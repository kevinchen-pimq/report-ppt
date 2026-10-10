// Shared building blocks for the "classic" environments (The First, Origins, Triangle, Nice, Big Mirror).
// Our own simple geometry — no game or third-party assets.
//
// Draw-call strategy (Quest budget):
//  - every light of an environment is one instance of ONE glow bank (crossed quads with a soft 1-D
//    gradient texture, additive) → 1 draw call for all lasers, ring lights, strips and logos;
//  - lights attached to moving objects (rings, laser pivots) are re-posed in update() from their parent
//    object's transform (only when it changed, no allocations);
//  - ring bodies are one InstancedMesh per ring type, posed the same way;
//  - static scenery is merged into one mesh per material.
import { THREE, LightBank, GEO, mergeStatic, sceneryMaterials } from './kit.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const DEG = Math.PI / 180;
const _up = new THREE.Vector3(0, 1, 0);
const _d = new THREE.Vector3();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _mm = new THREE.Matrix4();
const MIRROR_Y = new THREE.Matrix4().makeScale(1, -1, 1);

/** Unity-style coordinates (z forward = away from the player) → ours (player looks down -Z). */
export const U = (x, y, z) => new THREE.Vector3(x, y, -z);

/** Matrix for a unit glow quad-cross (width 1 along X/Z, length 1 along Y) stretched from a to b. */
function lineMatrix(a, b, width, out) {
  _d.subVectors(b, a);
  const len = _d.length();
  _p.addVectors(a, b).multiplyScalar(0.5);
  _q.setFromUnitVectors(_up, _d.normalize());
  _s.set(width, len, width);
  return out.compose(_p, _q, _s);
}

let _glowTex = null;
let _glowTexUsers = 0;
/** 64×1 gradient: bright core + soft falloff (alpha), white rgb. */
function glowTexture() {
  if (!_glowTex) {
    const n = 64;
    const data = new Uint8Array(n * 4);
    for (let i = 0; i < n; i++) {
      const d = Math.abs((i + 0.5) / n - 0.5) * 2; // 0 centre → 1 edge
      const core = d < 0.1 ? 1 : d < 0.16 ? 1 - (d - 0.1) / 0.06 : 0;
      const glow = 0.42 * Math.exp(-((d / 0.42) ** 2)) * (1 - d);
      const a = Math.min(1, core + glow);
      data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = 255;
      data[i * 4 + 3] = Math.round(a * 255);
    }
    _glowTex = new THREE.DataTexture(data, n, 1, THREE.RGBAFormat);
    _glowTex.magFilter = THREE.LinearFilter;
    _glowTex.minFilter = THREE.LinearMipmapLinearFilter;
    _glowTex.generateMipmaps = true;
    _glowTex.wrapS = _glowTex.wrapT = THREE.ClampToEdgeWrapping;
    _glowTex.needsUpdate = true;
  }
  _glowTexUsers++;
  return _glowTex;
}
function releaseGlowTexture() {
  if (--_glowTexUsers <= 0 && _glowTex) {
    _glowTex.dispose();
    _glowTex = null;
    _glowTexUsers = 0;
  }
}

