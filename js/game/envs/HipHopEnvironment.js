// Hip Hop environment (Hip Hop Mixtape) — our own recreation from simple shapes (no game assets).
// Look: a dark city alley seen from a round platform ringed with neon: tall dark walls covered in
// floating neon graffiti, flat ceiling light panels under a split roof, tall neon pillars, neon
// basketball hoops and balls on the walls, side lasers fanning out low, spectrogram bars along the
// wall feet, subway trains with lit windows (two long ones low along the far walls, two short elevated
// ones) and a neon boombox with shards at the far end.
//
// v3 light groups (id → what, elements, axes). Element order: near → far (approximate)
//   0 / 1    Environment Side Lasers Left / Right  5 each  trans x y z
//   2 / 5    Ceiling Lights Left / Right          12 each  rot x y z, trans x y z
//   3 / 4    (unnamed; no lights found in maps — not provided)
//   6 / 8    Trains Long 1 / 2 Transforms          1 each  rot x y, trans x y z, fx (accepted)
//   7 / 9    Trains Long 1 / 2 Color              30 each  (windows, front → back)
//   10 / 12  Trains Short L / R Transforms         1 each  rot y z, trans x y z, fx (accepted)
//   11 / 13  Trains Short L / R Color             12 each  (windows)
//   14 / 15 / 16  Geo Walls / Roof / Platforms     1 each  trans y (no light)
//   17 / 18  Geo Pillars Left / Right              4 each  trans x y z (neon pillars)
//   19       Environment Runway Ring               1       (ring around the player platform)
//   20 / 23 / 26 / 29  Hoops L1 / L2 / R1 / R2      3 each  rot x z, trans x y z (board, rim, net)
//   21 / 24 / 27 / 30  Hoops Pieces L1 … R2       12 each  rot x, trans z (4 pieces per hoop element;
//                                                  as in the game: z = toward the part's centre, x = along it)
//   22 / 25 / 28 / 31  Balls L1 / L2 / R1 / R2      1 each  rot x y z, trans x y z
//   32 / 33  Graffiti Floating Graffiti R / L     16 each  (neon tags on the walls)
//   34       Graffiti Boombox                      1       trans x y z
//   35       Graffiti Boombox Shards               6       trans x
//   36 / 37  Environment Spectrogram Left / Right 16 each
//   38 / 39  Trains Short L / R Graffiti          12 each
//   40       Environment Runway Lights             2       (left / right runway edge lines)
//   41       Environment Spectrogram Y             1       trans y (moves both spectrograms)
// Basic events: 6 = ambient light (tints the walls, roof and floor).
// Sources (facts only): group names — KivalEvan/BeatSaber-JSMap (MIT); element counts and axes —
// index filters / axes in ~40 BeatSaver maps for this environment; GLS objects, look and colours —
// BSMG wiki environment list + preview image, Steam store screenshots, ArcViewer colour table.
// Approximate: all positions / sizes, graffiti shapes (random squiggles, arrows), train layout,
// what the hoop pieces are, the boombox shape (no Eminem logo variant).
import { THREE, GEO, GlowBank, LightBank, PropBank, Rig, V, stdMat, rng, MultiLight, mergeAll, applyMirrors } from './kit.js';
import { LG, finishGroups, pivot, chainTubes, tubes, AmbientLight, fxNone, arcSegs, polySegs, mat } from './_v3lg.js';

const AX = ['x', 'y', 'z'];
const WX = 7.5; // wall distance from the runway axis

// Mirror flags (CONTRACT.md "Handedness"): lower case = rotation axes, upper case = translation
// axes whose event value the runtime negates, so that each group turns / moves the way Beat Saber's
// does with our pivots' orientation. Derived per element from the game's environment data (world
// rotation axis / translation direction of a +1 event in ChroMapper's UGEcko export) against ours;
// real maps send the same values to both groups of most left / right pairs, which then mirror.
const MIRROR = { 0: 'Z', 1: 'XZ', 2: 'xyZ', 5: 'xzXZ', 6: 'xyZ', 8: 'xyZ', 10: 'yZ', 12: 'zXZ',
  17: 'Z', 18: 'XZ', 20: 'xZ', 22: 'xyZ', 23: 'xZ', 25: 'xyZ', 26: 'xzXZ', 28: 'zXZ', 29: 'xzXZ',
  31: 'zXZ', 34: 'Z' };

