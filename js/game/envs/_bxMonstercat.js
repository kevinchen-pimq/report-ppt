// Shared builder for MonstercatEnvironment and CrabRaveEnvironment (same layout, different colours).
// A recreation with simple shapes, made for this project.
//
// Look: a track over a dark void; two pairs of huge dark slabs leaning outward like a "V" on each
// side, the front pair carrying a neon mascot emblem; tall dark towers right beside the player with
// vertical light bars; long rows of thin pillars far out on both sides; a tunnel of 20 dark
// diamond-shaped ring frames ahead; seven long top lasers; five parallel rotating lasers per side
// that cross over the track; bottom lasers fanning down under the track; track wires and a chevron.
//
// Light groups (v2 event type -> lights, in light-ID order):
//   0 bottom lasers (8):  pairs left/right from near to far (1 L, 2 R, ... 7 L, 8 R), under the track
//   1 top lasers    (7):  left -> right
//   2 left lasers   (5):  outermost -> innermost
//   3 right lasers  (5):  innermost -> outermost
//   4 center        (14): 1 left emblem, 2 right emblem, 3 / 5 left tower bars, 4 / 6 right tower bars,
//                         7 / 8 left / right far tower bar (approximate: not in our source mapping),
//                         9 left outer wire, 10 left track wire, 11 right track wire, 12 right outer wire,
//                         13 chevron right stroke, 14 chevron left stroke
// Rings: 20 small ring frames, event 8 spins them (no zoom in this environment).
// Lasers: 12 / 13 spin the side lasers around the vertical axis.
// ID order / counts source: community light-ID mapping as used by ArcViewer's Monstercat recreation
// (facts only) plus the BSMG wiki environment notes; sizes / positions approximate.
import { THREE, GEO, trs, mergeStatic, sceneryMaterials, LightBank, lightMaterial } from './kit.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GlowBank, SceneryBank, Rig, MultiLight, rigScenery, rotatingLaser, rng, boxAt, V } from './_bxKit.js';

const RINGS = 20;

/** Neon mascot emblem (our own simple line drawing): cat head with ears, visor, body and feet. */
function emblemGeometry(width) {
  const lines = [];
  const loop = (pts) => { for (let i = 0; i < pts.length; i++) lines.push([pts[i], pts[(i + 1) % pts.length]]); };
  loop([[-0.4, -0.08], [-0.44, 0.24], [-0.38, 0.5], [-0.33, 0.74], [-0.17, 0.53], [0.17, 0.53], [0.33, 0.74], [0.38, 0.5],
    [0.44, 0.24], [0.4, -0.08], [0.24, -0.27], [-0.24, -0.27]]);
  loop([[-0.27, 0.06], [0.27, 0.06], [0.27, 0.22], [-0.27, 0.22]]);
  for (const s of [-1, 1]) {
    lines.push([[s * 0.15, -0.27], [s * 0.19, -0.6]]);
    lines.push([[s * 0.19, -0.6], [s * 0.36, -0.62]]);
    lines.push([[s * 0.24, -0.25], [s * 0.42, -0.44]]);
  }
  const parts = lines.map(([a, b]) => {
    const g = new THREE.BoxGeometry(1, 1, 1);
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const m = trs([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 0], [0, 0, Math.atan2(b[1] - a[1], b[0] - a[0])], [len + width, width, width]);
    return g.applyMatrix4(m);
  });
  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  return merged;
}

