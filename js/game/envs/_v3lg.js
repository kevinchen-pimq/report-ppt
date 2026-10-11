// Shared helpers for the v3 (group lighting) environment modules LinkinPark2, TheRollingStones,
// Lattice, DaftPunk and HipHop. Our own code (see CONTRACT.md "v3 environments").
//
//   LG / finishGroups   light-group records { lights, rotation, translation } and clean-up
//   pivot               a bare Object3D used as a rotation / translation pivot (not in the scene
//                       graph: the Rig composes its local matrix, the runtime writes its values)
//   chainTubes / tubes  one light made of several tube segments (moving / static)
//   arcSegs, polySegs   segment lists for arcs and polylines
//   AmbientLight        a "light" that tints scenery materials (basic "ambient" event groups)
//   FxOffsets           vfx (FloatFX) handler moving pivots along fixed directions
//   ringGeometry, prismGeometry, shardGeometry   small light / scenery shapes
//   textSegs            stroke text (letters the modules need that kit.js's font lacks too)
import { THREE, MultiLight, tubeMatrix } from './kit.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

/** New light-group record (see CONTRACT.md lightGroups). */
export function LG() {
  return { lights: [], rotation: { x: [], y: [], z: [] }, translation: { x: [], y: [], z: [] } };
}

/**
 * Drops empty rotation / translation axes and sets `count` (the largest of lights / pivots per
 * axis). opts[id] may add { rotMirror, transMirror, scale, count }.
 */
export function finishGroups(groups, opts = {}) {
  for (const id of Object.keys(groups)) {
    const g = groups[id];
    const o = opts[id] || {};
    let n = g.lights.length;
    for (const kind of ['rotation', 'translation']) {
      const spec = g[kind];
      if (!spec) continue;
      let any = false;
      for (const ax of ['x', 'y', 'z']) {
        if (!spec[ax] || spec[ax].length === 0) delete spec[ax];
        else {
          any = true;
          n = Math.max(n, spec[ax].length);
        }
      }
      if (!any) delete g[kind];
    }
    if (g.rotation && o.rotMirror) g.rotation.mirror = o.rotMirror;
    if (g.translation) {
      g.translation.scale = o.scale ?? g.translation.scale ?? 1;
      if (o.transMirror) g.translation.mirror = o.transMirror;
    }
    g.count = o.count ?? g.count ?? n;
  }
  return groups;
}

/** Pivot Object3D at (x, y, z) with Euler rotation (radians). */
export function pivot(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const o = new THREE.Object3D();
  o.position.set(x, y, z);
  o.rotation.set(rx, ry, rz);
  return o;
}

/** One light from tube segments [[a, b, r], …] (pivot-local) following a pivot chain. */
export function chainTubes(rig, chain, glow, segs) {
  if (segs.length === 1) return rig.tube(chain, glow, segs[0][0], segs[0][1], segs[0][2]);
  const L = new MultiLight();
  for (const [a, b, r] of segs) L.push(rig.tube(chain, glow, a, b, r));
  return L;
}

/** One static light from tube segments [[a, b, r], …]. */
export function tubes(glow, segs) {
  if (segs.length === 1) return glow.tube(segs[0][0], segs[0][1], segs[0][2]);
  const L = new MultiLight();
  for (const [a, b, r] of segs) L.push(glow.tube(a, b, r));
  return L;
}

/**
 * Arc of n tube segments in a plane: centre c, radius rad, angles a0 → a1 (radians, 0 = +x,
 * counter-clockwise), tube radius r. plane 'xy' (facing z), 'xz' (flat) or 'yz'.
 */
export function arcSegs(c, rad, a0, a1, n, r, plane = 'xy') {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    const u = Math.cos(a) * rad;
    const v = Math.sin(a) * rad;
    if (plane === 'xy') pts.push(V(c.x + u, c.y + v, c.z));
    else if (plane === 'xz') pts.push(V(c.x + u, c.y, c.z + v));
    else pts.push(V(c.x, c.y + v, c.z + u));
  }
  return polySegs(pts, r);
}

/** Segments joining consecutive points (closed: back to the first). */
export function polySegs(pts, r, closed = false) {
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) out.push([pts[i], pts[i + 1], r]);
  if (closed) out.push([pts[pts.length - 1], pts[0], r]);
  return out;
}

/**
 * "Ambient" light for the basic-event ambient group: set(r, g, b) tints the emissive colour of
 * scenery materials (no draw call of its own). gain scales the light colour.
 */
export class AmbientLight {
  constructor(materials, gain = 0.2, extra = null) {
    this.materials = materials;
    this.gain = gain;
    this.extra = extra; // optional Light-like (e.g. a haze glow) driven too
    this.r = this.g = this.b = -1;
  }

  set(r, g, b) {
    if (r === this.r && g === this.g && b === this.b) return;
    this.r = r;
    this.g = g;
    this.b = b;
    const k = this.gain;
    for (let i = 0; i < this.materials.length; i++) this.materials[i].emissive.setRGB(r * k, g * k, b * k);
    if (this.extra) this.extra.set(r, g, b);
  }
}

