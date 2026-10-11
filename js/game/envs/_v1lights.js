// Shared helpers for the v3 (group lighting) environments Weave, Pyro, EDM, The Second and Lizzo.
// Our own code. See CONTRACT.md (lightGroups) and kit.js.
//
//   U(x, y, z)            reference-scene coordinates (left-handed, +Z away from the player) → ours (-Z ahead)
//   fadeBeamGeometry()    crossed soft planes along +Y (0 … 1) that fade out toward the end: a light beam
//                         in fog (vertex colours; optional width / brightness profiles, e.g. flames)
//   fadeBeamMaterial(), fadeBeamBank()   its additive material / a core + halo GlowBank of it
//   Frame / PanTilt       per-element (or per-ring) rotation pivots for lightRotationEventBoxGroups: a fixed
//                         mount (position + orientation) → pivots (PanTilt: yaw rotation.y → tilt rotation.x),
//                         each pivot with zero rest rotation so the runtime's `rotation[axis] = rest + angle`
//                         is a pure rotation about that pivot's own axis; frames can hang inside other frames
//                         (lasers on a rotating circle); banks follow through kit.js Rig (no per-object draws)
//   movingHead(), rotGroup(), pushHead()   one beam + head + housing on a PanTilt / lightGroups records
//   beamMatrix()          matrix placing a unit beam (fadeBeamGeometry / GEO.tube) from a point along a direction
//   trussGeos(), crowdGeometry()   static scenery pieces (lattice trusses, crowd silhouettes) for mergeGeos
import { THREE, softLightMaterial, beamGeometry, GlowBank, MultiLight } from './kit.js';

export const D2R = Math.PI / 180;
const _up = new THREE.Vector3(0, 1, 0);
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();

/** Reference coordinates (Unity: left-handed, +Z ahead) → ours (right-handed, -Z ahead). */
export const U = (x, y, z) => new THREE.Vector3(x, y, -z);

/**
 * Soft beam: two crossed planes along +Y from 0 to 1, width 1 at the start growing to `widthEnd`,
 * bright along the centre line and at the start, fading to black at the sides and the far end
 * (brightness (1 - t)^power). Optional profile(t) = width factor and bright(t) = brightness along the
 * length (0 … 1) for other shapes (flames). Vertex colours; draw with fadeBeamMaterial().
 */
