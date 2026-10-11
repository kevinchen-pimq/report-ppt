// Imagine Dragons 2 environment (v3 group lighting; the "updated" Imagine Dragons levels) — our own
// recreation from simple shapes, no game assets.
// Look: a vast dark construction hall. The track runs through 24 small rings (two rotating panels
// each, with short beams pointing out and in) inside 15 huge rings carrying four tangent neon tubes,
// a row of stage spotlights hangs over the track, a grid of 35 tall pillars rises and sinks below
// it, two double runway strips line the track, sparkle emitters and two fans of main lasers stand
// left and right, and long glow lines run below the track.
//
// Light groups (id → what, elements, rotation / translation axes). Element order = official order.
//   0  Small Rings (no light) . 24  the small rings, near → far      rotation z (mirror z), translation z (±10)
//   1  Small Rings (lights) ... 96  per ring (near → far): 0–23 outward beam of the top panel,
//                                   24–47 outward beam of the bottom panel, 48–71 inward beam + panel
//                                   (top), 72–95 inward beam + panel (bottom)
//   2  Underground (no light) . 35  pillars below the track, rows of 5 (x = -7.4 … 7.4), near → far
//                                   translation y (±1)
//   3  Big Rings .............. 15  huge rings, near → far: the 4 tangent tubes (right, left, bottom,
//                                   top) of each   rotation z (mirror z), translation z (±10)
//   4  Top Spotlights ......... 8   spotlights over the track, near → far   rotation x, y
//   5  Runway Left ............ 12  strip segments left of the track: inner line near → far (6), then
//                                   outer line near → far (6)
//   6  Runway Right ........... 12  same, right
//   7  Particles Left ......... 5   sparkle emitters on a diagonal, top-inner → bottom-outer
//   8  Particles Right ........ 5   same, right
//   9  Main Lasers Bottom Left  5   laser fan at x = -8 (beams leave upward)   rotation x, y (mirror y)
//   10 Main Lasers Top Left ... 5   same spot, beams leave downward            rotation x, y (mirror x)
//   11 Main Lasers Top Right .. 5   x = +8, downward                           rotation x, y (mirror y)
//   12 Main Lasers Bottom Right 5   x = +8, upward                             rotation x, y (mirror x)
// Basic events: 0 / 1 inner glow lines left / right (below the track), 2 / 3 outer glow lines,
// 4 "Logo" (a small chevron of two tubes far over the track) + player platform glow, 6 ambient,
// 5 colour boost.
//
// Sources (facts only — ids, names, counts, order, positions, axes, limits, default colours): the
// environment's scene data in ChroMapper (github.com/Caeden117/ChroMapper, dev branch,
// Assets/__Scenes/Environments/Data/Dragons2Environment.json); ArcViewer's colour table; gameplay
// videos / thumbnails for the look.
// Approximate: the hall (pillars, beams and a few dim windows, procedural), panel / pillar shapes,
// particle emitters (static glowing dots instead of particles), the audio spectrograms (left out).
import { THREE, GEO, SoftGlow, rng, stdMat } from './kit.js';
import { Builder, node, mat, ringGeometry, boxGeo, group, scheme, multi } from './_v3b.js';

