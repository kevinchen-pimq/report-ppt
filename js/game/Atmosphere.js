// Lit atmosphere ("bloom fog"): the environment's lights light the air and the scenery around
// them, the way Beat Saber's fog glows in the light colours. Generic: works on any environment
// module (its `groups` / `lightGroups` lights) and on our own scenery, no per-module work.
//
//   fog / sky   each frame an ambient colour is derived from the lit lights (weighted by size,
//               normalised by the environment's total, compressed so 1 light vs 50 both read) and
//               added to the scene fog, the background colour and sky domes: distant geometry fades
//               into a haze in the light colour, dark again when the lights go off.
//   regions     scenery materials (non-light: standard / basic / line materials) get a cheap
//               world-position tint from four "virtual lights" — left, right, centre and far
//               averages of the lights in each area (onBeforeCompile, a few ALU ops per pixel,
//               no loop over lights).
//   air         ('full' only) one instanced, additive bank per environment (ONE draw call): a
//               soft camera-facing ribbon around every light (its longest bars) so beams seem to
//               light the air. Instances of dark lights collapse in the vertex shader (no pixels);
//               ribbons fade out near the camera, so overdraw stays modest.
//
// Levels: 'off' (nothing at all: no patched shaders, no extra mesh, no per-frame work — exactly the
// look without it), 'fog' (fog / sky / regions), 'full' (+ air glow).
// Per module: `atmosphere: false` turns it off for that environment, or `{ fog, sky, surface, air }`
// gains (default 1) tune it; a light with `light.atmo = false` is ignored.
import * as THREE from 'three';
import { SoftGlow } from './envs/kit.js';

export const ATMOSPHERE_LEVELS = ['off', 'fog', 'full'];

// ---- tuning --------------------------------------------------------------------------------
const FOG_GAIN = 0.05; // ambient colour → scene fog colour (added to the base fog)
const BG_GAIN = 0.035; // → background colour
const SKY_GAIN = 0.06; // → sky domes (toward the horizon)
const SURF_DIFFUSE = 1.0; // regional light × material colour
const SURF_SCATTER = 0.011; // regional light added regardless of the material (haze in front of it)
const AIR_GAIN = 0.035; // air glow brightness relative to the light colour
const AIR_FAR = 50; // m: air glow at half strength this far from the camera
const AIR_CROWD = 40; // more lit air instances than this: each one fainter (1 / sqrt)
const AIR_AREA = 8000; // m²: more lit air glow area than this: each one fainter (1 / sqrt)
const MAX_AIR = 400; // air instances per environment
const MAX_AIR_PER_LIGHT = 4;
const LIGHT_CAP = 1.5; // a flash may count up to 1.5× (hue kept)
const SMOOTH = 14; // 1/s: how fast the ambient follows the lights
// regions: |x| (m) at which a point is fully left / right; far blend between these distances ahead
const SIDE = 12;
const FAR0 = 45;
const FAR1 = 110;

const _m = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _box = new THREE.Box3();
const _bb = new THREE.Box3();
const _v = new THREE.Vector3();
const _c = new THREE.Vector3();

/** Region weights of a point (left, right, centre, far), the same formula the shader uses. */
export function regionWeights(x, z, out) {
  const s = Math.max(-1, Math.min(1, x / SIDE));
  const f = Math.max(0, Math.min(1, (-z - FAR0) / (FAR1 - FAR0)));
  out[0] = Math.max(0, -s) * (1 - f);
  out[1] = Math.max(0, s) * (1 - f);
  out[2] = (1 - Math.abs(s)) * (1 - f);
  out[3] = f;
  return out;
}

/** Brightness compression: fraction of light 0 … 1+ → 0 … ~1 (a few lights already show). */
function compress(rgb, i) {
  const m = Math.max(rgb[i], rgb[i + 1], rgb[i + 2]);
  if (m <= 1e-6) {
    rgb[i] = rgb[i + 1] = rgb[i + 2] = 0;
    return;
  }
  const k = (1 - Math.exp(-3 * m)) / 0.95 / m;
  rgb[i] *= k;
  rgb[i + 1] *= k;
  rgb[i + 2] *= k;
}

// ---- shaders ------------------------------------------------------------------------------

