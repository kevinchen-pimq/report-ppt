// Visual styles for sabers, notes and walls, plus user-supplied glTF/GLB models.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { NOTE_SIZE, BLADE_LEN } from './constants.js';

export const SABER_STYLES = [
  ['classic', '經典'],
  ['neon', '霓虹'],
  ['katana', '武士刀'],
  ['crystal', '水晶'],
  ['custom', '自訂模型'],
];
export const NOTE_STYLES = [
  ['classic', '經典圓角'],
  ['mech', '機械方塊'],
  ['neon', '霓虹框'],
  ['outline', '外框'],
  ['custom', '自訂模型'],
];
export const WALL_STYLES = [
  ['translucent', '半透明'],
  ['edges', '只顯示邊框'],
];

// Blade geometry is shared by every style: it starts here and runs BLADE_LEN along -Z
export const BLADE_START = -0.08;
const BLADE_MID = BLADE_START - BLADE_LEN / 2;

// ---------------------------------------------------------------------------
// Edge-glow shader: bright borders of fixed world-space width on every face of
// a (possibly non-uniformly scaled) box, plus an optional translucent fill.

// The note shaders include three.js' clipping chunks (inert unless the material has
// clippingPlanes), so the cut halves can reuse them.
const EDGE_VERT = /* glsl */ `
  #include <clipping_planes_pars_vertex>
  varying vec3 vPos;
  varying vec3 vNormal;
  varying vec3 vScale;
  void main() {
    vPos = position;
    vNormal = normal;
    vScale = vec3(length(modelMatrix[0].xyz), length(modelMatrix[1].xyz), length(modelMatrix[2].xyz));
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    #include <clipping_planes_vertex>
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const EDGE_FRAG = /* glsl */ `
  uniform vec3 color;
  uniform float fill;
  uniform float edge;
  uniform float intensity;
  uniform float whiten;
  uniform vec3 size;
  varying vec3 vPos;
  varying vec3 vNormal;
  varying vec3 vScale;
  #include <clipping_planes_pars_fragment>
  void main() {
    #include <clipping_planes_fragment>
    vec3 a = abs(vNormal);
    // distance (metres) from this fragment to the nearest border of its face
    vec3 d = (size * 0.5 - abs(vPos)) * vScale;
    float m = a.x > 0.5 ? min(d.y, d.z) : (a.y > 0.5 ? min(d.x, d.z) : min(d.x, d.y));
    float e = 1.0 - smoothstep(edge * 0.5, edge, m);
    float halo = (1.0 - smoothstep(edge, edge * 3.0, m)) * 0.22;
    float alpha = clamp(max(fill, e) + halo, 0.0, 1.0);
    vec3 c = mix(color, vec3(1.0), e * whiten) * intensity;
    gl_FragColor = vec4(c, alpha);
    #include <colorspace_fragment>
  }
`;

/** size: the geometry's own dimensions (1,1,1 for a unit box). */
export function createEdgeGlowMaterial({ color = 0xffffff, fill = 0.15, edge = 0.03, intensity = 1, whiten = 0.3, size = [1, 1, 1] } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      color: { value: new THREE.Color(color) },
      fill: { value: fill },
      edge: { value: edge },
      intensity: { value: intensity },
      whiten: { value: whiten },
      size: { value: new THREE.Vector3(...size) },
    },
    vertexShader: EDGE_VERT,
    fragmentShader: EDGE_FRAG,
    clipping: true,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

// ---------------------------------------------------------------------------
// Silhouette outline ("inverted hull"): the mesh is pushed out along its normals
// and only its back faces are drawn, so just a ring around the visible shape
// remains, from any viewing angle. glow = soft band fading outward (additive).

const HULL_VERT = /* glsl */ `
  #include <clipping_planes_pars_vertex>
  uniform float thickness;
  varying float vFacing;
  void main() {
    vec3 p = position + normalize(normal) * thickness;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vec4 mvPosition = mv;
    #include <clipping_planes_vertex>
    vec3 n = normalize(normalMatrix * normal);
    // |n·v| is ~0 at the outer contour and grows toward the body: used to fade the glow outward
    vFacing = abs(dot(n, normalize(-mv.xyz)));
    gl_Position = projectionMatrix * mv;
  }
