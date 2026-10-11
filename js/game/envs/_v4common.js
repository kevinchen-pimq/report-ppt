// Small helpers shared by the v3 group-lighting recreations Collider, Britney, Monstercat 2 and
// Metallica (our own code; see CONTRACT.md "v3 environments"). Not an environment module.
import { THREE, MultiLight } from './kit.js';

/** Empty Object3D at (x, y, z) with rotation (rx, ry, rz) (radians), added to `parent`. */
export function pivot(parent, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const o = new THREE.Object3D();
  o.position.set(x, y, z);
  o.rotation.set(rx, ry, rz);
  parent.add(o);
  return o;
}

/**
 * A `lightGroups` entry: { lights: [], rotation?, translation?, count? }.
 * rot / tra: the axes the group can rotate / translate ('xyz', 'z', '' …). scale: metres per unit.
 */
export function lightGroup(rot = '', tra = '', { scale = 1, count = null, mirror = null } = {}) {
  const g = { lights: [] };
  if (rot) {
    g.rotation = {};
    for (const a of rot) g.rotation[a] = [];
    if (mirror) g.rotation.mirror = mirror;
  }
  if (tra) {
    g.translation = { scale };
    for (const a of tra) g.translation[a] = [];
  }
  if (count != null) g.count = count;
  return g;
}

/** Registers `obj` as element pivot of group g (for all of the group's rotation / translation axes). */
export function addPivot(g, obj) {
  for (const k of ['rotation', 'translation']) {
    const spec = g[k];
    if (!spec) continue;
    for (const a of 'xyz') if (spec[a]) spec[a].push(obj);
  }
  return obj;
}

/** Combines several lights into one element (or returns the single one). */
export function multi(parts, gains = null) {
  return parts.length === 1 && !gains ? parts[0] : new MultiLight(parts, gains);
}

/**
 * fx group (vfx event boxes) without a visual of its own: keeps the last value per element, and
 * optionally calls apply(i, v). (Mask strengths, fire / smoke amounts …)
 */
export function fxGroup(count, apply = null) {
  const values = new Float32Array(count);
  return {
    count,
    values,
    set(i, v) {
      if (i < 0 || i >= count) return;
      values[i] = v;
      apply?.(i, v);
    },
  };
}

/** Star field: one Points draw call, `n` stars on a shell between r0 and r1 (upper hemisphere bias). */
export function starField(parent, rand, n = 700, r0 = 150, r1 = 260, { size = 0.7, color = 0x9aa4c0, minY = -40 } = {}) {
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    let x, y, z;
    do {
      x = rand() * 2 - 1;
      y = rand() * 2 - 1;
      z = rand() * 2 - 1;
    } while (x * x + y * y + z * z > 1 || x * x + y * y + z * z < 0.05);
    const r = r0 + (r1 - r0) * rand();
    const k = r / Math.sqrt(x * x + y * y + z * z);
    pos[i * 3] = x * k;
    pos[i * 3 + 1] = Math.max(minY, y * k);
    pos[i * 3 + 2] = z * k - 40;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({ color, size, sizeAttenuation: true, fog: false, toneMapped: false, depthWrite: false, transparent: true });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  pts.matrixAutoUpdate = false;
  pts.renderOrder = -5;
  parent.add(pts);
  return pts;
}

/** Disposes geometries / materials / anything with dispose() collected during build(). */
export function disposeAll(list) {
  for (const x of list) {
    if (!x) continue;
    if (x.isMesh || x.isPoints || x.isLine) {
      x.removeFromParent();
      x.geometry?.dispose();
      const m = x.material;
      if (Array.isArray(m)) m.forEach((y) => y.dispose());
      else m?.dispose();
    } else x.dispose?.();
  }
}

/** Unit ring (annulus) in the XY plane: outer radius 1, inner radius `inner`, for LightBanks. */
export function ringGeometry(inner = 0.86, segments = 32) {
  return new THREE.RingGeometry(inner, 1, segments, 1);
}

/** Closed polyline as tube segments on a GlowBank via the rig: returns one light (MultiLight). */
export function rigPolyline(rig, chain, glow, pts, radius, closed = true) {
  const parts = [];
  const n = pts.length;
  for (let i = 0; i < (closed ? n : n - 1); i++) parts.push(rig.tube(chain, glow, pts[i], pts[(i + 1) % n], radius));
  return multi(parts);
}

/** Same as rigPolyline on a static GlowBank (no pivots). */
export function polyline(glow, pts, radius, closed = true) {
  const parts = [];
  const n = pts.length;
  for (let i = 0; i < (closed ? n : n - 1); i++) parts.push(glow.tube(pts[i], pts[(i + 1) % n], radius));
  return multi(parts);
}
