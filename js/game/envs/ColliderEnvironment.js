// Collider environment (OST 7) — our own recreation from simple shapes (no game assets).
// Look: black starry space; a long tunnel of "blocks" made only of laser bars around the runway
// (each block: a frame, inner / outer vertical bars and two pairs of long lasers that fan out
// sideways), a row of smaller laser blocks far out on each side, long "collider" beams that cross
// high above the track, diamond outlines where they meet, segmented runway strips and a white
// chevron at the end of the runway. Nearly everything rotates / translates on all three axes, so
// the blocks fold into kaleidoscopic laser patterns; basic event 6 tints the background haze.
//
// v3 light groups (id → what, elements, rotation / translation axes). Ids, names, counts and
// colour / transform / fx flags: bsmap (KivalEvan, environment + renamer tables) and the group ids /
// axes / value ranges seen in Collider maps on BeatSaver (40f1f, 4154c). Element order and the
// exact geometry are our approximation (index 0 = nearest the player, then left before right).
//   0  center blocks local          20  frame bars (top + bottom) of block k        rot xyz, tra xyz
//   1  center blocks global         20  (no light) outer pivot of block k           rot xyz, tra xyz
//   2  center blocks inner lasers   40  2k left / 2k+1 right inner vertical bar     rot xyz, tra xyz
//   3  center blocks outer lasers   40  2k / 2k+1 outer vertical bar                rot xyz, tra xyz
//   4  center blocks side 01 lasers 40  2k / 2k+1 long laser fanning up and out     rot xyz, tra xyz
//   5  center blocks side 02 lasers 40  2k / 2k+1 long laser fanning out and down   rot xyz, tra xyz
//   6  colliders diamonds            4  diamond outlines high above the track       rot xyz, tra xyz
//   7 / 8  side blocks set 01 (left) / 02 (right) local   5  diamond frame of side block k   rot, tra xyz
//   9 / 10 side blocks set 01 / 02 global                 5  (no light) outer pivot          rot, tra xyz
//   11 / 12 side blocks inner lasers  10  2k / 2k+1 short vertical bars             rot xyz, tra xyz
//   13 / 14 side blocks outer lasers  10  2k / 2k+1 tall vertical beams             rot xyz, tra xyz
//   15 / 16 side blocks side 01 lasers 10 2k / 2k+1 long beams forward / backward   rot xyz, tra xyz
//   17 / 18 side blocks side 02 lasers 10 2k / 2k+1 long beams up-outward           rot xyz, tra xyz
//   19 / 20 runway left / right       5  runway edge strip segments, near → far     (colour only)
//   21 / 22 colliders left / right    4  long beams from the side crossing the track rot xyz, tra xyz
//   23  chevron local                 1  chevron at the end of the runway           rot xyz, tra xyz
//   fx: 24 chevron mask strength (1), 25 center blocks mask strength (20), 26 / 27 side blocks
//       set 01 / 02 mask strength (5) — stored, no visual (we have no masks).
// Basic events: 6 (light) → background haze glow. No rings / laser-speed events.
// Approximate: block shapes and sizes, positions, element order inside a block, which laser is
// "inner" / "outer" / "side"; the game's laser reflections and masks are not modelled.
import { THREE, GEO, GlowBank, Rig, V, SoftGlow, rng } from './kit.js';
import { pivot, lightGroup, addPivot, multi, fxGroup, starField, disposeAll, rigPolyline } from './_v4common.js';

const BLOCKS = 20;
const BZ0 = -15; // first center block
const BDZ = 6; // spacing
const BY = 2.4; // block centre height

