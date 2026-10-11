// Shared helpers for the v3 (group lighting) environments The Weeknd, Rock Mixtape, Imagine
// Dragons 2, Panic! 2 and Queen. Our own code, no game assets.
//
// These environments are built in a "Unity frame": a child group of the module root with
// scale z = -1, so positions, rotations and the translation / rotation axes of the official
// light groups can be written in the game's own convention (x right, y up, +z away from the
// player) and the official mirror flags apply unchanged. The runtime writes
// obj.rotation[axis] = rest + angle on pivots inside that frame, which then turns the same way
// as in the original. Three.js flips the face winding of meshes under a mirrored matrix.
import { THREE, LightBank, GlowBank, PropBank, Rig, MultiLight, GEO, tubeMatrix, mergeAll, lightMaterial } from './kit.js';

export const D2R = Math.PI / 180;
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

/** 0..1 RGB → '#rrggbb'. */
export function hex(c) {
  return '#' + c.map((x) => Math.round(Math.max(0, Math.min(1, x)) * 255).toString(16).padStart(2, '0')).join('');
}

/** Module colour scheme from [r, g, b] (0..1) values. */
export function scheme({ left, right, envLeft, envRight, wall, envLeftBoost, envRightBoost, envWhite }) {
  const o = { left: hex(left), right: hex(right), envLeft: hex(envLeft), envRight: hex(envRight), wall: hex(wall) };
  if (envLeftBoost) o.envLeftBoost = hex(envLeftBoost);
  if (envRightBoost) o.envRightBoost = hex(envRightBoost);
  if (envWhite) o.envWhite = hex(envWhite);
  return o;
}

/** Object3D in `parent` at p (metres), Unity Euler angles r (degrees, Z then X then Y), uniform scale s. */
export function node(parent, p = [0, 0, 0], r = [0, 0, 0], s = 1) {
  const o = new THREE.Object3D();
  o.position.set(p[0], p[1], p[2]);
  o.rotation.set(r[0] * D2R, r[1] * D2R, r[2] * D2R, 'YXZ');
  if (Array.isArray(s)) o.scale.set(s[0], s[1], s[2]);
  else o.scale.setScalar(s);
  parent.add(o);
  return o;
}

/** The chain of pivots from just below `top` down to `obj` (outermost first), for Rig bindings. */
export function chainOf(obj, top) {
  const out = [];
  for (let o = obj; o && o !== top; o = o.parent) out.unshift(o);
  return out;
}

/** Matrix from position / Unity Euler degrees / scale ([sx, sy, sz] or a number). */
export function mat(p = [0, 0, 0], r = [0, 0, 0], s = 1, out = new THREE.Matrix4()) {
  const e = new THREE.Euler(r[0] * D2R, r[1] * D2R, r[2] * D2R, 'YXZ');
  const sc = Array.isArray(s) ? s : [s, s, s];
  return out.compose(new THREE.Vector3(p[0], p[1], p[2]), new THREE.Quaternion().setFromEuler(e), new THREE.Vector3(sc[0], sc[1], sc[2]));
}

/** Torus (ring) geometry in the XZ plane (horizontal), radius 1, tube radius `tube`. */
export function ringGeometry(tube = 0.06, radial = 4, tubular = 40) {
  const g = new THREE.TorusGeometry(1, tube, radial, tubular);
  g.rotateX(Math.PI / 2);
  return g;
}

/** Flat ring (annulus) in the XY plane, outer radius 1. */
export function annulusGeometry(inner = 0.85, seg = 40) {
  return new THREE.RingGeometry(inner, 1, seg, 1);
}

/** Chevron "V" (two flat bars) in the XY plane, tip at (0, 0) pointing -y, arms up to y = 1, half width 1. */
export function chevronGeometry(t = 0.18) {
  const parts = [];
  for (const s of [-1, 1]) {
    const g = new THREE.PlaneGeometry(1, 1);
    const len = Math.hypot(1, 1);
    g.scale(len, t, 1);
    g.rotateZ(s * Math.PI / 4);
    g.translate(s * 0.5, 0.5, 0);
    parts.push(g);
  }
  return mergeAll(parts);
}

/** Box geometry placed at p with size sz and Unity rotation r, for static merges. */
export function boxGeo(p, sz, r = [0, 0, 0]) {
  const g = new THREE.BoxGeometry(1, 1, 1);
  g.applyMatrix4(mat(p, r, sz));
  return g;
}

/**
 * Environment builder: root (player frame) with a mirrored Unity frame `u`, one Rig, and the
 * banks / disposables it creates.
 */
