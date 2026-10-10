// Small helpers shared by BillieEnvironment, HalloweenEnvironment and GagaEnvironment
// (things kit.js does not provide). Our own code; no assets from the game or other projects.
import { THREE, LightBank, lightMaterial } from './kit.js';

/** One addressable light that drives several instances (e.g. a core + a dimmer glow halo). */
export class MultiLight {
  constructor(parts, gains) {
    this.parts = parts;
    this.gains = gains || parts.map(() => 1);
  }

  set(r, g, b) {
    for (let i = 0; i < this.parts.length; i++) {
      const k = this.gains[i];
      this.parts[i].set(r * k, g * k, b * k);
    }
  }
}

/** Deterministic PRNG (mulberry32) so scenery is the same on every build. */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Additive light material that multiplies by vertex colours (soft gradients on lights). */
export function softLightMaterial(opts) {
  const m = lightMaterial(opts);
  m.vertexColors = true;
  return m;
}

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
    const a = 1 + i, b = 1 + j, c = 1 + segments + i, d = 1 + segments + j;
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
  const cz = new THREE.Color(zenith), ch = new THREE.Color(horizon), cb = new THREE.Color(below);
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
  return mesh;
}

/**
 * Rotating laser beams drawn from ONE LightBank (one draw call) instead of one mesh per beam.
 * Each beam gets an invisible pivot Object3D that goes into `lasers.left/right`; the runtime spins
 * the pivot (userData.axis) and sync() copies   base × pivotRotation × local   into the instance.
 */
export class SpinBank {
  constructor(parent, geometry, max, opts) {
    this.parent = parent;
    this.bank = new LightBank(parent, geometry, max, opts);
    this.items = [];
    this._r = new THREE.Matrix4();
    this._m = new THREE.Matrix4();
  }

  /** base: Matrix4 (mount position + rest orientation), local: Matrix4 (beam inside the pivot). */
  add(base, local, axis = 'z') {
    const pivot = new THREE.Object3D();
    pivot.userData.axis = axis;
    pivot.matrixAutoUpdate = false;
    this.parent.add(pivot);
    const i = this.bank.mesh.count;
    this._m.multiplyMatrices(base, local);
    const light = this.bank.add(this._m);
    this.items.push({ pivot, base: base.clone(), local: local.clone(), i, rx: 0, ry: 0, rz: 0 });
    return { light, pivot };
  }

  sync() {
    for (const it of this.items) {
      const r = it.pivot.rotation;
      if (r.x === it.rx && r.y === it.ry && r.z === it.rz) continue;
      it.rx = r.x;
      it.ry = r.y;
      it.rz = r.z;
      this._r.makeRotationFromEuler(r);
      this._m.multiplyMatrices(it.base, this._r).multiply(it.local);
      this.bank.setMatrix(it.i, this._m);
    }
  }
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
    const a = pts[i], b = pts[i + 1];
    const fa = [a.x, baseY, a.z], fb = [b.x, baseY, b.z];
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