/**
 * vfx (FloatFX) handler: element i moves its pivot from its rest position along dirs[i] by
 * value × scale (e.g. fracturing an object into pieces). { count, set(i, value) }; no allocation.
 */
export class FxOffsets {
  constructor(pivots, dirs, scale = 1) {
    this.count = pivots.length;
    this.pivots = pivots;
    this.base = pivots.map((p) => [p.position.x, p.position.y, p.position.z]);
    this.dirs = dirs.map((d) => [d.x, d.y, d.z]);
    this.scale = scale;
  }

  set(i, v) {
    const p = this.pivots[i];
    if (!p) return;
    const b = this.base[i];
    const d = this.dirs[i];
    const k = v * this.scale;
    p.position.set(b[0] + d[0] * k, b[1] + d[1] * k, b[2] + d[2] * k);
  }
}

/** vfx handler that scales pivots (value 0 → scale lo, 1 → hi), e.g. fading a shape out. */
export class FxScale {
  constructor(pivots, lo = 0.001, hi = 1) {
    this.count = pivots.length;
    this.pivots = pivots;
    this.lo = lo;
    this.hi = hi;
  }

  set(i, v) {
    const p = this.pivots[i];
    if (!p) return;
    const s = Math.max(0.001, this.lo + (this.hi - this.lo) * Math.min(1, Math.max(0, v)));
    p.scale.set(s, s, s);
  }
}

/** vfx handler that ignores its values (value controls the module does not show). */
export function fxNone(count = 1) {
  return { count, set() {} };
}

/** Flat ring (annulus) in the XY plane: inner / outer radius, optional arc (radians). */
export function ringGeometry(inner, outer, segs = 48, a0 = 0, len = Math.PI * 2) {
  return new THREE.RingGeometry(inner, outer, segs, 1, a0, len);
}

/** Closed prism along Z from a 2D outline [[x, y], …] (depth d, centred on z = 0). */
export function prismGeometry(outline, d) {
  const shape = new THREE.Shape(outline.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: d, bevelEnabled: false, steps: 1 });
  g.translate(0, 0, -d / 2);
  g.computeVertexNormals();
  return g;
}

/** Low-poly crystal shard: an elongated, slightly irregular octahedron (unit size, along +y). */
export function shardGeometry() {
  const p = [
    [0, 1, 0], [0, -0.7, 0],
    [0.32, 0.1, 0.05], [-0.05, 0.15, 0.3], [-0.3, 0.05, -0.08], [0.06, 0.1, -0.28],
  ];
  const f = [[0, 2, 3], [0, 3, 4], [0, 4, 5], [0, 5, 2], [1, 3, 2], [1, 4, 3], [1, 5, 4], [1, 2, 5]];
  const pos = [];
  for (const t of f) for (const k of t) pos.push(...p[k]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

/** Matrix (position, Euler rotation, scale) without allocation in the caller. */
const _e = new THREE.Euler();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
export function mat(px, py, pz, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx, out = new THREE.Matrix4()) {
  _e.set(rx, ry, rz);
  _q.setFromEuler(_e);
  return out.compose(_p.set(px, py, pz), _q, _s.set(sx, sy, sz));
}

export { tubeMatrix };

// Stroke font on a 4 × 6 grid (our own), for the letters the modules spell.
const FONT = {
  L: [[0, 6, 0, 0], [0, 0, 4, 0]],
  P: [[0, 0, 0, 6], [0, 6, 3, 6], [3, 6, 4, 5], [4, 5, 4, 4], [4, 4, 3, 3], [3, 3, 0, 3]],
  D: [[0, 0, 0, 6], [0, 6, 2.5, 6], [2.5, 6, 4, 4.5], [4, 4.5, 4, 1.5], [4, 1.5, 2.5, 0], [2.5, 0, 0, 0]],
  A: [[0, 0, 2, 6], [2, 6, 4, 0], [0.8, 2.4, 3.2, 2.4]],
  F: [[4, 6, 0, 6], [0, 6, 0, 0], [0, 3, 3, 3]],
  T: [[0, 6, 4, 6], [2, 6, 2, 0]],
  U: [[0, 6, 0, 1], [0, 1, 1, 0], [1, 0, 3, 0], [3, 0, 4, 1], [4, 1, 4, 6]],
  N: [[0, 0, 0, 6], [0, 6, 4, 0], [4, 0, 4, 6]],
  K: [[0, 0, 0, 6], [0, 3, 4, 6], [1, 3.75, 4, 0]],
};

/** Text as tube segments in the XY plane centred on (cx, cy, cz), letter height h, tube radius r. */
export function textSegs(text, cx, cy, cz, h, r, spacing = 1.6) {
  const k = h / 6;
  const adv = (4 + spacing) * k;
  const width = text.length * adv - spacing * k;
  let x0 = cx - width / 2;
  const out = [];
  for (const ch of text) {
    for (const [ax, ay, bx, by] of FONT[ch] || []) out.push([V(x0 + ax * k, cy + ay * k, cz), V(x0 + bx * k, cy + by * k, cz), r]);
    x0 += adv;
  }
  return out;
}
