// Notes, bombs, chains and walls of a modchart map (Noodle Extensions / Mapping Extensions),
// played the way Heck moves them. NoteManager hands a map with `map.noodle` to this class;
// plain maps never come here.
//
// Object motion (Beat Saber's, in the game's axes: -z is away from the player):
//   spawn            time - halfJump - MOVE_TIME (each object has its own NJS / half jump)
//   floor movement   flies in from MOVE_DIST further away during MOVE_TIME
//   jump             notes: z from -halfDist to +halfDist over 2 x halfJump, y on a parabola
//                    from the start layer up to the note's height at the player;
//                    walls: constant speed until their back has passed by halfDist
//   path time        notes: 0 at the jump start, 0.5 at the player, 1 at the jump end
//                    walls: 0 at the jump start, 1 when it despawns (jump + duration)
// then the Noodle transform: offsets / definite position (x 0.6 m), world rotation (object
// x track x path), local rotation, scale; dissolve, interactable and colour (walls).
//
// Walls are drawn as one InstancedMesh (edge-glow shader, per-instance colour / opacity), so
// thousands of walls cost two draw calls; walls without animation keep a precomputed matrix
// and only move along their direction each frame.

import * as THREE from 'three';
import { NoodleRuntime, ObjectState, qmul, qrot } from './Noodle.js';
import { laneX, layerY, getHeightOffset, noteRotation } from './constants.js';
import { createInstancedEdgeGlowMaterial } from './Models.js';

export const MOVE_TIME = 0.4; // keep in sync with Notes.js
const MOVE_DIST = 60;
const MISS_Z = 0.9;
const TAU = Math.PI * 2;

const HIT_HALF = new THREE.Vector3(0.36, 0.3, 0.45);
const LINK_HALF = new THREE.Vector3(0.36, 0.22, 0.45);
const BOMB_HALF = new THREE.Vector3(0.18, 0.18, 0.18);
const GRACE = 0.09;
const MIN_CUT_SPEED = 1.2;
const MAX_CUT_ANGLE = 70;

const ID_Q = new Float64Array([0, 0, 0, 1]);
const ONE3 = new Float64Array([1, 1, 1]);

const _S = new ObjectState();
const _q = new Float64Array(4);
const _q2 = new Float64Array(4);
const _v = new Float64Array(3);
const _m = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _inv = new THREE.Matrix4();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _p0 = new THREE.Vector3();
const _p1 = new THREE.Vector3();
const _vel = new THREE.Vector3();
const _tq = new THREE.Quaternion();
const _col = new THREE.Color();
const WHITE = new THREE.Color(0xffffff);
const _box = { min: new THREE.Vector3(), max: new THREE.Vector3() };
const AXES = ['x', 'y', 'z'];

