import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import {
  NOTE_SIZE, COLOR_LEFT, COLOR_RIGHT, COLOR_WALL, WALL_UNIT, LANE_W,
  laneX, layerY, noteRotation, rotationToDir,
} from './constants.js';

const MOVE_TIME = 0.4; // seconds of fast "fly-in" before the jump starts
const MOVE_DIST = 60; // metres travelled during fly-in
const MISS_Z = 0.9; // a note passing this z is a miss

// Hit-box half extents (more generous than the visual cube, like the real game)
const HIT_HALF = new THREE.Vector3(0.36, 0.3, 0.45);
const LINK_HALF = new THREE.Vector3(0.36, 0.22, 0.45);
const BOMB_HALF = new THREE.Vector3(0.18, 0.18, 0.18);

const MIN_CUT_SPEED = 1.2; // m/s of the saber tip
const MAX_CUT_ANGLE = 70; // degrees of tolerance for directional notes
const GRACE = 0.09; // seconds a slow touch may turn into a valid swing

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _vel = new THREE.Vector3();
const _n = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _box = new THREE.Box3();

function makeArrowGeometry() {
  const s = NOTE_SIZE;
  const shape = new THREE.Shape();
  // chevron pointing down (-Y)
  shape.moveTo(-s * 0.36, s * 0.04);
  shape.lineTo(s * 0.36, s * 0.04);
  shape.lineTo(0, -s * 0.22);
  shape.closePath();
  const g = new THREE.ShapeGeometry(shape);
  g.translate(0, -s * 0.08, s / 2 + 0.002);
  return g;
}

function segmentHitsBox(p0, p1, box) {
  // Slab test for segment p0->p1 against an AABB
  let tmin = 0;
  let tmax = 1;
  for (const ax of ['x', 'y', 'z']) {
    const d = p1[ax] - p0[ax];
    if (Math.abs(d) < 1e-9) {
      if (p0[ax] < box.min[ax] || p0[ax] > box.max[ax]) return false;
    } else {
      let t1 = (box.min[ax] - p0[ax]) / d;
      let t2 = (box.max[ax] - p0[ax]) / d;
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return false;
    }
  }
  return true;
}

export class NoteManager {
  constructor(scene, effects, callbacks) {
    this.scene = scene;
    this.effects = effects;
    this.cb = callbacks; // { onCut(note, saber, info), onMiss(note), onBadCut(note, saber, reason), onBomb(note, saber) }
    this.root = new THREE.Group();
    scene.add(this.root);

    this.colors = [new THREE.Color(COLOR_LEFT), new THREE.Color(COLOR_RIGHT)];

    // Shared geometries & materials
    this.bodyGeo = new RoundedBoxGeometry(NOTE_SIZE, NOTE_SIZE, NOTE_SIZE, 3, 0.07);
    this.linkGeo = new RoundedBoxGeometry(NOTE_SIZE, NOTE_SIZE * 0.28, NOTE_SIZE, 2, 0.04);
    this.arrowGeo = makeArrowGeometry();
    this.dotGeo = new THREE.CircleGeometry(NOTE_SIZE * 0.11, 16);
    this.dotGeo.translate(0, 0, NOTE_SIZE / 2 + 0.002);
    this.linkDotGeo = new THREE.CircleGeometry(NOTE_SIZE * 0.08, 12);
    this.linkDotGeo.rotateX(-Math.PI / 2);
    this.linkDotGeo.translate(0, 0, 0);
    this.bodyMats = this.colors.map(
      (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.35, metalness: 0.15, emissive: c, emissiveIntensity: 0.18 }),
    );
    this.symbolMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.bombGeo = new THREE.IcosahedronGeometry(0.2, 0);
    this.bombMat = new THREE.MeshStandardMaterial({ color: 0x2a2a30, roughness: 0.3, metalness: 0.8, flatShading: true, emissive: 0x220008 });
    this.spikeGeo = new THREE.ConeGeometry(0.04, 0.16, 6);

    this.wallGeo = new THREE.BoxGeometry(1, 1, 1);
    this.wallEdgesGeo = new THREE.EdgesGeometry(this.wallGeo);
    this.wallMat = new THREE.MeshBasicMaterial({ color: COLOR_WALL, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide });
    this.wallEdgeMat = new THREE.LineBasicMaterial({ color: COLOR_WALL });

