// Dev-only preview of an environment module (js/game/envs/<name>.js) with a simple
// v2 lighting driver. Not deployed. Query: ?env=<Name>&pattern=<p>&cam=<c>&t=<seconds>
//   pattern: all | groups | chase | rings | lasers | cycle (default cycle) | none (every light off)
//   cam: player | orbit | side | top (default player), or pos=x,y,z&look=x,y,z; t: freeze the clock
//   atmo: off | fog | full (default full) — the lit atmosphere (js/game/Atmosphere.js)
import * as THREE from 'three';
import { Atmosphere, AtmosphereTarget, analyseLights, sceneryMaterialsOf } from '../js/game/Atmosphere.js';

const q = new URLSearchParams(location.search);
const ENV = q.get('env') || 'DefaultEnvironment';
const PATTERN = q.get('pattern') || 'cycle';
const CAM = q.get('cam') || 'player';
const FIXED_T = q.has('t') ? Number(q.get('t')) : null;
const ATMO = q.get('atmo') || 'full';
const hud = document.getElementById('hud');

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x04040a);
scene.fog = new THREE.Fog(0x04040a, 25, 140);
scene.add(new THREE.HemisphereLight(0x8899ff, 0x221122, 1.4));
const dir = new THREE.DirectionalLight(0xffffff, 1.6);
dir.position.set(0, 4, 3);
scene.add(dir);
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.05, 400);
const cams = {
  player: [[0, 1.7, 0.4], [0, 1.6, -20]],
  orbit: [[14, 9, 14], [0, 3, -15]],
  side: [[22, 4, -14], [0, 4, -16]],
  top: [[0, 60, -18], [0, 0, -19]],
};
// custom camera: &pos=x,y,z&look=x,y,z
if (q.has('pos')) cams.custom = [q.get('pos').split(',').map(Number), (q.get('look') || '0,1.5,-20').split(',').map(Number)];
const [cp, ct] = cams[q.has('pos') ? 'custom' : CAM] || cams.player;
camera.position.set(...cp);
camera.lookAt(...ct);
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// Stand-in for what the game draws itself: player platform + runway + lanes
const standIn = [];
{
  const m = new THREE.MeshStandardMaterial({ color: 0x0a0b16, roughness: 0.4, metalness: 0.5 });
  const plat = new THREE.Mesh(new THREE.BoxGeometry(2, 0.1, 2), m);
  plat.position.set(0, -0.05, 0);
  const run = new THREE.Mesh(new THREE.BoxGeometry(2, 0.05, 40), m);
  run.position.set(0, -0.03, -21);
  scene.add(plat, run);
  standIn.push(m);
  const lane = new THREE.LineBasicMaterial({ color: 0x334488 });
  for (const x of [-1, 1]) {
    const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x, 0.01, 1), new THREE.Vector3(x, 0.01, -41)]);
    scene.add(new THREE.Line(g, lane));
  }
}

const RED = [0.8, 0.12, 0.1];
const BLUE = [0.15, 0.5, 1.0];
const WHITE = [1, 1, 1];

let env = null;
let mod = null;
try {
  mod = (await import(`../js/game/envs/${ENV}.js`)).default;
  env = mod.build();
  scene.add(env.root);
} catch (e) {
  hud.textContent = `failed to load ${ENV}: ${e.message}`;
  console.error(e);
  throw e;
}
// the module's own background / fog, as in the game
const bg = env.background ?? mod.background;
if (bg != null) scene.background = new THREE.Color(bg);
const fog = env.fog ?? mod.fog;
if (fog) scene.fog = new THREE.Fog(fog.color ?? 0x04040a, fog.near ?? 25, fog.far ?? 110);
const groups = env.groups || {};
const types = Object.keys(groups).map(Number).sort((a, b) => a - b);
const rings = env.rings || [];
const lasers = env.lasers || { left: [], right: [] };
// deterministic phases (same picture on every load, for before / after screenshot diffs)
[...lasers.left, ...lasers.right].forEach((o, i) => (o.userData.phase = (i * 2.399) % (Math.PI * 2)));

