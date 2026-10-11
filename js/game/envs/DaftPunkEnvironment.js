// Daft Punk environment (Daft Punk music pack) — our own recreation from simple shapes (no game
// assets). Look: a starry void; the two robot helmets float above the runway in front of two big
// walls of glowing triangles (a pyramid-like tri wall split left / right); rows of tall and
// diagonal lasers stand on dark side platforms, floor lasers fan out sideways, outlined light tiles
// line the runway, and four huge thin orbit rings, each carrying four ringed stars, circle the scene.
//
// v3 light groups (id → what, elements, axes). Element order: near → far / inner → outer (approx.)
//   0 / 1    Tris Wall Left / Right                75 each  trans z (each triangle pops out)
//   2–5      Lasers Top Sideset 01 L, 02 L, 01 R, 02 R   12 each  rot x z (01 upright, 02 slanted)
//   6–9      Lasers Bottom Sideset 01 L, 02 L, 01 R, 02 R 12 each rot x z (floor lasers fanning out)
//   10 / 11  Lasers Top Wall L / R                  5 each  (beams up from the tri walls)
//   12 / 13  Lasers Bottom Wall L / R               5 each  (beams down from the tri walls)
//   14–17    Orbit 1–4                              1 each  rot x y z, trans x y z (orbit ring)
//   18       Runway Middle                         32       trans x y (tiles beside the runway, L/R alternating)
//   19 / 20  Visor 01 / 02 Spectrogram         17 / 19      (bars on the visors)
//   21 / 22  Visor 01 / 02 Text                     1 each  (text strip; the text itself is not shown)
//   23 / 24  Helmet 01 / 02                         1 each  rot x y z, trans x y z, fx (accepted)
//   25 / 26  Runway Left / Right                   16 each  trans x y (outer tiles)
//   27       Background Stars                       3       (three star fields)
//   28–43    Orbit n Star k (n, k = 1–4)            4 each  (star core + three rings)
//   44–47    Orbit 1–4 Stars Transform              4 each  rot y z (star k's position on the orbit)
//   48–55    Visor 01 / 02 Offset / Padding X / Y   fx only (value controls; accepted, not shown)
// Basic events: 6 = ambient light (tints the platforms). Helmet switches / texts (40–43) are not
// shown (both helmets are always there).
// Sources (facts only): group names — KivalEvan/BeatSaber-JSMap (MIT); element counts and axes —
// index filters / axes in ~40 BeatSaver maps for this environment; GLS objects, look and colours —
// BSMG wiki environment list + preview image, Steam store screenshots, ArcViewer colour table.
// Approximate: all positions / sizes, helmet shapes, tile layout (the middle tiles sit beside the
// game's runway instead of under it), star element meaning; the scheme's extra white light colours
// (#7acfff, boost #ffd57c) are not part of the module colour format.
import { THREE, GEO, GlowBank, LightBank, PropBank, Rig, V, stdMat, rng, softLightMaterial, glowDiscGeometry, MultiLight, mergeAll, applyMirrors } from './kit.js';
import { LG, finishGroups, pivot, chainTubes, AmbientLight, fxNone, ringGeometry, arcSegs, mat } from './_v3lg.js';

const D2R = Math.PI / 180;
const AX = ['x', 'y', 'z'];

// Mirror flags (CONTRACT.md "Handedness"): lower case = rotation axes, upper case = translation
// axes whose event value the runtime negates, so that each group turns / moves the way Beat Saber's
// does with our pivots' orientation. Derived per element from the game's environment data (world
// rotation axis / translation direction of a +1 event in ChroMapper's UGEcko export) against ours;
// real maps send the same values to both groups of most left / right pairs, which then mirror.
const MIRROR = { 2: 'xz', 3: 'z', 4: 'x', 7: 'x', 8: 'z', 9: 'xz', 14: 'xyZ', 15: 'xyZ', 16: 'xyZ',
  17: 'xyZ', 23: 'xXZ', 24: 'xyZ', 25: 'X', 44: 'yz', 45: 'yz', 46: 'yz', 47: 'yz' };