const SURF_VERT_HEAD = 'varying vec3 vAtmoW;';
const SURF_VERT_BODY = `
  vec4 atmoW = vec4( transformed, 1.0 );
  #ifdef USE_INSTANCING
    atmoW = instanceMatrix * atmoW;
  #endif
  vAtmoW = ( modelMatrix * atmoW ).xyz;`;
const SURF_FRAG_HEAD = `
varying vec3 vAtmoW;
uniform vec3 atmoL;
uniform vec3 atmoR;
uniform vec3 atmoC;
uniform vec3 atmoF;
uniform vec2 atmoK;
vec3 atmoAt( vec3 w ) {
  float s = clamp( w.x * ${(1 / SIDE).toFixed(5)}, -1.0, 1.0 );
  vec3 near = atmoC + max( -s, 0.0 ) * ( atmoL - atmoC ) + max( s, 0.0 ) * ( atmoR - atmoC );
  return mix( near, atmoF, clamp( ( -w.z - ${FAR0.toFixed(1)} ) * ${(1 / (FAR1 - FAR0)).toFixed(5)}, 0.0, 1.0 ) );
}`;
const SURF_FRAG_BODY = `
  outgoingLight += atmoAt( vAtmoW ) * ( diffuseColor.rgb * atmoK.x + atmoK.y );`;
const SKY_VERT_HEAD = 'varying float vAtmoH;';
const SKY_VERT_BODY = `
  vAtmoH = 1.0 - clamp( normalize( position ).y, 0.0, 1.0 );
  vAtmoH *= vAtmoH;`;
const SKY_FRAG_HEAD = 'varying float vAtmoH;\nuniform vec3 atmoSky;';
const SKY_FRAG_BODY = `
  outgoingLight += atmoSky * ( 0.35 + 0.65 * vAtmoH );`;

function inject(shader, kind, uniforms) {
  const sky = kind === 'sky';
  for (const k of sky ? ['atmoSky'] : ['atmoL', 'atmoR', 'atmoC', 'atmoF', 'atmoK']) shader.uniforms[k] = uniforms[k];
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\n${sky ? SKY_VERT_HEAD : SURF_VERT_HEAD}`)
    .replace('#include <project_vertex>', `#include <project_vertex>\n${sky ? SKY_VERT_BODY : SURF_VERT_BODY}`);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>\n${sky ? SKY_FRAG_HEAD : SURF_FRAG_HEAD}`)
    .replace('#include <opaque_fragment>', `${sky ? SKY_FRAG_BODY : SURF_FRAG_BODY}\n#include <opaque_fragment>`);
}

/** Which atmosphere shader a material gets: 'surface' | 'sky' | null (lights, custom shaders …). */
function materialKind(mat, obj) {
  if (!mat || mat.userData.atmo === false || mat.isShaderMaterial) return null;
  if (mat.userData.atmoSky || obj.userData.atmoSky) return 'sky';
  // emissive / light materials: additive, or not tone mapped (logos, glowing panels)
  if (mat.blending === THREE.AdditiveBlending || mat.toneMapped === false) return null;
  if (mat.isMeshBasicMaterial && mat.side === THREE.BackSide && !mat.fog) return 'sky';
  if (mat.isMeshStandardMaterial || mat.isMeshBasicMaterial || mat.isMeshLambertMaterial || mat.isMeshPhongMaterial ||
    (mat.isLineBasicMaterial && !mat.isLineDashedMaterial)) return 'surface';
  return null;
}

/** Scenery materials under `root` (shared materials once): [{ mat, kind }]. */
export function sceneryMaterialsOf(root, out = []) {
  const seen = new Set(out.map((e) => e.mat));
  root.traverse((o) => {
    if (!o.material || !(o.isMesh || o.isLine)) return;
    for (const mat of Array.isArray(o.material) ? o.material : [o.material]) {
      if (seen.has(mat)) continue;
      seen.add(mat);
      const kind = materialKind(mat, o);
      if (kind) out.push({ mat, kind });
    }
  });
  return out;
}