export default {
  name: 'HipHopEnvironment',
  label: 'Hip Hop',
  colors: {
    left: '#ff9550',
    right: '#049c96',
    envLeft: '#e97e00',
    envRight: '#0fcd2f',
    envLeftBoost: '#24fff7',
    envRightBoost: '#3a46ff',
    wall: '#ff508d',
    envWhite: '#CCC1B4', // the game's white light colour (used when the map has none)
    envWhiteBoost: '#E0E0E0',
  },
  build() {
    const root = new THREE.Group();
    root.name = 'HipHopEnvironment';
    const rig = new Rig(root);
    const R = rng(1979);
    const owned = [];
    const own = (x) => (owned.push(x), x);

    const glow = new GlowBank(root, GEO.tube, 380, { haloScale: 3, haloOpacity: 0.16 });
    const boxes = new LightBank(root, GEO.box, 220);
    const geoMat = own(stdMat(0x0b0b12, { roughness: 0.8, metalness: 0.2 }));
    const trainMat = own(stdMat(0x1a1c26, { roughness: 0.5, metalness: 0.6 }));
    const geo = new PropBank(root, GEO.box, geoMat, 12);
    const trains = new PropBank(root, GEO.box, trainMat, 8);

    const G = {};
    for (let i = 0; i <= 41; i++) if (i !== 3 && i !== 4) G[i] = LG();
    const fx = {};
    const all = (g, kind, o, axes = AX) => {
      for (const ax of axes) G[g][kind][ax].push(o);
    };

    // ---- geometry that moves: walls (14), roof (15), side platforms (16)
    {
      const walls = pivot();
      G[14].translation.y.push(walls);
      for (const s of [-1, 1]) rig.attach(walls, geo, mat(s * (WX + 0.6), 8, -70, 0, 0, 0, 1.2, 22, 160));
      const roof = pivot();
      G[15].translation.y.push(roof);
      for (const s of [-1, 1]) rig.attach(roof, geo, mat(s * (WX - 2.2), 15.5, -70, 0, 0, s * 0.12, 5, 0.5, 160));
      const plat = pivot();
      G[16].translation.y.push(plat);
      for (const s of [-1, 1]) rig.attach(plat, geo, mat(s * 4.6, -0.6, -70, 0, 0, 0, 3.6, 1.2, 160));
      for (const g of [14, 15, 16]) G[g].count = 1;
    }

    // ---- side lasers (5 per side), low, fanning outward through the wall gaps near the player
    for (const [s, g] of [[-1, 0], [1, 1]]) {
      for (let k = 0; k < 5; k++) {
        const p = pivot(s * 3.2, 0.4 + k * 0.55, -2 - k * 1.2);
        all(g, 'translation', p);
        G[g].lights.push(rig.tube(p, glow, V(0, 0, 0), V(s * 60, 6 + k * 4, 20 - k * 8), 0.035));
      }
    }

    // ---- ceiling light panels (12 per side)
    for (const [s, g] of [[-1, 2], [1, 5]]) {
      for (let i = 0; i < 12; i++) {
        const p = pivot(s * 4.4, 13.6, -6 - i * 7.5);
        all(g, 'rotation', p);
        all(g, 'translation', p);
        G[g].lights.push(rig.light(p, boxes, mat(0, 0, 0, 0, 0, -s * 0.12, 3.4, 0.12, 1.3)));
      }
    }

    // ---- trains: long ones low along the walls far down the alley, short ones elevated nearer
    const train = (gT, gC, x, y, z, len, n, gGraf = null) => {
      const p = pivot(x, y, z);
      all(gT, 'rotation', p, gT >= 10 ? ['y', 'z'] : ['x', 'y']);
      all(gT, 'translation', p);
      G[gT].count = 1;
      fx[gT] = fxNone(1);
      rig.attach(p, trains, mat(0, 0, 0, 0, 0, 0, 2.6, 3, len));
      const side = x < 0 ? 1 : -1; // windows face the runway
      for (let i = 0; i < n; i++) {
        const wz = len / 2 - ((i + 0.5) * len) / n;
        G[gC].lights.push(rig.light(p, boxes, mat(side * 1.32, 0.45, wz, 0, 0, 0, 0.04, 0.8, (len / n) * 0.6)));
        if (gGraf !== null) {
          G[gGraf].lights.push(rig.light(p, boxes, mat(side * 1.33, -0.75, wz, 0, 0, 0, 0.03, 0.18, (len / n) * 0.85)));
        }
      }
    };
    train(6, 7, -6.1, 1.7, -100, 70, 30);
    train(8, 9, 6.1, 1.7, -108, 70, 30);
    train(10, 11, -5.2, 7.5, -32, 24, 12, 38);
    train(12, 13, 5.2, 7.5, -38, 24, 12, 39);

    // ---- neon pillars (4 per side)
    for (const [s, g] of [[-1, 17], [1, 18]]) {
      for (let i = 0; i < 4; i++) {
        const p = pivot(s * 3.4, 0, -9 - i * 19);
        all(g, 'translation', p);
        G[g].lights.push(rig.tube(p, glow, V(0, 0, 0), V(0, 15, 0), 0.11));
      }
    }

    // ---- runway ring (below the runway surface: the game's runway covers the part in front)
    G[19].lights.push(tubes(glow, arcSegs(V(0, -0.1, 0), 2.1, 0, Math.PI * 2, 28, 0.11, 'xz')));
    G[19].count = 1;
    G[40].lights.push(glow.tube(V(-1.45, 0.02, -2.3), V(-1.45, 0.02, -140), 0.03));
    G[40].lights.push(glow.tube(V(1.45, 0.02, -2.3), V(1.45, 0.02, -140), 0.03));

    // ---- basketball hoops (3 elements of 4 pieces each) and balls
    const HOOPS = [[-1, 20, 21, 22, -22], [-1, 23, 24, 25, -58], [1, 26, 27, 28, -30], [1, 29, 30, 31, -66]];
    for (const [s, gH, gP, gB, z] of HOOPS) {
      const base = V(s * (WX - 0.2), 6.5, z);
      const parts = [
        // backboard: 4 edges
        [[V(0, 0.9, -1.3), V(0, 0.9, 1.3)], [V(0, -0.9, -1.3), V(0, -0.9, 1.3)], [V(0, 0.9, -1.3), V(0, -0.9, -1.3)], [V(0, 0.9, 1.3), V(0, -0.9, 1.3)]],
        // rim: 4 arcs of a ring sticking out from the board, in the game's piece order (centred on
        // +x, -z, -x, +z around the rim's centre)
        [0, 1, 2, 3].map((q) => {
          const a0 = (-q * Math.PI) / 2 - Math.PI / 4;
          const a1 = a0 + Math.PI / 2;
          return [V(-s * 0.75 + Math.cos(a0) * 0.55, -0.85, Math.sin(a0) * 0.55), V(-s * 0.75 + Math.cos(a1) * 0.55, -0.85, Math.sin(a1) * 0.55)];
        }),
        // net: 4 slanted strands (same order)
        [0, 1, 2, 3].map((q) => {
          const a = (-q * Math.PI) / 2;
          return [V(-s * 0.75 + Math.cos(a) * 0.55, -0.85, Math.sin(a) * 0.55), V(-s * 0.75 + Math.cos(a) * 0.3, -1.8, Math.sin(a) * 0.3)];
        }),
      ];
      // ring centre / axis of each part's 4 pieces (board: vertical, facing the track; rim, net: flat)
      const rings = [[V(0, 0, 0), V(1, 0, 0)], [V(-s * 0.75, -0.85, 0), V(0, 1, 0)], [V(-s * 0.75, -1.3, 0), V(0, 1, 0)]];
      parts.forEach((pieces, k) => {
        const hp = pivot(base.x, base.y, base.z);
        all(gH, 'rotation', hp, ['x', 'z']);
        all(gH, 'translation', hp);
        const L = new MultiLight();
        const [c0, n] = rings[k];
        for (const [a, b] of pieces) {
          // as in the game's hoop pieces: a fixed mount per piece with z pointing to the ring's
          // centre and x along the ring (n × z); the pivot inside tilts around x and slides along z
          const c = a.clone().add(b).multiplyScalar(0.5);
          const off = c.clone().sub(c0);
          const Z = off.addScaledVector(n, -off.dot(n)).normalize().negate();
          const X = V(0, 0, 0).crossVectors(n, Z);
          const Y = V(0, 0, 0).crossVectors(Z, X);
          const mount = pivot(c.x, c.y, c.z);
          mount.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, Y, Z));
          const pp = pivot();
          G[gP].rotation.x.push(pp);
          G[gP].translation.z.push(pp);
          const loc = (v) => { const d = v.clone().sub(c); return V(X.dot(d), Y.dot(d), Z.dot(d)); };
          L.push(rig.tube([hp, mount, pp], glow, loc(a), loc(b), 0.05));
        }
        G[gH].lights.push(L);
      });
      // ball: a circle with two seams
      const bp = pivot(base.x - s * 1.6, 3.2, z + 3);
      all(gB, 'rotation', bp);
      all(gB, 'translation', bp);
      const segs = arcSegs(V(0, 0, 0), 0.6, 0, Math.PI * 2, 10, 0.04, 'yz');
      segs.push([V(0, 0.6, 0), V(0, -0.6, 0), 0.03], [V(0, 0, 0.6), V(0, 0, -0.6), 0.03]);
      G[gB].lights.push(chainTubes(rig, [bp], glow, segs));
    }

    // ---- floating graffiti: random neon tags (squiggles and arrows) on both walls
    for (const [s, g] of [[1, 32], [-1, 33]]) {
      for (let i = 0; i < 16; i++) {
        const x = s * (WX - 0.15);
        const y = 3 + R() * 9;
        const z = -6 - i * 6 - R() * 3;
        const pts = [];
        const n = 4 + Math.floor(R() * 3);
        const w = 2.4 + R() * 2.4;
        for (let k = 0; k < n; k++) pts.push(V(x, y + (R() - 0.5) * 2.6, z - (k / (n - 1) - 0.5) * w * s));
        const segs = polySegs(pts, 0.07);
        if (i % 3 === 0) {
          // arrow head at the end
          const e = pts[pts.length - 1];
          segs.push([e, V(x, e.y + 0.45, e.z + 0.45 * s), 0.05], [e, V(x, e.y - 0.45, e.z + 0.45 * s), 0.05]);
        }
        G[g].lights.push(tubes(glow, segs));
      }
    }

    // ---- boombox at the far end, with shards
    {
      const p = pivot(0, 9, -96);
      all(34, 'translation', p);
      const r = 0.12;
      const segs = [
        [V(-4, -1.8, 0), V(4, -1.8, 0), r], [V(-4, 1.8, 0), V(4, 1.8, 0), r],
        [V(-4, -1.8, 0), V(-4, 1.8, 0), r], [V(4, -1.8, 0), V(4, 1.8, 0), r],
        [V(-2.5, 1.8, 0), V(-2, 3, 0), r], [V(2.5, 1.8, 0), V(2, 3, 0), r], [V(-2, 3, 0), V(2, 3, 0), r],
        ...arcSegs(V(-2.3, -0.1, 0), 1.25, 0, Math.PI * 2, 12, r),
        ...arcSegs(V(2.3, -0.1, 0), 1.25, 0, Math.PI * 2, 12, r),
        [V(-0.7, 0.9, 0), V(0.7, 0.9, 0), r],
      ];
      G[34].lights.push(chainTubes(rig, [p], glow, segs));
      // shards around the boombox in the game's order (top, then clockwise); translation x
      // pushes each one outward along its own direction, as in the game
      [79, 40, -46, -118, 166, 142].forEach((deg) => {
        const a = (deg * Math.PI) / 180;
        const mount = pivot(Math.cos(a) * 6.2, Math.sin(a) * 4.4, 0, 0, 0, a);
        const sp = pivot();
        G[35].translation.x.push(sp);
        const t = [V(0, 0.8, 0), V(0.6, -0.5, 0), V(-0.6, -0.5, 0)].map((v) => v.applyAxisAngle(V(0, 0, 1), -a));
        G[35].lights.push(chainTubes(rig, [p, mount, sp], glow, polySegs(t, 0.06, true)));
      });
    }

    // ---- spectrograms along the wall feet (16 per side), all on the Y pivot (41)
    {
      const py = pivot();
      G[41].translation.y.push(py);
      G[41].count = 1;
      for (const [s, g] of [[-1, 36], [1, 37]]) {
        for (let i = 0; i < 16; i++) {
          const h = 0.4 + ((i * 7) % 5) * 0.25;
          G[g].lights.push(rig.light(py, boxes, mat(s * (WX - 0.9), h / 2 + 0.1, -7 - i * 5, 0, 0, 0, 0.16, h, 0.5)));
        }
      }
    }

    // ---- static floor
    const floorMat = own(stdMat(0x0a0a10, { roughness: 0.4, metalness: 0.5 }));
    const fl = new THREE.PlaneGeometry(2 * WX, 170);
    fl.rotateX(-Math.PI / 2);
    fl.translate(0, -0.02, -78);
    const floor = new THREE.Mesh(mergeAll([fl]), floorMat);
    floor.matrixAutoUpdate = false;
    root.add(floor);

    const ambient = new AmbientLight([geoMat, floorMat], 0.03);
    finishGroups(G);
    rig.update(true);
    return {
      root,
      banks: [...glow.banks, boxes, geo, trains],
      groups: { 6: [ambient] },
      lightGroups: applyMirrors(G, MIRROR),
      fx,
      update() {
        rig.update();
      },
      dispose() {
        glow.dispose();
        boxes.mesh.material.dispose();
        boxes.dispose();
        geo.dispose();
        trains.dispose();
        floor.geometry.dispose();
        for (const o of owned) o.dispose();
      },
    };
  },
};