export function buildMonstercat() {
  const root = new THREE.Group();
  const mats = sceneryMaterials();
  const owned = [];
  const rig = new Rig();
  const groups = { 0: [], 1: [], 2: [], 3: [], 4: [] };
  const dark = [];
  const metal = [];

  // ---------- static scenery ----------
  // wider track body beside the runway + front piece with emitter blocks
  for (const s of [-1, 1]) {
    dark.push(boxAt(mats.dark, [s * 2.1, -0.12, -153], [1.9, 0.14, 300]));
    metal.push(boxAt(mats.metal, [s * 3.5, -0.05, -6.6], [1.1, 0.5, 1.3]));
  }
  metal.push(boxAt(mats.metal, [0, -0.35, -6.6], [8, 0.25, 0.5]));
  // leaning slabs ("V"): front pair at the emblems, middle and back pairs further down the track
  const slabMat = new THREE.MeshStandardMaterial({ color: 0x141a33, roughness: 0.85, metalness: 0.15 });
  owned.push(slabMat);
  const slabs = [];
  const lean = (25 * Math.PI) / 180;
  for (const [z, y0, x0] of [[-18, 6, 17.25], [-40, 4, 19], [-62, 10.5, 19]]) {
    for (const s of [-1, 1]) {
      // slab centre line passes through (x0, y0), leaning outward
      const cy = 6;
      const cx = x0 + (cy - y0) * Math.tan(lean);
      slabs.push(boxAt(slabMat, [s * cx, cy, z - 1.6], [9, 78, 3], [0, 0, -s * lean]));
    }
  }
  // tall towers right beside the player
  for (const s of [-1, 1]) {
    dark.push(boxAt(mats.dark, [s * 39, -5, -2], [10, 80, 4]));
    dark.push(boxAt(mats.dark, [s * 39, -1, -10], [10, 80, 4]));
    dark.push(boxAt(mats.dark, [s * 39.5, 35, -10], [5.5, 4, 40]));
    dark.push(boxAt(mats.dark, [s * 39, 59, -10], [1, 40, 1]));
    dark.push(boxAt(mats.dark, [s * 44, 37.8, -20], [20, 3.5, 6]));
    dark.push(boxAt(mats.dark, [s * 39.5, 26.4, -20], [1, 15, 4]));
  }
  // rows of thin pillars far out on both sides (static heights)
  {
    const r = rng(1989);
    for (const s of [-1, 1]) {
      for (let i = 0; i < 64; i++) {
        const z = 20 - i * 3.4;
        const top = -1 + Math.pow(r(), 0.8) * 13;
        dark.push(boxAt(mats.dark, [s * 25, top - 40, z], [0.75, 80, 0.75]));
      }
    }
  }
  const darkMesh = mergeStatic(dark, mats.dark);
  const metalMesh = mergeStatic(metal, mats.metal);
  const slabMesh = mergeStatic(slabs, slabMat);
  root.add(darkMesh, metalMesh, slabMesh);
  owned.push(darkMesh.geometry, metalMesh.geometry, slabMesh.geometry);

  // ---------- ring frames (diamonds) ----------
  const ringMat = new THREE.MeshStandardMaterial({ color: 0x2c3046, roughness: 0.4, metalness: 0.35 });
  owned.push(ringMat);
  const ringBodies = new SceneryBank(root, GEO.box, RINGS * 4 + 8, ringMat);
  const ringObjs = [];
  const R = 8.6; // half-diagonal
  for (let i = 0; i < RINGS; i++) {
    const o = new THREE.Object3D();
    o.position.set(0, 2.6, -21 - i * 8);
    root.add(o);
    ringObjs.push(o);
    const p = rig.pivot(o);
    for (let e = 0; e < 4; e++) {
      const ang = Math.PI / 4 + (e * Math.PI) / 2;
      const d = R / Math.SQRT2; // centre -> edge midpoint
      rigScenery(rig, p, ringBodies, trs([Math.cos(ang) * d, Math.sin(ang) * d, 0], [0, 0, ang + Math.PI / 2], [R * Math.SQRT2 + 0.5, 0.5, 0.5]));
    }
  }

  // ---------- lights ----------
  const tubes = new GlowBank(root, GEO.tube, 64);
  const tilt = (55 * Math.PI) / 180;

  // 0: bottom lasers fanning down and outward from under the track
  const down = (22.5 * Math.PI) / 180;
  for (const z of [-27.5, -42.5, -57.5, -72.5]) {
    for (const s of [-1, 1]) {
      const a = V(s * 1.5, -1.2, z);
      groups[0].push(tubes.tube(a, a.clone().add(V(s * Math.sin(down) * 220, -Math.cos(down) * 220, 0)), 0.1, 4));
    }
  }
  // 1: top lasers
  for (let i = 0; i < 7; i++) {
    const x = -10.5 + i * 3.5;
    groups[1].push(tubes.tube(V(x, 10, 50), V(x, 10, -300), 0.08, 4));
  }
  // 2 / 3: rotating lasers, five abreast per side
  const lasers = { left: [], right: [] };
  for (const [type, xs, s, list] of [[2, [-23, -21, -19, -17, -15], -1, lasers.left], [3, [15, 17, 19, 21, 23], 1, lasers.right]]) {
    for (const x of xs) {
      const { pivot, light } = rotatingLaser(root, rig, tubes, V(x, 3, -46), -s * tilt, 220, 0.07);
      groups[type].push(light);
      list.push(pivot);
    }
  }

  // 4: emblems (own geometry bank: core + halo), tower bars, wires, chevron
  const embCore = emblemGeometry(0.035);
  const embHalo = emblemGeometry(0.12);
  owned.push(embCore, embHalo);
  const embBank = new LightBank(root, embCore, 2);
  const embHaloBank = new LightBank(root, embHalo, 2, { material: lightMaterial({ opacity: 0.3 }), renderOrder: 1 });
  for (const s of [-1, 1]) {
    const m = trs([s * 17.25, 6, -17.05], [0, 0, -s * 0.12], [3.6, 3.6, 1]);
    groups[4].push(new MultiLight([embBank.add(m), embHaloBank.add(m)]));
  }
  for (const [y, z] of [[18, -2], [22, -10]]) {
    for (const s of [-1, 1]) groups[4].push(tubes.tube(V(s * 33.9, y - 16, z), V(s * 33.9, y + 16, z), 0.15, 3));
  }
  for (const s of [-1, 1]) groups[4].push(tubes.tube(V(s * 38.9, 20, -17.9), V(s * 38.9, 33, -17.9), 0.15, 3));
  groups[4].push(tubes.tube(V(-5.5, 0.35, 10), V(-5.5, 0.35, -300), 0.04, 3.5));
  groups[4].push(tubes.tube(V(-3.5, 0.0, -6), V(-3.5, 0.0, -300), 0.04, 3.5));
  groups[4].push(tubes.tube(V(3.5, 0.0, -6), V(3.5, 0.0, -300), 0.04, 3.5));
  groups[4].push(tubes.tube(V(5.5, 0.35, 10), V(5.5, 0.35, -300), 0.04, 3.5));
  {
    const c = V(0, 5, -75);
    const d = new THREE.Vector3(Math.sin(tilt), Math.cos(tilt), 0).multiplyScalar(3.4);
    const right = tubes.tube(c.clone().add(V(d.x, -d.y, 0)), c.clone().add(V(0, 0.02, 0)), 0.12, 4);
    const left = tubes.tube(c.clone().sub(d), c.clone().add(V(0, 0.02, 0)), 0.12, 4);
    groups[4].push(right, left);
  }

  rig.update(true);
  const banks = [...tubes.banks, embBank, embHaloBank, ringBodies.bank];
  return {
    root,
    banks,
    groups,
    rings: [{ type: 'small', objects: ringObjs, step: 3 }],
    lasers,
    update() {
      rig.update();
    },
    dispose() {
      for (const g of owned) g.dispose();
      tubes.dispose();
      for (const b of [embBank, embHaloBank]) {
        b.mesh.material.dispose();
        b.dispose();
      }
      ringBodies.dispose();
      Object.values(mats).forEach((m) => m.dispose());
      root.removeFromParent();
    },
  };
}
