// Panic! at the Disco 2 environment (v3 group lighting; the "updated" Panic! levels) — our own
// recreation from simple shapes, no game assets.
// Look: a dark void. Huge double-pyramid "cones" outlined in neon hang over the track (bottom tips just
// above it), each can swing around the track axis; slanted spectrogram bars rise out of the abyss on
// both sides (in front of and behind the player), rings of glowing diamonds orbit the track, fans of
// main lasers shoot up from above it, neon lines run along the runway, two tall stained-glass
// windows lean over its far part and neon columns stand behind the player.
//
// Light groups (id → what, elements, rotation / translation axes). Element order = official order.
//   0  Left Cones Local ...... 7  side cones (z = 20 … 128, near → far): their 8 neon edges
//                                  rotation y, z (mirror z); translation y (±15)
//   1  Right Cones Local ..... 7  same set for the right (rotation mirror y)
//   2  Left Cones Global (no light)  7  swing of the left cones around the track axis   rotation z;
//                                  translation z (±15)
//   3  Right Cones Global (no light) 7  same, right (rotation mirror z)
//   4  Center Cones Local .... 8  centre cones (z = 17 … 143)   rotation y, z (mirror z); translation y
//   5  Center Cones Global (no light) 8  rotation z (mirror z), translation z
//   6  Diamond Rings Local Left  24  diamonds left of the track (z = 5 … 62.5)   rotation y, z (mirror z)
//   7  Diamond Rings Local Right 24  same, right (rotation mirror y)
//   8  Diamond Rings Global (no light) 24  each left / right diamond pair around the track axis
//                                  rotation z (mirror z), translation z (±10)
//   9  Lasers Bottom Left .... 6  main lasers above the track (z = 22.8 … 72.8) rotation y, z;
//                                  translation x, y (±10)
//   10 Lasers Bottom Right ... 6  (rotation mirror y, z; translation mirror x)
//   11 Lasers Top Left ....... 6  12 Lasers Top Right (mirror y, z / x)
//   13 Runway Lasers Left .... 14 12 m neon segments along the left runway edge, near → far
//   14 Runway Lasers Right ... 14 same, right
//   15 Runway Inner Laser .... 2  two long lines on the track (x = ∓0.6)
//   16 Spectrogram Left ...... 28 slanted bars left of the track: element k lights the k-th bar ahead of
//                                  the player and its mirror image behind (gaps growing with distance)
//   17 Spectrogram Right ..... 28 same, right
//   18 Runway Lasers Left Transform Z (no light)  1   translation z (±50)
//   19 Runway Lasers Right Transform Z (no light) 1
//   20 Window Left Pieces .... 12 panes of the left window (3 × 4, top → bottom)
//   21 Window Left Aura ...... 1  its neon outline
//   22 Window Right Pieces ... 12 23 Window Right Aura ... 1
// Basic events: 3 ambient (the neon columns behind the player + haze), 4 player platform glow,
// 5 colour boost.
//
// Sources (facts only — ids, names, counts, order, positions, axes, limits, default colours): the
// environment's scene data in ChroMapper (github.com/Caeden117/ChroMapper, dev branch,
// Assets/__Scenes/Environments/Data/Panic2Environment.json); ArcViewer's colour table; gameplay
// videos / thumbnails for the look.
// Approximate: cone, diamond, window and bar shapes, the dark structures (back columns, the
// "bottom cones" mass under the track), the pane layout of the windows (the original lights 12
// pieces of one mesh through a colour array).
import { THREE, GEO, SoftGlow, stdMat } from './kit.js';
import { Builder, node, mat, boxGeo, group, scheme, multi } from './_v3b.js';

const SPEC_Z = [8, 11.1, 14.2, 17.6, 21, 24.6, 28.3, 32.1, 36.1, 40.3, 44.6, 49, 53.7, 58.5, 63.4, 68.6, 73.9, 79.4, 85.1, 91, 97.2, 103.5, 110, 116.8, 123.8, 131, 138.5, 146.3];

