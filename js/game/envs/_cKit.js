// Small shared helpers for the Rocket / Green Day / Timbaland / FitBeat environment modules.
// Everything here is our own code on top of kit.js (see CONTRACT.md).
import { THREE, LightBank, lightMaterial, tubeMatrix } from './kit.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const V = (x, y, z) => new THREE.Vector3(x, y, z);

/** One addressable light that drives several instances (core + halo, or a bundle of strands). */
export class MultiLight {
  constructor(list) {
    this.list = list;
  }

  set(r, g, b) {
    for (let i = 0; i < this.list.length; i++) this.list[i].set(r, g, b);
  }
}

/**
 * Two banks sharing one geometry: a thin bright core and a wider faint halo (2 draw calls).
 * add* returns one MultiLight that colours both.
 */
export class GlowBank {
  constructor(parent, geometry, max, { halo = 3, haloOpacity = 0.18, renderOrder = 0 } = {}) {
    this.core = new LightBank(parent, geometry, max, { renderOrder });
    this.halo = halo > 0 ? new LightBank(parent, geometry, max, { material: lightMaterial({ opacity: haloOpacity }), renderOrder }) : null;
    this.haloScale = halo;
  }

  /** Tube from a to b. Returns a MultiLight (or the bare Light when the bank has no halo). */
  tube(a, b, radius) {
    const c = this.core.add(tubeMatrix(a, b, radius));
    if (!this.halo) return c;
    return new MultiLight([c, this.halo.add(tubeMatrix(a, b, radius * this.haloScale))]);
  }

  /** Tube a→b given in the local space of a pivot chain; the instance follows the chain (see Followers). */
  tubeFollow(followers, chain, a, b, radius) {
    const mc = tubeMatrix(a, b, radius, new THREE.Matrix4());
    const mh = tubeMatrix(a, b, radius * this.haloScale, new THREE.Matrix4());
    const light = this.add(mc, mh);
    followers.add(this, this.core.mesh.count - 1, chain, mc, mh);
    return light;
  }

  /** Generic: core matrix and (optional) halo matrix. */
  add(m, mHalo = m) {
    const c = this.core.add(m);
    if (!this.halo) return c;
    return new MultiLight([c, this.halo.add(mHalo)]);
  }

  /** Index pair used by Followers to move both instances. */
  get banks() {
    return this.halo ? [this.core, this.halo] : [this.core];
  }

  dispose() {
    this.core.dispose();
    this.halo?.dispose();
  }
}

/** Instanced static-material props whose matrices can move (ring frames etc.): 1 draw call. */
export class PropBank {
  constructor(parent, geometry, material, max) {
    this.mesh = new THREE.InstancedMesh(geometry, material, max);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.dirtyMatrix = true;
    parent.add(this.mesh);
  }

  add(m) {
    const i = this.mesh.count++;
    this.mesh.setMatrixAt(i, m);
    this.dirtyMatrix = true;
    return i;
  }

  setMatrix(i, m) {
    this.mesh.setMatrixAt(i, m);
    this.dirtyMatrix = true;
  }

  update() {
    if (this.dirtyMatrix) {
      this.mesh.instanceMatrix.needsUpdate = true;
      this.dirtyMatrix = false;
    }
  }

  dispose() {
    this.mesh.removeFromParent();
    this.mesh.dispose?.();
  }
}

/**
 * Lets instances (lights or props) follow Object3D pivots (rings, laser pivots) without one draw
 * call per object: the runtime rotates / moves the pivots, update() copies
 * pivot chain matrix × local matrix into the instance. Pivots must hang off the same parent as the banks
 * (chains are listed outermost first). No allocation per frame.
 */
export class Followers {
  constructor() {
    this.pivots = [];
    this.items = [];
    this._m = new THREE.Matrix4();
  }

  _track(p) {
    if (p.userData._fState) return;
    p.userData._fState = new Float32Array(7).fill(NaN);
    p.userData._fDirty = true;
    this.pivots.push(p);
  }

  /**
   * target: LightBank | PropBank | GlowBank (moves core and halo); index: instance index (for a GlowBank,
   * the core index; halo uses the same index). chain: Object3D or array outermost→innermost.
   */
  add(target, index, chain, local, haloLocal = null) {
    const list = Array.isArray(chain) ? chain : [chain];
    list.forEach((p) => this._track(p));
    if (target instanceof GlowBank) {
      this.items.push({ bank: target.core, index, chain: list, local: local.clone() });
      if (target.halo) this.items.push({ bank: target.halo, index, chain: list, local: (haloLocal || local).clone() });
    } else {
      this.items.push({ bank: target, index, chain: list, local: local.clone() });
    }
  }

  update(force = false) {
    for (let i = 0; i < this.pivots.length; i++) {
      const p = this.pivots[i];
      const s = p.userData._fState;
      const r = p.rotation;
      const q = p.position;
      if (force || s[0] !== r.x || s[1] !== r.y || s[2] !== r.z || s[3] !== q.x || s[4] !== q.y || s[5] !== q.z) {
        s[0] = r.x; s[1] = r.y; s[2] = r.z; s[3] = q.x; s[4] = q.y; s[5] = q.z;
        p.updateMatrix();
        p.userData._fDirty = true;
      } else p.userData._fDirty = false;
    }
    const m = this._m;
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i];
      let dirty = false;
      for (let k = 0; k < it.chain.length; k++) if (it.chain[k].userData._fDirty) dirty = true;
      if (!dirty) continue;
      m.copy(it.chain[0].matrix);
      for (let k = 1; k < it.chain.length; k++) m.multiply(it.chain[k].matrix);
      m.multiply(it.local);
      it.bank.setMatrix(it.index, m);
    }
  }
}

