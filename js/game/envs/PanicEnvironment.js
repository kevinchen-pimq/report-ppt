// Panic! at the Disco (PanicEnvironment) — a recreation with simple shapes, made for this project.
//
// Look: a tunnel framed by huge dark pyramids pointing at the track from below, above and the two
// upper diagonals; rows of dark leaning pillars ("piano keys") along both sides with a laser running
// behind them (seen as dashes through the gaps); a tight spiral of 30 small rings, each carrying a
// light bar at its top and bottom; two gothic church windows glowing far ahead; seven criss-crossing
// rotating lasers per side up high; two bottom lasers crossing under the track.
//
// Light groups (v2 event type -> lights, in light-ID order):
//   0 bottom lasers (2):  1 right-hand laser, 2 left-hand laser (they cross under the track)
//   1 ring lights   (62): 1-60 small rings near -> far, per ring 1 top bar then 1 bottom bar,
//                         61 left pillar laser, 62 right pillar laser
//   2 left lasers   (7):  near -> far
//   3 right lasers  (7):  near -> far
//   4 center        (6):  1 left window, 2 right window, 3 left / 4 right window frame (approximate:
//                         not in our source mapping), 5 left track laser, 6 right track laser
// Rings: 30 small rings, event 8 spins them (5° step), event 9 zooms 0.25 m <-> 1.5 m.
// Lasers: 12 / 13 spin the side lasers around the vertical axis.
// ID order / counts source: community light-ID mapping as used by ArcViewer's Panic recreation
// (facts only) plus the BSMG wiki environment notes; sizes / positions approximate.
import { THREE, GEO, trs, mergeStatic, sceneryMaterials, LightBank, lightMaterial } from './kit.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GlowBank, SceneryBank, Rig, MultiLight, rigLight, rigScenery, rotatingLaser, rng, boxAt, V } from './_bxKit.js';

const RINGS = 30;

/** Square-based pyramid, apex at +y (height 1, base 1 × 1 centred at y = -0.5). */
function pyramidGeometry() {
  const g = new THREE.ConeGeometry(Math.SQRT1_2, 1, 4, 1, false, Math.PI / 4);
  return g;
}

/** Pointed-arch window outline (unit: width 1, height 1, bottom at y = -0.5). */
function archShape(inset = 0) {
  const w = 0.5 - inset;
  const spring = 0.12; // where the arch starts
  const s = new THREE.Shape();
  s.moveTo(-w, -0.5 + inset);
  s.lineTo(w, -0.5 + inset);
  s.lineTo(w, spring);
  s.quadraticCurveTo(w, 0.36 - inset * 0.5, 0, 0.5 - inset);
  s.quadraticCurveTo(-w, 0.36 - inset * 0.5, -w, spring);
  s.lineTo(-w, -0.5 + inset);
  return s;
}

function windowFrameGeometry(t) {
  // thin outline ring around the arch (shape minus inset hole)
  const outer = archShape(-t);
  outer.holes.push(new THREE.Path(archShape(0).getPoints(12).reverse()));
  return new THREE.ShapeGeometry(outer, 12);
}