function segmentHitsBox(p0, p1, box) {
  let tmin = 0;
  let tmax = 1;
  for (const ax of AXES) {
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

const srgbToLinear = (c) => (c < 0.04045 ? c * 0.0773993808 : ((c + 0.055) / 1.055) ** 2.4);
const inOutQuad =(t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Note height at the player for a (fractional) layer: Heck's line for Noodle maps, the game's otherwise. */
function hitHeight(layer, ne) {
  return ne ? 0.858333 + 0.525 * layer + getHeightOffset() : layerY(layer);
}

/**
 * Writes T(p) · R(q) · S(s) · T(0, h/2, -l/2) · S(w, h, l) (column-major) at out[o..o+15]:
 * a unit box scaled to a wall whose origin is its front bottom centre.
 */
function composeWall(px, py, pz, q, sx, sy, sz, w, h, l, out, o) {
  const x = q[0];
  const y = q[1];
  const z = q[2];
  const qw = q[3];
  const r00 = 1 - 2 * (y * y + z * z);
  const r10 = 2 * (x * y + z * qw);
  const r20 = 2 * (x * z - y * qw);
  const r01 = 2 * (x * y - z * qw);
  const r11 = 1 - 2 * (x * x + z * z);
  const r21 = 2 * (y * z + x * qw);
  const r02 = 2 * (x * z + y * qw);
  const r12 = 2 * (y * z - x * qw);
  const r22 = 1 - 2 * (x * x + y * y);
  const cx = sx * w;
  const cy = sy * h;
  const cz = sz * l;
  out[o] = r00 * cx;
  out[o + 1] = r10 * cx;
  out[o + 2] = r20 * cx;
  out[o + 3] = 0;
  out[o + 4] = r01 * cy;
  out[o + 5] = r11 * cy;
  out[o + 6] = r21 * cy;
  out[o + 7] = 0;
  out[o + 8] = r02 * cz;
  out[o + 9] = r12 * cz;
  out[o + 10] = r22 * cz;
  out[o + 11] = 0;
  // centre: p + R · (0, sy·h/2, -sz·l/2)
  out[o + 12] = px + r01 * cy * 0.5 - r02 * cz * 0.5;
  out[o + 13] = py + r11 * cy * 0.5 - r12 * cz * 0.5;
  out[o + 14] = pz + r21 * cy * 0.5 - r22 * cz * 0.5;
  out[o + 15] = 1;
}

/** Sorted spawn times for objects (index order into `list`). */
function spawnOrder(list, hjOf) {
  const order = list.map((_, i) => i);
  const st = list.map((o) => o.time - hjOf(o) - MOVE_TIME);
  order.sort((a, b) => st[a] - st[b] || a - b);
  return { order, at: Float64Array.from(order.map((i) => st[i])) };
}

/** First index with at[i] > t. */
function upperBound(at, t) {
  let lo = 0;
  let hi = at.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (at[m] <= t) lo = m + 1;
    else hi = m;
  }
  return lo;
}

const STRIDE = 28; // floats per wall instance (see EDGE_INST_VERT in Models.js)
const CHUNK = 512; // walls per GPU buffer (56 KB)

/**
 * A batch of walls drawn as instanced meshes (edge-glow material from NoteManager), the
 * per-instance data of each chunk of CHUNK walls in one interleaved buffer.
 *   ring batches (walls that only travel): a wall keeps its slot for life; slots are handed
 *     out round the ring, so the walls spawning in a frame land in the same chunk and only
 *     that chunk is uploaded; the GPU moves the walls and hides them after their despawn time
 *   compact batches (animated walls): refilled and uploaded every frame
 * A changed chunk is uploaded whole (partial updates of a buffer in use can stall the
 * driver), into the other of its two GPU copies: they alternate frame by frame (same data on
 * the CPU), so a frame never writes a buffer the previous frame drew from. Draw calls: two
 * per chunk in use (back and front faces), however many walls.
 */
class WallBatch {
  constructor(nm, name, capacity, ring) {
    this.nm = nm;
    this.name = name;
    this.ring = ring;
    this.capacity = 0;
    this.chunks = []; // { array, views: [{ mesh, buf, dirty }] x 2 }
    this.flip = 0;
    this.count = 0; // ring: high-water slot + 1 (drawn range)
    this.head = 0; // ring: next slot to try
    this.used = new Uint8Array(0); // ring: 1 = live slot
    this.grow(Math.max(16, capacity));
  }

  /** The first chunk's mesh drawn this frame (shares the material with the others). */
  get mesh() {
    return this.chunks[0].views[this.flip].mesh;
  }

  /** Instances drawn this frame. */
  get drawn() {
    let n = 0;
    for (const c of this.chunks) n += c.views[this.flip].mesh.geometry.instanceCount;
    return n;
  }

  grow(n) {
    const cap = Math.ceil(Math.max(n, this.capacity * 1.5) / CHUNK) * CHUNK;
    while (this.chunks.length * CHUNK < cap) this.chunks.push(this.makeChunk());
    const used = new Uint8Array(cap);
    used.set(this.used);
    this.used = used;
    this.capacity = cap;
  }

  makeChunk() {
    const array = new Float32Array(CHUNK * STRIDE);
    const src = this.nm.wallGeo;
    const views = [0, 1].map(() => {
      const geo = new THREE.InstancedBufferGeometry();
      geo.index = src.index.clone(); // own copies: disposing this geometry must not touch the shared box
      geo.setAttribute('position', src.attributes.position.clone());
      geo.setAttribute('normal', src.attributes.normal.clone());
      const buf = new THREE.InstancedInterleavedBuffer(array, STRIDE, 1);
      buf.setUsage(THREE.DynamicDrawUsage);
      const at = (name, offset) => geo.setAttribute(name, new THREE.InterleavedBufferAttribute(buf, 4, offset));
      at('instM0', 0);
      at('instM1', 4);
      at('instM2', 8);
      at('instM3', 12);
      at('instColor', 16);
      at('instMotion', 20);
      at('instTiming', 24);
      geo.instanceCount = 0;
      const mesh = new THREE.Mesh(geo, this.nm.instancedWallMaterial());
      mesh.frustumCulled = false;
      mesh.name = this.name;
      mesh.visible = false;
      this.nm.root.add(mesh);
      return { mesh, buf, dirty: true };
    });
    return { array, views };
  }

  /** A slot for a new wall (ring batches): the next free one round the ring. */
  alloc() {
    const cap = this.capacity;
    for (let k = 0; k < cap; k++) {
      const s = (this.head + k) % cap;
      if (this.used[s]) continue;
      this.used[s] = 1;
      this.head = (s + 1) % cap;
      if (s + 1 > this.count) this.count = s + 1;
      return s;
    }
    const s = cap; // full: grow (rare, the size is the map's peak plus a margin)
    this.grow(cap + 1);
    this.used[s] = 1;
    this.head = s + 1;
    this.count = s + 1;
    return s;
  }

  /** Frees a slot (the wall is already hidden by the GPU after its despawn time). */
  release(slot) {
    this.used[slot] = 0;
  }

  /**
   * Writes a wall: matrix (16 floats), colour (rgb, r < 0: the wall colour), opacity, and for
   * moving walls the travel direction plus jump start / half jump distance / NJS / despawn time.
   */
  write(slot, m, color, alpha, motion, jumpStart, halfDist, njs, end) {
    if (slot >= this.capacity) this.grow(slot + 1);
    const c = this.chunks[(slot / CHUNK) | 0];
    const local = slot % CHUNK;
    const a = c.array;
    const o = local * STRIDE;
    for (let k = 0; k < 16; k++) a[o + k] = m[k];
    a[o + 16] = color[3] ? color[0] : -1;
    a[o + 17] = color[1];
    a[o + 18] = color[2];
    a[o + 19] = alpha;
    if (motion) {
      a[o + 20] = motion[0];
      a[o + 21] = motion[1];
      a[o + 22] = motion[2];
      a[o + 23] = 1;
      a[o + 24] = jumpStart;
      a[o + 25] = halfDist;
      a[o + 26] = njs;
      a[o + 27] = end;
    } else a[o + 23] = 0;
    c.views[0].dirty = true;
    c.views[1].dirty = true;
  }

  clear() {
    this.count = 0;
    this.head = 0;
    this.used.fill(0);
    for (const c of this.chunks) {
      c.array.fill(0);
      for (const v of c.views) {
        v.dirty = true;
        v.mesh.geometry.instanceCount = 0;
        v.mesh.visible = false;
      }
    }
  }

  /** Shows this frame's copy of each chunk, uploading the chunks written since it was drawn. */
  flush(count = this.count) {
    this.flip ^= 1;
    for (let k = 0; k < this.chunks.length; k++) {
      const c = this.chunks[k];
      const n = Math.max(0, Math.min(CHUNK, count - k * CHUNK));
      c.views[this.flip ^ 1].mesh.visible = false;
      const v = c.views[this.flip];
      v.mesh.visible = n > 0;
      v.mesh.geometry.instanceCount = n;
      if (v.dirty && n > 0) {
        v.dirty = false;
        v.buf.needsUpdate = true;
      }
    }
  }

  dispose() {
    for (const c of this.chunks) {
      for (const v of c.views) {
        v.mesh.removeFromParent();
        v.mesh.geometry.dispose();
      }
    }
  }
}

class WallRec {
  constructor() {
    this.m = new Float64Array(16); // instance matrix this frame
    this.base = new Float64Array(16); // static walls: matrix at z = 0
    this.dir = new Float64Array(3); // static walls: world direction of +z (three axes)
    this.wq = new Float64Array(4);
    this.lq = new Float64Array(4);
    this.s0 = new Float64Array(3);
    this.color = new Float64Array(4); // linear rgb, w = use it
    // every field set up front (stable object shape, numbers stored unboxed)
    this.wall = null;
    this.nd = null;
    this.pg = null;
    this.static = false;
    this.fake = false;
    this.collide = false;
    this.slot = -1;
    this.hj = 0.5;
    this.njs = 0.5;
    this.halfDist = 0.5;
    this.dur = 0.5;
    this.total = 0.5;
    this.W = 0.5;
    this.X = 0.5;
    this.Y = 0.5;
    this.H = 0.5;
    this.L = 0.5;
    this.zu = 0.5;
    this.alpha = 0.5;
  }
}

export class NoodleField {
  constructor(nm, map) {
    this.nm = nm;
    this.map = map;
    this.ne = !!map.noodle.ne;
    this.rt = new NoodleRuntime(map.noodle, nm.root);
    this.baseHj = map.halfJump;
    this.baseNjs = map.njs;
    const hjOf = (o) => (o.nd && o.nd.hj) || this.baseHj;
    this.notes = map.notes;
    this.walls = map.walls;
    this.noteSpawn = spawnOrder(this.notes, hjOf);
    this.wallSpawn = spawnOrder(this.walls, hjOf);
    this.noteK = 0;
    this.wallK = 0;
    this.from = -Infinity;
    this.wallsOn = [];
    this.wallPool = [];
    this.linked = new Map(); // link name -> active objects (v3 `link`)
    this.playerPos = new THREE.Vector3();
    // walls that only travel (no tracks / animation) move on the GPU; animated ones are
    // recomputed every frame
    const isStatic = (w) => !w.nd || (!w.nd.tracks && !w.nd.anim);
    // sized for the map's peak plus a margin (spawns land before despawns within a frame)
    const size = (n) => Math.ceil(n * 1.1) + 32;
    this.statics = new WallBatch(nm, 'noodle-walls', size(this.maxConcurrentWalls(isStatic)), true);
    this.dynamics = new WallBatch(nm, 'noodle-walls-animated', size(this.maxConcurrentWalls((w) => !isStatic(w))), false);
  }

  dispose() {
    this.clearWalls();
    this.rt.dispose();
    this.statics.dispose();
    this.dynamics.dispose();
  }

  /** Most walls (passing `filter`) alive at once (sweep over spawn / despawn times): a batch size. */
  maxConcurrentWalls(filter) {
    const ev = [];
    for (const w of this.walls) {
      if (!filter(w)) continue;
      const hj = (w.nd && w.nd.hj) || this.baseHj;
      const start = w.time - hj - MOVE_TIME;
      const end = w.time - hj + 2 * hj + Math.max(0, w.endTime - w.time);
      ev.push([start, 1], [end, -1]);
    }
    ev.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    let n = 0;
    let max = 0;
    for (const [, d] of ev) {
      n += d;
      if (n > max) max = n;
    }
    return max;
  }

  // ---------------------------------------------------------------------------
  // Seeking

  /** Practice mode: the field at song time t, objects from `from` on (fakes / scenery always). */
  seek(t, from = t) {
    const nm = this.nm;
    for (const o of nm.active) this.releaseNote(o);
    nm.active.length = 0;
    this.clearWalls();
    this.rt.seek(t);
    this.from = from;
    // notes alive at t: spawned and not past their jump end
    const ns = this.noteSpawn;
    this.noteK = upperBound(ns.at, t);
    let maxLife = 0;
    for (const n of this.notes) maxLife = Math.max(maxLife, 2 * ((n.nd && n.nd.hj) || this.baseHj));
    for (let k = upperBound(ns.at, t - maxLife - MOVE_TIME - 0.01); k < this.noteK; k++) {
      const n = this.notes[ns.order[k]];
      const hj = (n.nd && n.nd.hj) || this.baseHj;
      if (t >= n.time + hj) continue;
      if (!n.fake && n.time < from) continue;
      if (n.kind === 'bomb' && !nm.showBombs) continue;
      nm.active.push(this.acquireNote(n));
    }
    const ws = this.wallSpawn;
    this.wallK = upperBound(ws.at, t);
    if (nm.showWalls) {
      for (let k = 0; k < this.wallK; k++) {
        const w = this.walls[ws.order[k]];
        const hj = (w.nd && w.nd.hj) || this.baseHj;
        if (t > w.time + hj + Math.max(0, w.endTime - w.time)) continue;
        if (!w.fake && w.endTime < from) continue;
        this.spawnWall(w);
      }
    }
    this.rt.update(t);
  }

  clearWalls() {
    for (const r of this.wallsOn) this.wallPool.push(r);
    this.wallsOn.length = 0;
    this.statics.clear();
    this.dynamics.clear();
  }

  // ---------------------------------------------------------------------------
  // Per frame

  update(t, dt, sabers, autoplay) {
    const nm = this.nm;
    this.rt.update(t);
    // spawn
    const ns = this.noteSpawn;
    while (this.noteK < ns.order.length && ns.at[this.noteK] <= t) {
      const n = this.notes[ns.order[this.noteK++]];
      if (!n.fake && (n.time < t - 0.3 || n.time < this.from)) continue; // skipped by a seek
      if (t >= n.time + ((n.nd && n.nd.hj) || this.baseHj)) continue; // already gone (clock jumped)
      if (n.kind === 'bomb' && !nm.showBombs) continue;
      nm.active.push(this.acquireNote(n));
    }
    const ws = this.wallSpawn;
    while (this.wallK < ws.order.length && ws.at[this.wallK] <= t) {
      const w = this.walls[ws.order[this.wallK++]];
      if (!nm.showWalls) continue;
      if (!w.fake && w.endTime < this.from) continue;
      if (t > w.endTime + ((w.nd && w.nd.hj) || this.baseHj)) continue; // already gone (clock jumped)
      this.spawnWall(w);
    }
    // notes
    const act = nm.active;
    for (let i = act.length - 1; i >= 0; i--) {
      const obj = act[i];
      const gone = this.positionNote(obj, t);
      if (!gone && !obj.done) this.judge(obj, t, sabers, autoplay);
      if (gone || (obj.done && obj.cut)) {
        // a real note that skipped past the player (time animation) without being judged: a miss
        if (gone && !obj.done && !obj.fake && obj.kind !== 'bomb') this.nm.cb.onMiss(obj.note);
        this.releaseNote(obj);
        act.splice(i, 1);
      }
    }
    // walls
    this.updateWalls(t);
  }

  // ---------------------------------------------------------------------------
  // Notes

  acquireNote(note) {
    const nm = this.nm;
    const obj = nm.acquire(note);
    if (!obj.inner) {
      // a level for the cut-direction roll under the Noodle transform (scale applies unrolled)
      const inner = new THREE.Group();
      for (const c of [...obj.group.children]) inner.add(c);
      obj.group.add(inner);
      obj.inner = inner;
      obj.wp = new THREE.Vector3();
      obj.wq = new THREE.Quaternion();
      obj.inv = new THREE.Matrix4();
      obj.showArrow = false;
      obj.showDot = false;
    }
    obj.group.rotation.set(0, 0, 0);
    obj.showArrow = !!(obj.arrow && obj.arrow.visible);
    obj.showDot = !!(obj.dot && obj.dot.visible);
    const nd = note.nd || null;
    obj.nd = nd;
    obj.static = !nd || (!nd.tracks && !nd.anim);
    obj.hj = (nd && nd.hj) || this.baseHj;
    obj.njs = (nd && nd.njsV) || this.baseNjs;
    obj.halfDist = obj.njs * obj.hj;
    obj.X = laneX(note.x);
    const flip = nd && nd.flip;
    obj.flipX = flip && flip[0] !== null ? laneX(flip[0] + 2) : obj.X;
    const fy = flip && flip[1] !== null ? flip[1] : 0;
    obj.yAvoid = fy > 0 ? fy * 0.45 : fy * 0.15;
    obj.hitY = hitHeight(note.y, this.ne);
    const sl = nd && nd.noGravity ? note.y : note.sl || 0;
    obj.startY = 0.25 + 0.6 * sl;
    obj.wq0 = (nd && nd.worldRot) || ID_Q;
    obj.lq0 = (nd && nd.localRot) || ID_Q;
    obj.s0 = (nd && nd.scale) || ONE3;
    obj.fake = !!note.fake;
    obj.uninteractable = !!(nd && nd.uninteractable);
    obj.cuttable = !obj.uninteractable;
    obj.e = -Infinity;
    obj.parentGroup = null;
    if (nd && nd.link) {
      let l = this.linked.get(nd.link);
      if (!l) this.linked.set(nd.link, (l = []));
      l.push(obj);
    }
    note._obj = obj;
    return obj;
  }

  releaseNote(obj) {
    const note = obj.note;
    if (note && note._obj === obj) note._obj = null;
    const link = obj.nd && obj.nd.link;
    if (link) {
      const l = this.linked.get(link);
      const i = l ? l.indexOf(obj) : -1;
      if (i >= 0) l.splice(i, 1);
    }
    obj.parentGroup = null;
    this.nm.release(obj);
  }

  /** Moves a note to song time t; true when it has despawned. */
  positionNote(obj, t) {
    const note = obj.note;
    const hj = obj.hj;
    const jd = 2 * hj;
    let e = t - (note.time - hj);
    let tn = e / jd;
    const S = _S;
    if (obj.static) S.clear();
    else {
      const tp = this.rt.timeOf(obj.nd);
      if (tp !== null && e >= 0) {
        tn = tp;
        e = tp * jd;
      }
      this.rt.objectState(obj.nd, tn, S);
    }
    if (tn >= 1 || t - note.time > hj + 20) return true;
    obj.e = e;
    // local position (before the world rotation)
    let lx;
    let ly;
    let lz;
    if (e < 0) {
      const f = Math.max(0, 1 + e / MOVE_TIME);
      lx = obj.flipX;
      ly = obj.startY;
      lz = -(obj.halfDist + MOVE_DIST * (1 - f));
      if (S.hasPos) {
        lx += S.pos[0];
        ly += S.pos[1];
        lz += S.pos[2];
      }
    } else if (S.hasDef) {
      lx = S.def[0] + obj.X;
      ly = S.def[1] + obj.hitY;
      lz = S.def[2];
    } else {
      const p = e / hj;
      lx = obj.X;
      if (tn < 0.25 && obj.flipX !== obj.X) lx = obj.flipX + (obj.X - obj.flipX) * inOutQuad(tn * 4);
      ly = obj.startY + (obj.hitY - obj.startY) * (1 - (1 - p) * (1 - p));
      if (obj.yAvoid !== 0 && tn < 0.25) ly += (0.5 - Math.cos(tn * 4 * TAU) * 0.5) * obj.yAvoid;
      lz = -(obj.halfDist - obj.njs * e);
      if (S.hasPos) {
        lx += S.pos[0];
        ly += S.pos[1];
        lz += S.pos[2];
      }
    }
    // world rotation (object x track x path), then local rotation
    const W = S.hasRot ? qmul(obj.wq0, S.rot, _q) : obj.wq0;
    _v[0] = lx;
    _v[1] = ly;
    _v[2] = lz;
    if (W !== ID_Q) qrot(W, _v, _v);
    const g = obj.group;
    g.position.set(_v[0], _v[1], _v[2]);
    let Q = W;
    if (obj.lq0 !== ID_Q) Q = qmul(Q, obj.lq0, _q2);
    if (S.hasLRot) Q = qmul(Q, S.lrot, _q2);
    g.quaternion.set(Q[0], Q[1], Q[2], Q[3]);
    const s0 = obj.s0;
    if (S.hasScale) g.scale.set(s0[0] * S.scale[0], s0[1] * S.scale[1], s0[2] * S.scale[2]);
    else g.scale.set(s0[0], s0[1], s0[2]);
    // cut direction roll (eases in at the start of the jump), bombs spin
    if (obj.kind === 'bomb') obj.inner.rotation.set(obj.spin + t, obj.spin * 0.7 + t * 0.6, 0);
    else {
      const rp = e <= 0 ? 0 : Math.min(1, (e / hj) * 3);
      obj.inner.rotation.set(0, 0, obj.rot * (1 - (1 - rp) ** 3));
    }
    // dissolve: the body shrinks away (Heck's fallback look), arrows separately
    const dis = S.hasDis ? clamp01(S.dis) : 1;
    const body = obj.bodyRoot || obj.body;
    body.visible = dis > 0.005;
    body.scale.setScalar(Math.max(dis, 1e-3));
    if (obj.kind !== 'bomb') {
      const da = S.hasDisA ? clamp01(S.disA) : 1;
      if (obj.arrow) {
        obj.arrow.visible = obj.showArrow && da > 0.005;
        obj.arrow.scale.setScalar(Math.max(da, 1e-3));
      }
      if (obj.dot) {
        obj.dot.visible = obj.showDot && da > 0.005;
        obj.dot.scale.setScalar(Math.max(da, 1e-3));
      }
    }
    obj.cuttable = S.hasInt ? S.int >= 1 : !obj.uninteractable;
    // track parent
    const pg = obj.static ? null : this.rt.parentFor(obj.nd.tracks);
    const parent = pg || this.nm.root;
    if (g.parent !== parent) parent.add(g);
    obj.parentGroup = pg;
    g.updateMatrix();
    g.updateWorldMatrix(false, false);
    obj.wp.setFromMatrixPosition(g.matrixWorld);
    return false;
  }

  /** Cuts, misses and saber hits of a live note. */
  judge(obj, t, sabers, autoplay) {
    const note = obj.note;
    const e = obj.e;
    if (autoplay) {
      if (!obj.fake && obj.kind !== 'bomb' && obj.cuttable && e >= obj.hj - 0.55 / obj.njs) {
        const saber = sabers[note.color] || sabers[1];
        this.cut(obj, saber, this.evaluate(obj, saber, true));
      }
    } else if (obj.cuttable && this.near(obj)) {
      this.testCollision(obj, sabers, t);
    }
    if (!obj.done && e > obj.hj + MISS_Z / obj.njs) {
      if (obj.touchSaber) this.cut(obj, obj.touchSaber, this.evaluate(obj, obj.touchSaber));
      else {
        obj.done = true;
        if (obj.kind !== 'bomb' && !obj.fake) this.nm.cb.onMiss(note);
      }
    }
  }

  near(obj) {
    const p = obj.wp;
    const c = this.playerPos;
    const dx = p.x - c.x;
    const dy = p.y - (c.y + 1.2);
    const dz = p.z - c.z;
    return dx * dx + dy * dy + dz * dz < 2.6 * 2.6;
  }

  testCollision(obj, sabers, t) {
    const half = obj.kind === 'bomb' ? BOMB_HALF : obj.kind === 'link' ? LINK_HALF : HIT_HALF;
    _box.min.set(-half.x, -half.y, -half.z);
    _box.max.set(half.x, half.y, half.z);
    obj.inv.copy(obj.group.matrixWorld).invert();
    for (const saber of sabers) {
      if (!saber || !saber.active || !saber.hasPose) continue;
      const travel = saber.tip.distanceTo(saber.prevTip);
      const steps = Math.max(1, Math.min(12, Math.ceil(travel / 0.06)));
      for (let s = 1; s <= steps; s++) {
        const f = s / steps;
        _p0.lerpVectors(saber.prevBase, saber.base, f).applyMatrix4(obj.inv);
        _p1.lerpVectors(saber.prevTip, saber.tip, f).applyMatrix4(obj.inv);
        if (!segmentHitsBox(_p0, _p1, _box)) continue;
        if (obj.kind === 'bomb') {
          obj.done = true;
          obj.cut = true;
          this.nm.effects.spawnSparks(obj.wp, WHITE, 60, 4);
          if (!obj.fake) this.nm.cb.onBomb(obj.note, saber);
          return;
        }
        const res = this.evaluate(obj, saber);
        const nd = obj.nd;
        // Noodle: notes that cannot be cut the wrong way just ignore such a touch
        if (!res.good && nd && ((res.reason === 'wrong-direction' && nd.noBadDir) || (res.reason === 'too-slow' && nd.noBadSpeed) || (res.reason === 'wrong-color' && nd.noBadSaber))) continue;
        const soft = res.reason === 'too-slow' || (res.reason === 'wrong-direction' && res.speed < 2.0);
        if (!res.good && soft && (!obj.touchSaber || t - obj.touchT < GRACE)) {
          if (!obj.touchSaber) {
            obj.touchSaber = saber;
            obj.touchT = t;
          }
          continue;
        }
        this.cut(obj, saber, res);
        return;
      }
    }
  }

  /** Like NoteManager.evaluate, with the saber's swing measured in the note's own frame. */
  evaluate(obj, saber, autoplay = false) {
    const note = obj.note;
    const vel = saber.tipVelocity(_vel);
    // note frame: world rotation of the note including its roll
    obj.inner.getWorldQuaternion(obj.wq);
    _tq.copy(obj.wq).invert();
    const lv = _a.copy(vel).applyQuaternion(_tq);
    const speed = Math.hypot(lv.x, lv.y);
    // the world cut direction (for the cut plane): local -Y
    const d = _b.set(0, -1, 0).applyQuaternion(obj.wq);
    const dl = Math.hypot(d.x, d.y) || 1;
    obj.cutDir[0] = d.x / dl;
    obj.cutDir[1] = d.y / dl;
    let good = true;
    let reason = '';
    if (!autoplay) {
      if (saber.colorIndex !== note.color) {
        good = false;
        reason = 'wrong-color';
      } else if (note.kind === 'note' && note.dir !== 8) {
        const cos = speed > 0 ? -lv.y / speed : -1;
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
    return { good, reason, vel, speed: Math.hypot(vel.x, vel.y), autoplay };
  }

  cut(obj, saber, res) {
    this.nm.cutNote(obj, saber, res);
    // v3 `link`: notes with the same link are cut together
    const link = obj.nd && obj.nd.link;
    if (!link) return;
    const l = this.linked.get(link);
    if (!l) return;
    for (const o of [...l]) {
      if (o === obj || o.done) continue;
      this.nm.cutNote(o, saber, { ...res, vel: res.vel.clone() });
    }
  }

  /** World position of a live note (autoplay sabers aim at it), or null. */
  liveTarget(note) {
    const o = note._obj;
    return o && !o.done ? o.wp : null;
  }

  // ---------------------------------------------------------------------------
  // Walls

  spawnWall(w) {
    const r = this.wallPool.pop() || new WallRec();
    const nd = w.nd || null;
    r.wall = w;
    r.nd = nd;
    r.static = !nd || (!nd.tracks && !nd.anim);
    r.hj = (nd && nd.hj) || this.baseHj;
    r.njs = (nd && nd.njsV) || this.baseNjs;
    r.halfDist = r.njs * r.hj;
    r.dur = Math.max(0, w.endTime - w.time);
    r.total = 2 * r.hj + r.dur;
    const width = w.w * 0.6;
    r.W = width;
    r.X = (w.x - 2) * 0.6 + width / 2;
    r.Y = 0.1 + 0.6 * w.y + getHeightOffset();
    r.H = w.h * 0.6;
    const len = nd && nd.size && nd.size[2] !== null ? nd.size[2] * 0.6 : r.njs * r.dur;
    r.L = Math.abs(len) < 1e-4 ? 1e-4 : len;
    r.wq.set((nd && nd.worldRot) || ID_Q);
    r.lq.set((nd && nd.localRot) || ID_Q);
    r.s0.set((nd && nd.scale) || ONE3);
    r.fake = !!w.fake;
    r.collide = !r.fake && !(nd && nd.uninteractable);
    r.alpha = 1;
    r.color[3] = 0;
    if (this.nm.chroma && w.chroma != null) {
      _col.setHex(w.chroma);
      r.color[0] = _col.r;
      r.color[1] = _col.g;
      r.color[2] = _col.b;
      r.color[3] = 1;
    }
    r.slot = -1;
    r.zu = r.halfDist + MOVE_DIST;
    if (r.static) {
      // the wall at the player (z = 0) and the world direction it travels along: the GPU
      // moves it (WallBatch), it is uploaded once
      qmul(r.wq, r.lq, _q);
      _v[0] = r.X;
      _v[1] = r.Y;
      _v[2] = 0;
      qrot(r.wq, _v, _v);
      composeWall(_v[0], _v[1], _v[2], _q, r.s0[0], r.s0[1], r.s0[2], r.W, r.H, r.L, r.base, 0);
      _v[0] = 0;
      _v[1] = 0;
      _v[2] = 1;
      qrot(r.wq, _v, r.dir);
      r.slot = this.statics.alloc();
      this.statics.write(r.slot, r.base, r.color, 1, r.dir, w.time - r.hj, r.halfDist, r.njs, w.time - r.hj + r.total);
    }
    this.wallsOn.push(r);
    return r;
  }

  updateWalls(t) {
    const list = this.wallsOn;
    const rt = this.rt;
    const S = _S;
    let w = 0;
    for (let i = 0; i < list.length; i++) {
      const r = list[i];
      const wall = r.wall;
      let e = t - (wall.time - r.hj);
      let tn = e / r.total;
      if (!r.static) {
        const tp = rt.timeOf(r.nd);
        if (tp !== null && e > 0) {
          tn = tp;
          e = tp * r.total;
        }
      }
      if (tn > 1 || (r.static && e > r.total)) {
        if (r.slot >= 0) this.statics.release(r.slot);
        this.wallPool.push(r);
        continue;
      }
      list[w++] = r;
      // z of the front (game axes): flying in, then at the NJS
      const zu = e < 0 ? r.halfDist + MOVE_DIST * Math.min(1, -e / MOVE_TIME) : r.halfDist - r.njs * e;
      r.zu = zu;
      if (r.static) continue; // moved by the GPU
      const m = r.m;
      rt.objectState(r.nd, tn, S);
      let px;
      let py;
      let pz;
      if (S.hasDef) {
        // Heck evaluates the definite position over the clamped path time
        if (tn < 0 || tn > 1) rt.objectState(r.nd, clamp01(tn), S);
        px = S.def[0] + r.X;
        py = S.def[1] + r.Y;
        pz = S.def[2] + (e < 0 ? -(zu - r.halfDist) : 0);
      } else {
        px = r.X;
        py = r.Y;
        pz = -zu;
        if (S.hasPos) {
          px += S.pos[0];
          py += S.pos[1];
          pz += S.pos[2];
        }
      }
      const W = S.hasRot ? qmul(r.wq, S.rot, _q) : r.wq;
      _v[0] = px;
      _v[1] = py;
      _v[2] = pz;
      qrot(W, _v, _v);
      let Q = qmul(W, r.lq, _q2);
      if (S.hasLRot) Q = qmul(Q, S.lrot, _q2);
      const sx = S.hasScale ? r.s0[0] * S.scale[0] : r.s0[0];
      const sy = S.hasScale ? r.s0[1] * S.scale[1] : r.s0[1];
      const sz = S.hasScale ? r.s0[2] * S.scale[2] : r.s0[2];
      composeWall(_v[0], _v[1], _v[2], Q, sx, sy, sz, r.W, r.H, r.L, m, 0);
      r.alpha = S.hasDis ? clamp01(S.dis) : 1;
      r.collide = !r.fake && (S.hasInt ? S.int >= 1 : !(r.nd && r.nd.uninteractable));
      if (S.hasColor && this.nm.chroma) {
        let cr = Math.max(0, S.color[0]);
        let cg = Math.max(0, S.color[1]);
        let cb = Math.max(0, S.color[2]);
        const mx = Math.max(cr, cg, cb);
        if (mx > 1) {
          cr /= mx;
          cg /= mx;
          cb /= mx;
        }
        r.color[0] = srgbToLinear(cr);
        r.color[1] = srgbToLinear(cg);
        r.color[2] = srgbToLinear(cb);
        r.color[3] = 1;
      }
      // track parent: bake its world matrix into the instance
      const pg = rt.parentFor(r.nd.tracks);
      r.pg = pg;
      if (pg) {
        _m.fromArray(m);
        _m2.multiplyMatrices(pg.matrixWorld, _m);
        const el = _m2.elements;
        for (let k = 0; k < 16; k++) m[k] = el[k];
      }
    }
    list.length = w;
    this.statics.mesh.material.uniforms.songTime.value = t;
    this.statics.flush();
    // animated walls: refilled every frame, far ones first (latest spawned are the farthest)
    const dyn = this.dynamics;
    let n = 0;
    for (let i = list.length - 1; i >= 0; i--) {
      const r = list[i];
      if (r.static || r.alpha <= 0.002) continue;
      dyn.write(n++, r.m, r.color, r.alpha, null, 0, 0, 0, 0);
    }
    dyn.flush(n);
  }

  /** True if the head is inside an interactable wall (oriented boxes). */
  headInWall(head) {
    const list = this.wallsOn;
    for (let i = 0; i < list.length; i++) {
      const r = list[i];
      if (!r.collide) continue;
      const m = r.m;
      if (r.static) {
        const b = r.base;
        for (let k = 0; k < 12; k++) m[k] = b[k];
        m[12] = b[12] - r.zu * r.dir[0];
        m[13] = b[13] - r.zu * r.dir[1];
        m[14] = b[14] - r.zu * r.dir[2];
        m[15] = 1;
      }
      // quick reject: the box's bounding sphere
      const dx = head.x - m[12];
      const dy = head.y - m[13];
      const dz = head.z - m[14];
      const rad = 0.5 * (Math.sqrt(m[0] * m[0] + m[1] * m[1] + m[2] * m[2]) + Math.sqrt(m[4] * m[4] + m[5] * m[5] + m[6] * m[6]) + Math.sqrt(m[8] * m[8] + m[9] * m[9] + m[10] * m[10]));
      if (dx * dx + dy * dy + dz * dz > rad * rad) continue;
      _inv.fromArray(m).invert();
      _a.copy(head).applyMatrix4(_inv);
      // (strictly inside, like plain walls: a head exactly on a wall's side is not in it)
      if (Math.abs(_a.x) < 0.4999 && Math.abs(_a.y) < 0.4999 && Math.abs(_a.z) < 0.4999) return true;
    }
    return false;
  }

  /** Player rig transform from the player track (false: not moved). */
  playerTransform(pos, quat) {
    return this.rt.playerTransform(pos, quat);
  }
}
