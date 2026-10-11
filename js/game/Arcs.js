import * as THREE from 'three';
import { laneX, layerY, COLOR_LEFT, COLOR_RIGHT } from './constants.js';

const MOVE_TIME = 0.4; // keep in sync with Notes.js
const WIDTH = 0.045;
const _chroma = new THREE.Color();
const _now = { x: 0, y: 0 };
const _target = { x: 0, y: 0 };
const _attach = new THREE.Vector3();

/**
 * Arcs (sliders): glowing ribbons that guide the saber from a head note to a tail.
 * Purely visual like the original game, plus light haptics while the saber follows one.
 */
export class ArcManager {
  constructor(scene) {
    this.root = new THREE.Group();
    scene.add(this.root);
    this.colors = [new THREE.Color(COLOR_LEFT), new THREE.Color(COLOR_RIGHT)];
    this.pool = [];
    this.active = [];
    this.map = null;
    this.lastBuzz = [0, 0];
    this.chroma = false; // Chroma arc colours (setting)
  }

  setColors(left, right) {
    this.colors[0].set(left);
    this.colors[1].set(right);
  }

  reset(map) {
    for (const a of this.active) this.release(a);
    this.active = [];
    this.map = map;
    this.idx = 0;
    this.from = -Infinity; // seek(): arcs ending before this are left out
  }

  /**
   * Practice mode jump to song time t: clears the arcs on screen; arcs still running at `from`
   * (>= t) that are already in view spawn now, later ones as usual (by their head time).
   */
  seek(t, from = t, halfJump = 0) {
    for (const a of this.active) this.release(a);
    this.active.length = 0;
    if (!this.map) return;
    const arcs = this.map.arcs;
    const lead = halfJump + MOVE_TIME;
    let k = 0;
    for (; k < arcs.length && arcs[k].time - lead <= t; k++) {
      if (arcs[k].endTime > from) this.active.push(this.acquire(arcs[k]));
    }
    this.idx = k;
    this.from = from;
  }

  acquire(arc) {
    const n = arc.samples.length;
    let obj = null;
    for (let i = 0; i < this.pool.length; i++) {
      if (this.pool[i].n !== n) continue;
      obj = this.pool[i];
      this.pool.splice(i, 1);
      break;
    }
    if (!obj) obj = this.create(n);
    obj.arc = arc;
    obj.mesh.visible = true;
    this.root.add(obj.mesh);
    return obj;
  }

