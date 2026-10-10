// Imagine Dragons (DragonsEnvironment) — a recreation with simple shapes, made for this project.
//
// Look: no floor, the track floats over a void with dark blocks below it; a tunnel of big dark
// A-frames with long rails, huge diamond-shaped "big rings" whose light bars sit on the diamond
// edges, a tight tunnel of small spinning ring arcs (two block arcs per ring) around the track,
// five crossing rotating lasers per side, glow wires along the track and a "^" chevron far ahead.
//
// Light groups (v2 event type -> lights, in light-ID order):
//   0 back lasers  (2):  1 left back wire, 2 right back wire (long wires low at the far sides)
//   1 ring lights  (62): 1-60 big rings, 4 bars per ring from near to far
//                        (per ring: upper-right, lower-left, lower-right, upper-left bar),
//                        61 left bottom wire, 62 right bottom wire (under the track)
//   2 left lasers  (5):  near -> far
//   3 right lasers (5):  near -> far
//   4 center       (4):  1 left track wire, 2 right track wire, 3 chevron left stroke, 4 chevron right stroke
// Rings: 30 small rings (event 8 spin, event 9 zoom 0.25 m <-> 1.75 m), 15 big rings (spin only).
// Lasers: 12 / 13 spin the side lasers around the vertical axis.
// ID order / counts source: community light-ID mapping as used by ArcViewer's Dragons recreation
// (facts only), cross-checked against the BSMG wiki environment notes. Sizes / positions approximate.
// Not supported by the contract: in the game the back lasers show the opposite colour.
import { THREE, GEO, trs, mergeStatic, sceneryMaterials } from './kit.js';
import { GlowBank, SceneryBank, Rig, rigLight, rigScenery, rotatingLaser, rng, boxAt, beamBetween, V } from './_bxKit.js';

const BIG_RINGS = 15;
const SMALL_RINGS = 30;