// v3 light groups (see CONTRACT.md): rest rotations / positions recorded once
const lightGroups = env.lightGroups || {};
const lgIds = Object.keys(lightGroups).map(Number).sort((a, b) => a - b);
for (const id of lgIds) {
  const g = lightGroups[id];
  for (const kind of ['rotation', 'translation']) {
    for (const ax of ['x', 'y', 'z']) for (const o of g[kind]?.[ax] || []) {
      o.userData.rest ??= {};
      o.userData.rest[kind + ax] = kind === 'rotation' ? o.rotation[ax] : o.position[ax];
    }
  }
}

// lit atmosphere, as the game sets it up (Environment.prepare / showModule)
const atmo = new Atmosphere(scene);
{
  const tune = env.atmosphere ?? mod.atmosphere;
  const all = [...types.flatMap((ty) => groups[ty]), ...lgIds.flatMap((id) => lightGroups[id].lights)];
  atmo.setExtraMaterials(standIn.map((mat) => ({ mat, kind: 'surface' })));
  if (tune !== false) {
    atmo.setTarget(new AtmosphereTarget({ root: env.root, materials: sceneryMaterialsOf(env.root), analyse: () => analyseLights(all, env.root), tune: tune || null }));
  }
  atmo.setLevel(ATMO);
  // for test scripts
  window.__atmo = atmo;
}

function setAll(type, rgb, k = 1) {
  for (const l of groups[type] || []) l.set(rgb[0] * k, rgb[1] * k, rgb[2] * k);
}

