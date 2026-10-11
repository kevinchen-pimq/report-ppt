// Building blocks for environment modules (js/game/envs/<EnvironmentName>.js).
// See js/game/envs/CONTRACT.md for what a module returns. Our own code, no game assets.
//
//   lights      LightBank / Light, MeshLight, MultiLight, GlowBank (core + halo), SoftGlow
//   motion      Rig: bank instances that follow Object3D pivots (rings, laser pivots) the
//               runtime moves; rotatingLaser()
//   scenery     PropBank (instanced, movable), mergeStatic / mergeGeos / mergeAll, boxAt,
//               beamBetween, beamGeometry, place, sceneryMaterials, stdMat
//   shapes      tubeMatrix, trs, bar / barXYZ / fatten, GEO, glowDiscGeometry, fadeStripGeometry,
//               skyDome, ridgeGeometry, strokeText
//   misc        V, rng (seeded), wash (average colour of lights)
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export { THREE };

const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _d = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _up = new THREE.Vector3(0, 1, 0);
const _black = new THREE.Color(0, 0, 0);
const IDENT = new THREE.Matrix4();

export const V = (x, y, z) => new THREE.Vector3(x, y, z);

/** Deterministic pseudo-random numbers in [0, 1) (mulberry32), so scenery is the same on every build. */
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

// ---------------------------------------------------------------------------------------------
// Lights

/** Material for emissive light shapes: additive, so a light set to black is invisible. */
export function lightMaterial({ opacity = 1, additive = true } = {}) {
  return new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: additive || opacity < 1,
    opacity,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    depthWrite: !additive,
    toneMapped: false,
    fog: false,
  });
}

/** Additive light material that multiplies by vertex colours (soft gradients on lights). */
export function softLightMaterial(opts) {
  const m = lightMaterial(opts);
  m.vertexColors = true;
  return m;
}

/**
 * Many lights sharing one geometry and material = one draw call.
 * Each light is an instance with its own colour (set by the lighting runtime).
 */
export class LightBank {
  constructor(parent, geometry, max, { material = lightMaterial(), renderOrder = 0 } = {}) {
    this.mesh = new THREE.InstancedMesh(geometry, material, max);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, _black); // creates instanceColor
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    parent.add(this.mesh);
    this.max = max;
    this.dirtyColor = true;
    this.dirtyMatrix = true;
    this.lights = [];
  }

  /** Adds a light with a local matrix (relative to the bank's parent). Returns the Light. */
  add(matrix) {
    if (this.mesh.count >= this.max) throw new Error('LightBank full');
    const i = this.mesh.count++;
    this.mesh.setMatrixAt(i, matrix);
    this.mesh.setColorAt(i, _black);
    const light = new Light(this, i);
    this.lights.push(light);
    this.dirtyMatrix = true;
    return light;
  }

  /** Moves a light (e.g. a laser beam that rotates on its own). */
  setMatrix(i, matrix) {
    this.mesh.setMatrixAt(i, matrix);
    this.dirtyMatrix = true;
  }

  /** Upload changes; the runtime calls this once per frame (after the module's update()). */
  update() {
    if (this.dirtyColor) {
      this.mesh.instanceColor.needsUpdate = true;
      this.dirtyColor = false;
    }
    if (this.dirtyMatrix) {
      // no bounding sphere: banks are never frustum culled
      this.mesh.instanceMatrix.needsUpdate = true;
      this.dirtyMatrix = false;
    }
  }

  dispose() {
    this.mesh.removeFromParent();
    this.mesh.dispose?.();
  }
}

/** One addressable light. The runtime calls set(r, g, b) with linear RGB already scaled by brightness. */
export class Light {
  constructor(bank, index) {
    this.bank = bank;
    this.index = index;
    this.r = 0;
    this.g = 0;
    this.b = 0;
  }