export default {
  name: 'DragonsEnvironment',
  label: 'Imagine Dragons',
  colors: { left: '#c81414', right: '#288ed2', envLeft: '#d91616', envRight: '#30acff', wall: '#ff3030' },
  build() {
    const root = new THREE.Group();
    const mats = sceneryMaterials();
    const owned = [];
    const rig = new Rig();
    const groups = { 0: [], 1: [], 2: [], 3: [], 4: [] };

    // ---------- static scenery ----------
    const dark = [];
    const metal = [];
    // A-frames: two nested inverted "V"s every 18 m, legs 40° off vertical
    const leg = (40 * Math.PI) / 180;
    for (let k = 0; k < 8; k++) {
      const z = 1 - k * 18;
      for (const apex of [18, 25]) {
        for (const s of [-1, 1]) {
          const a = V(0, apex, z);
          const len = (apex + 40) / Math.cos(leg);
          const b = V(s * Math.sin(leg) * len, apex - Math.cos(leg) * len, z);
          metal.push(beamBetween(mats.metal, a, b, 0.55, 0.55));
        }
      }
    }
    // long rails along the A-frame legs
    for (const off of [0, 7]) {
      for (const [x, y] of [[1.8, 15], [4.3, 12], [6.8, 9], [9.3, 6], [16.8, -3], [21.8, -9]]) {
        for (const s of [-1, 1]) dark.push(boxAt(mats.dark, [s * x, y + off, -150], [0.18, 0.18, 300]));
      }
    }
    // blocks under / beside the track (the void below is the Dragons look)
    {
      const r = rng(7);
      for (let i = 0; i < 18; i++) {
        const x = (r() - 0.5) * 15;
        const z = -10 - r() * 26;
        const w = r() < 0.5 ? 1.5 : 4 + r() * 3;
        const top = -3.2 - r() * 2.5;
        dark.push(boxAt(mats.dark, [x, top - 25, z], [w, 50, 2.5 + r() * 2.5]));
      }
      for (const s of [-1, 1]) {
        for (let i = 0; i < 46; i++) {
          const z = -4 - i * 2.6;
          const top = -0.9 - r() * 2.2;
          const x = s * (3.2 + r() * 1.6);
          dark.push(boxAt(mats.dark, [x, top - 20, z], [1.4 + r() * 0.6, 40, 1.6]));
        }
      }
    }
    // track continuation beyond the game's runway: four strips
    for (const x of [-0.9, -0.3, 0.3, 0.9]) dark.push(boxAt(mats.dark, [x, -0.075, -171], [0.45, 0.15, 260]));
    const darkMesh = mergeStatic(dark, mats.dark);
    const metalMesh = mergeStatic(metal, mats.metal);
    root.add(darkMesh, metalMesh);
    owned.push(darkMesh.geometry, metalMesh.geometry);

    // ---------- light banks ----------
    const tubes = new GlowBank(root, GEO.tube, 32);
    const bars = new GlowBank(root, GEO.box, BIG_RINGS * 4 + 4);

    // group 0: back wires, far out to the sides below the track
    for (const s of [-1, 1]) groups[0].push(tubes.tube(V(s * 18.5, -6, 30), V(s * 18.5, -6, -260), 0.12, 4));

    // ---------- big rings (diamonds) ----------
    const ringBodies = new SceneryBank(root, GEO.box, BIG_RINGS * 4, mats.metal);
    const R = 44; // half-diagonal of the diamond
    const bigRings = [];
    const edge = R * Math.SQRT2;
    for (let k = 0; k < BIG_RINGS; k++) {
      const o = new THREE.Object3D();
      o.position.set(0, 6.25, -7 - k * 10);
      root.add(o);
      bigRings.push(o);
      const p = rig.pivot(o);
      // four frame edges (dark)
      for (let e = 0; e < 4; e++) {
        const ang = Math.PI / 4 + (e * Math.PI) / 2; // edge midpoint direction
        const mx = Math.cos(ang) * (R / Math.SQRT2);
        const my = Math.sin(ang) * (R / Math.SQRT2);
        rigScenery(rig, p, ringBodies, trs([mx, my, 0], [0, 0, ang + Math.PI / 2], [edge, 0.7, 0.7]));
      }
      // light bars on the edge midpoints, slightly in front of the frame (ID order: UR, LL, LR, UL)
      for (const [dx, dy] of [[1, 1], [-1, -1], [1, -1], [-1, 1]]) {
        const ang = Math.atan2(dy, dx);
        const mx = dx * (R / 2 - 0.3);
        const my = dy * (R / 2 - 0.3);
        const local = trs([mx, my, 0.5], [0, 0, ang + Math.PI / 2], [13, 0.38, 0.4]);
        const halo = trs([mx, my, 0.5], [0, 0, ang + Math.PI / 2], [13.4, 1.0, 1.0]);
        groups[1].push(rigLight(rig, p, bars, local, halo));
      }
    }
    // ring group 61 / 62: bottom wires under the track
    for (const s of [-1, 1]) groups[1].push(tubes.tube(V(s * 4, -4, 30), V(s * 4, -4, -260), 0.1, 4));

    // ---------- small rings: two arcs of stepped blocks ----------
    const ringMat = new THREE.MeshStandardMaterial({ color: 0x3b3f58, roughness: 0.45, metalness: 0.25 });
    const smallBodies = new SceneryBank(root, GEO.box, SMALL_RINGS * 14, ringMat);
    const smallRings = [];
    for (let i = 0; i < SMALL_RINGS; i++) {
      const o = new THREE.Object3D();
      o.position.set(0, 1.5, -17 - i * 1.75);
      root.add(o);
      smallRings.push(o);
      const p = rig.pivot(o);
      for (const base of [Math.PI / 2, -Math.PI / 2]) {
        for (let b = 0; b < 7; b++) {
          const a = base + ((b - 3) / 3) * 0.95;
          const rr = 4.6 + (b % 2) * 0.18;
          rigScenery(rig, p, smallBodies, trs([Math.cos(a) * rr, Math.sin(a) * rr, 0], [0, 0, a], [0.5, 0.95, 0.32]));
        }
      }
    }

    // ---------- rotating lasers (groups 2 / 3) ----------
    const lasers = { left: [], right: [] };
    const tilt = (55 * Math.PI) / 180;
    for (const [type, s, list] of [[2, -1, lasers.left], [3, 1, lasers.right]]) {
      for (let i = 0; i < 5; i++) {
        const { pivot, light } = rotatingLaser(root, rig, tubes, V(s * 10, 3.5, -39 - i * 2), -s * tilt, 160, 0.07);
        groups[type].push(light);
        list.push(pivot);
      }
    }

    // ---------- group 4: track wires + chevron ----------
    for (const s of [-1, 1]) groups[4].push(tubes.tube(V(s * 2, -0.07, 6), V(s * 2, -0.07, -300), 0.04, 4));
    {
      const c = V(0, 3.5, -60);
      const d = new THREE.Vector3(Math.sin(tilt), Math.cos(tilt), 0).multiplyScalar(4.2);
      // left stroke rises from the lower left to the apex, right stroke mirrored
      groups[4].push(tubes.tube(c.clone().sub(d), c.clone().add(V(0, 0.02, 0)), 0.11, 4));
      groups[4].push(tubes.tube(c.clone().add(V(d.x, -d.y, 0)), c.clone().add(V(0, 0.02, 0)), 0.11, 4));
    }

    rig.update(true);
    const banks = [...tubes.banks, ...bars.banks, ringBodies.bank, smallBodies.bank];
    return {
      root,
      banks,
      groups,
      rings: [
        { type: 'small', objects: smallRings, step: 5, zoom: { near: 0.25, far: 1.75 } },
        { type: 'big', objects: bigRings, step: 5 },
      ],
      lasers,
      update() {
        rig.update();
      },
      dispose() {
        for (const g of owned) g.dispose();
        tubes.dispose();
        bars.dispose();
        ringBodies.dispose();
        smallBodies.dispose();
        ringMat.dispose();
        Object.values(mats).forEach((m) => m.dispose());
        root.removeFromParent();
      },
    };
  },
};
