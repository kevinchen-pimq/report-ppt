import * as THREE from 'three';
import { BLADE_LEN } from './constants.js';
import { buildSaberVisual, BLADE_START } from './Models.js';

const TRAIL_LEN = 9;
const HISTORY_SEC = 0.5;

export class Saber {
  constructor(colorHex, hand) {
    this.hand = hand; // 'left' | 'right'
    this.colorIndex = hand === 'left' ? 0 : 1;
    this.color = new THREE.Color(colorHex);
    this.object = new THREE.Group();
    this.object.matrixAutoUpdate = false;
    this.active = true;

    this.bladeStart = BLADE_START;
    this.style = null;
    this.setStyle('classic');

    // Trail ribbon
    const positions = new Float32Array(TRAIL_LEN * 2 * 3);
    const colors = new Float32Array(TRAIL_LEN * 2 * 3);
    const index = [];
    for (let i = 0; i < TRAIL_LEN - 1; i++) {
      const a = i * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setIndex(index);
    this.trail = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        forceSinglePass: true, // additive, no depth write: one pass gives the same picture
      }),
    );
    this.trail.frustumCulled = false;
    this.trail.matrixAutoUpdate = false;

    // Tracking state
    this.base = new THREE.Vector3();
    this.tip = new THREE.Vector3();
    this.prevBase = new THREE.Vector3();
    this.prevTip = new THREE.Vector3();
    this.dir = new THREE.Vector3(0, 0, -1);
    this.history = []; // { t, base, tip, dir }
    this.spare = []; // recycled history entries (no per-frame allocations)
    this.hasPose = false;
  }

  setMatrix(m) {
    this.object.matrix.copy(m);
    this.object.matrixWorldNeedsUpdate = true;
  }

  setVisible(v) {
    this.object.visible = v;
    this.trail.visible = v;
    this.active = v;
  }

  /** Swaps the saber's look (see Models.js); custom = parsed glTF scene for 'custom'. */
  setStyle(style, custom = null, flip = false) {
    const key = `${style}|${custom ? custom.uuid : ''}|${flip}`;
    if (key === this.styleKey) return;
    this.styleKey = key;
    if (this.visual) {
      this.object.remove(this.visual.group);
      this.visual.group.traverse((o) => {
        if (o.isMesh) {
          o.geometry.dispose();
          for (const m of [].concat(o.material)) m.dispose();
        }
      });
    }
    this.style = style;
    this.visual = buildSaberVisual(style, this.color, custom, flip);
    this.object.add(this.visual.group);
  }

  setColor(hex) {
    this.color.set(hex);
    this.visual.setColor(this.color);
  }

  /** Call once per frame after the pose has been set. */
  update(now) {
    this.object.updateMatrixWorld(true);
    const m = this.object.matrixWorld;
    this.prevBase.copy(this.base);
    this.prevTip.copy(this.tip);
    this.base.set(0, 0, this.bladeStart).applyMatrix4(m);
    this.tip.set(0, 0, this.bladeStart - BLADE_LEN).applyMatrix4(m);
    this.dir.subVectors(this.tip, this.base).normalize();
    if (!this.hasPose) {
      this.prevBase.copy(this.base);
      this.prevTip.copy(this.tip);
      this.hasPose = true;
    }
    const e = this.spare.pop() || { t: 0, base: new THREE.Vector3(), tip: new THREE.Vector3(), dir: new THREE.Vector3() };
    e.t = now;
    e.base.copy(this.base);
    e.tip.copy(this.tip);
    e.dir.copy(this.dir);
    this.history.push(e);
    while (this.history.length > 2 && now - this.history[0].t > HISTORY_SEC) this.spare.push(this.history.shift());
    this.updateTrail();
  }

  /** Average tip velocity over the last ~40ms (world units / s). */
  tipVelocity(out) {
    const h = this.history;
    out.set(0, 0, 0);
    if (h.length < 2) return out;
    const last = h[h.length - 1];
    let first = h[h.length - 2];
    for (let i = h.length - 2; i >= 0; i--) {
      first = h[i];
      if (last.t - h[i].t >= 0.04) break;
    }
    const dt = last.t - first.t;
    if (dt <= 0) return out;
    return out.subVectors(last.tip, first.tip).divideScalar(dt);
  }

  /** Largest blade rotation (degrees) between now and the last `window` seconds. */
  swingAngleBefore(window = 0.3) {
    const h = this.history;
    if (!h.length) return 0;
    const now = h[h.length - 1];
    let max = 0;
    for (let i = h.length - 1; i >= 0; i--) {
      if (now.t - h[i].t > window) break;
      const a = now.dir.angleTo(h[i].dir);
      if (a > max) max = a;
    }
    return THREE.MathUtils.radToDeg(max);
  }

  updateTrail() {
    const pos = this.trail.geometry.attributes.position;
    const col = this.trail.geometry.attributes.color;
    const h = this.history;
    const n = Math.min(TRAIL_LEN, h.length);
    for (let i = 0; i < TRAIL_LEN; i++) {
      const src = h[Math.max(0, h.length - 1 - Math.min(i, n - 1))];
      const fade = this.active ? Math.max(0, 1 - i / (TRAIL_LEN - 1)) ** 2 * 0.6 : 0;
      // inner edge a bit away from the handle
      const bx = src.base.x + (src.tip.x - src.base.x) * 0.15;
      const by = src.base.y + (src.tip.y - src.base.y) * 0.15;
      const bz = src.base.z + (src.tip.z - src.base.z) * 0.15;
      pos.setXYZ(i * 2, bx, by, bz);
      pos.setXYZ(i * 2 + 1, src.tip.x, src.tip.y, src.tip.z);
      col.setXYZ(i * 2, this.color.r * fade * 0.3, this.color.g * fade * 0.3, this.color.b * fade * 0.3);
      col.setXYZ(i * 2 + 1, this.color.r * fade, this.color.g * fade, this.color.b * fade);
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
  }
}
