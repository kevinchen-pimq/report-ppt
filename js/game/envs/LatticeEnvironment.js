// Lattice environment (OST 6) — our own recreation from simple shapes (no game assets). Look: a
// dark void; down the runway, four diagonal rows (bottom-left, bottom-right, top-left, top-right) of
// floating "cube" clusters — a dark cube with four light dots between two dark arms — each throwing
// two vertical spot beams and two long lasers that cross over the runway into a lattice; on the
// floor a large light triangle (outline, inner diagonals) pointing down the runway with a chevron
// at its tip.
//
// v3 light groups (id → what, elements, axes). Per quadrant q (BL = 0, BR = 7, TL = 14, TR = 21)
// the groups are q + 0 … q + 6, each with 8 elements (one per cluster, near → far):
//   q+0  <Quadrant> Global    8   trans x y z (no light; moves the whole cluster)
//   q+1  <Quadrant> Cube      8   rot x z, fx (splits the cube's light dots apart)
//   q+2  <Quadrant> Radial    8   rot x z (z = around the runway axis), trans y (= outward)
//   q+3  <Quadrant> Spot 1    8   (vertical beam)
//   q+4  <Quadrant> Spot 2    8   rot z
//   q+5  <Quadrant> Laser 1   8   (laser crossing the runway)
//   q+6  <Quadrant> Laser 2   8   rot z
//   28   Runway Diagonals     8   rot y, trans x z (lines inside the triangle: left outer → right outer)
//   29   Runway Outline       3   (base, left side, right side)
//   30   Runway Chevron       1   trans x y z
// Hierarchy per cluster: Global → Radial → Cube / Spot 2 / Laser 2 pivots.
// Basic events: 6 = ambient light (tints the cluster bodies).
// Sources (facts only): group names — KivalEvan/BeatSaber-JSMap (MIT); element counts and axes —
// index filters / axes in ~40 BeatSaver maps for this environment; GLS objects ("Cubes, Runway,
// Chevron", "Radial" naming, FloatFX splitting the cubes), look and colours — BSMG wiki environment
// list + preview image, gameplay video thumbnails, ArcViewer colour table.
// Approximate: cluster spacing / distance, beam directions, triangle size; the triangle lies just
// below the runway surface so the game's runway covers the part in the middle.
import { THREE, GEO, GlowBank, LightBank, PropBank, Rig, V, stdMat, MultiLight, applyMirrors } from './kit.js';
import { LG, finishGroups, pivot, chainTubes, tubes, AmbientLight, mat } from './_v3lg.js';

const CY = 3; // runway axis height of the cluster rows
const RAD = 7.2; // cluster distance from the axis
const D2R = Math.PI / 180;

/** fx: element i moves its own set of pivots outward by value × scale. */
class FxSpread {
  constructor(sets, scale) {
    this.count = sets.length;
    this.sets = sets; // [{ pivots, dirs }]
    this.scale = scale;
  }

  set(i, v) {
    const s = this.sets[i];
    if (!s) return;
    const k = v * this.scale;
    for (let j = 0; j < s.pivots.length; j++) {
      const d = s.dirs[j];
      s.pivots[j].position.set(d[0] * k, d[1] * k, d[2] * k);
    }
  }
}

// Mirror flags (CONTRACT.md "Handedness"): lower case = rotation axes, upper case = translation
// axes whose event value the runtime negates, so that each group turns / moves the way Beat Saber's
// does with our pivots' orientation. Derived per element from the game's environment data (world
// rotation axis / translation direction of a +1 event in ChroMapper's UGEcko export) against ours;
// real maps send the same values to both groups of most left / right pairs, which then mirror.
const MIRROR = { 0: 'Z', 1: 'xz', 2: 'xz', 4: 'z', 6: 'z', 7: 'XZ', 8: 'x', 9: 'x', 14: 'YZ',
  15: 'x', 16: 'Y', 21: 'XYZ', 22: 'xz', 23: 'zY', 25: 'z', 27: 'z', 28: 'yZ', 30: 'Z' };