export class Builder {
  constructor(name) {
    this.root = new THREE.Group();
    this.root.name = name;
    this.u = new THREE.Group();
    this.u.scale.z = -1;
    this.root.add(this.u);
    this.rig = new Rig(this.u);
    this.banks = [];
    this.owned = [];
    this.m = new THREE.Matrix4();
  }

  own(x) {
    this.owned.push(x);
    return x;
  }

  /** LightBank on the Unity frame (double sided, additive). */
  bank(geometry, max, { opacity = 1, renderOrder = 0, ownGeo = false } = {}) {
    const b = new LightBank(this.u, geometry, max, { material: lightMaterial({ opacity }), renderOrder });
    b.mesh.material.side = THREE.DoubleSide;
    b.mesh.material.forceSinglePass = true;
    this.banks.push(b);
    this.own(b.mesh.material);
    if (ownGeo) this.own(geometry);
    this.owned.push({ dispose: () => b.dispose() });
    return b;
  }

  /** GlowBank (core + halo) on the Unity frame. */
  glow(geometry, max, opts = {}) {
    const g = new GlowBank(this.u, geometry, max, opts);
    for (const b of g.banks) {
      b.mesh.material.side = THREE.DoubleSide;
      b.mesh.material.forceSinglePass = true;
    }
    this.banks.push(...g.banks);
    this.owned.push(g);
    return g;
  }

  /** PropBank (movable scenery instances) on the Unity frame. */
  props(geometry, material, max) {
    const p = new PropBank(this.u, geometry, material, max, { ownMaterial: true });
    this.own(material); // the bank draws with its own copy
    this.banks.push(p);
    this.owned.push(p);
    return p;
  }

  /** A light at `local` that follows `pivot` (or is static when pivot is null). */
  light(pivot, target, local, haloLocal = null) {
    if (!pivot) {
      if (target instanceof GlowBank) return target.add(local, haloLocal || local);
      return target.add(local);
    }
    return this.rig.light(chainOf(pivot, this.u), target, local, haloLocal);
  }

  /** Tube light a → b (in the pivot's space, or the Unity frame when pivot is null). */
  tube(pivot, glow, a, b, r, haloScale = null) {
    const k = haloScale ?? glow.haloScale;
    const mc = tubeMatrix(_v.set(a[0], a[1], a[2]), _w.set(b[0], b[1], b[2]), r, new THREE.Matrix4());
    const mh = glow.halo ? tubeMatrix(_v.set(a[0], a[1], a[2]), _w.set(b[0], b[1], b[2]), r * k, new THREE.Matrix4()) : null;
    return this.light(pivot, glow, mc, mh);
  }

  /** Prop instance at `local` following `pivot` (static when null). */
  prop(pivot, propBank, local) {
    if (!pivot) return propBank.add(local);
    return this.rig.attach(chainOf(pivot, this.u), propBank, local);
  }

  /** Merges static geometries (Unity frame) into one mesh with `material`. */
  merge(geos, material) {
    const mesh = new THREE.Mesh(mergeAll(geos), material);
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    this.u.add(mesh);
    this.own(mesh.geometry);
    this.own(material);
    return mesh;
  }

  /** Static mesh in the player frame (floor, sky …). */
  add(mesh) {
    this.root.add(mesh);
    if (mesh.geometry) this.own(mesh.geometry);
    if (mesh.material) this.own(mesh.material);
    return mesh;
  }

  /** Returns the module's built object. */
  finish(extra) {
    const rig = this.rig;
    rig.update(true);
    const owned = this.owned;
    return {
      root: this.root,
      banks: this.banks,
      groups: {},
      update() {
        rig.update();
      },
      dispose() {
        for (const o of owned) o.dispose?.();
      },
      ...extra,
    };
  }
}

/** Light group entry for `lightGroups`. rot / tr: { x?: [], y?: [], z?: [], mirror?: {}, scale? }. */
export function group(lights, { count = null, rot = null, tr = null } = {}) {
  const g = { lights, count: count ?? lights.length };
  if (rot) g.rotation = rot;
  if (tr) g.translation = { scale: 1, ...tr };
  return g;
}

/** One light made of several (e.g. core + halo of several shapes). */
export function multi(...parts) {
  const L = new MultiLight();
  for (const p of parts) {
    if (p instanceof MultiLight) p.parts.forEach((q, i) => L.push(q, p.gains[i]));
    else L.push(p, 1);
  }
  return L;
}