// The air glow: a ribbon along the instance's long axis (column 0 = the full axis vector, column 1
// length = half width, column 3 = centre), turned about that axis to face the camera.
// Attribute air: x = position along the axis (-0.5 … 0.5), y = cap extension beyond the ends (in
// half widths, -1 / 0 / 1), z = across (-1 / 1).
const AIR_VERT = `
attribute vec3 air;
varying vec3 vColor;
varying vec2 vAir;
varying vec2 vNear;
void main() {
  mat4 m = modelMatrix * instanceMatrix;
  vec3 axis = m[0].xyz;
  float w = length( m[1].xyz );
  float len = length( axis );
  vec3 dir = len > 1e-5 ? axis / len : vec3( 0.0, 1.0, 0.0 );
  vec3 p = m[3].xyz + axis * air.x + dir * ( w * air.y );
  vec3 toCam = cameraPosition - p;
  vec3 side = cross( dir, toCam );
  float sl = length( side );
  side = sl > 1e-4 ? side / sl : normalize( m[1].xyz + vec3( 1e-6 ) );
  p += side * ( w * air.z );
  // far ones (many of them stack up toward the vanishing point) get fainter; seen end-on a ribbon
  // folds onto itself: fainter too
  float d = length( toCam );
  float fade = clamp( 2.5 * sl / max( d, 1e-3 ), 0.0, 1.0 ) / ( 1.0 + d * d * ${(1 / (AIR_FAR * AIR_FAR)).toExponential(4)} );
  vColor = instanceColor * fade;
  vAir = vec2( air.z, 1.0 - abs( air.y ) );
  vec4 mv = viewMatrix * vec4( p, 1.0 );
  vNear = vec2( -mv.z, w ); // view depth, half width: near fade per pixel (long ribbons pass the camera)
  gl_Position = projectionMatrix * mv;
  // dark light: the whole instance collapses outside the view (no pixels drawn)
  if ( instanceColor.r + instanceColor.g + instanceColor.b < 0.003 ) gl_Position = vec4( 2.0, 2.0, 2.0, 1.0 );
}`;
const AIR_FRAG = `
varying vec3 vColor;
varying vec2 vAir;
varying vec2 vNear;
void main() {
  float a = 1.0 - vAir.x * vAir.x;
  // close to the camera a ribbon would fill the view: fade it out
  float near = smoothstep( vNear.y, vNear.y * 4.0 + 3.0, vNear.x );
  gl_FragColor = vec4( vColor * ( a * a * vAir.y * vAir.y * near ), 1.0 );
  #include <colorspace_fragment>
}`;