`;

const HULL_FRAG = /* glsl */ `
  uniform vec3 color;
  uniform float opacity;
  uniform float glow;
  varying float vFacing;
  #include <clipping_planes_pars_fragment>
  void main() {
    #include <clipping_planes_fragment>
    float a = glow > 0.5 ? opacity * pow(vFacing, 1.5) : opacity;
    gl_FragColor = vec4(color, a);
    #include <colorspace_fragment>
  }
`;

export function createHullMaterial({ color = 0xffffff, thickness = 0.012, opacity = 1, glow = false } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      color: { value: new THREE.Color(color) },
      thickness: { value: thickness },
      opacity: { value: opacity },
      glow: { value: glow ? 1 : 0 },
    },
    vertexShader: HULL_VERT,
    fragmentShader: HULL_FRAG,
    clipping: true,
    side: THREE.BackSide,
    transparent: glow,
    depthWrite: !glow,
    blending: glow ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
}

// ---------------------------------------------------------------------------
// Glass note body: deep, darker colour where the surface faces the viewer and a
// bright glassy band where it turns away (the rounded edges), from any angle.

const GLASS_VERT = /* glsl */ `
  varying vec3 vN;
  varying vec3 vV;
  varying vec3 vObjN;
  varying vec3 vObjP;
  #include <clipping_planes_pars_vertex>
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vec4 mvPosition = mv;
    #include <clipping_planes_vertex>
    vN = normalize(normalMatrix * normal);
    vV = normalize(-mv.xyz);
    vObjN = normal;
    vObjP = position;
    gl_Position = projectionMatrix * mv;
  }
`;

const GLASS_FRAG = /* glsl */ `
  uniform vec3 color;
  uniform float halfSize;
  varying vec3 vN;
  varying vec3 vV;
  varying vec3 vObjN;
  varying vec3 vObjP;
  #include <clipping_planes_pars_fragment>
  void main() {
    #include <clipping_planes_fragment>
    vec3 an = abs(normalize(vObjN));
    float flatness = max(an.x, max(an.y, an.z));            // 1 on flat faces, < 1 on the rounded bevels
    float bevel = 1.0 - smoothstep(0.86, 0.997, flatness);  // glassy band on every rounded edge
    float facing = clamp(dot(normalize(vN), normalize(vV)), 0.0, 1.0);
    float rim = pow(1.0 - facing, 4.0);
    // soft glow toward the middle of each face
    vec3 ap = abs(vObjP) / halfSize;
    vec2 face = an.x > 0.9 ? ap.yz : (an.y > 0.9 ? ap.xz : ap.xy);
    float centre = 1.0 - smoothstep(0.1, 0.85, length(face));
    vec3 edge = mix(color, vec3(1.0), 0.12);
    vec3 c = color * 0.26 + color * 0.24 * centre + edge * (bevel * 0.55 + rim * 0.55);
    gl_FragColor = vec4(c, 1.0);
    #include <colorspace_fragment>
  }