export default {
  name: 'DaftPunkEnvironment',
  label: 'Daft Punk',
  colors: {
    left: '#b83a2e',
    right: '#1fb2b0',
    envLeft: '#ffb340',
    envRight: '#8554d1',
    envLeftBoost: '#db007a',
    envRightBoost: '#00d1cd',
    wall: '#9b00ff',
    envWhite: '#7ACFFF', // the game's white light colour (used when the map has none)
    envWhiteBoost: '#FFD57C',
  },
  build() {
    const root = new THREE.Group();
    root.name = 'DaftPunkEnvironment';
    const rig = new Rig(root);
    const R = rng(1993);
    const owned = [];
    const own = (x) => (owned.push(x), x);

    const glow = new GlowBank(root, GEO.tube, 320, { haloScale: 3, haloOpacity: 0.15 });
    const triGeo = own(new THREE.CircleGeometry(1, 3, Math.PI / 2));
    const tris = new LightBank(root, triGeo, 150);
    // outlined tile: a flat rectangular frame (merged thin boxes), lying on the floor
    const frameParts = [];
    for (const [x, z, w, d] of [[0, 0.47, 1, 0.06], [0, -0.47, 1, 0.06], [0.47, 0, 0.06, 1], [-0.47, 0, 0.06, 1]]) {
      const b = new THREE.BoxGeometry(w, 0.02, d);
      b.translate(x, 0, z);
      frameParts.push(b);
    }
    const tiles = new LightBank(root, own(mergeAll(frameParts)), 64);
    const boxes = new LightBank(root, GEO.box, 160);
    const starCore = new LightBank(root, own(glowDiscGeometry(16, 0.3)), 16, { material: softLightMaterial() });
    const starRing = new LightBank(root, own(ringGeometry(0.9, 1, 24)), 48);
    const helmetMat = own(stdMat(0x15151c, { roughness: 0.25, metalness: 0.85 }));
    const helmetGeo = own(new THREE.SphereGeometry(1, 14, 10));
    const helmets = new PropBank(root, helmetGeo, helmetMat, 2);

    const G = {};
    for (let i = 0; i <= 55; i++) G[i] = LG();
    const fx = {};

    // ---- tri walls: 5 rows × 15 alternating triangles per side, each on a z-translation pivot
    const TZ = -50;
    for (const [s, g] of [[-1, 0], [1, 1]]) {
      for (let r = 0; r < 5; r++) {
        for (let c = 0; c < 15; c++) {
          const up = (c + r) % 2 === 0;
          const x = s * (1.6 + (4 - r) * 0.55 + c * 0.95);
          const y = 0.9 + r * 1.55;
          const p = pivot(x, y + (up ? 0 : 0.5), TZ);
          G[g].translation.z.push(p);
          G[g].lights.push(rig.light(p, tris, mat(0, 0, 0, 0, 0, up ? 0 : Math.PI, 0.82)));
        }
      }
      // wall lasers: up (10 / 11) and down (12 / 13) from the wall's outer half
      for (let k = 0; k < 5; k++) {
        const x = s * (3 + k * 3);
        G[10 + (s > 0 ? 1 : 0)].lights.push(glow.tube(V(x, 8.4, TZ - 0.5), V(x + s * k * 3, 70, TZ - 20), 0.04));
        G[12 + (s > 0 ? 1 : 0)].lights.push(glow.tube(V(x, 0.6, TZ - 0.5), V(x + s * k * 3, -40, TZ - 15), 0.04));
      }
    }

    // ---- side lasers: top sidesets on the platforms, bottom sidesets fanning over the floor
    const sideset = (g, s, slant, top) => {
      for (let k = 0; k < 12; k++) {
        const z = -6 - k * 6.5;
        if (top) {
          const p = pivot(s * 11, 1.5, z);
          G[g].rotation.x.push(p);
          G[g].rotation.z.push(p);
          const d = slant ? V(-s * 0.55, 1, -0.15) : V(0, 1, 0);
          G[g].lights.push(rig.tube(p, glow, V(0, 0, 0), d.normalize().multiplyScalar(45), 0.05));
        } else {
          const p = pivot(s * 2.4, -0.2, z - (slant ? 3 : 0));
          G[g].rotation.x.push(p);
          G[g].rotation.z.push(p);
          const d = slant ? V(s, 0, 0.55) : V(s, 0.02, -0.35);
          G[g].lights.push(rig.tube(p, glow, V(0, 0, 0), d.normalize().multiplyScalar(40), 0.035));
        }
      }
    };
    sideset(2, -1, false, true);
    sideset(3, -1, true, true);
    sideset(4, 1, false, true);
    sideset(5, 1, true, true);
    sideset(6, -1, false, false);
    sideset(7, -1, true, false);
    sideset(8, 1, false, false);
    sideset(9, 1, true, false);

    // ---- runway tiles (middle: beside the runway, alternating left / right; outer: left / right)
    for (let i = 0; i < 32; i++) {
      const s = i % 2 ? 1 : -1;
      const p = pivot(s * 1.75, 0.01, -3 - Math.floor(i / 2) * 2.6);
      G[18].translation.x.push(p);
      G[18].translation.y.push(p);
      G[18].lights.push(rig.light(p, tiles, mat(0, 0, 0, 0, 0, 0, 0.7, 1, 2.2)));
    }
    for (const [s, g] of [[-1, 25], [1, 26]]) {
      for (let i = 0; i < 16; i++) {
        const p = pivot(s * 3.1, 0.01, -3 - i * 5.2);
        G[g].translation.x.push(p);
        G[g].translation.y.push(p);
        G[g].lights.push(rig.light(p, tiles, mat(0, 0, 0, 0, 0, 0, 1.5, 1, 4.6)));
      }
    }

    // ---- helmets
    const helmet = (g, x, gSpec, nSpec, gText, second) => {
      const p = pivot(x, 8, -30);
      for (const ax of AX) {
        G[g].rotation[ax].push(p);
        G[g].translation[ax].push(p);
      }
      rig.attach(p, helmets, mat(0, 0, 0, 0, 0, 0, 2.2, 2.5, 2.3));
      const r = 0.06;
      const segs = arcSegs(V(0, 0, 1.9), 2.35, -20 * D2R, 200 * D2R, 14, r);
      if (!second) {
        // Thomas: one wide visor band across the face
        segs.push([V(-2.1, 0.35, 1.85), V(2.1, 0.35, 1.85), r], [V(-2.1, -0.75, 1.85), V(2.1, -0.75, 1.85), r]);
        segs.push([V(-0.7, -1.6, 2.0), V(0.7, -1.6, 2.0), r]);
      } else {
        // Guy-Manuel: a rounded face visor outline
        segs.push(...arcSegs(V(0, 0.1, 2.05), 1.5, 200 * D2R, 340 * D2R, 8, r));
        segs.push([V(-1.41, -0.41, 2.05), V(-1.1, 1.3, 2.05), r], [V(1.41, -0.41, 2.05), V(1.1, 1.3, 2.05), r]);
        segs.push([V(-1.1, 1.3, 2.05), V(1.1, 1.3, 2.05), r]);
      }
      G[g].lights.push(chainTubes(rig, [p], glow, segs));
      for (let i = 0; i < nSpec; i++) {
        const x0 = -1.6 + (3.2 * (i + 0.5)) / nSpec;
        G[gSpec].lights.push(rig.light(p, boxes, mat(x0, second ? 0.25 : -0.2, 2.15, 0, 0, 0, 0.09, 0.55, 0.05)));
      }
      G[gText].lights.push(rig.light(p, boxes, mat(0, second ? -0.35 : 0.0, 2.17, 0, 0, 0, 2.6, 0.12, 0.04)));
    };
    helmet(23, -4.2, 19, 17, 21, false);
    helmet(24, 4.2, 20, 19, 22, true);
    fx[23] = fxNone(1);
    fx[24] = fxNone(1);
    for (let i = 48; i <= 55; i++) fx[i] = fxNone(1);

    // ---- orbits: ring on a pivot; 4 star pivots (44–47) turn the stars along the ring
    const ORB = [[24, 20, 10], [30, -14, -25], [36, 32, 40], [44, -6, 70]];
    ORB.forEach(([rad, tiltX, tiltZ], n) => {
      const op = pivot(0, 9, -55, tiltX * D2R, 0, tiltZ * D2R);
      for (const ax of AX) {
        G[14 + n].rotation[ax].push(op);
        G[14 + n].translation[ax].push(op);
      }
      G[14 + n].lights.push(chainTubes(rig, [op], glow, arcSegs(V(0, 0, 0), rad, 0, Math.PI * 2, 32, 0.035)));
      for (let k = 0; k < 4; k++) {
        const sp = pivot(0, 0, 0, 0, 0, (k * 90 + n * 30 + 20) * D2R);
        for (const ax of ['y', 'z']) G[44 + n].rotation[ax].push(sp); // the game has no x axis here
        const g = 28 + n * 4 + k;
        // undo the orbit tilt so the star faces the player
        const face = mat(rad, 0, 0, -tiltX * D2R, 0, 0, 1);
        const L = [rig.light([op, sp], starCore, mat(rad, 0, 0, 0, 0, 0, 1.1).multiply(new THREE.Matrix4().makeRotationX(-tiltX * D2R)))];
        for (const sc of [1.5, 2.2, 3.1]) L.push(rig.light([op, sp], starRing, face.clone().multiply(new THREE.Matrix4().makeScale(sc, sc, 1))));
        G[g].lights.push(...L);
      }
    });

    // ---- background stars: three fields of tiny lights
    for (let f = 0; f < 3; f++) {
      const L = new MultiLight();
      for (let i = 0; i < 30; i++) {
        const a = R() * Math.PI * 2;
        const e = 0.05 + R() * 1.2;
        const d = 150 + R() * 40;
        const x = Math.cos(a) * Math.cos(e) * d;
        const z = -Math.abs(Math.sin(a)) * Math.cos(e) * d - 20;
        L.push(boxes.add(mat(x, Math.sin(e) * d * 0.7, z, R(), R(), R(), 0.35 + R() * 0.35)));
      }
      G[27].lights.push(L);
    }

    // ---- static scenery: dark floor and side platforms
    const floorMat = own(stdMat(0x07070d, { roughness: 0.3, metalness: 0.7 }));
    const platMat = own(stdMat(0x101018, { roughness: 0.6, metalness: 0.4 }));
    const fl = new THREE.PlaneGeometry(22, 170);
    fl.rotateX(-Math.PI / 2);
    fl.translate(0, -0.25, -75);
    const plats = [];
    for (const s of [-1, 1]) {
      const b = new THREE.BoxGeometry(30, 3, 170);
      b.translate(s * 26, 0, -75);
      plats.push(b);
    }
    const floor = new THREE.Mesh(mergeAll([fl]), floorMat);
    const platforms = new THREE.Mesh(mergeAll(plats), platMat);
    for (const m of [floor, platforms]) {
      m.matrixAutoUpdate = false;
      root.add(m);
    }

    const ambient = new AmbientLight([platMat, floorMat], 0.025);
    finishGroups(G);
    rig.update(true);
    return {
      root,
      banks: [...glow.banks, tris, tiles, boxes, starCore, starRing, helmets],
      groups: { 6: [ambient] },
      lightGroups: applyMirrors(G, MIRROR),
      fx,
      background: 0x020208,
      update() {
        rig.update();
      },
      dispose() {
        glow.dispose();
        for (const b of [tris, tiles, boxes, starCore, starRing]) {
          b.mesh.material.dispose();
          b.dispose();
        }
        helmets.dispose();
        floor.geometry.dispose();
        platforms.geometry.dispose();
        for (const o of owned) o.dispose();
      },
    };
  },
};