export function fadeBeamGeometry({ rows = 6, power = 1.4, widthEnd = 2.5, planes = 2, profile = null, bright = null } = {}) {
  const pos = [];
  const col = [];
  const idx = [];
  for (let p = 0; p < planes; p++) {
    const a = (p / planes) * Math.PI;
    const ax = Math.cos(a);
    const az = Math.sin(a);
    const base = pos.length / 3;
    for (let r = 0; r <= rows; r++) {
      const t = r / rows;
      const w = 0.5 * (profile ? profile(t) : 1 + (widthEnd - 1) * t);
      const c = bright ? bright(t) : Math.pow(1 - t, power);
      for (const [k, edge] of [[-1, 0], [0, 1], [1, 0]]) {
        pos.push(ax * w * k, t, az * w * k);
        const v = c * edge;
        col.push(v, v, v);
      }
    }
    for (let r = 0; r < rows; r++) {
      for (let k = 0; k < 2; k++) {
        const i0 = base + r * 3 + k;
        const i1 = i0 + 1;
        const i2 = i0 + 3;
        const i3 = i0 + 4;
        idx.push(i0, i1, i3, i0, i3, i2);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}

/** Additive, vertex-coloured, double-sided light material for fadeBeamGeometry banks. */
export function fadeBeamMaterial(opacity = 1) {
  const m = softLightMaterial({ opacity });
  m.side = THREE.DoubleSide;
  return m;
}

/** Matrix for a unit beam along +Y (0 … 1): from `start` along `dir` (unit), `len` long, `width` wide. */
export function beamMatrix(start, dir, len, width, out = new THREE.Matrix4()) {
  _q.setFromUnitVectors(_up, _v.copy(dir).normalize());
  return out.compose(start, _q, _s.set(width, len, width));
}

/**
 * Lattice truss from a to b as box geometries (for kit mergeAll / mergeGeos): `sides` chords
 * (3 = triangular, 4 = square) at `w` across, zig-zag diagonals every `step` metres, bar thickness `t`.
 */
export function trussGeos(a, b, w, step, t, sides = 3, out = []) {
  const d = new THREE.Vector3().subVectors(b, a);
  const len = d.length();
  d.normalize();
  const ref = Math.abs(d.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const u = new THREE.Vector3().crossVectors(d, ref).normalize();
  const v = new THREE.Vector3().crossVectors(d, u).normalize();
  const r = sides === 3 ? w / Math.sqrt(3) : w / Math.SQRT2;
  const off = [];
  for (let i = 0; i < sides; i++) {
    const ang = (i / sides) * Math.PI * 2 + Math.PI / 4;
    off.push(u.clone().multiplyScalar(Math.cos(ang) * r).addScaledVector(v, Math.sin(ang) * r));
  }
  const n = Math.max(1, Math.round(len / step));
  const P = (i, k) => a.clone().addScaledVector(d, (len * k) / n).add(off[i % sides]);
  for (let i = 0; i < sides; i++) out.push(beamGeometry(P(i, 0), P(i, n), t, t));
  for (let k = 0; k < n; k++) {
    for (let i = 0; i < sides; i++) out.push(beamGeometry(P(i, k), P(i + 1, k + 1), t * 0.7, t * 0.7));
  }
  return out;
}

/**
 * Crowd silhouette: a ribbon along the polyline `pts` ([x, z] pairs, ours) whose top edge is a row of
 * heads and shoulders (height h at the heads), from y = y0 up. Non-indexed geometry.
 */
export function crowdGeometry(pts, { h = 1.75, y0 = -0.5, spacing = 0.55, S = 4 } = {}) {
  const pos = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, az] = pts[i];
    const [bx, bz] = pts[i + 1];
    const segLen = Math.hypot(bx - ax, bz - az);
    const nHead = Math.max(1, Math.round(segLen / spacing));
    let prev = null;
    for (let k = 0; k <= nHead * S; k++) {
      const t = k / (nHead * S);
      const ph = (k % S) / S; // 0 … 1 across one person
      const jitter = 0.12 * Math.sin((i * 31 + Math.floor(k / S)) * 12.9898);
      const head = Math.max(0, 1 - Math.pow((ph - 0.5) / 0.3, 2));
      const y = y0 + (h - 0.3 + jitter) + 0.3 * Math.sqrt(head) - (ph < 0.1 ? 0.12 : 0);
      const x = ax + (bx - ax) * t;
      const z = az + (bz - az) * t;
      if (prev) {
        const [px, py, pz] = prev;
        pos.push(px, y0, pz, x, y0, z, x, y, z, px, y0, pz, x, y, z, px, py, pz);
      }
      prev = [x, y, z];
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

/**
 * A rotating frame for one element (or a whole circle of elements): a fixed mount at `pos` whose
 * local Y / X axes are the reference rotation axes `yAxis` / `xAxis` (already in our coordinates,
 * U()-style, z flipped; either may be null), then one pivot per entry of `order` ('x' | 'y'),
 * outermost first, each rotating about its own axis (this.pivot.x / this.pivot.y). Because the
 * reference scene is left-handed, a positive angle there is a negative angle about the converted
 * axis, so the mount uses the negated axes (same visual direction for the same event value). The X
 * axis is made orthogonal to Y. With `parent` (another Frame) the mount hangs inside the parent's
 * pivots (lasers on a rotating circle). Light / prop matrices given to the Rig are in the innermost
 * pivot's space; toLocal() turns a world (root) direction into that space at rest.
 */
export class Frame {
  constructor(pos, yAxis, xAxis, order = ['y', 'x'], parent = null) {
    let Y = yAxis ? yAxis.clone().normalize().negate() : null;
    let X = xAxis ? xAxis.clone().normalize().negate() : null;
    if (!Y) Y = Math.abs(X.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);
    if (!X) X = Math.abs(Y.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
    X.addScaledVector(Y, -X.dot(Y)).normalize();
    const Z = new THREE.Vector3().crossVectors(X, Y);
    this.mount = new THREE.Matrix4().makeBasis(X, Y, Z).setPosition(pos);
    this.inv = new THREE.Matrix4().copy(this.mount).invert();
    this.rot = new THREE.Matrix4().extractRotation(this.inv);
    this.pivot = {};
    const own = order.map((ax) => (this.pivot[ax] = new THREE.Object3D()));
    if (parent) {
      const em = new THREE.Object3D();
      new THREE.Matrix4().multiplyMatrices(parent.inv, this.mount).decompose(em.position, em.quaternion, em.scale);
      this.chain = [...parent.chain, em, ...own];
      this.pre = parent.pre;
    } else {
      this.chain = own;
      this.pre = this.mount;
    }
  }

  /** World direction → innermost-pivot local direction (at rest). */
  toLocal(v) {
    return v.clone().applyMatrix4(this.rot).normalize();
  }

  /** World point → innermost-pivot local point (at rest). */
  pointLocal(p) {
    return p.clone().applyMatrix4(this.inv);
  }

  /** Light following the pivots (kit Rig, the mount as `pre`). */
  light(rig, bank, local, haloLocal = null) {
    return rig.light(this.chain, bank, local, haloLocal, this.pre);
  }

  /** Prop instance following the pivots. */
  attach(rig, propBank, local) {
    return rig.attach(this.chain, propBank, local, this.pre);
  }
}

/** Pan (outer, rotation.y = this.yaw) / tilt (inner, rotation.x = this.tilt) frame of one moving head. */
export class PanTilt extends Frame {
  constructor(pos, yawAxis, tiltAxis, parent = null) {
    super(pos, yawAxis, tiltAxis, ['y', 'x'], parent);
    this.yaw = this.pivot.y;
    this.tilt = this.pivot.x;
  }
}

/**
 * GlowBank of soft fading beams (fadeBeamGeometry core + wider, fainter halo): 2 draw calls.
 * Returns { bank, geometry }; dispose bank (bank.dispose()) and geometry yourself.
 */
export function fadeBeamBank(parent, max, { haloOpacity = 0.08, power = 1.8, widthEnd = 3, rows = 5 } = {}) {
  const geometry = fadeBeamGeometry({ rows, power, widthEnd });
  const bank = new GlowBank(parent, geometry, max, { haloOpacity });
  for (const b of bank.banks) {
    b.mesh.material.dispose();
    b.mesh.material = fadeBeamMaterial(b === bank.core ? 1 : haloOpacity);
  }
  return { bank, geometry };
}

const _hq = new THREE.Quaternion();
/**
 * One moving-head light: PanTilt pivots at `pos`, a fading beam along `dir` (rest, ours) from `start`
 * metres out, `len` long, core `width` / halo `halo` wide, optional emitter `head` (LightBank, box of
 * size headSize along the beam) and `housing` (PropBank, box housingSize). Returns { pt, light }
 * (light = MultiLight beam + head). gains: [beam, head].
 */
export function movingHead(rig, beams, pos, dir, yawAxis, tiltAxis, {
  len = 12, width = 0.08, halo = 0.45, haloLen = 0.75, start = 0.3, head = null, headSize = [0.12, 0.2, 0.12],
  housing = null, housingSize = [0.3, 0.3, 0.3], gains = [0.6, 1.4], parent = null,
} = {}) {
  const pt = new PanTilt(pos, yawAxis, tiltAxis, parent);
  const d = pt.toLocal(dir);
  const s = d.clone().multiplyScalar(start);
  const parts = [pt.light(rig, beams, beamMatrix(s, d, len, width), beamMatrix(s, d, len * haloLen, halo))];
  const g = [gains[0]];
  _hq.setFromUnitVectors(_up, d);
  if (head) {
    const hm = new THREE.Matrix4().compose(d.clone().multiplyScalar(start * 0.7), _hq, new THREE.Vector3(...headSize));
    parts.push(pt.light(rig, head, hm));
    g.push(gains[1]);
  }
  if (housing) {
    const bm = new THREE.Matrix4().compose(d.clone().multiplyScalar(start * 0.15), _hq, new THREE.Vector3(...housingSize));
    pt.attach(rig, housing, bm);
  }
  return { pt, light: new MultiLight(parts, g) };
}

/** Empty v3 light-group record with x / y rotation lists. */
export function rotGroup(mirrorY = false, mirrorX = false) {
  return { lights: [], rotation: { x: [], y: [], mirror: { x: mirrorX, y: mirrorY } } };
}

/** Adds a movingHead() result to a rotGroup(). */
export function pushHead(g, e) {
  g.lights.push(e.light);
  g.rotation.x.push(e.pt.tilt);
  g.rotation.y.push(e.pt.yaw);
}