`;

export function createGlassMaterial(color) {
  return new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color(color) }, halfSize: { value: NOTE_SIZE / 2 } },
    vertexShader: GLASS_VERT,
    fragmentShader: GLASS_FRAG,
    clipping: true,
  });
}

/** Wall look: translucent fill with edges, or edges only. */
export function wallStyleParams(style) {
  return style === 'edges' ? { fill: 0.0, edge: 0.045, intensity: 1.5 } : { fill: 0.26, edge: 0.03, intensity: 1.1 };
}

// ---------------------------------------------------------------------------
// glTF / GLB loading

let loaderPromise = null;
async function gltfLoader() {
  if (!loaderPromise) loaderPromise = import('three/addons/loaders/GLTFLoader.js').then((m) => new m.GLTFLoader());
  return loaderPromise;
}

/** Parses a .glb / .gltf (self-contained) ArrayBuffer into a scene graph. */
export async function parseModel(buffer) {
  const loader = await gltfLoader();
  const gltf = await new Promise((resolve, reject) => loader.parse(buffer, '', resolve, (e) => reject(new Error(e?.message || '模型解析失敗'))));
  const root = gltf.scene || gltf.scenes?.[0];
  if (!root) throw new Error('模型中沒有場景');
  let meshes = 0;
  root.traverse((o) => {
    if (o.isMesh) meshes++;
  });
  if (!meshes) throw new Error('模型中沒有網格');
  return root;
}

const TINT_SABER = /blade|glow|color|colour|light|emiss|saber|beam/i;
const KEEP_NOTE = /arrow|dot|white|keep|metal|frame/i;

function cloneWithMaterials(src) {
  const copy = src.clone(true);
  copy.traverse((o) => {
    if (o.isMesh) o.material = Array.isArray(o.material) ? o.material.map((m) => m.clone()) : o.material.clone();
  });
  return copy;
}

function eachMaterial(root, fn) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) fn(m, o);
  });
}

/**
 * Fits a saber model so its longest axis becomes the blade, pointing -Z from a handle
 * near the grip (handle end = the end closest to the model's origin, or the other end when flipped).
 */
export function fitSaberModel(src, flip = false) {
  const model = cloneWithMaterials(src);
  const orient = new THREE.Group();
  orient.add(model);
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const axis = size.x >= size.y && size.x >= size.z ? 'x' : size.y >= size.z ? 'y' : 'z';
  // the end farther from the origin is the blade tip
  const tipPositive = Math.abs(box.max[axis]) >= Math.abs(box.min[axis]);
  const dir = new THREE.Vector3();
  dir[axis] = tipPositive !== flip ? 1 : -1;
  orient.quaternion.setFromUnitVectors(dir, new THREE.Vector3(0, 0, -1));
  orient.updateMatrixWorld(true);
  const b2 = new THREE.Box3().setFromObject(orient);
  const s2 = b2.getSize(new THREE.Vector3());
  const scale = (BLADE_LEN + 0.24) / Math.max(1e-6, s2.z);
  const out = new THREE.Group();
  out.add(orient);
  orient.scale.setScalar(scale);
  orient.position.set(-((b2.min.x + b2.max.x) / 2) * scale, -((b2.min.y + b2.max.y) / 2) * scale, 0.14 - b2.max.z * scale);
  const tinted = [];
  eachMaterial(model, (m, mesh) => {
    if (TINT_SABER.test(m.name || '') || TINT_SABER.test(mesh.name || '')) tinted.push(m);
  });
  return { group: out, tinted };
}

/** Centres a note model and scales it into the note's cube; returns per-colour clones. */
export function fitNoteModel(src) {
  const model = cloneWithMaterials(src);
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const scale = NOTE_SIZE / Math.max(1e-6, size.x, size.y, size.z);
  const out = new THREE.Group();
  model.position.sub(center);
  const wrap = new THREE.Group();
  wrap.add(model);
  wrap.scale.setScalar(scale);
  out.add(wrap);
  const tinted = [];
  eachMaterial(model, (m, mesh) => {
    if (!(KEEP_NOTE.test(m.name || '') || KEEP_NOTE.test(mesh.name || ''))) tinted.push(m);
  });
  return { group: out, tinted };
}

function tint(materials, color, emissive = 0.25) {
  for (const m of materials) {
    if (m.color) m.color.copy(color);
    if (m.emissive) {
      m.emissive.copy(color);
      m.emissiveIntensity = emissive;
    }
  }
}

// ---------------------------------------------------------------------------
// Sabers

function cyl(r1, r2, len, seg, mat, z, open = false) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, len, seg, 1, open), mat);
  m.rotation.x = Math.PI / 2;
  m.position.z = z;
  return m;
}

const additive = (color, opacity) =>
  new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false });

/**
 * Builds a saber's visual. Returns { group, setColor(color) }.
 * Every style keeps the blade on -Z from BLADE_START so hit detection stays identical.
 */
export function buildSaberVisual(style, color, custom = null, flip = false) {
  const g = new THREE.Group();
  const colored = []; // materials that follow the saber colour
  const c = new THREE.Color(color);
  const metal = (hex, rough = 0.35) => new THREE.MeshStandardMaterial({ color: hex, metalness: 0.75, roughness: rough });

  if (style === 'custom' && custom) {
    const { group, tinted } = fitSaberModel(custom, flip);
    g.add(group);
    const setColor = (col) => tint(tinted, col, 0.8);
    setColor(c);
    return { group: g, setColor };
  }

  if (style === 'neon') {
    g.add(cyl(0.013, 0.016, 0.18, 16, metal(0xb8bcc8, 0.15), 0.02));
    const ring = new THREE.MeshBasicMaterial({ color: c });
    colored.push(ring);
    g.add(cyl(0.02, 0.02, 0.012, 16, ring, -0.072));
    g.add(cyl(0.005, 0.005, BLADE_LEN, 8, new THREE.MeshBasicMaterial({ color: 0xffffff }), BLADE_MID));
    const g1 = additive(c, 0.75);
    const g2 = additive(c, 0.2);
    colored.push(g1, g2);
    g.add(cyl(0.014, 0.014, BLADE_LEN, 12, g1, BLADE_MID, true));
    g.add(cyl(0.038, 0.038, BLADE_LEN, 16, g2, BLADE_MID, true));
  } else if (style === 'katana') {
    g.add(cyl(0.017, 0.017, 0.24, 10, new THREE.MeshStandardMaterial({ color: 0x1a1414, roughness: 0.9 }), 0.04));
    const wrapMat = new THREE.MeshStandardMaterial({ color: c, roughness: 0.7 });
    colored.push(wrapMat);
    for (let i = 0; i < 5; i++) g.add(cyl(0.0185, 0.0185, 0.012, 10, wrapMat, 0.13 - i * 0.045));
    const guard = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.01, 24), metal(0xc9a64a, 0.3));
    guard.rotation.x = Math.PI / 2;
    guard.position.z = -0.083;
    g.add(guard);
    // blade: flat steel with a glowing coloured edge and an angled tip
    const steel = new THREE.MeshStandardMaterial({ color: 0xdfe4ea, metalness: 0.95, roughness: 0.12 });
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.032, BLADE_LEN - 0.06), steel);
    blade.position.set(0, 0.002, BLADE_START - (BLADE_LEN - 0.06) / 2);
    g.add(blade);
    const tipShape = new THREE.Shape();
    tipShape.moveTo(-0.014, 0);
    tipShape.lineTo(0.018, 0);
    tipShape.lineTo(0.018, -0.06);
    tipShape.closePath();
    const tipGeo = new THREE.ExtrudeGeometry(tipShape, { depth: 0.006, bevelEnabled: false });
    tipGeo.translate(0, 0, -0.003);
    const tip = new THREE.Mesh(tipGeo, steel);
    tip.rotation.set(Math.PI / 2, Math.PI / 2, 0);
    tip.position.set(0, 0.002, BLADE_START - BLADE_LEN + 0.06);
    g.add(tip);
    const edgeMat = new THREE.MeshBasicMaterial({ color: c });
    colored.push(edgeMat);
    const edge = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.005, BLADE_LEN - 0.04), edgeMat);
    edge.position.set(0, -0.016, BLADE_START - (BLADE_LEN - 0.04) / 2);
    g.add(edge);
    const haze = additive(c, 0.18);
    colored.push(haze);
    const glow = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.05, BLADE_LEN), haze);
    glow.position.z = BLADE_MID;
    g.add(glow);
  } else if (style === 'crystal') {
    g.add(cyl(0.02, 0.016, 0.2, 6, metal(0x3a3550, 0.4), 0.02));
    const prongMat = new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.6, metalness: 0.4, roughness: 0.3 });
    colored.push(prongMat);
    g.add(cyl(0.028, 0.012, 0.05, 6, prongMat, -0.06));
    const crystal = new THREE.MeshPhysicalMaterial({
      color: c, emissive: c, emissiveIntensity: 0.55, transparent: true, opacity: 0.55, roughness: 0.05, metalness: 0.1, flatShading: true, depthWrite: false,
    });
    colored.push(crystal);
    const geo = new THREE.OctahedronGeometry(0.5, 0);
    geo.scale(0.05, 0.05, BLADE_LEN);
    const body = new THREE.Mesh(geo, crystal);
    body.position.z = BLADE_MID;
    body.rotation.z = Math.PI / 4;
    g.add(body);
    g.add(cyl(0.004, 0.004, BLADE_LEN * 0.95, 6, new THREE.MeshBasicMaterial({ color: 0xffffff }), BLADE_MID));
    const halo = additive(c, 0.15);
    colored.push(halo);
    g.add(cyl(0.035, 0.035, BLADE_LEN, 12, halo, BLADE_MID, true));
  } else {
    // classic
    g.add(cyl(0.018, 0.022, 0.2, 12, metal(0x222228), 0.02));
    const ring = new THREE.MeshBasicMaterial({ color: c });
    colored.push(ring);
    g.add(cyl(0.024, 0.024, 0.02, 12, ring, -0.08));
    g.add(cyl(0.008, 0.008, BLADE_LEN, 8, new THREE.MeshBasicMaterial({ color: 0xffffff }), BLADE_MID));
    const glow = additive(c, 0.55);
    colored.push(glow);
    g.add(cyl(0.022, 0.022, BLADE_LEN, 10, glow, BLADE_MID, true));
  }
  const setColor = (col) => {
    for (const m of colored) {
      m.color.copy(col);
      if (m.emissive) m.emissive.copy(col);
    }
  };
  return { group: g, setColor };
}

// ---------------------------------------------------------------------------
// Rounded-box edge frame: tubes along the 12 rounded edges (on the 45° line of each
// edge's curve), joined over every corner by arcs on the corner sphere.

const _WHITE = new THREE.Color(0xffffff);

class SphereArc extends THREE.Curve {
  constructor(center, from, to, radius) {
    super();
    this.center = center;
    this.from = from;
    this.to = to;
    this.radius = radius;
  }

  getPoint(t, target = new THREE.Vector3()) {
    return target.lerpVectors(this.from, this.to, t).normalize().multiplyScalar(this.radius).add(this.center);
  }
}

export function edgeFrameGeometry(sx, sy, sz, r, thickness) {
  const half = [sx / 2, sy / 2, sz / 2];
  const parts = [];
  const corners = new Map();
  const vec = (arr) => new THREE.Vector3(arr[0], arr[1], arr[2]);
  for (let a = 0; a < 3; a++) {
    const b = (a + 1) % 3;
    const c = (a + 2) % 3;
    for (const sb of [-1, 1]) {
      for (const sc of [-1, 1]) {
        const ends = [-1, 1].map((sa) => {
          const center = [0, 0, 0];
          center[a] = sa * (half[a] - r);
          center[b] = sb * (half[b] - r);
          center[c] = sc * (half[c] - r);
          const u = [0, 0, 0];
          u[b] = sb * Math.SQRT1_2;
          u[c] = sc * Math.SQRT1_2;
          const d = [0, 0, 0];
          d[a] = sa;
          d[b] = sb;
          d[c] = sc;
          const dv = vec(d).normalize();
          const cv = vec(center);
          corners.set(d.join(','), cv.clone().addScaledVector(dv, r));
          return { center: cv, u: vec(u), d: dv };
        });
        const [lo, hi] = ends;
        const path = new THREE.CurvePath();
        path.add(new SphereArc(lo.center, lo.d, lo.u, r));
        path.add(new THREE.LineCurve3(lo.center.clone().addScaledVector(lo.u, r), hi.center.clone().addScaledVector(hi.u, r)));
        path.add(new SphereArc(hi.center, hi.u, hi.d, r));
        const tube = new THREE.TubeGeometry(path, 24, thickness, 8, false);
        parts.push(tube);
      }
    }
  }
  for (const p of corners.values()) {
    const sph = new THREE.SphereGeometry(thickness, 10, 8);
    sph.translate(p.x, p.y, p.z);
    parts.push(sph);
  }
  const merged = mergeGeometries(parts, false);
  for (const g of parts) g.dispose();
  return merged;
}

// ---------------------------------------------------------------------------
// Notes

/**
 * Builds note / chain-link bodies for one style. Keeps per-colour materials so
 * colours can change without rebuilding. Each build returns { group, body } where
 * body is a mesh whose geometry is used for the sliced debris.
 */
export class NoteStyle {
  constructor(id, custom = null) {
    this.id = id === 'custom' && !custom ? 'classic' : id;
    this.custom = custom;
    this.colors = [new THREE.Color(0xc81e1e), new THREE.Color(0x2a8fe0)];
    this.colorMats = [[], []]; // [{ mat, kind }] per colour
    this.disposables = [];
    const S = NOTE_SIZE;
    if (this.id === 'mech') {
      this.bodyGeo = new RoundedBoxGeometry(S, S, S, 2, 0.015);
      this.linkGeo = new RoundedBoxGeometry(S, S * 0.28, S, 1, 0.012);
    } else if (this.id === 'outline') {
      this.bodyGeo = new RoundedBoxGeometry(S, S, S, 4, 0.07);
      this.linkGeo = new RoundedBoxGeometry(S, S * 0.28, S, 3, 0.04);
    } else if (this.id === 'neon') {
      this.bodyGeo = new THREE.BoxGeometry(S * 0.96, S * 0.96, S * 0.96);
      this.frameGeo = new THREE.BoxGeometry(S, S, S);
      this.linkGeo = new THREE.BoxGeometry(S * 0.96, S * 0.26, S * 0.96);
      this.linkFrameGeo = new THREE.BoxGeometry(S, S * 0.28, S);
    } else {
      // classic: 7 cm rounded corners, bright rim and a soft halo
      this.bodyGeo = new RoundedBoxGeometry(S, S, S, 4, 0.07);
      this.linkGeo = new RoundedBoxGeometry(S, S * 0.28, S, 3, 0.04);
    }
    this.disposables.push(this.bodyGeo, this.linkGeo, this.frameGeo, this.linkFrameGeo);
    this.mats = [0, 1].map((c) => this.makeBodyMaterial(c));
    if (this.id === 'neon') {
      this.frameMats = [0, 1].map((c) => this.track(c, createEdgeGlowMaterial({ color: this.colors[c], fill: 0.05, edge: 0.03, intensity: 1.6, size: [S, S, S] }), 'uniform'));
      this.linkFrameMats = [0, 1].map((c) => this.track(c, createEdgeGlowMaterial({ color: this.colors[c], fill: 0.05, edge: 0.02, intensity: 1.6, size: [S, S * 0.28, S] }), 'uniform'));
    }
    // Outline: black body, thick glowing outline, symbols drawn in the note colour
    this.coloredSymbols = this.id === 'outline';
    if (this.id === 'outline') {
      // silhouette outline (inverted hull): only the outer contour is drawn, from any angle
      this.hullMats = [0, 1].map((c) => this.track(c, createHullMaterial({ color: this.colors[c], thickness: 0.014 }), 'uniform'));
      this.hullGlowMats = [0, 1].map((c) => this.track(c, createHullMaterial({ color: this.colors[c], thickness: 0.04, glow: true, opacity: 0.55 }), 'uniform'));
      this.linkHullMats = [0, 1].map((c) => this.track(c, createHullMaterial({ color: this.colors[c], thickness: 0.01 }), 'uniform'));
      this.haloMats = [0, 1].map((c) => this.track(c, new THREE.SpriteMaterial({
        map: glowTexture(), color: this.colors[c], transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
      }), 'sprite'));
    }
    if (this.id === 'classic') {
      // glass body (shader) + soft silhouette glow, like the reference: dark core, bright glassy edges
      this.hullGlowMats = [0, 1].map((c) => this.track(c, createHullMaterial({ color: this.colors[c], thickness: 0.035, glow: true, opacity: 0.45 }), 'uniform'));
      this.haloMats = [0, 1].map((c) => this.track(c, new THREE.SpriteMaterial({
        map: glowTexture(), color: this.colors[c], transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
      }), 'sprite'));
    }
    if (this.id === 'custom') this.customByColor = [0, 1].map((c) => fitNoteModel(custom));
  }

  track(c, mat, kind = 'standard') {
    this.colorMats[c].push({ mat, kind });
    this.disposables.push(mat);
    return mat;
  }

  makeBodyMaterial(c) {
    const col = this.colors[c];
    if (this.id === 'mech') {
      return this.track(c, new THREE.MeshStandardMaterial({ color: col, metalness: 0.65, roughness: 0.28, emissive: col, emissiveIntensity: 0.12 }));
    }
    if (this.id === 'outline') {
      const m = new THREE.MeshStandardMaterial({ color: 0x050508, metalness: 0.0, roughness: 0.95, emissive: col, emissiveIntensity: 0.03 });
      this.disposables.push(m);
      this.colorMats[c].push({ mat: m, kind: 'emissiveOnly' });
      return m;
    }
    if (this.id === 'neon') {
      const m = new THREE.MeshStandardMaterial({ color: 0x0c0c14, metalness: 0.3, roughness: 0.4, emissive: col, emissiveIntensity: 0.08 });
      this.disposables.push(m);
      this.colorMats[c].push({ mat: m, kind: 'emissiveOnly' });
      return m;
    }
    if (this.id === 'classic') return this.track(c, createGlassMaterial(col), 'uniform');
    return this.track(c, new THREE.MeshStandardMaterial({ color: col, roughness: 0.35, metalness: 0.15, emissive: col, emissiveIntensity: 0.18 }));
  }

  setColors(left, right) {
    this.colors[0].set(left);
    this.colors[1].set(right);
    for (let c = 0; c < 2; c++) {
      const col = this.colors[c];
      for (const { mat, kind } of this.colorMats[c]) {
        if (kind === 'uniform') mat.uniforms.color.value.copy(col);
        else if (kind === 'sprite' || kind === 'basic') mat.color.copy(col);
        else if (kind === 'light') mat.color.copy(col).lerp(_WHITE, 0.45);
        else if (kind === 'dimmed') {
          mat.color.copy(col).multiplyScalar(0.72);
          mat.emissive.copy(col);
        }
        else if (kind === 'emissiveOnly') mat.emissive.copy(col);
        else {
          mat.color.copy(col);
          if (mat.emissive) mat.emissive.copy(col);
        }
      }
      if (this.customByColor) tint(this.customByColor[c].tinted, col, 0.15);
    }
  }

  buildNote(c) {
    const group = new THREE.Group();
    if (this.id === 'custom') {
      const model = this.customByColor[c].group.clone(true); // shares the per-colour materials
      group.add(model);
      // invisible box used for the sliced debris
      const body = new THREE.Mesh(this.bodyGeo, this.mats[c]);
      body.visible = false;
      group.add(body);
      return { group, body };
    }
    const body = new THREE.Mesh(this.bodyGeo, this.mats[c]);
    group.add(body);
    if (this.id === 'neon') group.add(new THREE.Mesh(this.frameGeo, this.frameMats[c]));
    if (this.id === 'outline') {
      const hull = new THREE.Mesh(this.bodyGeo, this.hullMats[c]);
      const glow = new THREE.Mesh(this.bodyGeo, this.hullGlowMats[c]);
      glow.renderOrder = 1;
      const halo = new THREE.Sprite(this.haloMats[c]);
      halo.scale.setScalar(NOTE_SIZE * 1.9);
      halo.renderOrder = -1;
      halo.position.z = -NOTE_SIZE * 0.7; // behind the block, so it never washes over the body
      group.add(hull, glow, halo);
    }
    if (this.id === 'classic') {
      const glow = new THREE.Mesh(this.bodyGeo, this.hullGlowMats[c]);
      glow.renderOrder = 1;
      const halo = new THREE.Sprite(this.haloMats[c]);
      halo.scale.setScalar(NOTE_SIZE * 1.8);
      halo.renderOrder = -1;
      halo.position.z = -NOTE_SIZE * 0.7; // behind the block, so it never washes over the body
      group.add(glow, halo);
    }
    return { group, body };
  }

  /**
   * How a cut half of a note / link of colour c is drawn: the style's own layers, all on
   * the body geometry. double = draw back faces too, so the open cut doesn't look hollow.
   */
  debrisLayers(c, link = false) {
    const L = [{ mat: this.mats[c], double: true }];
    if (this.id === 'neon') L.push({ mat: link ? this.linkFrameMats[c] : this.frameMats[c] });
    if (this.id === 'outline') {
      L.push({ mat: link ? this.linkHullMats[c] : this.hullMats[c] });
      if (!link) L.push({ mat: this.hullGlowMats[c], renderOrder: 1 });
    }
    if (this.id === 'classic' && !link) L.push({ mat: this.hullGlowMats[c], renderOrder: 1 });
    return L;
  }

  buildLink(c) {
    const group = new THREE.Group();
    const body = new THREE.Mesh(this.linkGeo, this.mats[c]);
    group.add(body);
    if (this.id === 'neon') group.add(new THREE.Mesh(this.linkFrameGeo, this.linkFrameMats[c]));
    if (this.id === 'outline') {
      group.add(new THREE.Mesh(this.linkGeo, this.linkHullMats[c]));
    }
    return { group, body };
  }

  dispose() {
    for (const d of this.disposables) d?.dispose?.();
  }
}

// ---------------------------------------------------------------------------
// Canvas textures: note halo, glowing arrow and dot

function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

let _glow = null;
/** Soft rounded-square glow, white (tinted by the material colour). */
export function glowTexture() {
  if (!_glow) {
    _glow = canvasTexture(128, 128, (ctx, w, h) => {
      const g = ctx.createRadialGradient(w / 2, h / 2, w * 0.18, w / 2, h / 2, w * 0.5);
      g.addColorStop(0, 'rgba(255,255,255,0.9)');
      g.addColorStop(0.45, 'rgba(255,255,255,0.35)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    });
  }
  return _glow;
}

// Arrow plane layout (fractions of the note size): a wide flat triangle whose base
// sits near the edge and whose tip points toward the centre (= the cut direction, local -Y).
// (kept inside the flat part of the face: 7 cm corner radius = 0.155 of the note size)
export const ARROW_PLANE = { w: 0.8, h: 0.4, centerY: 0.245 };

let _arrow = null;
export function arrowTexture() {
  if (!_arrow) {
    _arrow = canvasTexture(256, 128, (ctx, w, h) => {
      // base near the top of the canvas (= outer edge), tip toward the bottom (= centre / -Y)
      // V-shaped chevron: flat outer edge, short sides, point toward the centre
      const draw = () => {
        ctx.beginPath();
        ctx.moveTo(w * 0.1, h * 0.25);
        ctx.lineTo(w * 0.9, h * 0.25);
        ctx.lineTo(w * 0.9, h * 0.37);
        ctx.lineTo(w * 0.5, h * 0.68);
        ctx.lineTo(w * 0.1, h * 0.37);
        ctx.closePath();
        ctx.fill();
      };
      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = 'rgba(255,255,255,0.95)';
      ctx.shadowBlur = 22;
      draw();
      ctx.shadowBlur = 8;
      draw();
    });
  }
  return _arrow;
}

let _dot = null;
export function dotTexture() {
  if (!_dot) {
    _dot = canvasTexture(128, 128, (ctx, w, h) => {
      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = 'rgba(255,255,255,0.95)';
      ctx.shadowBlur = 18;
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, w * 0.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 6;
      ctx.fill();
    });
  }
  return _dot;
}

// ---------------------------------------------------------------------------
// Persistent storage of uploaded models (IndexedDB: survives reloads)

const DB_NAME = 'webxr-saber';
const STORE = 'models';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(req?.result);
    t.onerror = () => reject(t.error);
  });
}

export const modelStore = {
  async get(kind) {
    try {
      return (await tx('readonly', (s) => s.get(kind))) || null;
    } catch (e) {
      return null;
    }
  },
  put(kind, name, data) {
    return tx('readwrite', (s) => s.put({ name, data }, kind));
  },
  remove(kind) {
    return tx('readwrite', (s) => s.delete(kind));
  },
};
