// The Rolling Stones environment (The Rolling Stones music pack) — our own recreation from simple
// shapes (no game assets). Look ("Hackney Diamonds"): a hazy purple void lined with tall dark
// columns carrying neon strips and sky lasers, floating crystal slabs low at the sides, small
// crystal "spheres" shooting lasers, and above the far runway three crystal show pieces that can
// fracture apart: the tongue-and-lips logo, a heart and a cube, plus a few floating splinters.
//
// v3 light groups (id → what, elements, axes). Element order: near → far / inner → outer (approx.)
//   0 / 1    Cube Local Left / Right          15 each  rot x y z, trans x y z, fx (fracture)
//   2–5      Columns Left 01–04                4 each  rot x y z, trans x y z (16 left columns)
//   6–9      Columns Right 01–04               4 each  (same, right)
//   10 / 11  Floor Blocks Left / Right        16 each  trans x y z (floating crystal slabs)
//   12 / 13  Heart Local Left / Right          6 each  rot x y z, trans x y z, fx (fracture)
//   14–17    Lasers Left 01–04                 3 each  rot x y z, trans x y z (beams of sphere 1–4)
//   18–21    Lasers Right 01–04                3 each
//   22 / 23  Columns Lasers 01 / 02           16 each  (sky beams on the left / right columns)
//   24 / 25  Lasers Left / Right Sphere        4 each  rot x y z, trans x y z, fx (float)
//   26       Cube Global                       1       rot x y z, trans x y z (no light)
//   27       Heart Global                      1       rot x y z, trans x y z (no light)
//   28       Logo Local                        6       rot x y z, fx (fracture) — logo pieces
//   29       Logo Global                       1       rot x y z, trans x y z (no light)
//   30       Splinters                         6       rot x y z, trans x y z, fx (fracture)
//   31 / 32  Cube Rot Z Left / Right          15 each  rot z (pieces around the cube centre)
//   33 / 34  Heart Rot Z Left / Right          6 each  rot z (pieces around the heart centre)
//   35 / 36  Floor Side Laser Left / Right     1 each
//   37       Cube Lasers                       4
//   38       Splinters Global Translation      6       trans x y z (no light)
//   39       Floor Below Block                 1       trans y (no light; dark block under the runway)
//   40 / 41  Floor Inner Light Left / Right    6 each
//   42 / 43  Logo Iridescence / Logo Color     fx only (6 each; accepted, not shown)
//   44 / 45  Floor Side Laser Bottom L / R     1 each
// Basic events: 6 = ambient light (tints the columns and the haze). Value control 40 (logo) is not
// shown. fx: groups 0, 1, 12, 13, 28, 30 push pieces outward, 24 / 25 lift the spheres.
// Sources (facts only): group names — KivalEvan/BeatSaber-JSMap (MIT); element counts and axes —
// index filters / axes in ~40 BeatSaver maps for this environment; GLS objects, look and colours —
// BSMG wiki environment list + preview image, Steam store screenshots, ArcViewer colour table.
// Approximate: every position / size, the logo / heart / cube shapes, piece order, fx meaning.
import { THREE, GEO, GlowBank, LightBank, PropBank, Rig, V, stdMat, rng, applyMirrors } from './kit.js';
import { LG, finishGroups, pivot, chainTubes, tubes, AmbientLight, FxOffsets, fxNone, shardGeometry, prismGeometry, mat } from './_v3lg.js';

const AX = ['x', 'y', 'z'];

// Mirror flags (CONTRACT.md "Handedness"): lower case = rotation axes, upper case = translation
// axes whose event value the runtime negates, so that each group turns / moves the way Beat Saber's
// does with our pivots' orientation. Derived per element from the game's environment data (world
// rotation axis / translation direction of a +1 event in ChroMapper's UGEcko export) against ours;
// real maps send the same values to both groups of most left / right pairs, which then mirror.
const MIRROR = { 0: 'xyZ', 1: 'xyZ', 2: 'yZ', 3: 'yZ', 4: 'yZ', 5: 'yZ', 6: 'XZ', 7: 'XZ', 8: 'XZ',
  9: 'XZ', 10: 'X', 12: 'xyZ', 13: 'xyZ', 14: 'zZ', 15: 'zZ', 16: 'zZ', 17: 'zZ', 18: 'XZ',
  19: 'XZ', 20: 'XZ', 21: 'XZ', 24: 'xZ', 25: 'xXZ', 26: 'yZ', 27: 'yzZ', 28: 'y', 29: 'yZ',
  30: 'yzZ', 31: 'z', 32: 'z', 33: 'z', 34: 'z', 38: 'Z' };

