// Shared helpers for the Dragons / KDA / Monstercat / Crab Rave / Panic environment modules.
// (Local additions on top of kit.js; nothing here is specific to one environment.)
import { THREE, LightBank, GEO, tubeMatrix, lightMaterial } from './kit.js';

/** Several Light objects driven as one (core + glow halo). */
export class MultiLight {
  constructor(lights) {
    this.lights = lights;
  }

  set(r, g, b) {
    for (let i = 0; i < this.lights.length; i++) this.lights[i].set(r, g, b);
  }
}

/**
 * A light bank with an optional wider, faint halo bank (2 draw calls).
 * add(matrix, haloMatrix) returns one light that drives both.
 */
export class GlowBank {
  constructor(parent, geometry, max, { halo = true, haloOpacity = 0.22, haloGeometry = geometry } = {}) {
    this.core = new LightBank(parent, geometry, max);
    this.halo = halo ? new LightBank(parent, haloGeometry, max, { material: lightMaterial({ opacity: haloOpacity }), renderOrder: 1 }) : null;
    this.banks = this.halo ? [this.core, this.halo] : [this.core];
  }

  add(matrix, haloMatrix = null) {
    const a = this.core.add(matrix);
    if (!this.halo) return a;
    const b = this.halo.add(haloMatrix || matrix);
    return new MultiLight([a, b]);
  }

  /** Tube light from a to b; halo is the same tube `haloScale` times wider. */
  tube(a, b, radius, haloScale = 3.5) {
    return this.add(tubeMatrix(a, b, radius), this.halo ? tubeMatrix(a, b, radius * haloScale) : null);
  }

  dispose() {
    for (const b of this.banks) {
      b.mesh.material.dispose();
      b.dispose();
    }
  }
}

/** Instanced, non-light scenery (one draw call) whose instances can follow moving pivots. */
export class SceneryBank {
  constructor(parent, geometry, max, material) {
    this.bank = new LightBank(parent, geometry, max, { material });
  }

  add(matrix) {
    const l = this.bank.add(matrix);
    l.set(1, 1, 1); // instance colour multiplies the material colour
    return l;
  }

  dispose() {
    this.bank.dispose();
  }
}

/**
 * Keeps bank instances attached to moving Object3D pivots (rings, rotating lasers).
 * The lighting runtime only changes pivot.rotation / pivot.position; call rig.update() from
 * the module's update() to copy the pivots' transforms into the instance matrices.
 * Only pivots whose transform changed are recomputed; no per-frame allocation.
 */
export class Rig {
  constructor() {
    this.pivots = [];
    this._m = new THREE.Matrix4();
  }

  /** Registers a pivot. Items: [bank (LightBank), instance index, local Matrix4]. */
  pivot(obj) {
    const p = { obj, last: new Float64Array(6).fill(NaN), items: [] };
    this.pivots.push(p);
    return p;
  }

  /** Adds an instance (light or scenery) that follows pivot p with local matrix `local`. */
  attach(p, bank, index, local) {
    p.items.push({ bank, index, local: local.clone() });
  }

  update(force = false) {
    const m = this._m;
    for (let i = 0; i < this.pivots.length; i++) {
      const p = this.pivots[i];
      const o = p.obj;
      const L = p.last;
      if (!force && L[0] === o.rotation.x && L[1] === o.rotation.y && L[2] === o.rotation.z &&
        L[3] === o.position.x && L[4] === o.position.y && L[5] === o.position.z) continue;
      L[0] = o.rotation.x; L[1] = o.rotation.y; L[2] = o.rotation.z;
      L[3] = o.position.x; L[4] = o.position.y; L[5] = o.position.z;
      o.updateMatrix();
      for (let k = 0; k < p.items.length; k++) {
        const it = p.items[k];
        m.multiplyMatrices(o.matrix, it.local);
        it.bank.setMatrix(it.index, m);
      }
    }
  }
}

/** Light (or MultiLight) added to a bank at a pivot-relative matrix, attached to the rig. */
export function rigLight(rig, p, glowBank, local, haloLocal = null) {
  const core = glowBank.core;
  const a = core.add(local);
  rig.attach(p, core, a.index, local);
  if (!glowBank.halo) return a;
  const hl = haloLocal || local;
  const b = glowBank.halo.add(hl);
  rig.attach(p, glowBank.halo, b.index, hl);
  return new MultiLight([a, b]);
}

/** Scenery instance attached to a pivot. */
export function rigScenery(rig, p, sceneryBank, local) {
  const l = sceneryBank.add(local);
  rig.attach(p, sceneryBank.bank, l.index, local);
  return l;
}

/**
 * Rotating laser: a pivot (spun by the runtime around userData.axis) holding a beam that leaves the
 * pivot tilted by `tilt` radians from vertical toward +x (negative tilt = toward -x).
 */
export function rotatingLaser(root, rig, glowBank, pos, tilt, length, radius, { axis = 'y', back = 0 } = {}) {
  const pivot = new THREE.Object3D();
  pivot.position.copy(pos);
  pivot.userData.axis = axis;
  root.add(pivot);
  const p = rig.pivot(pivot);
  const dir = new THREE.Vector3(Math.sin(tilt), Math.cos(tilt), 0);
  const a = dir.clone().multiplyScalar(-back);
  const b = dir.clone().multiplyScalar(length);
  const light = rigLight(rig, p, glowBank, tubeMatrix(a, b, radius), glowBank.halo ? tubeMatrix(a, b, radius * 3.5) : null);
  return { pivot, light };
}

/** Deterministic pseudo-random numbers (mulberry32). */
export function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Box mesh helper for mergeStatic(): centre, size, rotation (radians). */
export function boxAt(material, pos, size, rot = [0, 0, 0]) {
  const m = new THREE.Mesh(GEO.box, material);
  m.position.set(pos[0], pos[1], pos[2]);
  m.scale.set(size[0], size[1], size[2]);
  m.rotation.set(rot[0], rot[1], rot[2]);
  return m;
}

/** Box stretched between two points (thickness w × h), for beams / struts. */
export function beamBetween(material, a, b, w, h = w) {
  const m = new THREE.Mesh(GEO.box, material);
  const d = new THREE.Vector3().subVectors(b, a);
  m.position.addVectors(a, b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize());
  m.scale.set(w, d.length(), h);
  return m;
}

export const V = (x, y, z) => new THREE.Vector3(x, y, z);