export default {
  name: 'ColliderEnvironment',
  label: 'Collider',
  colors: {
    left: '#F67E26',
    right: '#2B99DB',
    envLeft: '#F66800',
    envRight: '#2B64DB',
    envLeftBoost: '#E50906',
    envRightBoost: '#DA69F8',
    wall: '#D61800',
  },
  build() {
    const root = new THREE.Group();
    root.name = 'ColliderEnvironment';
    const owned = [];
    const rig = new Rig();
    const glow = new GlowBank(root, GEO.tube, 460, { haloScale: 3.2, haloOpacity: 0.15 });
    const LG = {};
    const all = 'xyz';
    for (const id of [0, 2, 3, 4, 5, 6, 7, 8, 11, 12, 13, 14, 15, 16, 17, 18, 21, 22, 23]) LG[id] = lightGroup(all, all);
    LG[1] = lightGroup(all, all, { count: BLOCKS });
    LG[9] = lightGroup(all, all, { count: 5 });
    LG[10] = lightGroup(all, all, { count: 5 });
    LG[19] = lightGroup();
    LG[20] = lightGroup();
    const T = (chain, a, b, r = 0.04) => rig.tube(chain, glow, a, b, r);

    // ---- center blocks: global pivot (1) → local pivot (0) → one pivot per laser (2 … 5)
    for (let k = 0; k < BLOCKS; k++) {
      const gp = addPivot(LG[1], pivot(root, 0, BY, BZ0 - k * BDZ));
      const lp = addPivot(LG[0], pivot(gp));
      const c = [gp, lp];
      LG[0].lights.push(multi([
        T(c, V(-2.2, 4.6, 0), V(2.2, 4.6, 0), 0.06),
        T(c, V(-2.2, -4.6, 0), V(2.2, -4.6, 0), 0.06),
      ]));
      for (const s of [-1, 1]) {
        const pi = addPivot(LG[2], pivot(lp, s * 2.5, 0, 0));
        LG[2].lights.push(T([gp, lp, pi], V(0, -2.4, 0), V(0, 2.4, 0), 0.045));
        const po = addPivot(LG[3], pivot(lp, s * 4.2, 0, 0));
        LG[3].lights.push(T([gp, lp, po], V(0, -4.4, 0), V(0, 4.4, 0), 0.045));
        const p1 = addPivot(LG[4], pivot(lp, s * 4.2, 4.4, 0));
        LG[4].lights.push(T([gp, lp, p1], V(0, 0, 0), V(s * 22, 12, -5), 0.035));
        const p2 = addPivot(LG[5], pivot(lp, s * 4.2, -2.6, 0));
        LG[5].lights.push(T([gp, lp, p2], V(0, 0, 0), V(s * 26, -3, 4), 0.035));
      }
    }

    // ---- side blocks: set 01 left (7 / 9 / 11 / 13 / 15 / 17), set 02 right (8 / 10 / 12 / 14 / 16 / 18)
    for (const [s, loc, glob, inner, outer, s1, s2] of [[-1, 7, 9, 11, 13, 15, 17], [1, 8, 10, 12, 14, 16, 18]]) {
      for (let k = 0; k < 5; k++) {
        const gp = addPivot(LG[glob], pivot(root, s * 14, 5.5, -26 - k * 22));
        const lp = addPivot(LG[loc], pivot(gp));
        const c = [gp, lp];
        const d = 1.9;
        LG[loc].lights.push(rigPolyline(rig, c, glow, [V(0, d, 0), V(d, 0, 0), V(0, -d, 0), V(-d, 0, 0)], 0.05));
        // 2k: the bar nearer the track, 2k + 1: the outer one
        for (const side of [-s, s]) {
          const pi = addPivot(LG[inner], pivot(lp, side * 1.1, 0, 0));
          LG[inner].lights.push(T([gp, lp, pi], V(0, -1.3, 0), V(0, 1.3, 0), 0.04));
          const po = addPivot(LG[outer], pivot(lp, side * 2.6, 0, 0));
          LG[outer].lights.push(T([gp, lp, po], V(0, -9, 0), V(0, 9, 0), 0.035));
        }
        for (const dz of [1, -1]) {
          const p = addPivot(LG[s1], pivot(lp, 0, 0, 0));
          LG[s1].lights.push(T([gp, lp, p], V(0, 0, 0), V(s * 4, 1, dz * 24), 0.035));
        }
        for (const dx of [-1, 1]) {
          const p = addPivot(LG[s2], pivot(lp, dx * 0.6, d, 0));
          LG[s2].lights.push(T([gp, lp, p], V(0, 0, 0), V(dx * 10 + s * 6, 26, 0), 0.035));
        }
      }
    }

    // ---- colliders: long beams from both sides crossing high over the track (21 / 22) + diamonds (6)
    for (const [s, id] of [[-1, 21], [1, 22]]) {
      for (let i = 0; i < 4; i++) {
        const p = addPivot(LG[id], pivot(root, s * 34, 6 + i * 1.5, -44 - i * 20));
        LG[id].lights.push(T([p], V(0, 0, 0), V(-s * 64, 14, -6), 0.05));
      }
    }
    for (let i = 0; i < 4; i++) {
      const p = addPivot(LG[6], pivot(root, 0, 13 + i * 0.5, -48 - i * 20));
      const d = 2.6;
      LG[6].lights.push(rigPolyline(rig, [p], glow, [V(0, d * 1.3, 0), V(d, 0, 0), V(0, -d * 1.3, 0), V(-d, 0, 0)], 0.07));
    }

    // ---- runway strips (19 / 20), 5 segments per side, and the chevron (23)
    for (const [s, id] of [[-1, 19], [1, 20]]) {
      for (let i = 0; i < 5; i++) {
        const z0 = -2 - i * 25;
        LG[id].lights.push(glow.tube(V(s * 1.55, 0.03, z0), V(s * 1.55, 0.03, z0 - 23), 0.03, 2.2));
      }
    }
    {
      const p = addPivot(LG[23], pivot(root, 0, 0.4, -131));
      LG[23].lights.push(rigPolyline(rig, [p], glow, [V(-3, 0, 0), V(0, 1.7, 0), V(3, 0, 0)], 0.11, false));
    }

    // ---- basic event 6: background haze; stars
    const haze = new SoftGlow(root, 420, 220, V(0, 10, -220), { gain: 0.35, power: 1.2 });
    owned.push(haze);
    const stars = starField(root, rng(7), 800, 140, 260);
    owned.push(stars);

    const fx = { 24: fxGroup(1), 25: fxGroup(BLOCKS), 26: fxGroup(5), 27: fxGroup(5) };
    rig.update(true);
    return {
      root,
      banks: [...glow.banks],
      groups: { 6: [haze] },
      lightGroups: LG,
      fx,
      background: 0x020208,
      update() {
        rig.update();
      },
      dispose() {
        glow.dispose();
        disposeAll(owned);
      },
    };
  },
};