    this.pools = { note: [], bomb: [], link: [], wall: [] };
    this.active = [];
    this.activeWalls = [];
    this.reset(null);
  }

  setColors(left, right) {
    this.colors[0].set(left);
    this.colors[1].set(right);
    this.bodyMats[0].color.copy(this.colors[0]);
    this.bodyMats[0].emissive.copy(this.colors[0]);
    this.bodyMats[1].color.copy(this.colors[1]);
    this.bodyMats[1].emissive.copy(this.colors[1]);
  }

  reset(map) {
    for (const o of this.active) this.release(o);
    for (const w of this.activeWalls) this.releaseWall(w);
    this.active = [];
    this.activeWalls = [];
    this.map = map;
    this.noteIdx = 0;
    this.wallIdx = 0;
    if (map) {
      this.njs = map.njs;
      this.halfJump = map.halfJump;
      this.jumpDist = map.njs * map.halfJump; // half jump distance
      this.spawnLead = map.halfJump + MOVE_TIME;
    }
  }

  // ----- object pools -------------------------------------------------------
  acquire(note) {
    const kind = note.kind;
    const pool = this.pools[kind];
    let obj = pool.pop();
    if (!obj) obj = this.createObject(kind);
    if (kind !== 'bomb') {
      obj.body.material = this.bodyMats[note.color];
      obj.arrow.visible = kind === 'note' && note.dir !== 8;
      obj.dot.visible = kind === 'note' && note.dir === 8;
    }
    obj.group.visible = true;
    obj.note = note;
    obj.done = false;
    obj.cut = false;
    obj.touchSaber = null;
    obj.touchT = 0;
    obj.rot = noteRotation(note.dir, note.angle);
    obj.cutDir = rotationToDir(obj.rot);
    obj.targetX = laneX(note.x);
    obj.targetY = layerY(note.y);
    // Bombs spin slowly
    obj.spin = kind === 'bomb' ? Math.random() * Math.PI : 0;
    this.root.add(obj.group);
    return obj;
  }

  createObject(kind) {
    const group = new THREE.Group();
    const obj = { kind, group };
    if (kind === 'bomb') {
      const body = new THREE.Mesh(this.bombGeo, this.bombMat);
      group.add(body);
      const dirs = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1], [0.6, 0.6, 0.5], [-0.6, -0.6, -0.5]];
      for (const d of dirs) {
        const spike = new THREE.Mesh(this.spikeGeo, this.bombMat);
        const v = new THREE.Vector3(...d).normalize();
        spike.position.copy(v).multiplyScalar(0.2);
        spike.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), v);
        group.add(spike);
      }
      obj.body = body;
    } else if (kind === 'link') {
      obj.body = new THREE.Mesh(this.linkGeo, this.bodyMats[0]);
      group.add(obj.body);
      obj.arrow = new THREE.Mesh(this.arrowGeo, this.symbolMat);
      obj.arrow.visible = false;
      obj.dot = new THREE.Mesh(this.dotGeo, this.symbolMat);
      obj.dot.scale.set(0.8, 0.8, 1);
      obj.dot.position.z = 0;
      // dot on the front face of the flat link
      obj.dot.geometry = new THREE.CircleGeometry(NOTE_SIZE * 0.09, 12);
      obj.dot.geometry.translate(0, 0, NOTE_SIZE / 2 + 0.002);
      group.add(obj.dot);
    } else {
      obj.body = new THREE.Mesh(this.bodyGeo, this.bodyMats[0]);
      group.add(obj.body);
      obj.arrow = new THREE.Mesh(this.arrowGeo, this.symbolMat);
      obj.dot = new THREE.Mesh(this.dotGeo, this.symbolMat);
      group.add(obj.arrow, obj.dot);
    }
    return obj;
  }

  release(obj) {
    obj.group.visible = false;
    this.root.remove(obj.group);
    this.pools[obj.kind].push(obj);
  }

  acquireWall(wall) {
    let w = this.pools.wall.pop();
    if (!w) {
      const group = new THREE.Group();
      const mesh = new THREE.Mesh(this.wallGeo, this.wallMat);
      const edges = new THREE.LineSegments(this.wallEdgesGeo, this.wallEdgeMat);
      group.add(mesh, edges);
      w = { group };
    }
    w.wall = wall;
    const width = Math.abs(wall.w) * LANE_W;
    const left = wall.w >= 0 ? (wall.x - 2) * LANE_W : (wall.x - 2 + wall.w) * LANE_W;
    // Height: layers are 0..2 from the floor; height in "layer units" of WALL_UNIT
    const bottom = Math.max(0, wall.y * WALL_UNIT * 1.05);
    const height = Math.max(0.05, Math.abs(wall.h) * WALL_UNIT);
    w.cx = left + width / 2;
    w.cy = bottom + height / 2;
    w.width = width;
    w.height = height;
    w.depth = Math.max(0.05, (wall.endTime - wall.time) * this.njs);
    w.group.scale.set(width, height, w.depth);
    w.group.visible = true;
    this.root.add(w.group);
    return w;
  }

  releaseWall(w) {
    w.group.visible = false;
    this.root.remove(w.group);
    this.pools.wall.push(w);
  }

  // ----- motion ---------------------------------------------------------------
  /** Computes the note's world position at song time t. Returns progress info. */
  positionNote(obj, t) {
    const n = obj.note;
    const dt = n.time - t; // seconds until hit
    let z;
    let y = obj.targetY;
    let rot = obj.rot;
    const hj = this.halfJump;
    if (dt > hj) {
      // fly-in phase
      const p = Math.min(1, (dt - hj) / MOVE_TIME);
      z = -this.jumpDist - p * MOVE_DIST;
      y = layerY(0) - 0.25;
      rot = 0;
    } else {
      z = -dt * this.njs;
      // jump: rise from below to the target layer during the first half of the jump
      const p = 1 - dt / hj; // 0 at jump start, 1 at hit
      const rise = Math.min(1, p * 2);
      const ease = 1 - (1 - rise) * (1 - rise);
      y = layerY(0) - 0.25 + (obj.targetY - layerY(0) + 0.25) * ease;
      const rp = Math.min(1, p * 3);
      rot = obj.rot * (1 - (1 - rp) ** 3);
    }
    obj.group.position.set(obj.targetX, y, z);
    if (obj.kind === 'bomb') {
      obj.group.rotation.set(obj.spin + t, obj.spin * 0.7 + t * 0.6, 0);
    } else {
      obj.group.rotation.set(0, 0, rot);
    }
    return z;
  }

  update(t, dt, sabers, autoplay) {
    if (!this.map) return;
    const notes = this.map.notes;
    // spawn
    while (this.noteIdx < notes.length && notes[this.noteIdx].time - this.spawnLead <= t) {
      const n = notes[this.noteIdx++];
      if (n.time < t - 0.3) continue; // skip notes far in the past (seeking)
      this.active.push(this.acquire(n));
    }
    const walls = this.map.walls;
    while (this.wallIdx < walls.length && walls[this.wallIdx].time - this.spawnLead <= t) {
      const w = walls[this.wallIdx++];
      if (w.endTime < t) continue;
      this.activeWalls.push(this.acquireWall(w));
    }

    // move + test
    for (let i = this.active.length - 1; i >= 0; i--) {
      const obj = this.active[i];
      const z = this.positionNote(obj, t);
      obj.group.updateMatrixWorld(true);
      if (!obj.done) {
        if (autoplay) {
          const lead = 0.55 / this.njs;
          if (obj.kind !== 'bomb' && t >= obj.note.time - lead) {
            const saber = sabers[obj.note.color] || sabers[1];
            this.cutNote(obj, saber, this.evaluate(obj, saber, true));
          }
        } else if (z > -2.5 && z < MISS_Z + 0.5) {
          this.testCollision(obj, sabers, t);
        }
        if (!obj.done && z > MISS_Z) {
          if (obj.touchSaber) {
            // touched by a saber that never swung properly: a bad cut
            this.cutNote(obj, obj.touchSaber, this.evaluate(obj, obj.touchSaber));
          } else {
            obj.done = true;
            if (obj.kind !== 'bomb') this.cb.onMiss(obj.note);
          }
        }
      }
      if (obj.done && obj.cut) {
        this.release(obj);
        this.active.splice(i, 1);
        continue;
      }
      if (z > 4) {
        this.release(obj);
        this.active.splice(i, 1);
      }
    }

    for (let i = this.activeWalls.length - 1; i >= 0; i--) {
      const w = this.activeWalls[i];
      const zFront = this.wallZ(w.wall.time, t);
      const zBack = this.wallZ(w.wall.endTime, t);
      w.zFront = zFront;
      w.zBack = Math.min(zBack, zFront);
      const depth = Math.max(0.05, zFront - w.zBack);
      w.group.scale.z = depth;
      w.group.position.set(w.cx, w.cy, zFront - depth / 2);
      if (w.zBack > 3) {
        this.releaseWall(w);
        this.activeWalls.splice(i, 1);
      }
    }
  }

  wallZ(time, t) {
    const dt = time - t;
    const hj = this.halfJump;
    if (dt > hj) return -this.jumpDist - Math.min(1, (dt - hj) / MOVE_TIME) * MOVE_DIST - (dt - hj > MOVE_TIME ? (dt - hj - MOVE_TIME) * this.njs : 0);
    return -dt * this.njs;
  }

  /** True if a head position is inside any wall. */
  headInWall(head) {
    for (const w of this.activeWalls) {
      if (head.z > w.zBack && head.z < w.zFront &&
          Math.abs(head.x - w.cx) < w.width / 2 &&
          Math.abs(head.y - w.cy) < w.height / 2) return true;
    }
    return false;
  }

  testCollision(obj, sabers, t) {
    const half = obj.kind === 'bomb' ? BOMB_HALF : obj.kind === 'link' ? LINK_HALF : HIT_HALF;
    const p = obj.group.position;
    _box.min.set(p.x - half.x, p.y - half.y, p.z - half.z);
    _box.max.set(p.x + half.x, p.y + half.y, p.z + half.z);
    for (const saber of sabers) {
      if (!saber || !saber.active || !saber.hasPose) continue;
      const travel = saber.tip.distanceTo(saber.prevTip);
      const steps = Math.max(1, Math.min(12, Math.ceil(travel / 0.06)));
      for (let s = 1; s <= steps; s++) {
        const f = s / steps;
        _a.lerpVectors(saber.prevBase, saber.base, f);
        _b.lerpVectors(saber.prevTip, saber.tip, f);
        if (segmentHitsBox(_a, _b, _box)) {
          if (obj.kind === 'bomb') {
            obj.done = true;
            obj.cut = true;
            this.effects.spawnSparks(p, new THREE.Color(0xffffff), 60, 4);
            this.cb.onBomb(obj.note, saber);
          } else {
            const res = this.evaluate(obj, saber);
            // A slow / ambiguous touch gets a short grace period to become a proper swing
            const soft = res.reason === 'too-slow' || (res.reason === 'wrong-direction' && res.speed < 2.0);
            if (!res.good && soft && (!obj.touchSaber || t - obj.touchT < GRACE)) {
              if (!obj.touchSaber) {
                obj.touchSaber = saber;
                obj.touchT = t;
              }
              continue;
            }
            this.cutNote(obj, saber, res);
          }
          return;
        }
      }
    }
  }

  /** Judges a saber touching a note: colour, direction and speed. */
  evaluate(obj, saber, autoplay = false) {
    const note = obj.note;
    const vel = saber.tipVelocity(new THREE.Vector3());
    const speed = Math.hypot(vel.x, vel.y);
    let good = true;
    let reason = '';
    if (!autoplay) {
      if (saber.colorIndex !== note.color) {
        good = false;
        reason = 'wrong-color';
      } else if (note.kind === 'note' && note.dir !== 8) {
        const dx = obj.cutDir[0];
        const dy = obj.cutDir[1];
        const cos = speed > 0 ? (vel.x * dx + vel.y * dy) / speed : -1;
        const angle = (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
        if (angle > MAX_CUT_ANGLE) {
          good = false;
          reason = 'wrong-direction';
        }
      }
      if (good && note.kind === 'note' && speed < MIN_CUT_SPEED) {
        good = false;
        reason = 'too-slow';
      }
    }
    return { good, reason, vel, speed, autoplay };
  }

  cutNote(obj, saber, res) {
    const note = obj.note;
    obj.done = true;
    obj.cut = true;
    const p = obj.group.position;
    const { good, reason, speed, autoplay } = res;
    _vel.copy(res.vel);

    // Cut plane: contains the blade and the swing direction
    let cutDirW;
    if (autoplay || speed < 0.01) cutDirW = _tmp.set(obj.cutDir[0], obj.cutDir[1], 0).normalize();
    else cutDirW = _tmp.copy(_vel).normalize();
    _n.crossVectors(saber.dir, cutDirW);
    if (_n.lengthSq() < 1e-6) _n.set(-cutDirW.y, cutDirW.x, 0);
    _n.normalize();
    const dist = autoplay ? 0 : Math.abs(_n.dot(_a.subVectors(p, saber.tip)));

    const color = this.colors[note.color] || this.colors[1];
    const noteVel = _b.set(0, 0, this.njs);
    this.effects.spawnDebris(obj.body, color, p, _n, cutDirW, noteVel);
    this.effects.spawnSparks(p, color, good ? 30 : 12, 3, cutDirW);

    if (good) this.cb.onCut(note, saber, { distance: dist, autoplay, cutDir: cutDirW.clone(), position: p.clone() });
    else this.cb.onBadCut(note, saber, reason, p.clone());
  }

  /** Upcoming note targets for autoplay saber animation. */
  upcoming(colorIdx, t, max = 2) {
    const out = [];
    const notes = this.map ? this.map.notes : [];
    // search from slightly before the current spawn index
    let i = Math.max(0, this.noteIdx - 64);
    for (; i < notes.length && out.length < max; i++) {
      const n = notes[i];
      if (n.kind === 'bomb' || n.color !== colorIdx) continue;
      if (n.time < t - 0.3) continue;
      out.push(n);
    }
    return out;
  }
}