export default {
  name: 'Panic2Environment',
  label: 'Panic! 2',
  colors: scheme({
    left: [0.902, 0.333, 0.569],
    right: [0.153, 0.557, 0.486],
    envLeft: [0.698, 0.114, 0.373],
    envRight: [0.188, 0.62, 0.624],
    envWhite: [0.833, 0.901, 0.925],
    wall: [0.969, 0.38, 0.275],
    envLeftBoost: [0.902, 0.447, 0.067],
    envRightBoost: [0.637, 0.437, 0.858],
  }),
  build() {
    const B = new Builder('Panic2Environment');
    const u = B.u;
    const V = (x, y, z) => [x, y, z];
    const tube = B.glow(GEO.tube, 640, { haloScale: 3, haloOpacity: 0.16 });
    const glass = B.bank(GEO.plane, 30, { opacity: 0.55 });
    const octa = B.own(new THREE.OctahedronGeometry(1, 0));
    const gems = B.glow(octa, 48, { haloOpacity: 0.18 });
    const dark = stdMat(0x0b0a10, { roughness: 0.4, metalness: 0.6, flat: true });
    const bars = B.props(GEO.box, stdMat(0x18161f, { roughness: 0.35, metalness: 0.6 }), 112);
    const coneGeo = B.own(new THREE.ConeGeometry(1, 1, 4, 1, true).rotateY(Math.PI / 4));
    const cones = B.props(coneGeo, dark, 44);
    const lg = {};

    // ---- cones (0 – 5): global swing (rotation z around the track axis, translation z) →
    // local translation y → local rotation y → local rotation z → body + 8 edges
    const cone = (zc) => {
      const g = node(u, [0, 0, zc]); // CenterRotationZ + global translation z
      const ly = node(g, [0, 59, 0]); // local translation y
      const ry = node(ly);
      const rz = node(ry);
      // bodies: lower pyramid (tip at y = 6.5) and upper pyramid (tip at y = 111.5), 16 × 8 at y = 59
      B.prop(rz, cones, mat([0, -26.25, 0], [180, 0, 0], [11.3, 52.5, 5.7]));
      B.prop(rz, cones, mat([0, 26.25, 0], [0, 0, 0], [11.3, 52.5, 5.7]));
      const parts = [];
      for (const [cx, cz] of [[8, 4], [-8, 4], [8, -4], [-8, -4]]) {
        parts.push(B.tube(rz, tube, V(0, -52.6, 0), V(cx * 1.0, 0, cz * 1.0), 0.1, 2.5));
        parts.push(B.tube(rz, tube, V(0, 52.6, 0), V(cx * 1.0, 0, cz * 1.0), 0.1, 2.5));
      }
      return { g, ly, ry, rz, light: multi(...parts) };
    };
    const coneSet = (zs, localId, globalId, mirLocal, mirGlobal) => {
      const C = zs.map(cone);
      lg[localId] = group(C.map((c) => c.light), { rot: { y: C.map((c) => c.ry), z: C.map((c) => c.rz), mirror: mirLocal }, tr: { y: C.map((c) => c.ly) } });
      lg[globalId] = group([], { count: C.length, rot: { z: C.map((c) => c.g), mirror: mirGlobal }, tr: { z: C.map((c) => c.g) } });
    };
    const sideZ = [20.1, 38.1, 56.1, 74.1, 92.1, 110.1, 128.1];
    coneSet(sideZ, 0, 2, { z: true }, {});
    coneSet(sideZ, 1, 3, { y: true }, { z: true });
    coneSet([17, 35, 53, 71, 89, 107, 125, 143], 4, 5, { z: true }, { z: true });

    // ---- diamond rings (6 – 8)
    {
      const glob = [];
      const loc = { [-1]: { L: [], y: [], z: [] }, [1]: { L: [], y: [], z: [] } };
      for (let k = 0; k < 24; k++) {
        const g = node(u, [0, 0, 5 + 2.5 * k]);
        glob.push(g);
        for (const s of [-1, 1]) {
          const ry = node(g, [s * 5, 0, 0]);
          const rz = node(ry);
          const o = loc[s];
          o.y.push(ry);
          o.z.push(rz);
          o.L.push(multi(
            B.light(rz, gems, mat([0, 0, 0], [0, 0, 0], [0.28, 1.42, 0.28]), mat([0, 0, 0], [0, 0, 0], [0.7, 2.2, 0.7])),
            B.tube(rz, tube, V(0, 1.4, 0), V(0, 2.8, 0), 0.03, 3),
            B.tube(rz, tube, V(0, -1.4, 0), V(0, -2.8, 0), 0.03, 3),
          ));
        }
      }
      lg[6] = group(loc[-1].L, { rot: { y: loc[-1].y, z: loc[-1].z, mirror: { z: true } } });
      lg[7] = group(loc[1].L, { rot: { y: loc[1].y, z: loc[1].z, mirror: { y: true } } });
      lg[8] = group([], { count: 24, rot: { z: glob, mirror: { z: true } }, tr: { z: glob } });
    }

    // ---- main lasers (9 – 12)
    for (const [id, mirror, trMirror] of [[9, {}, {}], [10, { y: true, z: true }, { x: true }], [11, {}, {}], [12, { y: true, z: true }, { x: true }]]) {
      const ry = [];
      const rz = [];
      const L = [];
      for (let k = 0; k < 6; k++) {
        const base = node(u, [0, 18.4, 22.8 + 10 * k]);
        const tz = node(base);
        ry.push(base);
        rz.push(tz);
        L.push(B.tube(tz, tube, V(0, 0, 0), V(0, 125, 0), 0.05, 2.5));
      }
      lg[id] = group(L, { rot: { y: ry, z: rz, mirror }, tr: { x: ry, y: ry, mirror: trMirror } });
    }

    // ---- runway lasers (13, 14, 18, 19) and inner lines (15)
    for (const [s, id, trId] of [[-1, 13, 18], [1, 14, 19]]) {
      const w = node(u, [0, 0, 0]);
      const L = [];
      for (let k = 0; k < 14; k++) {
        const z = 7.8 + 12 * k;
        L.push(B.tube(w, tube, V(s * 1.3, 0.02, z - 5.9), V(s * 1.3, 0.02, z + 5.9), 0.025, 3));
      }
      lg[id] = group(L);
      lg[trId] = group([], { count: 1, tr: { z: [w] } });
    }
    lg[15] = group([-0.6, 0.6].map((x) => B.tube(null, tube, V(x, 0.02, 8), V(x, 0.02, 158), 0.02, 2.5)));

    // ---- spectrogram bars (16, 17): slanted bars rising out of the abyss, ahead and behind
    for (const [s, id] of [[-1, 16], [1, 17]]) {
      const L = [];
      for (const z of SPEC_Z) {
        const parts = [];
        for (const zz of z === 8 ? [8] : [z, 16 - z]) {
          const a = V(s * 0.6, -29, zz);
          const b = V(s * 10.1, 0.3, zz);
          const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, zz];
          const ang = Math.atan2(b[0] - a[0], b[1] - a[1]); // tilt from vertical toward x
          B.prop(null, bars, mat(mid, [0, 0, (-ang * 180) / Math.PI], [1.25, 30.6, 1.25]));
          parts.push(B.tube(null, tube, V(a[0] + s * 0.4, a[1], zz - 0.7), V(b[0] + s * 0.4, b[1], zz - 0.7), 0.08, 3));
          parts.push(B.tube(null, tube, V(b[0] - s * 0.9, b[1] - 1.6, zz), V(b[0] + s * 0.3, b[1] + 1.4, zz), 0.2, 2.2));
        }
        L.push(multi(...parts));
      }
      lg[id] = group(L);
    }

    // ---- windows (20 – 23): two tall leaning windows over the far part of the track
    for (const [s, piecesId, auraId] of [[-1, 20, 21], [1, 22, 23]]) {
      const w = node(u, [s * 2.5, 7, 68], [340, 0, 0]);
      const P = [];
      for (let r = 0; r < 4; r++) {
        for (let c = 0; c < 3; c++) {
          const x = (c - 1) * 1.45;
          const y = 3.0 - r * 1.95;
          P.push(B.light(w, glass, mat([x, y, 0], [0, 0, 0], [1.3, 1.8, 1])));
        }
      }
      lg[piecesId] = group(P);
      const pts = [[-2.3, -4.7], [-2.3, 2.6], [-1.3, 4.0], [0, 4.7], [1.3, 4.0], [2.3, 2.6], [2.3, -4.7], [-2.3, -4.7]];
      const parts = [];
      for (let i = 0; i < pts.length - 1; i++) parts.push(B.tube(w, tube, V(pts[i][0], pts[i][1], -0.05), V(pts[i + 1][0], pts[i + 1][1], -0.05), 0.07, 3));
      lg[auraId] = group([multi(...parts)]);
    }

    // ---- static dark structures: back columns behind the player, mass under the track
    {
      const geos = [];
      for (const s of [-1, 1]) {
        for (let i = 0; i < 5; i++) geos.push(boxGeo([s * (4.5 + i * 2.2), -60 + i * 6, -24 - i * 3], [1.8, 200, 1.8], [-20, 0, 0]));
      }
      geos.push(boxGeo([0, -48, 45], [10, 40, 70], [0, 45, 0]));
      geos.push(boxGeo([0, -1.2, 80], [2.4, 2.2, 160]));
      B.merge(geos, stdMat(0x0d0b12, { roughness: 0.5, metalness: 0.5, flat: true }));
    }

    // ---- basic events: 3 ambient (back neon columns + haze), 4 platform glow
    const haze = new SoftGlow(B.root, 520, 260, new THREE.Vector3(0, 40, -220), { gain: 0.22, power: 1.5 });
    B.owned.push(haze);
    const groups = {
      3: [multi(
        B.tube(null, tube, V(3, 0.2, -21.7), V(3, 0.2 + 100 * Math.cos(20 * Math.PI / 180) * 0.5, -21.7 - 100 * Math.sin(20 * Math.PI / 180) * 0.5), 0.1, 3),
        B.tube(null, tube, V(-3, 0.2, -21.7), V(-3, 0.2 + 100 * Math.cos(20 * Math.PI / 180) * 0.5, -21.7 - 100 * Math.sin(20 * Math.PI / 180) * 0.5), 0.1, 3),
        haze,
      )],
      4: [multi(
        B.tube(null, tube, V(-1.5, 0.01, -1), V(1.5, 0.01, -1), 0.02, 3),
        B.tube(null, tube, V(-1.5, 0.01, 1), V(1.5, 0.01, 1), 0.02, 3),
        B.tube(null, tube, V(-1.5, 0.01, -1), V(-1.5, 0.01, 1), 0.02, 3),
        B.tube(null, tube, V(1.5, 0.01, -1), V(1.5, 0.01, 1), 0.02, 3),
      )],
    };

    return B.finish({
      groups,
      lightGroups: lg,
      background: 0x050309,
      fog: { color: 0x07040c, near: 40, far: 280 },
    });
  },
};