export default {
  name: 'Dragons2Environment',
  label: 'Imagine Dragons 2',
  colors: scheme({
    left: [0.726, 0.659, 0.281],
    right: [0.251, 0.765, 0.405],
    envLeft: [0.02, 0.996, 0.067],
    envRight: [0, 0.055, 1],
    envWhite: [0.725, 0.725, 0.725],
    wall: [0.555, 0.247, 1],
    envLeftBoost: [0.976, 0.031, 0.02],
    envRightBoost: [1, 0.829, 0.226],
  }),
  build() {
    const B = new Builder('Dragons2Environment');
    const u = B.u;
    const R = rng(2012);
    const V = (x, y, z) => [x, y, z];
    const tube = B.glow(GEO.tube, 400, { haloScale: 3, haloOpacity: 0.18 });
    const dots = B.glow(GEO.disc, 160, { haloOpacity: 0.25 });
    const metal = stdMat(0x14151a, { roughness: 0.5, metalness: 0.6 });
    const panels = B.props(GEO.box, metal, 48);
    const ringGeo = B.own(ringGeometry(0.016, 3, 64));
    const bigRings = B.props(ringGeo, stdMat(0x1a1b22, { roughness: 0.5, metalness: 0.5 }), 15);
    const pillars = B.props(GEO.box, stdMat(0x0f1014, { roughness: 0.8, metalness: 0.3 }), 35);
    const lg = {};

    // ---- small rings (0, 1)
    {
      const rings = [];
      const out = [[], []];
      const inn = [[], []];
      for (let k = 0; k < 24; k++) {
        const ring = node(u, [0, 1, 20 + 2.35 * k]);
        rings.push(ring);
        [1, -1].forEach((s, si) => {
          // panel at radius 4, outward beam (4 m) and inward beam (2 m)
          B.prop(ring, panels, mat([0, s * 4, 0], [0, 0, 0], [2, 0.3, 1]));
          out[si].push(B.tube(ring, tube, V(0, s * 4.14, 0), V(0, s * 8.1, 0), 0.03, 3));
          const dot = B.light(ring, dots, mat([0, s * 3.86, -0.52], [0, 0, 0], 0.09), mat([0, s * 3.86, -0.52], [0, 0, 0], 0.35));
          inn[si].push(multi(B.tube(ring, tube, V(0, s * 3.87, 0), V(0, s * 1.9, 0), 0.03, 3), dot, B.tube(ring, tube, V(-1, s * 3.84, -0.5), V(1, s * 3.84, -0.5), 0.02, 2)));
        });
      }
      lg[0] = group([], { count: 24, rot: { z: rings, mirror: { z: true } }, tr: { z: rings } });
      lg[1] = group([...out[0], ...out[1], ...inn[0], ...inn[1]]);
    }

    // ---- big rings (3)
    {
      const piv = [];
      const L = [];
      for (let k = 0; k < 15; k++) {
        const ring = node(u, [0, 5, 3.1 + 8 * k]);
        piv.push(ring);
        B.prop(ring, bigRings, mat([0, 0, 0], [90, 0, 0], 24.8));
        L.push(multi(
          B.tube(ring, tube, V(23.15, -3, 0), V(23.15, 3, 0), 0.07, 3),
          B.tube(ring, tube, V(-23.15, -3, 0), V(-23.15, 3, 0), 0.07, 3),
          B.tube(ring, tube, V(-3, -23.15, 0), V(3, -23.15, 0), 0.07, 3),
          B.tube(ring, tube, V(-3, 23.15, 0), V(3, 23.15, 0), 0.07, 3),
        ));
      }
      lg[3] = group(L, { rot: { z: piv, mirror: { z: true } }, tr: { z: piv } });
    }

    // ---- underground pillars (2)
    {
      const piv = [];
      for (let r = 0; r < 7; r++) {
        for (let c = 0; c < 5; c++) {
          const p = node(u, [-7.4 + 3.7 * c, -34.5, 12.5 + 4.2 * r]);
          piv.push(p);
          B.prop(p, pillars, mat([0, 0, 0], [0, 0, 0], [3.5, 55, 4]));
        }
      }
      lg[2] = group([], { count: 35, tr: { y: piv } });
    }

    // ---- top spotlights (4)
    {
      const ry = [];
      const rx = [];
      const L = [];
      const housing = [];
      for (let k = 0; k < 8; k++) {
        const z = 13.2 + 5.5 * k;
        const base = node(u, [0, 8.3, z], [0, 270, 180]);
        const src = node(base, [0, 0.9, 0]);
        ry.push(base);
        rx.push(src);
        housing.push(boxGeo([0, 9.2, z], [0.6, 1.6, 0.6]));
        // beam leaves downward (the base is rolled 180°): local +y
        L.push(B.tube(src, tube, V(0, 0, 0), V(0, 7.2, 0), 0.05, 3));
      }
      B.merge(housing, metal.clone());
      B.own(metal);
      lg[4] = group(L, { rot: { x: rx, y: ry } });
    }

    // ---- runway strips (5, 6)
    {
      const Z = [7.8, 12.9, 20.8, 33.3, 51.8, 83.8, 150];
      for (const [s, id] of [[-1, 5], [1, 6]]) {
        const L = [];
        for (const x of [1.9, 2.1]) for (let i = 0; i < 6; i++) L.push(B.tube(null, tube, V(s * x, 0.02, Z[i]), V(s * x, 0.02, Z[i + 1] - 0.8), 0.03, 3));
        lg[id] = group(L);
      }
    }

    // ---- particle emitters (7, 8)
    for (const [s, id] of [[-1, 7], [1, 8]]) {
      const L = [];
      for (let k = 0; k < 5; k++) {
        const x = s * (8.3 + 1.85 * k);
        const y = 11.2 - 2.1 * k;
        const parts = [];
        for (let j = 0; j < 6; j++) {
          const p = [x + (R() - 0.5) * 1.6, y + (R() - 0.5) * 1.6, 39 + (R() - 0.5) * 1.6];
          parts.push(B.light(null, dots, mat(p, [0, 0, 0], 0.07), mat(p, [0, 0, 0], 0.3)));
        }
        L.push(multi(...parts));
      }
      lg[id] = group(L);
    }

    // ---- main lasers (9 – 12)
    for (const [id, s, down, mirror] of [[9, -1, false, { y: true }], [10, -1, true, { x: true }], [11, 1, true, { y: true }], [12, 1, false, { x: true }]]) {
      const rx = [];
      const ry = [];
      const L = [];
      for (let k = 0; k < 5; k++) {
        const base = node(u, [s * 8, 4, 40 + k], [0, s < 0 ? (down ? 90 : 270) : (down ? 270 : 90), down ? 180 : 0]);
        const tx = node(base);
        ry.push(base);
        rx.push(tx);
        L.push(multi(B.tube(tx, tube, V(0, 0, 0), V(0, 125, 0), 0.05, 2.5), B.light(tx, dots, mat([0, 0, 0], [0, 0, 0], 0.15), mat([0, 0, 0], [0, 0, 0], 0.6))));
      }
      lg[id] = group(L, { rot: { x: rx, y: ry, mirror } });
    }

    // ---- the hall: side walls of pillars, ceiling beams, floor; a few dim windows
    {
      const geos = [];
      for (let z = -40; z <= 200; z += 16) {
        for (const s of [-1, 1]) {
          geos.push(boxGeo([s * 34, -12, z], [3, 72, 3]));
          geos.push(boxGeo([s * 48, -12, z + 8], [2, 72, 2]));
        }
        geos.push(boxGeo([0, 24, z], [100, 2.2, 2.4]));
      }
      for (const s of [-1, 1]) {
        geos.push(boxGeo([s * 30, 24, 80], [1.6, 2, 260]));
        geos.push(boxGeo([s * 62, -10, 80], [2, 70, 300]));
        geos.push(boxGeo([s * 34, -6, 80], [2, 1.2, 260]));
      }
      geos.push(boxGeo([0, 26, 80], [126, 1, 300]));
      B.merge(geos, stdMat(0x0c0d11, { roughness: 0.85, metalness: 0.25 }));
      const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 360), stdMat(0x060608, { roughness: 1, metalness: 0 }));
      floor.rotation.x = -Math.PI / 2;
      floor.position.set(0, -48, -80);
      B.add(floor);
      const win = new THREE.InstancedMesh(GEO.plane, new THREE.MeshBasicMaterial({ color: 0x8a7a3a, toneMapped: false }), 60);
      for (let i = 0; i < 60; i++) {
        const s = i % 2 ? 1 : -1;
        win.setMatrixAt(i, mat([s * 60.9, -30 + R() * 50, -30 + R() * 220], [0, 90, 0], [0.7 + R() * 1.2, 0.5 + R() * 0.6, 1]));
      }
      win.frustumCulled = false;
      u.add(win);
      B.own(win.material);
      B.owned.push({ dispose: () => win.dispose() });
    }

    // ---- basic events: glow lines (0 – 3), logo + platform (4), ambient (6)
    const groups = {
      0: [B.tube(null, tube, V(-4.5, -4.8, -150), V(-4.5, -4.8, 350), 0.1, 3)],
      1: [B.tube(null, tube, V(4.5, -4.8, -150), V(4.5, -4.8, 350), 0.1, 3)],
      2: [B.tube(null, tube, V(-19.4, -4.8, -150), V(-19.4, -4.8, 350), 0.1, 3)],
      3: [B.tube(null, tube, V(19.4, -4.8, -150), V(19.4, -4.8, 350), 0.1, 3)],
      4: [multi(
        B.tube(null, tube, V(-1.05, 4.0, 65), V(0, 4.75, 65), 0.1, 3),
        B.tube(null, tube, V(1.05, 4.0, 65), V(0, 4.75, 65), 0.1, 3),
        B.tube(null, tube, V(-1.5, 0.01, -1), V(1.5, 0.01, -1), 0.02, 3),
        B.tube(null, tube, V(-1.5, 0.01, 1), V(1.5, 0.01, 1), 0.02, 3),
      )],
    };
    const haze = new SoftGlow(B.root, 300, 160, new THREE.Vector3(0, 6, -230), { gain: 0.12, power: 1.5 });
    B.owned.push(haze);
    groups[6] = [haze];

    return B.finish({
      groups,
      lightGroups: lg,
      background: 0x030305,
      fog: { color: 0x040406, near: 40, far: 260 },
    });
  },
};