  set(r, g, b) {
    if (r === this.r && g === this.g && b === this.b) return;
    this.r = r;
    this.g = g;
    this.b = b;
    // over-bright: scale the channels together (each one capped at 1 on its own turns any colour white)
    const max = Math.max(r, g, b);
    const k = max > 1 ? 1 / max : 1;
    const a = this.bank.mesh.instanceColor.array;
    a[this.index * 3] = r * k;
    a[this.index * 3 + 1] = g * k;
    a[this.index * 3 + 2] = b * k;
    this.bank.dirtyColor = true;
  }
}

/**
 * A light that is its own Object3D (for lights that must move independently, e.g. rotating
 * lasers parented to a pivot). Prefer LightBank when possible (fewer draw calls).
 */
export class MeshLight {
  constructor(mesh) {
    this.mesh = mesh;
    this.r = this.g = this.b = -1;
  }

  set(r, g, b) {
    if (r === this.r && g === this.g && b === this.b) return;
    this.r = r;
    this.g = g;
    this.b = b;
    const max = Math.max(r, g, b);
    const k = max > 1 ? 1 / max : 1; // keep the hue when over-bright (see Light.set)
    this.mesh.material.color.setRGB(r * k, g * k, b * k);
    this.mesh.visible = r + g + b > 0.002;
  }
}

/** One addressable light that drives several parts (core + glow halo, a bundle of strands …), each with a gain. */
export class MultiLight {
  constructor(parts = [], gains = null) {
    this.parts = parts;
    this.gains = gains || parts.map(() => 1);
    this.r = this.g = this.b = -1;
  }