function glowMaterial(clip) {
  const mat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    map: glowTexture(),
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
    fog: false,
  });
  mat.forceSinglePass = true; // additive: no need for three's two-pass transparent double-side rendering
  if (clip) {
    // reflection bank (instances mirrored at y = 0), clipped to the mirror floor rectangle
    // constants baked into the shader (per environment)
    const f = (v) => v.toFixed(3);
    // keep a reflected fragment only where the view ray to it crosses the floor (y = 0) inside the mirror
    const cond = `mirrorClip( vMirrorW )`;
    const fn = `
bool mirrorClip( vec3 w ) {
  if ( w.y > 0.0 || cameraPosition.y <= 0.0 ) return true;
  vec3 hit = cameraPosition + ( w - cameraPosition ) * ( cameraPosition.y / ( cameraPosition.y - w.y ) );
  return abs( hit.x ) > ${f(clip.halfWidth)} || hit.z > ${f(clip.zNear)} || hit.z < ${f(clip.zFar)};
}`;
    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vMirrorW;')
        .replace('#include <project_vertex>', `#include <project_vertex>
  vec4 mirrorW = vec4( transformed, 1.0 );
  #ifdef USE_INSTANCING
    mirrorW = instanceMatrix * mirrorW;
  #endif
  vMirrorW = ( modelMatrix * mirrorW ).xyz;`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\nvarying vec3 vMirrorW;\n${fn}`)
        .replace('void main() {', `void main() {
  if ( ${cond} ) discard;`);
    };
    mat.customProgramCacheKey = () => `classicMirrorClip ${fn}`;
  }
  return mat;
}

function crossGeometry() {
  const a = new THREE.PlaneGeometry(1, 1);
  const b = new THREE.PlaneGeometry(1, 1).rotateY(Math.PI / 2);
  const g = mergeGeometries([a, b], false);
  a.dispose();
  b.dispose();
  return g;
}

/** One addressable light = a core glow instance (+ optional dimmed reflection instance). */
class GlowLight {
  constructor(core, mirror, k) {
    this.core = core;
    this.mirror = mirror;
    this.k = k;
  }
  set(r, g, b) {
    this.core.set(r, g, b);
    if (this.mirror) this.mirror.set(r * this.k, g * this.k, b * this.k);
  }
}

/** Tracks objects the runtime moves (rings, laser pivots) and re-poses what hangs on them. */
class Followers {
  constructor() {
    this.items = [];
  }
  item(obj) {
    let it = obj.userData.__follow;
    if (!it) {
      it = { obj, key: new Float64Array(6).fill(NaN), lights: [], bodies: [] };
      obj.userData.__follow = it;
      this.items.push(it);
    }
    return it;
  }
  update(force = false) {
    for (const it of this.items) {
      const o = it.obj;
      const k = it.key;
      const p = o.position;
      const r = o.rotation;
      if (!force && k[0] === p.x && k[1] === p.y && k[2] === p.z && k[3] === r.x && k[4] === r.y && k[5] === r.z) continue;
      k[0] = p.x; k[1] = p.y; k[2] = p.z; k[3] = r.x; k[4] = r.y; k[5] = r.z;
      o.updateMatrix();
      for (const e of it.lights) {
        _m.multiplyMatrices(o.matrix, e.local);
        e.core.bank.setMatrix(e.core.index, _m);
        if (e.mirror) {
          _mm.multiplyMatrices(MIRROR_Y, _m);
          e.mirror.bank.setMatrix(e.mirror.index, _mm);
        }
      }
      for (const b of it.bodies) {
        _m.multiplyMatrices(o.matrix, b.local);
        b.mesh.setMatrixAt(b.index, _m);
        b.mesh.instanceMatrix.needsUpdate = true;
      }
    }
  }
}

/**
 * Environment build context: root, one glow bank (+ optional reflection bank), followers, static boxes.
 * `mirror`: { halfWidth, zNear, zFar, k } enables reflected copies of lights (Big Mirror).
 */
export class ClassicKit {
  constructor({ maxLights = 512, mirror = null } = {}) {
    this.root = new THREE.Group();
    this.mats = sceneryMaterials();
    this.owned = [];
    this.followers = new Followers();
    this.geo = crossGeometry();
    this.owned.push(this.geo);
    this.glowMat = glowMaterial(null);
    this.owned.push(this.glowMat);
    this.bank = new LightBank(this.root, this.geo, maxLights, { material: this.glowMat, renderOrder: 2 });
    this.banks = [this.bank];
    this.mirror = mirror;
    if (mirror) {
      this.mirrorMat = glowMaterial(mirror);
      this.owned.push(this.mirrorMat);
      this.mirrorBank = new LightBank(this.root, this.geo, maxLights, { material: this.mirrorMat, renderOrder: 1 });
      this.banks.push(this.mirrorBank);
    }
    this.boxes = { dark: [], metal: [] };
    this.statics = [];
  }

  /**
   * A glowing line from a to b (Vector3, parent-local when `parent` is given), `width` = glow width (m).
   * opts.mirror (default true when the kit mirrors): also add a reflected copy below y = 0.
   */
  line(a, b, width, { parent = null, mirror = true } = {}) {
    const local = lineMatrix(a, b, width, new THREE.Matrix4());
    let world = local;
    if (parent) {
      parent.updateMatrix();
      world = new THREE.Matrix4().multiplyMatrices(parent.matrix, local);
    }
    const core = this.bank.add(world);
    let ml = null;
    if (this.mirror && mirror) ml = this.mirrorBank.add(new THREE.Matrix4().multiplyMatrices(MIRROR_Y, world));
    if (parent) this.followers.item(parent).lights.push({ local, core, mirror: ml });
    return new GlowLight(core, ml, this.mirror ? this.mirror.k : 0);
  }

  /** Static dark box: Unity-style position / size / Euler degrees (converted to our frame). */
  box(pos, size, rot = [0, 0, 0], mat = 'dark') {
    const m = new THREE.Mesh(GEO.box);
    m.position.set(pos[0], pos[1], -pos[2]);
    m.scale.set(Math.abs(size[0]), Math.abs(size[1]), Math.abs(size[2]));
    m.rotation.set(-rot[0] * DEG, -rot[1] * DEG, rot[2] * DEG, 'YXZ');
    this.boxes[mat].push(m);
    return m;
  }

  /** Box in our own frame (no conversion). */
  rawBox(pos, size, rotation = [0, 0, 0], mat = 'dark') {
    const m = new THREE.Mesh(GEO.box);
    m.position.set(...pos);
    m.scale.set(...size);
    m.rotation.set(...rotation);
    this.boxes[mat].push(m);
    return m;
  }

  /**
   * Ring set: `count` empty Groups (what the runtime rotates / zooms) at (0, y, -(z0 + i dz)), with an
   * instanced body (bodyGeo, ring-local) and per-ring lights from lightSegs [[a, b, width], …] (ring-local).
   * Returns { objects, lights: Light[][] } (lights[ring][k]).
   */
  rings({ count, y, z0, dz, bodyGeo = null, bodyMat = 'metal', lightSegs = [], rot0 = 0, rotStep = 0, mirrorLights = true }) {
    const objects = [];
    const lights = [];
    let mesh = null;
    if (bodyGeo) {
      this.owned.push(bodyGeo);
      mesh = new THREE.InstancedMesh(bodyGeo, this.mats[bodyMat], count);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      this.root.add(mesh);
      this.statics.push(mesh);
    }
    const ident = new THREE.Matrix4();
    for (let i = 0; i < count; i++) {
      const g = new THREE.Group();
      g.position.set(0, y, -(z0 + i * dz));
      g.rotation.z = (rot0 + rotStep * i) * DEG;
      this.root.add(g);
      objects.push(g);
      const it = this.followers.item(g);
      if (mesh) {
        g.updateMatrix();
        mesh.setMatrixAt(i, g.matrix);
        it.bodies.push({ mesh, index: i, local: ident });
      }
      lights.push(lightSegs.map(([a, b, w]) => this.line(a, b, w, { parent: g, mirror: mirrorLights })));
    }
    return { objects, lights };
  }

  /** Laser pivot (spins around its local Y, set by the runtime) holding beams given in pivot-local coords. */
  pivot(pos, beams, width, { axis = 'y', mirror = true } = {}) {
    const p = new THREE.Group();
    p.position.copy(pos);
    p.userData.axis = axis;
    this.root.add(p);
    const lights = beams.map(([a, b]) => this.line(a, b, width, { parent: p, mirror }));
    return { pivot: p, lights };
  }

  /** Finish: merge static boxes, return the module result pieces. */
  finish({ groups, rings = [], lasers = { left: [], right: [] }, update = null, extraDispose = null }) {
    for (const [name, list] of Object.entries(this.boxes)) {
      if (!list.length) continue;
      const mesh = mergeStatic(list, this.mats[name]);
      this.root.add(mesh);
      this.owned.push(mesh.geometry);
    }
    this.followers.update(true);
    const followers = this.followers;
    const banks = this.banks;
    const owned = this.owned;
    const mats = this.mats;
    const statics = this.statics;
    return {
      root: this.root,
      banks,
      groups,
      rings,
      lasers,
      update(t, dt) {
        followers.update(false);
        if (update) update(t, dt);
      },
      dispose() {
        for (const b of banks) b.dispose();
        for (const m of statics) {
          m.removeFromParent();
          m.dispose?.();
        }
        for (const o of owned) o.dispose();
        Object.values(mats).forEach((m) => m.dispose());
        releaseGlowTexture();
        if (extraDispose) extraDispose();
      },
    };
  }
}

/** Merge boxes (our frame: [pos, size, rotZ?]) into one geometry — used for ring bodies. */
export function boxesGeometry(list) {
  const parts = list.map(([pos, size, rz = 0]) => {
    const g = new THREE.BoxGeometry(size[0], size[1], size[2]);
    if (rz) g.rotateZ(rz);
    g.translate(pos[0], pos[1], pos[2]);
    return g;
  });
  const merged = mergeGeometries(parts, false);
  for (const g of parts) g.dispose();
  return merged;
}

/** Square frame (axis-aligned in ring space) with outer half-size `outer`, bar width `bar`, depth `depth`. */
export function squareFrame(outer, bar, depth, { gapTopBottom = 0 } = {}) {
  const c = outer - bar / 2;
  const L = outer * 2;
  const list = [
    [[-c, 0, 0], [bar, L, depth]],
    [[c, 0, 0], [bar, L, depth]],
  ];
  if (gapTopBottom > 0) {
    const seg = outer - bar - gapTopBottom / 2;
    for (const sy of [-1, 1]) for (const sx of [-1, 1]) list.push([[sx * (gapTopBottom / 2 + seg / 2), sy * c, 0], [seg, bar, depth]]);
  } else {
    list.push([[0, c, 0], [L - 2 * bar, bar, depth]], [[0, -c, 0], [L - 2 * bar, bar, depth]]);
  }
  return boxesGeometry(list);
}

/** Polygon frame through `pts` ([x, y] ring-local), bars of width `bar` and depth `depth`. */
export function polyFrame(pts, bar, depth) {
  const list = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) + bar;
    list.push([[(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 0], [len, bar, depth], Math.atan2(dy, dx)]);
  }
  return boxesGeometry(list);
}

/**
 * The tower blocks left and right of the track used by The First / Triangle / Nice / Big Mirror
 * (side s = -1 left, +1 right). x0 = building centre, zs = z shift. Returns the two vertical light
 * strip endpoints [[a,b],[a,b]] (BuildingLight1, BuildingLight2) in our frame.
 */
export function towerBlocks(kit, s, x0 = 39, zs = 0) {
  const X = (dx) => s * (x0 + dx);
  kit.box([X(0), -63.5, 24 + zs], [10, 151, 4]);
  kit.box([X(0), -84, 32 + zs], [10, 200, 4]);
  kit.box([X(0.5), 14, 17.5 + zs], [1, 15, 6], [45, 0, 0]);
  kit.box([X(0.5), 3.4, 42 + zs], [1, 15, 4]);
  kit.box([X(0.5), 12, 32 + zs], [5.5, 4, 40]);
  kit.box([X(0), 36, 32 + zs], [1, 40, 1]);
  kit.box([X(5), 14.8, 42 + zs], [20, 3.5, 6]);
  kit.box([X(-4), 13, 32 + zs], [1, 1, 50]);
  kit.box([X(-4), 11, 32 + zs], [1, 1, 50]);
  return [
    [U(X(-5), -21, 24 + zs), U(X(-5), 11, 24 + zs)],
    [U(X(-5), -17, 32 + zs), U(X(-5), 15, 32 + zs)],
  ];
}

/** The 6 m wide floating track with stilts and under-track supports (The First / Triangle / Big Mirror). */
export function floatingTrack(kit, { halfWidth = 3, z0 = 6, z1 = 300, stiltX = 2.75 } = {}) {
  // side strips beside the game's runway (|x| > 1), then the full-width track beyond z = 40
  const hw = halfWidth;
  const sideW = hw - 1.02;
  for (const s of [-1, 1]) {
    kit.box([s * (1.02 + sideW / 2), -0.29, (z0 + 41) / 2], [sideW, 0.5, 41 - z0]);
  }
  kit.box([0, -0.29, (41 + z1) / 2], [hw * 2, 0.5, z1 - 41]);
  for (const s of [-1, 1]) {
    kit.box([s * stiltX, -50.4, z0 + 0.25], [0.5, 100, 0.5]);
    kit.box([s * (stiltX + 0.25), -50, z0 - 0.1], [0.2, 100, 0.2]);
    kit.box([s * stiltX, -2, (z0 + z1) / 2], [0.3, 0.4, z1 - z0], [0, 0, s * -22.5]);
  }
}

export { DEG };