let _airGeo = null;
function airGeometry() {
  if (_airGeo) return _airGeo;
  const rows = [[-0.5, -1], [-0.5, 0], [-0.3, 0], [-0.1, 0], [0.1, 0], [0.3, 0], [0.5, 0], [0.5, 1]];
  const air = [];
  const idx = [];
  rows.forEach(([x, cap], r) => {
    air.push(x, cap, -1, x, cap, 1);
    if (r > 0) {
      const a = (r - 1) * 2;
      idx.push(a, a + 1, a + 3, a, a + 3, a + 2);
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('air', new THREE.Float32BufferAttribute(air, 3));
  // three.js needs a position attribute (draw range / bounds); the shader ignores it
  g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(air.length), 3));
  g.setIndex(idx);
  _airGeo = g;
  return g;
}

let _airMat = null;
function airMaterial() {
  if (_airMat) return _airMat;
  _airMat = new THREE.ShaderMaterial({
    vertexShader: AIR_VERT,
    fragmentShader: AIR_FRAG,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
    toneMapped: false,
  });
  return _airMat;
}

// ---- light analysis -----------------------------------------------------------------------

/** Every part of a light that is drawn: [{ mesh, index (instance, -1 = whole mesh), halo, soft }]. */
function lightParts(L, out, depth = 0) {
  if (!L || depth > 6) return out;
  if (Array.isArray(L.parts)) {
    for (const p of L.parts) lightParts(p, out, depth + 1);
  } else if (L.bank && L.bank.mesh && L.bank.mesh.isInstancedMesh && Number.isInteger(L.index)) {
    const mat = L.bank.mesh.material;
    out.push({ mesh: L.bank.mesh, index: L.index, bank: L.bank, halo: !!L.bank.isHalo || (mat && mat.opacity < 1), soft: false });
  } else if (L.mesh && (L.mesh.isMesh || L.mesh.isLine)) {
    out.push({ mesh: L.mesh, index: -1, bank: null, halo: false, soft: L instanceof SoftGlow });
  }
  if (L.extra) lightParts(L.extra, out, depth + 1);
  return out;
}

/** World matrix of a part (mesh world × instance). */
function partMatrix(part, out) {
  out.copy(part.mesh.matrixWorld);
  if (part.index >= 0) out.multiply(_m2.fromArray(part.mesh.instanceMatrix.array, part.index * 16));
  return out;
}

const _geoInfo = new WeakMap();
/**
 * Bright extent of a geometry along each local axis: [centre, length] × 3. With vertex colours the
 * extent is where the light actually is (soft beams fading out, glow discs), else the bounding box.
 */
function geometryExtent(geo) {
  let e = _geoInfo.get(geo);
  if (e) return e;
  if (!geo.boundingBox) geo.computeBoundingBox();
  const bb = geo.boundingBox;
  e = [];
  const pos = geo.attributes.position;
  const col = geo.attributes.color;
  for (let a = 0; a < 3; a++) {
    const lo = bb.min.getComponent(a);
    const hi = bb.max.getComponent(a);
    let c = (lo + hi) / 2;
    let len = hi - lo;
    if (col && pos && col.count === pos.count) {
      let sw = 0;
      let s1 = 0;
      let s2 = 0;
      for (let i = 0; i < pos.count; i++) {
        const w = col.getX(i) + col.getY(i) + col.getZ(i);
        const x = pos.getComponent(i, a);
        sw += w;
        s1 += w * x;
        s2 += w * x * x;
      }
      if (sw > 0) {
        const mean = s1 / sw;
        const sd = Math.sqrt(Math.max(0, s2 / sw - mean * mean));
        c = mean;
        len = Math.min(len, sd * 3.2);
      }
    }
    e.push(c, len);
  }
  _geoInfo.set(geo, e);
  return e;
}

/**
 * Air instance fitted to a part: matrix in the part's own (instance) space, so that
 * world = mesh world × instance × fit has column 0 = the light's long axis, column 1 length =
 * the glow's half width. Returns null for degenerate parts.
 */
function airFit(part, world) {
  const ext = geometryExtent(part.mesh.geometry);
  const e = world.elements;
  const n = [Math.hypot(e[0], e[1], e[2]), Math.hypot(e[4], e[5], e[6]), Math.hypot(e[8], e[9], e[10])];
  if (n[0] < 1e-6 || n[1] < 1e-6 || n[2] < 1e-6) return null;
  const we = [ext[1] * n[0], ext[3] * n[1], ext[5] * n[2]];
  const order = [0, 1, 2].sort((p, q) => we[q] - we[p]);
  const [a, b, c] = order;
  const len = we[a];
  if (!(len > 0.02)) return null;
  // half width: grows with the light's length (long beams glow wider), covers flat panels
  let w = Math.min(1.6, 0.3 + 0.04 * len);
  w = Math.min(3, Math.max(w, we[b] * 0.5 + 0.25));
  const fit = new THREE.Matrix4();
  const f = fit.elements;
  f.fill(0);
  f[a] = ext[a * 2 + 1]; // column 0 = local axis a × its length
  f[4 + b] = w / n[b]; // column 1 = local axis b, world length w
  f[8 + c] = w / n[c];
  f[12] = ext[0]; // column 3 = the bright part's centre
  f[13] = ext[2];
  f[14] = ext[4];
  f[15] = 1;
  return { fit, len, w, area: (len + 2 * w) * 2 * w };
}

/**
 * Lights of an environment module for the atmosphere: { lights, air } where
 *   lights = [{ light, w (size weight), rw: Float32Array(4) region weights }]
 *   air    = [{ mesh, index, bank, fit, light }]
 * Call once the lights sit where they belong (after the module's first update()).
 */
export function analyseLights(lights, root) {
  root.updateMatrixWorld(true);
  const tops = [];
  const seen = new Set();
  for (const L of lights) {
    if (!L || seen.has(L) || L.atmo === false) continue;
    seen.add(L);
    tops.push(L);
  }
  const out = { lights: [], air: [] };
  const withParts = [];
  for (const L of tops) {
    const parts = lightParts(L, []);
    let core = parts.filter((p) => !p.halo);
    if (!core.length) core = parts;
    const entry = { light: L, w: 1, rw: new Float32Array([0.25, 0.25, 0.25, 0.25]) };
    out.lights.push(entry);
    if (!core.length) continue; // no shape (ambient tint …): counts everywhere
    _bb.makeEmpty();
    for (const p of core) {
      const g = p.mesh.geometry;
      if (!g.boundingBox) g.computeBoundingBox();
      partMatrix(p, _m);
      p.world = _m.clone();
      _box.copy(g.boundingBox).applyMatrix4(_m);
      _bb.union(_box);
    }
    if (_bb.isEmpty()) continue;
    _bb.getCenter(_c);
    _bb.getSize(_v);
    const size = Math.max(_v.x, _v.y, _v.z);
    entry.w = Math.max(0.15, Math.min(3, Math.sqrt(size) / 3));
    regionWeights(_c.x, _c.z, entry.rw);
    const cand = [];
    for (const p of core) {
      if (p.soft) continue;
      const fit = airFit(p, p.world);
      if (fit) cand.push({ part: p, ...fit });
    }
    cand.sort((p, q) => q.len - p.len);
    if (cand.length) withParts.push({ light: L, cand });
  }
  const per = Math.max(1, Math.min(MAX_AIR_PER_LIGHT, Math.floor(MAX_AIR / Math.max(1, withParts.length))));
  for (const { light, cand } of withParts) {
    for (let i = 0; i < cand.length && i < per && out.air.length < MAX_AIR; i++) {
      const { part, fit } = cand[i];
      out.air.push({ mesh: part.mesh, index: part.index, bank: part.bank, fit, light, area: cand[i].area, share: 1 });
    }
  }
  // lights stacked on the same spot (e.g. lasers on one pivot, before rotation events fan them out)
  // share one glow's brightness instead of adding up
  const stacks = new Map();
  for (const a of out.air) {
    partMatrix(a, _m).multiply(a.fit);
    const e = _m.elements;
    const len = Math.hypot(e[0], e[1], e[2]) || 1;
    const q = (v, k) => Math.round(v * k);
    a.key = [q(e[12], 2), q(e[13], 2), q(e[14], 2), q(Math.abs(e[0] / len), 10), q(Math.abs(e[1] / len), 10), q(Math.abs(e[2] / len), 10), q(len, 1)].join();
    stacks.set(a.key, (stacks.get(a.key) || 0) + 1);
  }
  for (const a of out.air) a.share = 1 / stacks.get(a.key);
  return out;
}

// ---- runtime ------------------------------------------------------------------------------

/**
 * What the atmosphere works on for one scene (an environment module or our own scenery):
 *   root       parent of the air glow mesh (shown / hidden with the scenery)
 *   materials  [{ mat, kind }] scenery materials to tint (sceneryMaterialsOf())
 *   analyse    () => { lights, air } (analyseLights(), or hand-made), called on first use
 *   tune       { fog, sky, surface, air } gains (default 1)
 */
export class AtmosphereTarget {
  constructor({ root, materials, analyse, tune = null }) {
    this.root = root;
    this.materials = materials;
    this.analyse = analyse;
    const t = tune || {};
    this.tune = { fog: t.fog ?? 1, sky: t.sky ?? 1, surface: t.surface ?? 1, air: t.air ?? 1 };
    this.data = null; // analyse() result
    this.wTotal = 0;
    this.wRegion = new Float32Array(4);
    this.air = null; // { mesh, parts, sources }
  }

  ensureData() {
    if (this.data) return this.data;
    this.data = this.analyse();
    this.wTotal = 0;
    this.wRegion.fill(0);
    for (const e of this.data.lights) {
      this.wTotal += e.w;
      for (let k = 0; k < 4; k++) this.wRegion[k] += e.w * e.rw[k];
    }
    return this.data;
  }

  /** The air glow bank (created on first use, 'full' only). */
  ensureAir() {
    if (this.air) return this.air;
    const parts = this.ensureData().air;
    const mesh = new THREE.InstancedMesh(airGeometry(), airMaterial(), Math.max(1, parts.length));
    mesh.count = parts.length;
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.renderOrder = 1;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, parts.length) * 3), 3);
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    mesh.name = 'atmosphere-air';
    // source meshes: their world matrix relative to the air mesh's parent, refreshed when it changes
    const sources = new Map();
    for (const p of parts) {
      if (!sources.has(p.mesh)) sources.set(p.mesh, { mesh: p.mesh, rel: new THREE.Matrix4(), last: new Float32Array(16).fill(NaN), moved: true });
      p.src = sources.get(p.mesh);
      p.cr = p.cg = p.cb = -1;
      p.share ??= 1;
      p.area ??= 0;
    }
    this.air = { mesh, parts, sources: [...sources.values()], inv: new THREE.Matrix4(), force: true, lit: 0, litArea: 0 };
    if (parts.length) this.root.add(mesh);
    return this.air;
  }

  dispose() {
    if (this.air) {
      this.air.mesh.removeFromParent();
      this.air.mesh.dispose();
      this.air = null;
    }
  }
}

