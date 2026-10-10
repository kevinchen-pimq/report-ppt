// Shared helpers for the LinkinPark / BTS / Kaleidoscope / Interscope / Skrillex modules.
// (Local additions on top of kit.js; nothing here is specific to one environment.)
//
// The main idea: rings and lasers that the runtime rotates are plain Object3D "proxies"; their
// lights live in a few shared instanced banks (1 draw call each) and Rig.sync() rewrites the
// instance matrices of the lights bound to a proxy whenever that proxy moved. That keeps the draw
// call count independent of the number of rings / laser pivots. No allocations after build().
import { THREE, LightBank, GEO, tubeMatrix, lightMaterial } from './kit.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const _m = new THREE.Matrix4();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

export const V = (x, y, z) => new THREE.Vector3(x, y, z);

/** Instanced, non-light scenery (e.g. ring frames that rotate with their ring). 1 draw call. */
export class InstBank {
  constructor(parent, geometry, material, max) {
    this.mesh = new THREE.InstancedMesh(geometry, material, max);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    parent.add(this.mesh);
    this.dirtyMatrix = true;
  }

  add(matrix) {
    const i = this.mesh.count++;
    this.mesh.setMatrixAt(i, matrix);
    this.dirtyMatrix = true;
    return { bank: this, index: i };
  }