function drive(t) {
  const cyc = lgIds.length ? ['all', 'vgroups', 'vchase', 'vrotate', 'vtranslate'] : ['all', 'groups', 'chase', 'rings', 'lasers'];
  const pat = PATTERN === 'cycle' ? cyc[Math.floor(t / 4) % cyc.length] : PATTERN;
  for (const ty of types) setAll(ty, [0, 0, 0]);
  for (const id of lgIds) for (const l of lightGroups[id].lights) l.set(0, 0, 0);
  if (pat === 'all') {
    for (const ty of types) setAll(ty, ty % 2 ? BLUE : RED);
    lgIds.forEach((id, gi) => { const c = gi % 2 ? BLUE : RED; for (const l of lightGroups[id].lights) l.set(...c); });
  }
  if (pat === 'vgroups' && lgIds.length) {
    const id = lgIds[Math.floor(t * 1.5) % lgIds.length];
    const f = 1 - ((t * 1.5) % 1) * 0.7;
    for (const l of lightGroups[id].lights) l.set(f, f, f);
  }
  if (pat === 'vchase' || pat === 'vrotate' || pat === 'vtranslate') {
    lgIds.forEach((id, gi) => {
      const L = lightGroups[id].lights;
      const head = (t * 10) % (L.length + 3);
      const c = gi % 2 ? BLUE : RED;
      L.forEach((l, i) => {
        const d = head - i;
        const k = pat === 'vchase' ? (d >= 0 && d < 3 ? 1 - d / 3 : 0.05) : 1;
        l.set(c[0] * k, c[1] * k, c[2] * k);
      });
    });
  }
  for (const id of lgIds) {
    const g = lightGroups[id];
    for (const kind of ['rotation', 'translation']) {
      const spec = g[kind];
      if (!spec) continue;
      for (const ax of ['x', 'y', 'z']) {
        (spec[ax] || []).forEach((o, i) => {
          const rest = o.userData.rest[kind + ax];
          const mir = spec.mirror?.[ax] ? -1 : 1;
          if (kind === 'rotation') {
            const a = pat === 'vrotate' ? Math.sin(t * 1.2 + i * 0.35) * 45 : 0;
            o.rotation[ax] = rest + THREE.MathUtils.degToRad(a * mir);
          } else {
            const d = pat === 'vtranslate' ? Math.sin(t * 1.2 + i * 0.35) * (spec.scale || 1) : 0;
            o.position[ax] = rest + d * mir;
          }
        });
      }
    }
  }
  if (pat === 'groups') {
    // one group at a time, flashing, so every group can be identified
    const ty = types[Math.floor(t * 1.5) % Math.max(1, types.length)];
    const f = 1 - ((t * 1.5) % 1) * 0.7;
    setAll(ty, [1, 1, 1], f);
  }
  if (pat === 'chase' || pat === 'rings' || pat === 'lasers') {
    // light-ID chase in every group: a short bright run moving through the ids
    for (const ty of types) {
      const L = groups[ty];
      const n = L.length;
      const head = (t * 12) % (n + 4);
      L.forEach((l, i) => {
        const d = head - i;
        const k = d >= 0 && d < 4 ? 1 - d / 4 : 0.05;
        const c = ty % 2 ? BLUE : RED;
        l.set(c[0] * k, c[1] * k, c[2] * k);
      });
    }
  }
  // rings: spin with per-ring lag, zoom every 2 s
  for (const r of rings) {
    const spin = pat === 'rings' || pat === 'cycle' ? t * 0.6 : 0;
    const zoomed = Math.floor(t / 2) % 2 === 1 && pat === 'rings';
    const z = r.zoom ? (zoomed ? r.zoom.near : r.zoom.far) : null;
    r.objects.forEach((o, i) => {
      o.rotation.z = spin * (1 + i * 0.04) + THREE.MathUtils.degToRad(r.step || 0) * i * (pat === 'rings' ? 1 : 0);
      if (z !== null) {
        o.userData.z0 ??= o.position.z;
        o.userData.base ??= r.objects[0].position.z;
        o.position.z = r.objects[0].userData.z0 - i * z;
      }
    });
  }
  // lasers: speed 3 when the pattern is 'lasers' (or cycle), else still
  const sp = pat === 'lasers' ? 3 : 0.5;
  for (const [side, list] of [[-1, lasers.left], [1, lasers.right]]) {
    for (const o of list) {
      const ax = o.userData.axis || 'z';
      o.rotation[ax] = o.userData.phase + side * t * sp * 0.6;
    }
  }
  return pat;
}

let frames = 0;
const t0 = performance.now();
function frame() {
  const t = FIXED_T ?? (performance.now() - t0) / 1000;
  const pat = drive(t);
  env.update?.(t, 1 / 60);
  atmo.update(1 / 60);
  for (const b of env.banks || []) b.update();
  renderer.render(scene, camera);
  frames++;
  if (frames % 10 === 1) {
    const info = renderer.info.render;
    hud.textContent = `${mod.label || ENV}  pattern ${pat}  t ${t.toFixed(1)}\n` +
      `draw calls ${info.calls}  triangles ${info.triangles}\n` +
      `groups ${types.map((ty) => `${ty}:${groups[ty].length}`).join('  ')}  rings ${rings.map((r) => `${r.type}×${r.objects.length}`).join(' ')}  lasers L${lasers.left.length} R${lasers.right.length}` +
      (lgIds.length ? `\nlight groups ${lgIds.map((id) => `${id}:${lightGroups[id].count ?? lightGroups[id].lights.length}`).join('  ')}` : '');
    window.__stats = { calls: info.calls, triangles: info.triangles, groups: Object.fromEntries(types.map((ty) => [ty, groups[ty].length])), lightGroups: Object.fromEntries(lgIds.map((id) => [id, lightGroups[id].count ?? lightGroups[id].lights.length])), rings: rings.map((r) => [r.type, r.objects.length]), lasers: [lasers.left.length, lasers.right.length], pattern: pat };
  }
  if (FIXED_T !== null && frames > 3) window.__ready = true;
  requestAnimationFrame(frame);
}
frame();