export default {
  name: 'TheRollingStonesEnvironment',
  label: 'The Rolling Stones',
  colors: {
    left: '#e5001d',
    right: '#8622ad',
    envLeft: '#f30367',
    envRight: '#7a67ff',
    envLeftBoost: '#907600',
    envRightBoost: '#01a3ab',
    wall: '#f30367',
    envWhite: '#B9B9B9', // the game's white light colour (used when the map has none)
  },
  build() {
    const root = new THREE.Group();
    root.name = 'TheRollingStonesEnvironment';
    const rig = new Rig(root);
    const R = rng(1962);
    const owned = [];
    const own = (x) => (owned.push(x), x);

    const glow = new GlowBank(root, GEO.tube, 190, { haloScale: 3.2, haloOpacity: 0.15 });
    const shardGeo = own(shardGeometry());
    const shards = new LightBank(root, shardGeo, 64);
    const slabGeo = own(prismGeometry([[-1.6, -0.5], [-0.4, -0.9], [1.5, -0.6], [1.8, 0.3], [0.2, 0.8], [-1.3, 0.5]], 0.12));
    slabGeo.rotateX(Math.PI / 2);
    const slabs = new LightBank(root, slabGeo, 32);
    const colMat = own(stdMat(0x120d1c, { roughness: 0.55, metalness: 0.35 }));
    const props = new PropBank(root, GEO.box, colMat, 40);

    const G = {};
    for (let i = 0; i <= 45; i++) G[i] = LG();
    const addAxes = (g, kind, o, axes = AX) => {
      for (const ax of axes) G[g][kind][ax].push(o);
    };
    const fx = {};

    // ---- columns (4 groups × 4 per side), each with a neon strip and a sky beam (groups 22 / 23)
    for (const [s, g0, gSky] of [[-1, 2, 22], [1, 6, 23]]) {
      for (let j = 0; j < 4; j++) {
        for (let i = 0; i < 4; i++) {
          const k = j * 4 + i;
          const x = s * (8 + R() * 2.2);
          const z = -10 - k * 6.4;
          const top = 2 + R() * 5;
          const p = pivot(x, top, z);
          addAxes(g0 + j, 'rotation', p, ['y']);
          addAxes(g0 + j, 'translation', p);
          const w = 2 + R() * 0.8;
          rig.attach(p, props, mat(0, -20, 0, 0, 0, 0, w, 40, w));
          // neon strip on the inner face
          G[g0 + j].lights.push(rig.tube(p, glow, V(-s * (w / 2 + 0.03), -18, 0), V(-s * (w / 2 + 0.03), -0.2, 0), 0.05));
          // sky beam from the column top
          G[gSky].lights.push(rig.tube(p, glow, V(0, 0.1, 0), V(0, 70, 0), 0.03));
        }
      }
    }

    // ---- floor blocks: floating crystal slabs low at the sides
    for (const [s, g] of [[-1, 10], [1, 11]]) {
      for (let i = 0; i < 16; i++) {
        const p = pivot(s * (3.6 + R() * 2), -2.2 - R() * 2, -6 - i * 6.1);
        addAxes(g, 'translation', p, ['x', 'y']);
        G[g].lights.push(rig.light(p, slabs, mat(0, 0, 0, 0, R() * 3, (R() - 0.5) * 0.3, 0.55 + R() * 0.3)));
      }
    }

    // ---- spheres (24 / 25) with three lasers each (14–17 left, 18–21 right)
    const dirs = [V(0.35, 1, -0.25), V(-0.25, 0.75, -0.65), V(0.8, 0.45, -0.5)];
    for (const [s, gS, gL0] of [[-1, 24, 14], [1, 25, 18]]) {
      const fxP = [];
      for (let k = 0; k < 4; k++) {
        const sp = pivot(s * (3.2 + k * 0.9), 3 + (k % 2) * 3.2, -12 - k * 11);
        const fp = pivot();
        addAxes(gS, 'rotation', sp, ['x']);
        addAxes(gS, 'translation', sp);
        G[gS].lights.push(rig.light([sp, fp], shards, mat(0, 0, 0, 0.3, k, 0.2, 0.9)));
        fxP.push(fp);
        for (let l = 0; l < 3; l++) {
          const lp = pivot();
          addAxes(gL0 + k, 'rotation', lp, ['x', 'z']);
          addAxes(gL0 + k, 'translation', lp);
          const d = dirs[l].clone().normalize();
          d.x *= -s;
          G[gL0 + k].lights.push(rig.tube([sp, fp, lp], glow, V(0, 0, 0), d.multiplyScalar(90), 0.03));
        }
      }
      fx[gS] = new FxOffsets(fxP, fxP.map(() => V(0, 1, 0)), 1.5);
    }

    // a fracturing crystal piece: chain [global, rotZ, local, fx] → shard
    const piece = (global, cx, cy, px, py, gLocal, gRotZ, fxList, dirList, local) => {
      const rz = pivot(0, 0, 0);
      if (gRotZ !== null) G[gRotZ].rotation.z.push(rz);
      const lp = pivot(px, py, 0);
      addAxes(gLocal, 'rotation', lp, ['x', 'y']);
      addAxes(gLocal, 'translation', lp, ['z']);
      const fp = pivot();
      fxList.push(fp);
      const d = V(px - cx, py - cy, (R() - 0.5) * 0.6);
      if (d.lengthSq() < 1e-4) d.set(0, 0, 1);
      dirList.push(d.normalize());
      return rig.light([global, rz, lp, fp], shards, local);
    };

    // ---- cube: 2 × 15 shards in a block (left half / right half)
    {
      const cg = pivot(0, 33, -125);
      cg.scale.setScalar(1.4);
      addAxes(26, 'rotation', cg, ['y']);
      addAxes(26, 'translation', cg);
      for (const [s, gL, gZ] of [[-1, 0, 31], [1, 1, 32]]) {
        const fxP = [];
        const fxD = [];
        for (let j = 0; j < 15; j++) {
          const px = s * (0.9 + Math.floor(j / 5) * 1.7);
          const py = (j % 5 - 2) * 1.6;
          G[gL].lights.push(piece(cg, 0, 0, px, py, gL, gZ, fxP, fxD, mat(0, 0, 0, R() * 3, R() * 3, R() * 3, 2.4, 2.8, 2.4)));
        }
        fx[gL] = new FxOffsets(fxP, fxD, 3);
      }
      // cube lasers: four beams from the cube's corners
      for (const [x, y] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
        G[37].lights.push(rig.tube(cg, glow, V(x * 3, y * 3, 0), V(x * 60, y * 50, 30), 0.04));
      }
    }

    // ---- heart: 2 × 6 shards along the heart outline
    {
      const hg = pivot(0, 18.5, -64);
      hg.scale.setScalar(1.3);
      addAxes(27, 'rotation', hg, ['y', 'z']);
      addAxes(27, 'translation', hg);
      const k = 0.38;
      for (const [s, gL, gZ] of [[-1, 12, 33], [1, 13, 34]]) {
        const fxP = [];
        const fxD = [];
        for (let i = 0; i < 6; i++) {
          const t = ((i + 0.5) / 6) * Math.PI;
          const x = s * 16 * Math.sin(t) ** 3 * k;
          const y = (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) * k;
          const tx = s * 48 * Math.sin(t) ** 2 * Math.cos(t);
          const ty = -13 * Math.sin(t) + 10 * Math.sin(2 * t) + 6 * Math.sin(3 * t) + 4 * Math.sin(4 * t);
          const ang = Math.atan2(ty, tx) - Math.PI / 2;
          G[gL].lights.push(piece(hg, 0, 1, x, y, gL, gZ, fxP, fxD, mat(0, 0, 0, 0, 0, ang, 2.2, 3, 1.2)));
        }
        fx[gL] = new FxOffsets(fxP, fxD, 3);
      }
    }

    // ---- logo: lips + tongue in 6 pieces (tube outlines)
    {
      const lg = pivot(0, 9, -50);
      lg.scale.setScalar(1.8);
      addAxes(29, 'rotation', lg, ['y', 'z']);
      addAxes(29, 'translation', lg);
      const r = 0.11;
      const arc = (cx, cy, rx, ry, a0, a1, n = 6) => {
        const pts = [];
        for (let i = 0; i <= n; i++) {
          const a = a0 + ((a1 - a0) * i) / n;
          pts.push(V(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry, 0));
        }
        return pts;
      };
      const pieces = [
        arc(0, 0.2, 3.6, 1.7, Math.PI * 0.05, Math.PI * 0.95, 8), // upper lip
        arc(0, 0.1, 3.6, 1.9, Math.PI * 1.05, Math.PI * 1.95, 8), // lower lip
        [V(-1.5, -0.6, 0.1), V(-1.7, -2.6, 0.1), V(-1.2, -4.2, 0.1)], // tongue left edge
        [V(1.5, -0.6, 0.1), V(1.8, -2.4, 0.1), V(1.4, -4.1, 0.1)], // tongue right edge
        arc(0.1, -4.2, 1.3, 0.9, Math.PI * 1.0, Math.PI * 2.0, 6), // tongue tip
        [V(0, -0.7, 0.15), V(0.05, -2.4, 0.15), V(0.2, -3.6, 0.15)], // tongue centre line
      ];
      const fxP = [];
      const fxD = [];
      pieces.forEach((pts) => {
        const c = pts.reduce((a, p) => a.add(p), V(0, 0, 0)).multiplyScalar(1 / pts.length);
        const pp = pivot(c.x, c.y, 0);
        addAxes(28, 'rotation', pp, ['y']);
        const fp = pivot();
        fxP.push(fp);
        fxD.push(V(c.x, c.y + 1, 0.4).normalize());
        const segs = [];
        for (let i = 0; i < pts.length - 1; i++) segs.push([pts[i].clone().sub(c), pts[i + 1].clone().sub(c), r]);
        G[28].lights.push(chainTubes(rig, [lg, pp, fp], glow, segs));
      });
      fx[28] = new FxOffsets(fxP, fxD, 3);
      fx[42] = fxNone(6);
      fx[43] = fxNone(6);
    }

    // ---- splinters: 6 big shards, global translation (38) → local (30) → fx
    {
      const fxP = [];
      const fxD = [];
      for (let i = 0; i < 6; i++) {
        const s = i % 2 ? 1 : -1;
        const gp = pivot(s * (5 + R() * 5), 9 + R() * 9, -30 - i * 12);
        addAxes(38, 'translation', gp);
        const lp = pivot();
        addAxes(30, 'rotation', lp, ['y', 'z']);
        addAxes(30, 'translation', lp, ['y', 'z']);
        const fp = pivot();
        fxP.push(fp);
        fxD.push(V(s, 0.5, 0).normalize());
        G[30].lights.push(rig.light([gp, lp, fp], shards, mat(0, 0, 0, R() * 3, R() * 3, R() * 3, 1.8, 4.6, 1.8)));
      }
      fx[30] = new FxOffsets(fxP, fxD, 4);
    }

    // ---- floor lasers
    G[35].lights.push(glow.tube(V(-1.7, 0.03, 0.5), V(-1.7, 0.03, -140), 0.035));
    G[36].lights.push(glow.tube(V(1.7, 0.03, 0.5), V(1.7, 0.03, -140), 0.035));
    G[44].lights.push(glow.tube(V(-2.6, -2.2, 0.5), V(-2.6, -2.2, -140), 0.05));
    G[45].lights.push(glow.tube(V(2.6, -2.2, 0.5), V(2.6, -2.2, -140), 0.05));
    for (const [s, g] of [[-1, 40], [1, 41]]) {
      for (let i = 0; i < 6; i++) G[g].lights.push(tubes(glow, [[V(s * 1.45, 0.02, -2 - i * 12), V(s * 1.45, 0.02, -11 - i * 12), 0.03]]));
    }
    // floor below block (39): a dark block under the runway that moves up / down
    {
      const p = pivot(0, -1.4, -40);
      G[39].translation.y.push(p);
      rig.attach(p, props, mat(0, 0, 0, 0, 0, 0, 3, 2.4, 80));
      G[39].count = 1;
    }

    // ambient: tints the column material
    const ambient = new AmbientLight([colMat], 0.05);

    finishGroups(G);
    rig.update(true);
    return {
      root,
      banks: [...glow.banks, shards, slabs, props],
      groups: { 6: [ambient] },
      lightGroups: applyMirrors(G, MIRROR),
      fx,
      background: 0x0a0616,
      fog: { color: 0x150b26, near: 30, far: 170 },
      update() {
        rig.update();
      },
      dispose() {
        glow.dispose();
        for (const b of [shards, slabs]) {
          b.mesh.material.dispose();
          b.dispose();
        }
        props.dispose();
        for (const o of owned) o.dispose();
      },
    };
  },
};