/** Box stretched from a to b (thickness w × d) as a geometry (for merged static meshes / logo strokes). */
const _bq = new THREE.Quaternion();
const _bd = new THREE.Vector3();
const _bx = new THREE.Vector3(1, 0, 0);
export function beamGeometry(a, b, w, d = w, base = null) {
  const g = (base || new THREE.BoxGeometry(1, 1, 1)).clone();
  _bd.subVectors(b, a);
  const len = _bd.length();
  _bq.setFromUnitVectors(_bx, _bd.normalize());
  const m = new THREE.Matrix4().compose(new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5), _bq, new THREE.Vector3(len + w, w, d));
  g.applyMatrix4(m);
  return g;
}

/** Merge a list of geometries into one (disposes the parts). Drops uvs so mixed sources merge. */
export function mergeAll(parts) {
  for (const p of parts) {
    if (p.index) {
      const n = p.toNonIndexed();
      parts[parts.indexOf(p)] = n;
      p.dispose();
    }
  }
  for (const p of parts) {
    for (const k of Object.keys(p.attributes)) if (k !== 'position' && k !== 'normal') p.deleteAttribute(k);
  }
  const g = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  return g;
}

/** Transform a geometry in place and return it. */
export function place(g, position, rotation = [0, 0, 0], scale = [1, 1, 1]) {
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(...position),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)),
    new THREE.Vector3(...scale),
  );
  g.applyMatrix4(m);
  return g;
}

// Minimal stroke font (our own), letters on a 4 × 6 grid. Only the letters the environments need.
const A = 0.83;
const FONT = {
  T: [[0, 6, 4, 6], [2, 6, 2, 0]],
  I: [[2, 0, 2, 6], [1, 6, 3, 6], [1, 0, 3, 0]],
  M: [[0, 0, 0, 6], [0, 6, 2, 3], [2, 3, 4, 6], [4, 6, 4, 0]],
  B: [[0, 0, 0, 6], [0, 6, 3, 6], [3, 6, 4, 5], [4, 5, 4, 4], [4, 4, 3, 3], [0, 3, 3, 3], [3, 3, 4, 2], [4, 2, 4, 1], [4, 1, 3, 0], [3, 0, 0, 0]],
  A: [[0, 0, 2, 6], [2, 6, 4, 0], [A, 2.5, 4 - A, 2.5]],
  L: [[0, 6, 0, 0], [0, 0, 4, 0]],
  N: [[0, 0, 0, 6], [0, 6, 4, 0], [4, 0, 4, 6]],
  D: [[0, 0, 0, 6], [0, 6, 2.5, 6], [2.5, 6, 4, 4.5], [4, 4.5, 4, 1.5], [4, 1.5, 2.5, 0], [2.5, 0, 0, 0]],
  G: [[4, 5, 3, 6], [3, 6, 1, 6], [1, 6, 0, 5], [0, 5, 0, 1], [0, 1, 1, 0], [1, 0, 3, 0], [3, 0, 4, 1], [4, 1, 4, 3], [4, 3, 2, 3]],
  R: [[0, 0, 0, 6], [0, 6, 3, 6], [3, 6, 4, 5], [4, 5, 4, 4], [4, 4, 3, 3], [3, 3, 0, 3], [2, 3, 4, 0]],
  E: [[4, 6, 0, 6], [0, 6, 0, 0], [0, 0, 4, 0], [0, 3, 3, 3]],
  Y: [[0, 6, 2, 3], [4, 6, 2, 3], [2, 3, 2, 0]],
  O: [[1, 0, 3, 0], [3, 0, 4, 1], [4, 1, 4, 5], [4, 5, 3, 6], [3, 6, 1, 6], [1, 6, 0, 5], [0, 5, 0, 1], [0, 1, 1, 0]],
  C: [[4, 5, 3, 6], [3, 6, 1, 6], [1, 6, 0, 5], [0, 5, 0, 1], [0, 1, 1, 0], [1, 0, 3, 0], [3, 0, 4, 1]],
  K: [[0, 0, 0, 6], [0, 3, 4, 6], [1, 3.75, 4, 0]],
  U: [[0, 6, 0, 1], [0, 1, 1, 0], [1, 0, 3, 0], [3, 0, 4, 1], [4, 1, 4, 6]],
  F: [[4, 6, 0, 6], [0, 6, 0, 0], [0, 3, 3, 3]],
  S: [[4, 5, 3, 6], [3, 6, 1, 6], [1, 6, 0, 5], [0, 5, 0, 4], [0, 4, 1, 3], [1, 3, 3, 3], [3, 3, 4, 2], [4, 2, 4, 1], [4, 1, 3, 0], [3, 0, 1, 0], [1, 0, 0, 1]],
};

/**
 * Text as merged box strokes in the XY plane, centred on x, baseline y = 0, facing +Z.
 * size = letter height (m); stroke = stroke width (m). Returns a BufferGeometry.
 */
export function strokeText(text, size, stroke, { spacing = 1.5, depth = stroke, slant = 0 } = {}) {
  const k = size / 6;
  const adv = (4 + spacing) * k;
  const width = text.length * adv - spacing * k;
  const parts = [];
  let x0 = -width / 2;
  const box = new THREE.BoxGeometry(1, 1, 1);
  for (const ch of text) {
    for (const [ax, ay, bx, by] of FONT[ch] || []) {
      parts.push(beamGeometry(V(x0 + (ax + ay * slant) * k, ay * k, 0), V(x0 + (bx + by * slant) * k, by * k, 0), stroke, depth, box));
    }
    x0 += adv;
  }
  box.dispose();
  return mergeAll(parts);
}