export class Atmosphere {
  constructor(scene) {
    this.scene = scene;
    this.level = 'off';
    this.target = null;
    this.baseFog = new THREE.Color();
    this.baseBg = new THREE.Color();
    this.fog = null; // the Fog / Color objects being tinted (restored when switched off)
    this.bg = null;
    this.uniforms = {
      atmoL: { value: new THREE.Color(0, 0, 0) },
      atmoR: { value: new THREE.Color(0, 0, 0) },
      atmoC: { value: new THREE.Color(0, 0, 0) },
      atmoF: { value: new THREE.Color(0, 0, 0) },
      atmoK: { value: new THREE.Vector2(SURF_DIFFUSE, SURF_SCATTER) },
      atmoSky: { value: new THREE.Color(0, 0, 0) },
    };
    this.patched = new Set(); // materials with the atmosphere shader
    this.extra = []; // [{ mat, kind }] materials tinted with every target (the game's runway / platform)
    // smoothed colours: global, left, right, centre, far (rgb each)
    this.cur = new Float32Array(15);
    this.acc = new Float32Array(15);
    this.snapNext = true;
    this.airCompiled = false;
  }

  get on() {
    return this.level !== 'off' && !!this.target;
  }

  /** 'off' | 'fog' | 'full' (unknown values: 'full'; true / false for older boolean settings). */
  setLevel(level) {
    const lv = level === false ? 'off' : ATMOSPHERE_LEVELS.includes(level) ? level : 'full';
    if (lv === this.level) return;
    this.level = lv;
    this.apply();
  }