export default {
  name: 'LatticeEnvironment',
  label: 'Lattice',
  colors: {
    left: '#d62c8b',
    right: '#00abfa',
    envLeft: '#e429bf',
    envRight: '#3295cb',
    envLeftBoost: '#8b22d0',
    envRightBoost: '#67eaea',
    wall: '#77b5ff',
    envWhite: '#B9B9B9', // the game's white light colour (used when the map has none)
  },
  build() {
    const root = new THREE.Group();
    root.name = 'LatticeEnvironment';
    const rig = new Rig(root);

    const lasers = new GlowBank(root, GEO.tube, 160, { haloScale: 3, haloOpacity: 0.16 });
    const spots = new GlowBank(root, GEO.tube, 64, { haloScale: 7, haloOpacity: 0.07 });
    const dots = new LightBank(root, GEO.box, 256);
    const bodyMat = stdMat(0x0d0f1a, { roughness: 0.45, metalness: 0.6 });
    const bodies = new PropBank(root, GEO.box, bodyMat, 96);

    const G = {};
    for (let i = 0; i <= 30; i++) G[i] = LG();
    const fx = {};

    // quadrants: [group base, x sign, y sign, radial rest angle]
    const QUADS = [[0, -1, -1, 135], [7, 1, -1, -135], [14, -1, 1, 45], [21, 1, 1, -45]];
    const toLocal = (d, ang) => {
      // world direction → radial-pivot-local (inverse of the rest rotation about z)
      const c = Math.cos(-ang);
      const s = Math.sin(-ang);
      return V(d.x * c - d.y * s, d.x * s + d.y * c, d.z);
    };
    for (const [q, sx, sy, deg] of QUADS) {
      const ang = deg * D2R;
      const sets = [];
      for (let i = 0; i < 8; i++) {
        const z = -12 - i * 13;
        const gp = pivot(0, CY, z);
        for (const ax of ['x', 'y', 'z']) G[q].translation[ax].push(gp);
        const rp = pivot(0, 0, 0, 0, 0, ang);
        G[q + 2].rotation.x.push(rp);
        G[q + 2].rotation.z.push(rp);
        G[q + 2].translation.y.push(rp);
        // cluster: arms (static in the radial frame), cube on its own pivot
        rig.attach([gp, rp], bodies, mat(0, RAD + 1.1, 0, 0, 0, 0, 0.5, 1.6, 0.5));
        rig.attach([gp, rp], bodies, mat(0, RAD - 1.1, 0, 0, 0, 0, 0.5, 1.6, 0.5));
        const cp = pivot(0, RAD, 0, 0, 0, 0);
        G[q + 1].rotation.x.push(cp);
        G[q + 1].rotation.z.push(cp);
        rig.attach([gp, rp, cp], bodies, mat(0, 0, 0, 0, 0, 0, 1.15, 1.15, 1.15));
        const L = new MultiLight();
        const piv = [];
        const dirs = [];
        for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
          const dp = pivot();
          piv.push(dp);
          dirs.push([a * 0.7, b * 0.7, 0.5]);
          L.push(rig.light([gp, rp, cp, dp], dots, mat(a * 0.28, b * 0.28, 0.6, 0, 0, 0, 0.22, 0.22, 0.08)));
          L.push(rig.light([gp, rp, cp, dp], dots, mat(a * 0.28, b * 0.28, -0.6, 0, 0, 0, 0.22, 0.22, 0.08)));
        }
        sets.push({ pivots: piv, dirs });
        G[q + 1].lights.push(L);
        // spots: vertical beams away from the runway (up for the top rows, down for the bottom)
        const up = toLocal(V(0, sy, 0), ang);
        const tang = toLocal(V(1, 0, 0), ang).multiplyScalar(0.45);
        const o1 = V(0, RAD, 0).add(tang);
        G[q + 3].lights.push(rig.tube([gp, rp], spots, o1, o1.clone().add(up.clone().multiplyScalar(40)), 0.07));
        const sp = pivot(-tang.x, RAD - tang.y, 0);
        G[q + 4].rotation.z.push(sp);
        G[q + 4].lights.push(rig.tube([gp, rp, sp], spots, V(0, 0, 0), up.clone().multiplyScalar(40), 0.07));
        // lasers: long beams across the runway toward the opposite side
        const d1 = toLocal(V(-sx, -sy * 0.42, -0.22).normalize(), ang).multiplyScalar(70);
        G[q + 5].lights.push(rig.tube([gp, rp], lasers, V(0, RAD, 0), V(0, RAD, 0).add(d1), 0.03));
        const lp = pivot(0, RAD, 0);
        G[q + 6].rotation.z.push(lp);
        const d2 = toLocal(V(-sx, -sy * 0.12, 0.18).normalize(), ang).multiplyScalar(70);
        G[q + 6].lights.push(rig.tube([gp, rp, lp], lasers, V(0, 0, 0), d2, 0.03));
      }
      fx[q + 1] = new FxSpread(sets, 1.2);
    }

    // ---- runway triangle (just below the runway surface: the game's runway hides the middle)
    const Y = -0.06;
    const base = -7;
    const apex = -62;
    const W = 5.5;
    G[29].lights.push(tubes(lasers, [[V(-W, Y, base), V(W, Y, base), 0.035]]));
    G[29].lights.push(tubes(lasers, [[V(-W, Y, base), V(0, Y, apex), 0.035]]));
    G[29].lights.push(tubes(lasers, [[V(W, Y, base), V(0, Y, apex), 0.035]]));
    for (let k = 0; k < 8; k++) {
      const x = -W + ((k + 0.5) * 2 * W) / 8;
      const p = pivot(x, Y, base);
      G[28].rotation.y.push(p);
      G[28].translation.x.push(p);
      G[28].translation.z.push(p);
      G[28].lights.push(rig.tube(p, lasers, V(0, 0, 0), V(-x * 0.92, 0, apex - base + 3), 0.025));
    }
    {
      const p = pivot(0, 0.6, apex - 4);
      for (const ax of ['x', 'y', 'z']) G[30].translation[ax].push(p);
      G[30].lights.push(chainTubes(rig, [p], lasers, [[V(-1.1, -0.5, 0), V(0, 0.5, 0), 0.06], [V(0, 0.5, 0), V(1.1, -0.5, 0), 0.06]]));
    }

    const ambient = new AmbientLight([bodyMat], 0.1);
    finishGroups(G);
    rig.update(true);
    return {
      root,
      banks: [...lasers.banks, ...spots.banks, dots, bodies],
      groups: { 6: [ambient] },
      lightGroups: applyMirrors(G, MIRROR),
      fx,
      background: 0x020208,
      update() {
        rig.update();
      },
      dispose() {
        lasers.dispose();
        spots.dispose();
        dots.mesh.material.dispose();
        dots.dispose();
        bodies.dispose();
        bodyMat.dispose();
      },
    };
  },
};