  create(n) {
    // Two crossed ribbons (horizontal + vertical) so the arc reads from any angle
    const positions = new Float32Array(n * 4 * 3);
    const colors = new Float32Array(n * 4 * 3);
    const index = [];
    for (let r = 0; r < 2; r++) {
      for (let i = 0; i < n - 1; i++) {
        const a = r * n * 2 + i * 2;
        index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setIndex(index);
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    // Additive + no depth write: face order doesn't matter, so skip three.js's two-pass
    // (back faces, then front faces) rendering of transparent double-sided materials
    mat.forceSinglePass = true;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    return { mesh, n };
  }

  release(obj) {
    obj.mesh.visible = false;
    this.root.remove(obj.mesh);
    this.pool.push(obj);
  }

  /**
   * t: song time, njs: current NJS, halfJump: seconds, haptic(hand, strength, ms) callback.
   */
  update(t, njs, halfJump, sabers, haptic) {
    if (!this.map) return;
    const arcs = this.map.arcs;
    const lead = halfJump + MOVE_TIME;
    while (this.idx < arcs.length && arcs[this.idx].time - lead <= t) {
      const a = arcs[this.idx++];
      if (a.endTime < t - 0.5 || a.endTime <= this.from) continue;
      this.active.push(this.acquire(a));
    }
    const jumpDist = njs * halfJump;
    const baseY = layerY(0) - 0.25;
    for (let k = this.active.length - 1; k >= 0; k--) {
      const obj = this.active[k];
      const arc = obj.arc;
      if (arc.endTime <= t) {
        this.release(obj);
        this.active.splice(k, 1);
        continue;
      }
      const col = this.chroma && arc.chroma != null ? _chroma.setHex(arc.chroma) : this.colors[arc.color];
      const pos = obj.mesh.geometry.attributes.position;
      const cols = obj.mesh.geometry.attributes.color;
      const n = obj.n;
      // Once the head is reached, the part already passed gathers on the saber's tip, like
      // the game: the arc runs from the tip to what is still coming. Without a visible saber
      // it gathers at the arc's own point at the player.
      const attach = t > arc.time ? this.attachPoint(arc, t, sabers[arc.color]) : null;
      for (let i = 0; i < n; i++) {
        const s = arc.samples[i];
        const dt = s.time - t;
        let x = laneX(s.x);
        const ty = layerY(s.y);
        let y;
        let z;
        let fade;
        if (attach && dt <= 0) {
          x = attach.x;
          y = attach.y;
          z = attach.z;
          fade = 1;
        } else if (dt > halfJump) {
          // not yet in its jump: collapse onto the spawn point, invisible
          z = -jumpDist;
          y = baseY;
          fade = 0;
        } else {
          z = -dt * njs;
          const p = 1 - dt / halfJump;
          const rise = Math.min(1, p * 2);
          y = baseY + (ty - baseY) * (1 - (1 - rise) * (1 - rise));
          fade = Math.min(1, (halfJump - dt) / (halfJump * 0.25));
        }
        const f = fade * 0.75;
        pos.setXYZ(i * 2, x - WIDTH, y, z);
        pos.setXYZ(i * 2 + 1, x + WIDTH, y, z);
        pos.setXYZ(n * 2 + i * 2, x, y - WIDTH, z);
        pos.setXYZ(n * 2 + i * 2 + 1, x, y + WIDTH, z);
        for (let v = 0; v < 2; v++) {
          cols.setXYZ(i * 2 + v, col.r * f, col.g * f, col.b * f);
          cols.setXYZ(n * 2 + i * 2 + v, col.r * f, col.g * f, col.b * f);
        }
      }
      pos.needsUpdate = true;
      cols.needsUpdate = true;

      // Haptics: the saber tip is following the arc near the player
      if (haptic && t >= arc.time && t <= arc.endTime) {
        const saber = sabers[arc.color];
        if (!saber || !saber.active) continue;
        const target = this.pointAt(arc, t + 0.6 / njs, _target);
        if (!target) continue;
        const d = Math.hypot(saber.tip.x - laneX(target.x), saber.tip.y - layerY(target.y));
        const now = performance.now();
        if (d < 0.3 && now - this.lastBuzz[arc.color] > 60) {
          this.lastBuzz[arc.color] = now;
          haptic(saber, 0.15, 40);
        }
      }
    }
  }

  /** Where the passed part of an arc gathers: the saber's tip, or the arc's own point at the player. */
  attachPoint(arc, t, saber) {
    if (saber && saber.active) return _attach.copy(saber.tip);
    const now = this.pointAt(arc, Math.min(t, arc.endTime), _now);
    return now ? _attach.set(laneX(now.x), layerY(now.y), 0) : null;
  }

  /** The arc's grid position (x lane, y layer, fractional) at a song time; out = reusable target. */
  pointAt(arc, time, out = { x: 0, y: 0 }) {
    const s = arc.samples;
    if (time < s[0].time || time > s[s.length - 1].time) return null;
    for (let i = 1; i < s.length; i++) {
      if (s[i].time >= time) {
        const a = s[i - 1];
        const b = s[i];
        const f = b.time > a.time ? (time - a.time) / (b.time - a.time) : 0;
        out.x = a.x + (b.x - a.x) * f;
        out.y = a.y + (b.y - a.y) * f;
        return out;
      }
    }
    return null;
  }
}