  /** Materials tinted whatever scenery is shown (patched with the current target's). */
  setExtraMaterials(list) {
    this.extra = list;
    this.apply();
  }

  /**
   * Shows `target` (null = none) with the scene's current fog / background as the base colours
   * (call after they are set; the objects are tinted in place and put back when switched off).
   */
  setTarget(target) {
    if (this.target?.air && this.target !== target) this.target.air.mesh.visible = false;
    this.restoreColors();
    this.target = target;
    this.fog = this.scene.fog || null;
    this.bg = this.scene.background && this.scene.background.isColor ? this.scene.background : null;
    if (this.fog) this.baseFog.copy(this.fog.color);
    if (this.bg) this.baseBg.copy(this.bg);
    this.snapNext = true;
    this.apply();
  }

  /** Puts the fog / background back to their base colours. */
  restoreColors() {
    if (this.fog) this.fog.color.copy(this.baseFog);
    if (this.bg) this.bg.copy(this.baseBg);
  }

  /** Brings shaders / air mesh in line with level and target. */
  apply() {
    const t = this.target;
    const on = this.on;
    if (!on) {
      this.restoreColors();
      for (const mat of this.patched) unpatch(mat);
      this.patched.clear();
      if (t?.air) t.air.mesh.visible = false;
      return;
    }
    for (const { mat, kind } of t.materials) this.patch(mat, kind);
    for (const { mat, kind } of this.extra) this.patch(mat, kind);
    // the air glow is built / shown by update(), once the lights sit where they belong
    if (t.air) {
      t.air.mesh.visible = false;
      t.air.force = true;
    }
    this.snapNext = true;
  }

  /** Patches a target's materials ahead of time (before its shaders are compiled). */
  prepare(target) {
    if (this.level === 'off') return;
    for (const { mat, kind } of target.materials) this.patch(mat, kind);
    for (const { mat, kind } of this.extra) this.patch(mat, kind);
  }