export default {
  name: 'PanicEnvironment',
  label: 'Panic! at the Disco',
  colors: { left: '#c81414', right: '#288ed2', envLeft: '#d91616', envRight: '#30acff', wall: '#ff3030' },
  build() {
    const root = new THREE.Group();
    const mats = sceneryMaterials();
    const owned = [];
    const rig = new Rig();
    const groups = { 0: [], 1: [], 2: [], 3: [], 4: [] };

    // ---------- static scenery ----------
    const dark = [];
    // track continuation beyond the game's runway: four strips
    for (const x of [-0.9, -0.3, 0.3, 0.9]) dark.push(boxAt(mats.dark, [x, -0.075, -171], [0.45, 0.15, 260]));
    // leaning pillars on both sides; tops at (±7, -1.5), leaning down toward the centre line
    const pl = (20 * Math.PI) / 180;
    for (const s of [-1, 1]) {
      for (let i = 0; i < 88; i++) {
        const z = 30 - i * 2;
        const L = 70;
        const top = V(s * 7, -1.5, z);
        const c = top.clone().add(V(-s * Math.sin(pl) * (L / 2), -Math.cos(pl) * (L / 2), 0));
        dark.push(boxAt(mats.dark, [c.x, c.y, c.z], [0.75, L, 0.75], [0, 0, s * pl]));
      }
    }
    // dark tracery in front of the windows
    const tracery = [];
    for (const s of [-1, 1]) {
      const W = trs([s * 1.75, 5.8, -53.4], [(15 * Math.PI) / 180, 0, 0], [1, 1, 1]);
      const add = (x, y, sx, sy) => {
        const m = new THREE.Mesh(GEO.box, mats.dark);
        new THREE.Matrix4().multiplyMatrices(W, trs([x, y, 0.06], [0, 0, 0], [sx, sy, 0.08])).decompose(m.position, m.quaternion, m.scale);
        tracery.push(m);
      };
      add(0, -0.4, 0.09, 4.0);
      add(0, -0.25, 2.0, 0.09);
      add(0, 1.1, 1.1, 0.08);
      add(-0.5, -1.2, 0.07, 2.5);
      add(0.5, -1.2, 0.07, 2.5);
    }
    dark.push(...tracery);
    const darkMesh = mergeStatic(dark, mats.dark);
    root.add(darkMesh);
    owned.push(darkMesh.geometry);

    // pyramids pointing at the track: bottom, top, upper-left, upper-right
    const pyrGeo = pyramidGeometry();
    owned.push(pyrGeo);
    const pyrMat = new THREE.MeshStandardMaterial({ color: 0x0d0c16, roughness: 0.75, metalness: 0.3, flatShading: true });
    owned.push(pyrMat);
    const pyrs = [];
    const placePyr = (angleDeg, zs) => {
      const a = (angleDeg * Math.PI) / 180;
      for (const z of zs) {
        const m = new THREE.Mesh(pyrGeo, pyrMat);
        // centre 36 m out along the direction; apex points back toward the track axis
        m.position.set(Math.cos(a) * 36, 0.8 + Math.sin(a) * 36, z);
        m.rotation.set(0, 0, a + Math.PI / 2);
        m.scale.set(17, 60, 8);
        pyrs.push(m);
      }
    };
    placePyr(-90, [-12, -23.25, -34.5, -45.75, -57]);
    placePyr(90, [-45, -56.25]);
    placePyr(135, [-22.5, -33.75, -45, -56.25]);
    placePyr(45, [-22.5, -33.75, -45, -56.25]);
    const pyrMesh = mergeStatic(pyrs, pyrMat);
    root.add(pyrMesh);
    owned.push(pyrMesh.geometry);

    // ---------- lights ----------
    const tubes = new GlowBank(root, GEO.tube, 32);
    const bars = new GlowBank(root, GEO.box, RINGS * 2);

    // 0: bottom lasers crossing under the track (1 right-hand, 2 left-hand)
    for (const s of [1, -1]) {
      const a = (s * 10 * Math.PI) / 180;
      const d = V(Math.sin(a), 0, Math.cos(a));
      const c = V(0, -2, -14);
      groups[0].push(tubes.tube(c.clone().addScaledVector(d, 30), c.clone().addScaledVector(d, -170), 0.06, 4));
    }

    // 1: rings — light bar on top and bottom of each ring, dark blocks at the sides
    const ringMat = new THREE.MeshStandardMaterial({ color: 0x2a2c40, roughness: 0.5, metalness: 0.3 });
    owned.push(ringMat);
    const ringBodies = new SceneryBank(root, GEO.box, RINGS * 2, ringMat);
    const ringObjs = [];
    for (let i = 0; i < RINGS; i++) {
      const o = new THREE.Object3D();
      o.position.set(0, 0.8, -8 - i * 1.5);
      root.add(o);
      ringObjs.push(o);
      const p = rig.pivot(o);
      for (const y of [4, -4]) {
        groups[1].push(rigLight(rig, p, bars, trs([0, y, 0], [0, 0, 0], [1.1, 0.3, 0.3]), trs([0, y, 0], [0, 0, 0], [1.35, 0.7, 0.7])));
      }
      for (const x of [4.2, -4.2]) rigScenery(rig, p, ringBodies, trs([x, 0, 0], [0, 0, Math.PI / 2], [1.2, 0.4, 0.4]));
    }
    // 61 / 62 pillar lasers behind the pillar rows
    for (const s of [-1, 1]) groups[1].push(tubes.tube(V(s * 5.9, -4, 30), V(s * 5.9, -4, -300), 0.08, 3));

    // 2 / 3: rotating lasers up high
    const lasers = { left: [], right: [] };
    const tilt = (50 * Math.PI) / 180;
    for (const [type, s, list] of [[2, -1, lasers.left], [3, 1, lasers.right]]) {
      for (let i = 0; i < 7; i++) {
        const { pivot, light } = rotatingLaser(root, rig, tubes, V(s * 8.5, 8.5, -23 - i * 3.5), -s * tilt, 200, 0.05);
        groups[type].push(light);
        list.push(pivot);
      }
    }

    // 4: windows (glowing glass), window frames, track lasers
    const glassGeo = new THREE.ShapeGeometry(archShape(0), 12);
    const frameGeo = windowFrameGeometry(0.07);
    owned.push(glassGeo, frameGeo);
    const glassBank = new LightBank(root, glassGeo, 2);
    const frameBank = new LightBank(root, frameGeo, 2);
    const glowBank = new LightBank(root, glassGeo, 2, { material: lightMaterial({ opacity: 0.25 }), renderOrder: 1 });
    const winM = [];
    for (const s of [-1, 1]) {
      const m = trs([s * 1.75, 5.8, -53.45], [(15 * Math.PI) / 180, 0, 0], [2.0, 5.0, 1]);
      winM.push(m);
      const halo = trs([s * 1.75, 5.8, -53.5], [(15 * Math.PI) / 180, 0, 0], [2.5, 5.6, 1]);
      groups[4].push(new MultiLight([glassBank.add(m), glowBank.add(halo)]));
    }
    for (const m of winM) groups[4].push(frameBank.add(m.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0, 0.02))));
    for (const s of [-1, 1]) groups[4].push(tubes.tube(V(s * 0.6, 0.01, -40), V(s * 0.6, 0.01, -260), 0.035, 3.5));

    rig.update(true);
    const banks = [...tubes.banks, ...bars.banks, ringBodies.bank, glassBank, glowBank, frameBank];
    return {
      root,
      banks,
      groups,
      rings: [{ type: 'small', objects: ringObjs, step: 5, zoom: { near: 0.25, far: 1.5 } }],
      lasers,
      update() {
        rig.update();
      },
      dispose() {
        for (const g of owned) g.dispose();
        tubes.dispose();
        bars.dispose();
        ringBodies.dispose();
        for (const b of [glassBank, glowBank, frameBank]) {
          b.mesh.material.dispose();
          b.dispose();
        }
        Object.values(mats).forEach((m) => m.dispose());
        root.removeFromParent();
      },
    };
  },
};
