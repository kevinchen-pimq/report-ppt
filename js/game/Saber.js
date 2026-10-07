import * as THREE from 'three';
import { BLADE_LEN } from './constants.js';

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

    // Handle
    const handle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.018, 0.022, 0.2, 12),
      new THREE.MeshStandardMaterial({ color: 0x222228, metalness: 0.7, roughness: 0.35 }),
    );
    handle.rotation.x = Math.PI / 2;
    handle.position.z = 0.02;
    this.object.add(handle);
    const ring = new THREE.Mesh(
      new THREE.CylinderGeometry(0.024, 0.024, 0.02, 12),
      new THREE.MeshBasicMaterial({ color: this.color }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.z = -0.08;
    this.object.add(ring);

    // Blade: white core + colored additive glow
    const core = new THREE.Mesh(
      new THREE.CylinderGeometry(0.008, 0.008, BLADE_LEN, 8),
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
    );
    core.rotation.x = Math.PI / 2;
    core.position.z = -0.08 - BLADE_LEN / 2;
    this.object.add(core);
    this.glowMat = new THREE.MeshBasicMaterial({
      color: this.color,
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const glow = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, BLADE_LEN, 10, 1, true), this.glowMat);
    glow.rotation.x = Math.PI / 2;
    glow.position.z = core.position.z;
    this.object.add(glow);
    this.bladeStart = -0.08;

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

  setColor(hex) {
    this.color.set(hex);
    this.glowMat.color.copy(this.color);
    this.object.children[1].material.color.copy(this.color);
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
    this.history.push({ t: now, base: this.base.clone(), tip: this.tip.clone(), dir: this.dir.clone() });
    while (this.history.length > 2 && now - this.history[0].t > HISTORY_SEC) this.history.shift();
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