  /** Compiles the air glow shader ahead of time ('full'), so its first use does not stall a frame. */
  precompile(renderer, camera) {
    if (this.level !== 'full' || this.airCompiled) return;
    this.airCompiled = true;
    const mesh = new THREE.InstancedMesh(airGeometry(), airMaterial(), 1);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(3), 3);
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    try {
      renderer.compile(mesh, camera, this.scene);
    } catch (e) {
      /* compiled on first use instead */
    }
    mesh.removeFromParent();
    mesh.dispose();
  }

  /** A target goes away (module disposed): forget its materials and air mesh. */
  release(target) {
    if (!target) return;
    for (const { mat } of target.materials) {
      if (!this.patched.has(mat)) continue;
      unpatch(mat); // a material kept by the module (module-level) must not be patched twice later
      this.patched.delete(mat);
    }
    target.dispose();
    if (this.target === target) this.target = null;
  }

  patch(mat, kind) {
    if (this.patched.has(mat)) return;
    this.patched.add(mat);
    if (mat.userData.atmoPatch) return; // already carries the shader (shared with another target)
    const u = this.uniforms;
    const own = Object.prototype.hasOwnProperty.call(mat, 'onBeforeCompile');
    const ownKey = Object.prototype.hasOwnProperty.call(mat, 'customProgramCacheKey');
    const prev = mat.onBeforeCompile;
    const prevKey = mat.customProgramCacheKey;
    mat.userData.atmoPatch = { own, ownKey, prev, prevKey };
    mat.onBeforeCompile = function (shader, renderer) {
      prev.call(this, shader, renderer);
      inject(shader, kind, u);
    };
    mat.customProgramCacheKey = function () {
      return `${prevKey.call(this)}|atmosphere-${kind}`;
    };
    mat.needsUpdate = true;
  }

  /** Jump to the current light state on the next update (new run, seek). */
  snap() {
    this.snapNext = true;
  }

  /** Per frame, after the lights were set (and before the light banks upload their matrices). */
  update(dt) {
    const T = this.target;
    if (this.level === 'off' || !T) return;
    const data = T.ensureData();
    const acc = this.acc;
    acc.fill(0);
    const lights = data.lights;
    for (let i = 0; i < lights.length; i++) {
      const e = lights[i];
      const L = e.light;
      let r = L.r > 0 ? L.r : 0;
      let g = L.g > 0 ? L.g : 0;
      let b = L.b > 0 ? L.b : 0;
      const m = r > g ? (r > b ? r : b) : g > b ? g : b;
      if (m <= 0.002) continue;
      const k = (m > LIGHT_CAP ? LIGHT_CAP / m : 1) * e.w;
      r *= k;
      g *= k;
      b *= k;
      acc[0] += r;
      acc[1] += g;
      acc[2] += b;
      const rw = e.rw;
      for (let q = 0; q < 4; q++) {
        const w = rw[q];
        if (w === 0) continue;
        acc[3 + q * 3] += r * w;
        acc[4 + q * 3] += g * w;
        acc[5 + q * 3] += b * w;
      }
    }
    // global = lit fraction of the whole environment; a region = its own lights' average,
    // pulled toward the global one when it has few lights (prior weight)
    const W = T.wTotal || 1;
    acc[0] /= W;
    acc[1] /= W;
    acc[2] /= W;
    const prior = 0.05 * W;
    for (let q = 0; q < 4; q++) {
      const wr = T.wRegion[q] + prior;
      for (let c = 0; c < 3; c++) acc[3 + q * 3 + c] = (acc[3 + q * 3 + c] + acc[c] * prior) / wr;
    }
    for (let q = 0; q < 5; q++) compress(acc, q * 3);
    const cur = this.cur;
    const s = this.snapNext ? 1 : 1 - Math.exp(-SMOOTH * Math.max(0, dt));
    this.snapNext = false;
    for (let i = 0; i < 15; i++) {
      const v = cur[i] + (acc[i] - cur[i]) * s;
      cur[i] = v > 1e-4 ? v : 0; // exactly dark again once the lights are off
    }

    const tn = T.tune;
    if (this.fog) {
      const k = FOG_GAIN * tn.fog;
      this.fog.color.setRGB(this.baseFog.r + cur[0] * k, this.baseFog.g + cur[1] * k, this.baseFog.b + cur[2] * k);
    }
    if (this.bg) {
      const k = BG_GAIN * tn.fog;
      this.bg.setRGB(this.baseBg.r + cur[0] * k, this.baseBg.g + cur[1] * k, this.baseBg.b + cur[2] * k);
    }
    const u = this.uniforms;
    const ks = tn.surface;
    u.atmoL.value.setRGB(cur[3] * ks, cur[4] * ks, cur[5] * ks);
    u.atmoR.value.setRGB(cur[6] * ks, cur[7] * ks, cur[8] * ks);
    u.atmoC.value.setRGB(cur[9] * ks, cur[10] * ks, cur[11] * ks);
    u.atmoF.value.setRGB(cur[12] * ks, cur[13] * ks, cur[14] * ks);
    const ky = SKY_GAIN * tn.sky;
    u.atmoSky.value.setRGB(cur[0] * ky, cur[1] * ky, cur[2] * ky);

    if (this.level === 'full' && tn.air > 0) {
      const air = T.air || T.ensureAir();
      if (!air.mesh.visible && air.parts.length) {
        air.mesh.visible = true;
        air.force = true;
      }
      if (air.mesh.visible) this.updateAir(air, tn.air);
    }
  }

  /** Air glow instances: follow their lights' matrices (when those moved) and colours. */
  updateAir(air, gain) {
    const parentInv = air.inv;
    const parent = air.mesh.parent;
    parentInv.copy(parent.matrixWorld).invert();
    // a source mesh (or the air's parent) that moved: its parts are recomputed
    const srcs = air.sources;
    for (let i = 0; i < srcs.length; i++) {
      const s = srcs[i];
      const a = s.mesh.matrixWorld.elements;
      const l = s.last;
      let moved = false;
      for (let j = 0; j < 16; j++) {
        if (l[j] !== a[j]) {
          moved = true;
          l[j] = a[j];
        }
      }
      if (moved || air.force) s.rel.multiplyMatrices(parentInv, s.mesh.matrixWorld);
      s.moved = moved || air.force;
    }
    const parts = air.parts;
    const mArr = air.mesh.instanceMatrix.array;
    const cArr = air.mesh.instanceColor.array;
    let dirtyM = false;
    let dirtyC = false;
    // many lit ribbons (they overlap, and stack up toward the vanishing point): each one fainter,
    // by the lit count and area of the previous frame
    const k = AIR_GAIN * gain * Math.min(1, Math.sqrt(AIR_CROWD / Math.max(1, air.lit)), Math.sqrt(AIR_AREA / Math.max(1, air.litArea)));
    let lit = 0;
    let litArea = 0;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      const L = p.light;
      let r = L.r > 0 ? L.r : 0;
      let g = L.g > 0 ? L.g : 0;
      let b = L.b > 0 ? L.b : 0;
      const m = r > g ? (r > b ? r : b) : g > b ? g : b;
      const kc = (m > 1 ? 1 / m : 1) * k * p.share;
      r *= kc;
      g *= kc;
      b *= kc;
      if (r !== p.cr || g !== p.cg || b !== p.cb) {
        p.cr = r;
        p.cg = g;
        p.cb = b;
        cArr[i * 3] = r;
        cArr[i * 3 + 1] = g;
        cArr[i * 3 + 2] = b;
        dirtyC = true;
      }
      // matrices: only for lit lights whose bank / mesh moved (dark ones are not drawn)
      const on = m > 0.002;
      if (on) {
        lit++;
        litArea += p.area;
      }
      const moved = p.src.moved || (p.bank ? p.bank.dirtyMatrix : p.dynamic === true) || p.stale;
      if (!moved && !air.force) continue;
      if (!on && !air.force) {
        p.stale = true; // catch up when it lights again
        continue;
      }
      p.stale = false;
      _m.copy(p.src.rel);
      if (p.index >= 0) _m.multiply(_m2.fromArray(p.mesh.instanceMatrix.array, p.index * 16));
      _m.multiply(p.fit);
      _m.toArray(mArr, i * 16);
      dirtyM = true;
    }
    air.force = false;
    air.lit = lit;
    air.litArea = litArea;
    if (dirtyM) air.mesh.instanceMatrix.needsUpdate = true;
    if (dirtyC) air.mesh.instanceColor.needsUpdate = true;
  }
}

function unpatch(mat) {
  const s = mat.userData.atmoPatch;
  if (!s) return;
  if (s.own) mat.onBeforeCompile = s.prev;
  else delete mat.onBeforeCompile;
  if (s.ownKey) mat.customProgramCacheKey = s.prevKey;
  else delete mat.customProgramCacheKey;
  delete mat.userData.atmoPatch;
  mat.needsUpdate = true;
}