  push(light, gain = 1) {
    this.parts.push(light);
    this.gains.push(gain);
    this.r = this.g = this.b = -1;
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

/**
 * Two light banks sharing one geometry (or two): a bright core and a wider, faint halo
 * (2 draw calls). Every add returns ONE light that colours both instances.
 *   halo: false → core only        haloScale: halo radius / thickness factor (tube(), light())
 *   haloMax / haloGeometry / haloOpacity / haloRenderOrder: the halo bank's own settings
 */
export class GlowBank {
  constructor(parent, geometry, max, {
    halo = true, haloScale = 3.5, haloOpacity = 0.2, haloGeometry = geometry, haloMax = max,
    renderOrder = 0, haloRenderOrder = renderOrder,
  } = {}) {
    this.core = new LightBank(parent, geometry, max, { renderOrder });
    this.halo = halo && haloMax > 0
      ? new LightBank(parent, haloGeometry, haloMax, { material: lightMaterial({ opacity: haloOpacity }), renderOrder: haloRenderOrder })
      : null;
    if (this.halo) this.halo.isHalo = true; // the atmosphere's air glow follows the cores only
    this.haloScale = haloScale;
    this.banks = this.halo ? [this.core, this.halo] : [this.core];
  }

  /** The halo bank (null without halo). */
  get glow() {
    return this.halo;
  }

  /** Core at matrix m, halo at mHalo (default: the same matrix). Returns a MultiLight (bare Light without halo). */
  add(m, mHalo = m) {
    const c = this.core.add(m);
    if (!this.halo) return c;
    return new MultiLight([c, this.halo.add(mHalo || m)]);
  }

  /** Tube light from a to b; the halo is the same tube `haloScale` times wider. */
  tube(a, b, radius, haloScale = this.haloScale) {
    const mc = tubeMatrix(a, b, radius, new THREE.Matrix4());
    return this.add(mc, this.halo ? tubeMatrix(a, b, radius * haloScale, new THREE.Matrix4()) : null);
  }

  /**
   * One light made of one or more box bars (matrices for a unit box, see bar()): every bar gets a
   * core instance and (unless g === null) a halo copy, by default the bar thickened by `fat`.
   * bars: [{ m: Matrix4, g?: Matrix4 | null }]. With rig + proxy the matrices are local to the
   * proxy and the instances follow it.
   */
  light(bars, { fat = 4, glowGain = 1, coreGain = 1, rig = null, proxy = null } = {}) {
    const L = new MultiLight();
    for (const b of bars) {
      const c = this.core.add(proxy ? IDENT : b.m);
      L.push(c, coreGain);
      if (proxy) rig.bind(proxy, this.core, c.index, b.m);
      if (this.halo && b.g !== null && glowGain > 0) {
        const gm = b.g || fatten(b.m, fat);
        const g = this.halo.add(proxy ? IDENT : gm);
        L.push(g, glowGain);
        if (proxy) rig.bind(proxy, this.halo, g.index, gm);
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

/**
 * Soft round glow (additive plane with a 64² radial-falloff texture) usable as a light:
 * glow.set(r, g, b). One draw call. Useful for haze / bloom behind logos.
 */
export class SoftGlow {
  constructor(parent, w, h, position, { gain = 1, power = 2 } = {}) {
    const N = 64;
    const data = new Uint8Array(N * N * 4);
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const dx = ((x + 0.5) / N) * 2 - 1;
        const dy = ((y + 0.5) / N) * 2 - 1;
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

/**
 * Ambient "bounce" approximation: average colour of some lights → apply(r, g, b) (e.g. a
 * material's emissive or a haze light). Returns an update function; no allocations.
 * (The game's lit atmosphere, js/game/Atmosphere.js, already tints fog / sky / scenery for every
 * environment; use this for a module-specific effect on top.)
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

// ---------------------------------------------------------------------------------------------
// Moving instances

/**
 * Instanced, non-light scenery whose instances can move (ring frames …): 1 draw call.
 * ownMaterial: draw with a private copy of `material` — use it when the same material is also on
 * ordinary (non-instanced) meshes, otherwise three.js re-checks the shader program every frame.
 */
export class PropBank {
  constructor(parent, geometry, material, max, { ownMaterial = false } = {}) {
    this.ownMaterial = ownMaterial ? material.clone() : null;
    this.mesh = new THREE.InstancedMesh(geometry, this.ownMaterial || material, max);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.dirtyMatrix = true;
    parent.add(this.mesh);
  }

  /** Adds an instance; returns its index. */
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
    this.ownMaterial?.dispose();
  }
}

/**
 * Keeps bank instances (lights or props) attached to Object3D pivots that the runtime moves
 * (rings: rotation.z / position.z, lasers: rotation[axis]) without one draw call per object.
 * Each binding sets   instance = pre × pivot chain × local   whenever a pivot of its chain moved
 * (chains are listed outermost first and must hang off the banks' parent; `pre` is an optional
 * fixed matrix in front, e.g. a mirror or a mount pose). obj.userData.map(obj, out) may replace
 * a pivot's own matrix (e.g. turn the spin angle into an up / down movement).
 * Call update() from the module's update(); only moved pivots are recomputed, no allocations.
 * Chains share their common prefixes (each pivot's composed matrix is computed once per frame), so
 * a binding costs one matrix product however deep its chain is. A pivot needs no scene-graph parent.
 */
export class Rig {
  constructor(parent = null) {
    this.parent = parent;
    this.entries = []; // tracked pivots
    this.chains = []; // bindings with chains of more than one pivot
    this.nodes = []; // chain prefixes (see _link)
    this._linked = true;
    this._m = new THREE.Matrix4();
  }

  /** Starts tracking an Object3D (idempotent); returns it. */
  track(obj) {
    if (!obj.userData.rig) {
      obj.userData.rig = { obj, last: new Float64Array(9).fill(NaN), dirty: true, items: [], mat: obj.matrix };
      this.entries.push(obj.userData.rig);
    }
    return obj;
  }

  /** New tracked pivot at (x, y, z) with rotation (rx, ry, rz); `axis` = laser spin axis. */
  proxy(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, axis = 'z') {
    const p = new THREE.Object3D();
    p.position.set(x, y, z);
    p.rotation.set(rx, ry, rz);
    p.userData.axis = axis;
    p.userData.map = null;
    p.userData.out = new THREE.Matrix4();
    (this.parent || this.root)?.add(p);
    return this.track(p);
  }

  /** Binds instance `index` of `bank` (LightBank | PropBank) to a pivot (or chain of pivots). */
  bind(chain, bank, index, local, pre = null) {
    const list = Array.isArray(chain) ? chain : [chain];
    for (const o of list) this.track(o);
    const item = { bank, index, local: local.clone(), pre: pre ? pre.clone() : null, chain: list };
    if (list.length === 1) list[0].userData.rig.items.push(item);
    else {
      this.chains.push(item);
      this._linked = false;
    }
    return item;
  }

  /** Adds a prop instance that follows the pivot; returns its index. */
  attach(chain, propBank, local, pre = null) {
    const i = propBank.add(IDENT);
    this.bind(chain, propBank, i, local, pre);
    return i;
  }

  /**
   * Adds a light that follows the pivot: target = LightBank (returns its Light) or GlowBank
   * (core at `local`, halo at `haloLocal` (default local); returns a MultiLight).
   */
  light(chain, target, local, haloLocal = null, pre = null) {
    if (target instanceof GlowBank) {
      const c = target.core.add(local);
      this.bind(chain, target.core, c.index, local, pre);
      if (!target.halo) return c;
      const hl = haloLocal || local;
      const h = target.halo.add(hl);
      this.bind(chain, target.halo, h.index, hl, pre);
      return new MultiLight([c, h]);
    }
    const l = target.add(local);
    this.bind(chain, target, l.index, local, pre);
    return l;
  }

  /** Tube light a → b (pivot-local) on a GlowBank, halo `glow.haloScale` times wider. */
  tube(chain, glow, a, b, radius) {
    const mc = tubeMatrix(a, b, radius, new THREE.Matrix4());
    const mh = glow.halo ? tubeMatrix(a, b, radius * glow.haloScale, new THREE.Matrix4()) : null;
    return this.light(chain, glow, mc, mh);
  }

  update(force = false) {
    const es = this.entries;
    for (let k = 0; k < es.length; k++) {
      const e = es[k];
      const o = e.obj;
      const L = e.last;
      const P = o.position;
      const R = o.rotation;
      const S = o.scale;
      if (!force && L[0] === P.x && L[1] === P.y && L[2] === P.z && L[3] === R.x && L[4] === R.y && L[5] === R.z &&
        L[6] === S.x && L[7] === S.y && L[8] === S.z) {
        e.dirty = false;
        continue;
      }
      L[0] = P.x; L[1] = P.y; L[2] = P.z; L[3] = R.x; L[4] = R.y; L[5] = R.z; L[6] = S.x; L[7] = S.y; L[8] = S.z;
      e.dirty = true;
      if (o.userData.map) e.mat = o.userData.map(o, o.userData.out);
      else {
        o.updateMatrix();
        e.mat = o.matrix;
      }
      const items = e.items;
      for (let i = 0; i < items.length; i++) this.apply(items[i], e.mat);
    }
    // chains: the composed matrix of every chain prefix is kept once (parent prefix × own pivot)
    // and recomputed only when a pivot in that prefix moved, so a binding costs one product
    if (!this._linked) this._link();
    const ns = this.nodes;
    for (let i = 0; i < ns.length; i++) {
      const n = ns[i];
      if (n.parent) {
        n.wd = n.parent.wd || n.e.dirty;
        if (n.wd) n.world.multiplyMatrices(n.parent.world, n.e.mat);
      } else {
        n.wd = n.e.dirty;
        n.world = n.e.mat;
      }
    }
    const cs = this.chains;
    for (let i = 0; i < cs.length; i++) {
      const it = cs[i];
      if (!it.node.wd) continue;
      const m = this._m.multiplyMatrices(it.node.world, it.local);
      if (it.pre) m.premultiply(it.pre);
      it.bank.setMatrix(it.index, m);
    }
  }

  /** Builds the prefix tree of the chain bindings (parents before children). */
  _link() {
    this._linked = true;
    this.nodes = [];
    const roots = new Map();
    for (const it of this.chains) {
      let parent = null;
      let level = roots;
      for (const o of it.chain) {
        let n = level.get(o);
        if (!n) {
          n = { e: o.userData.rig, parent, world: parent ? new THREE.Matrix4() : null, wd: true, kids: new Map() };
          level.set(o, n);
          this.nodes.push(n);
        }
        parent = n;
        level = n.kids;
      }
      it.node = parent;
    }
  }

  /** Same as update() (older name). */
  sync(force = false) {
    this.update(force);
  }

  apply(it, M) {
    const m = this._m.multiplyMatrices(M, it.local);
    if (it.pre) m.premultiply(it.pre);
    it.bank.setMatrix(it.index, m);
  }
}

/**
 * Sets the `mirror` flags of `lightGroups` from a table { [groupId]: 'xzY' }: lower-case letters =
 * rotation axes, upper-case = translation axes whose value the runtime negates. Groups listed get
 * exactly these flags (others are left alone); a group listed with '' has none. Use it to make a
 * group turn / move the way Beat Saber's does for our pivots' orientation (see CONTRACT.md).
 */
export function applyMirrors(lightGroups, table) {
  for (const [id, spec] of Object.entries(table)) {
    const g = lightGroups[id];
    if (!g) continue;
    for (const [kind, letters] of [['rotation', 'xyz'], ['translation', 'XYZ']]) {
      if (!g[kind]) continue;
      const m = {};
      for (const L of letters) if (spec.includes(L)) m[L.toLowerCase()] = true;
      g[kind].mirror = m;
    }
  }
  return lightGroups;
}

/**
 * Rotating laser: a tracked pivot at `pos` (spun by the runtime around userData.axis) holding a
 * tube beam that leaves the pivot tilted by `tilt` radians from vertical toward +x (negative tilt =
 * toward -x), `back` metres behind the pivot to `length` in front. Returns { pivot, light }.
 */
export function rotatingLaser(root, rig, glowBank, pos, tilt, length, radius, { axis = 'y', back = 0 } = {}) {
  const pivot = new THREE.Object3D();
  pivot.position.copy(pos);
  pivot.userData.axis = axis;
  root.add(pivot);
  const dir = new THREE.Vector3(Math.sin(tilt), Math.cos(tilt), 0);
  const a = dir.clone().multiplyScalar(-back);
  const b = dir.clone().multiplyScalar(length);
  const light = rig.light(pivot, glowBank, tubeMatrix(a, b, radius), glowBank.halo ? tubeMatrix(a, b, radius * 3.5) : null);
  return { pivot, light };
}

// ---------------------------------------------------------------------------------------------
// Matrices and shapes

/** Matrix for a unit cylinder (radius 1, height 1, along Y, centred) stretched from a to b. */
export function tubeMatrix(a, b, radius, out = new THREE.Matrix4()) {
  _d.subVectors(b, a);
  const len = _d.length();
  _p.addVectors(a, b).multiplyScalar(0.5);
  _q.setFromUnitVectors(_up, _d.normalize());
  _s.set(radius, len, radius);
  return out.compose(_p, _q, _s);
}

/** Matrix from position, Euler rotation (radians) and scale. */
export function trs(position, rotation = [0, 0, 0], scale = [1, 1, 1], out = new THREE.Matrix4()) {
  _p.set(position[0], position[1], position[2]);
  _q.setFromEuler(new THREE.Euler(rotation[0], rotation[1], rotation[2]));
  _s.set(scale[0], scale[1], scale[2]);
  return out.compose(_p, _q, _s);
}

/** Matrix for a box bar (GEO.box is a unit cube) from a to b with a w × d cross-section. */
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

/** Same as bar() with numbers (no vectors at the call site). */
export function barXYZ(ax, ay, az, bx, by, bz, w, d = w, out = new THREE.Matrix4()) {
  _a.set(ax, ay, az);
  _b.set(bx, by, bz);
  return bar(_a, _b, w, d, out);
}

/** Copy of a bar / tube matrix with its X/Z axes (cross-section) scaled by k. */
export function fatten(m, k, out = new THREE.Matrix4()) {
  out.copy(m);
  const e = out.elements;
  for (let i = 0; i < 3; i++) {
    e[i] *= k;
    e[8 + i] *= k;
  }
  return out;
}

/** Shared unit geometries for light shapes. */
export const GEO = {
  tube: new THREE.CylinderGeometry(1, 1, 1, 8, 1, true),
  box: new THREE.BoxGeometry(1, 1, 1),
  plane: new THREE.PlaneGeometry(1, 1),
  disc: new THREE.CircleGeometry(1, 24),
};

/** Disc in the XY plane, radius 1, bright centre fading to black at the rim (vertex colours). */
export function glowDiscGeometry(segments = 24, core = 0.25, coreLevel = 1) {
  const pos = [0, 0, 0];
  const col = [1, 1, 1];
  const idx = [];
  for (const [r, c] of [[core, coreLevel], [1, 0]]) {
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      pos.push(Math.cos(a) * r, Math.sin(a) * r, 0);
      col.push(c, c, c);
    }
  }
  for (let i = 0; i < segments; i++) {
    const j = (i + 1) % segments;
    idx.push(0, 1 + i, 1 + j);
    const a = 1 + i;
    const b = 1 + j;
    const c = 1 + segments + i;
    const d = 1 + segments + j;
    idx.push(a, c, d, a, d, b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}

/** Unit plane in XY (x ∈ [-.5,.5], y ∈ [-.5,.5]) bright along x = 0, black at both x edges. */
export function fadeStripGeometry() {
  const pos = [];
  const col = [];
  for (const y of [-0.5, 0.5]) {
    for (const [x, c] of [[-0.5, 0], [0, 1], [0.5, 0]]) {
      pos.push(x, y, 0);
      col.push(c, c, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex([0, 1, 4, 0, 4, 3, 1, 2, 5, 1, 5, 4]);
  return g;
}

/** Inside-out sky sphere with a vertical colour gradient (zenith → horizon → below). */
export function skyDome(zenith, horizon, below = 0x000000, radius = 320) {
  const geo = new THREE.SphereGeometry(radius, 16, 10);
  const cz = new THREE.Color(zenith);
  const ch = new THREE.Color(horizon);
  const cb = new THREE.Color(below);
  const p = geo.attributes.position;
  const col = new Float32Array(p.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const t = p.getY(i) / radius;
    if (t >= 0) c.copy(ch).lerp(cz, Math.pow(t, 0.6));
    else c.copy(ch).lerp(cb, Math.min(1, -t * 4));
    col.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = -10;
  mesh.frustumCulled = false;
  mesh.userData.atmoSky = true; // lit by the atmosphere toward the horizon (js/game/Atmosphere.js)
  return mesh;
}

/** Jagged mountain ridge: peaks along a polyline, faceted (non-indexed, flat normals). */
export function ridgeGeometry(rand, from, to, n, hMin, hMax, depth, outward, baseY = -1) {
  const pos = [];
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = from[0] + (to[0] - from[0]) * t;
    const z = from[1] + (to[1] - from[1]) * t;
    const edge = Math.min(1, Math.min(t, 1 - t) * 6); // taper at both ends
    const h = (hMin + (hMax - hMin) * rand()) * (0.35 + 0.65 * edge);
    const jx = (rand() - 0.5) * depth * 0.4;
    pts.push({ x, z, h, jx });
  }
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const fa = [a.x, baseY, a.z];
    const fb = [b.x, baseY, b.z];
    const pa = [a.x + outward[0] * depth * 0.5 + a.jx, a.h, a.z + outward[1] * depth * 0.5];
    const pb = [b.x + outward[0] * depth * 0.5 + b.jx, b.h, b.z + outward[1] * depth * 0.5];
    const ba = [a.x + outward[0] * depth, baseY, a.z + outward[1] * depth];
    const bb = [b.x + outward[0] * depth, baseY, b.z + outward[1] * depth];
    // mid-slope vertices give each face a crease (reads as rock faces)
    const ma = [(fa[0] + pa[0]) / 2 + outward[0] * 0.15 * depth, a.h * 0.45, (fa[2] + pa[2]) / 2];
    const mb = [(fb[0] + pb[0]) / 2 + outward[0] * 0.15 * depth, b.h * 0.45, (fb[2] + pb[2]) / 2];
    pos.push(...fa, ...ma, ...fb, ...fb, ...ma, ...mb);
    pos.push(...ma, ...pa, ...mb, ...mb, ...pa, ...pb);
    pos.push(...pa, ...ba, ...pb, ...pb, ...ba, ...bb);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------------------------------------
// Static scenery

/** Merges static meshes (same material) into one mesh = one draw call. */
export function mergeStatic(meshes, material) {
  const parts = meshes.map((m) => {
    m.updateMatrix();
    return m.geometry.clone().applyMatrix4(m.matrix);
  });
  const merged = mergeGeometries(parts, false);
  for (const g of parts) g.dispose();
  const mesh = new THREE.Mesh(merged, material);
  mesh.matrixAutoUpdate = false;
  return mesh;
}

/**
 * Merges geometries already placed in world space into one geometry (indexed and non-indexed
 * parts mixed; only positions and normals are kept). Disposes the parts.
 */
export function mergeAll(geos) {
  const parts = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  for (const p of parts) {
    for (const name of Object.keys(p.attributes)) if (name !== 'position' && name !== 'normal') p.deleteAttribute(name);
  }
  const merged = mergeGeometries(parts, false);
  for (const g of geos) g.dispose();
  for (const p of parts) if (!geos.includes(p)) p.dispose();
  return merged;
}

/** mergeAll() as a static mesh with `material` (one draw call). */
export function mergeGeos(geos, material) {
  const mesh = new THREE.Mesh(mergeAll(geos), material);
  mesh.matrixAutoUpdate = false;
  return mesh;
}

/** Transforms a geometry in place (position, Euler rotation, scale) and returns it. */
export function place(g, position, rotation = [0, 0, 0], scale = [1, 1, 1]) {
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(...position),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)),
    new THREE.Vector3(...scale),
  );
  g.applyMatrix4(m);
  return g;
}

/** Box mesh for mergeStatic(): centre, size, rotation (radians). */
export function boxAt(material, pos, size, rot = [0, 0, 0]) {
  const m = new THREE.Mesh(GEO.box, material);
  m.position.set(pos[0], pos[1], pos[2]);
  m.scale.set(size[0], size[1], size[2]);
  m.rotation.set(rot[0], rot[1], rot[2]);
  return m;
}

/** Box mesh stretched between two points (thickness w × h), for mergeStatic() beams / struts. */
export function beamBetween(material, a, b, w, h = w) {
  const m = new THREE.Mesh(GEO.box, material);
  const d = new THREE.Vector3().subVectors(b, a);
  m.position.addVectors(a, b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize());
  m.scale.set(w, d.length(), h);
  return m;
}

const _bx = new THREE.Vector3(1, 0, 0);
/** Box geometry stretched from a to b along its X axis (thickness w × d), for mergeAll(). */
export function beamGeometry(a, b, w, d = w, base = null) {
  const g = (base || new THREE.BoxGeometry(1, 1, 1)).clone();
  _d.subVectors(b, a);
  const len = _d.length();
  _q.setFromUnitVectors(_bx, _d.normalize());
  g.applyMatrix4(_m.compose(_p.addVectors(a, b).multiplyScalar(0.5), _q, _s.set(len + w, w, d)));
  return g;
}

/** Standard dark scenery materials (lit by the scene's ambient light). */
export function sceneryMaterials() {
  return {
    dark: new THREE.MeshStandardMaterial({ color: 0x0b0c14, roughness: 0.6, metalness: 0.4 }),
    metal: new THREE.MeshStandardMaterial({ color: 0x1b1d2a, roughness: 0.35, metalness: 0.8 }),
    floor: new THREE.MeshStandardMaterial({ color: 0x090a12, roughness: 0.25, metalness: 0.6 }),
  };
}

/** MeshStandardMaterial shorthand. */
export function stdMat(color, { roughness = 0.8, metalness = 0.1, emissive = 0x000000, side = THREE.FrontSide, flat = false } = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness, emissive, side, flatShading: flat });
}

// ---------------------------------------------------------------------------------------------
// Stroke font (our own): letters on a 4 × 6 grid, only the letters the environments need.
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