  setMatrix(i, matrix) {
    this.mesh.setMatrixAt(i, matrix);
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

/** One addressable light that drives several instances (core bars + glow halo …) with gains. */
export class MultiLight {
  constructor(parts = [], gains = []) {
    this.parts = parts;
    this.gains = gains;
    this.r = 0;
    this.g = 0;
    this.b = 0;
  }

  push(light, gain = 1) {
    this.parts.push(light);
    this.gains.push(gain);
  }

  set(r, g, b) {
    if (r === this.r && g === this.g && b === this.b) return;
    this.r = r;
    this.g = g;
    this.b = b;
    for (let i = 0; i < this.parts.length; i++) {
      const k = this.gains[i];
      this.parts[i].set(r * k, g * k, b * k);
    }
  }
}

/** Matrix for a box bar from a to b with a w × d cross-section (GEO.box is a unit cube). */
export function bar(a, b, w, d = w, out = new THREE.Matrix4()) {
  tubeMatrix(a, b, 1, out);
  // tubeMatrix scales (radius, len, radius); re-scale X/Z to the wanted cross-section
  const e = out.elements;
  for (let i = 0; i < 3; i++) {
    e[i] *= w;
    e[8 + i] *= d;
  }
  return out;
}

/** Same as bar() but with numbers (avoids building vectors at call sites). */
export function barXYZ(ax, ay, az, bx, by, bz, w, d = w, out = new THREE.Matrix4()) {
  _a.set(ax, ay, az);
  _b.set(bx, by, bz);
  return bar(_a, _b, w, d, out);
}

/**
 * Core + glow light banks. light(bars) creates one addressable light out of one or more bars
 * (matrices for GEO.box); every bar gets a soft, wider glow copy in the glow bank.
 */
export class LightSet {
  constructor(parent, { max = 256, glowMax = max, glowOpacity = 0.2, coreGeo = GEO.box, glowGeo = GEO.box } = {}) {
    this.core = new LightBank(parent, coreGeo, max);
    this.glow = glowMax > 0 ? new LightBank(parent, glowGeo, glowMax, { material: lightMaterial({ opacity: glowOpacity }) }) : null;
    this.banks = this.glow ? [this.core, this.glow] : [this.core];
  }

  /**
   * bars: [{ m: Matrix4 (core), g?: Matrix4 | null (glow; default = core thickened by `fat`) }]
   * opts: { fat: glow thickness factor, glowGain, rig, proxy } — with a proxy the matrices are
   * local to it and the instances are registered with the rig.
   */
  light(bars, { fat = 4, glowGain = 1, coreGain = 1, rig = null, proxy = null } = {}) {
    const L = new MultiLight();
    for (const b of bars) {
      const c = this.core.add(proxy ? IDENT : b.m);
      L.push(c, coreGain);
      if (proxy) rig.bind(proxy, this.core, c.index, b.m);
      if (this.glow && b.g !== null && glowGain > 0) {
        const gm = b.g || fatten(b.m, fat);
        const g = this.glow.add(proxy ? IDENT : gm);
        L.push(g, glowGain);
        if (proxy) rig.bind(proxy, this.glow, g.index, gm);
      }
    }
    return L;
  }

  dispose() {
    for (const b of this.banks) {
      b.mesh.material.dispose();
      b.dispose();
    }
  }
}

const IDENT = new THREE.Matrix4();

/** Copy of a bar matrix with its X/Z axes (cross-section) scaled by k. */
export function fatten(m, k, out = new THREE.Matrix4()) {
  out.copy(m);
  const e = out.elements;
  for (let i = 0; i < 3; i++) {
    e[i] *= k;
    e[8 + i] *= k;
  }
  return out;
}

/**
 * Proxies for rings / laser pivots. The runtime rotates (and for ring zoom, moves) the proxy;
 * sync() re-composes the bound instances. proxy.userData.map(proxy, out) may replace the proxy's
 * own matrix (e.g. turn the spin angle into an up/down movement).
 */
export class Rig {
  constructor(parent) {
    this.parent = parent;
    this.proxies = [];
  }

  proxy(x, y, z, rx = 0, ry = 0, rz = 0, axis = 'z') {
    const p = new THREE.Object3D();
    p.position.set(x, y, z);
    p.rotation.set(rx, ry, rz);
    p.userData.axis = axis;
    p.userData.binds = [];
    p.userData.last = new Float64Array(9).fill(NaN);
    p.userData.map = null;
    p.userData.out = new THREE.Matrix4();
    this.parent.add(p);
    this.proxies.push(p);
    return p;
  }

  bind(proxy, bank, index, local) {
    proxy.userData.binds.push({ bank, index, local: local.clone() });
  }

  /** Adds a scenery instance (InstBank) that follows the proxy. */
  attach(proxy, instBank, local) {
    const { index } = instBank.add(IDENT);
    this.bind(proxy, instBank, index, local);
    return index;
  }

  sync() {
    for (let k = 0; k < this.proxies.length; k++) {
      const p = this.proxies[k];
      const L = p.userData.last;
      const P = p.position;
      const R = p.rotation;
      const S = p.scale;
      if (L[0] === P.x && L[1] === P.y && L[2] === P.z && L[3] === R.x && L[4] === R.y && L[5] === R.z &&
        L[6] === S.x && L[7] === S.y && L[8] === S.z) continue;
      L[0] = P.x; L[1] = P.y; L[2] = P.z; L[3] = R.x; L[4] = R.y; L[5] = R.z; L[6] = S.x; L[7] = S.y; L[8] = S.z;
      let M;
      if (p.userData.map) M = p.userData.map(p, p.userData.out);
      else {
        p.updateMatrix();
        M = p.matrix;
      }
      const binds = p.userData.binds;
      for (let i = 0; i < binds.length; i++) {
        const b = binds[i];
        _m.multiplyMatrices(M, b.local);
        b.bank.setMatrix(b.index, _m);
      }
    }
  }
}

/**
 * Ambient "bounce" approximation: average colour of some lights → callback (e.g. a material's
 * emissive or a haze light). Returns an update function; no allocations.
 */
export function wash(sources, apply) {
  const n = sources.length;
  let pr = -1;
  let pg = -1;
  let pb = -1;
  return () => {
    let r = 0;
    let g = 0;
    let b = 0;
    for (let i = 0; i < n; i++) {
      const s = sources[i];
      r += s.r > 0 ? s.r : 0;
      g += s.g > 0 ? s.g : 0;
      b += s.b > 0 ? s.b : 0;
    }
    r /= n;
    g /= n;
    b /= n;
    if (Math.abs(r - pr) + Math.abs(g - pg) + Math.abs(b - pb) < 1e-4) return;
    pr = r;
    pg = g;
    pb = b;
    apply(r, g, b);
  };
}

/**
 * Soft round glow (additive plane with a 64² radial-falloff texture) usable as a light:
 * glow.set(r, g, b). One draw call per glow. Useful for haze / bloom behind logos.
 */
export class SoftGlow {
  constructor(parent, w, h, position, { gain = 1, power = 2 } = {}) {
    const N = 64;
    const data = new Uint8Array(N * N * 4);
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const dx = (x + 0.5) / N * 2 - 1;
        const dy = (y + 0.5) / N * 2 - 1;
        const d = Math.min(1, Math.sqrt(dx * dx + dy * dy));
        const v = Math.round(255 * Math.pow(1 - d, power));
        const i = (y * N + x) * 4;
        data[i] = data[i + 1] = data[i + 2] = v;
        data[i + 3] = 255;
      }
    }
    this.tex = new THREE.DataTexture(data, N, N);
    this.tex.needsUpdate = true;
    this.tex.magFilter = THREE.LinearFilter;
    this.tex.minFilter = THREE.LinearFilter;
    this.mat = new THREE.MeshBasicMaterial({
      map: this.tex,
      color: 0x000000,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      fog: false,
    });
    this.geo = new THREE.PlaneGeometry(w, h);
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.position.copy(position);
    this.mesh.visible = false;
    parent.add(this.mesh);
    this.gain = gain;
    this.r = this.g = this.b = 0;
  }

  set(r, g, b) {
    if (r === this.r && g === this.g && b === this.b) return;
    this.r = r;
    this.g = g;
    this.b = b;
    const k = this.gain;
    this.mat.color.setRGB(r * k, g * k, b * k);
    this.mesh.visible = r + g + b > 0.002;
  }

  dispose() {
    this.mesh.removeFromParent();
    this.geo.dispose();
    this.mat.dispose();
    this.tex.dispose();
  }
}

/** Standard material helper. */
export function stdMat(color, { roughness = 0.8, metalness = 0.1, emissive = 0x000000, side = THREE.FrontSide, flat = false } = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness, emissive, side, flatShading: flat });
}

/** Merges geometries already in world space (non-indexed/indexed mixed is handled). */
export function mergeGeos(geos, material) {
  const parts = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  for (const p of parts) {
    for (const name of Object.keys(p.attributes)) if (name !== 'position' && name !== 'normal') p.deleteAttribute(name);
  }
  const merged = mergeGeometries(parts, false);
  for (const g of geos) g.dispose();
  for (const p of parts) if (!geos.includes(p)) p.dispose();
  const mesh = new THREE.Mesh(merged, material);
  mesh.matrixAutoUpdate = false;
  return mesh;
}
