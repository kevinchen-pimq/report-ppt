// Queen environment (v3 group lighting) — our own recreation from simple shapes, no game assets.
// Look: a starry black stage. Four giant vinyl records stand on each side of the track facing it
// (each made of four concentric pieces that spin and fan out), a glowing performer silhouette
// (three echo copies) stands at the far end, sixty tunnel pieces can fan out into rings around the
// track near the player, a circle of twenty lasers far ahead shoots beams toward the player, a ring
// of twelve spotlights shines down from high above, and rows of glowing bricks line the track.
//
// Light groups (id → what, elements, rotation / translation axes). Element order = official order.
//   0  Vinyls Left ........... 4  the left records, near → far   rotation x (spin); translation y, z (±10)
//   1–4 Vinyl Left 1–4 (no light) 4 each  the four pieces of left record 1 … 4 (outer → inner)
//                                  rotation z (mirror z)
//   5  Vinyls Right .......... 4  6–9 Vinyl Right 1–4 (no light): same, right (no mirror)
//   10 Tunnel Rings Wrapper .. 60 tunnel pieces (three rings of 20, ring by ring); at rest all sit at
//                                  the top of a 5 m circle just ahead of the player
//                                  rotation z (mirror z), translation y (±1), z (±5)
//   11 Distant Circular Lasers Z (no light) 1  the laser circle   rotation z, translation z (±10)
//   12 Distant Circular Lasers 20  lasers on a 5.4 m circle far ahead (clockwise from the top), beams
//                                  toward the player   rotation x (mirror x), y
//   13 Top Circular Lasers Rot Y (no light) 1  the spotlight ring   rotation y
//   14 Top Circular Lasers ... 12  spotlights on a 20 m circle high above, beams down   rotation x
//   15 Platform Lane Left .... 24  glowing bricks left of the track, near → far   translation y (±0.5), z (±3)
//   16 Platform Lane Right ... 24  same, right (translation mirror z)
//   17 Silhouette Contour .... 3  the three echo copies of the silhouette   translation y, z (±10)
// Basic events: 4 player platform glow, 6 ambient (haze), 5 colour boost, 40 (special event 0,
// "Silhouettes") picks the silhouette: 0–3 four performer poses, 4 a chevron (value mod 5).
//
// Sources (facts only — ids, names, counts, order, positions, axes, limits, default colours): the
// environment's scene data in ChroMapper (github.com/Caeden117/ChroMapper, dev branch,
// Assets/__Scenes/Environments/Data/QueenEnvironment.json); ArcViewer's colour table; gameplay
// videos / thumbnails for the look.
// Approximate: the silhouettes are generic stick-figure poses of our own (the original shows band
// members), which value picks which silhouette, the record pieces (concentric arcs), silhouette
// size, the sky stars, the platform deck.
import { THREE, GEO, SoftGlow, rng, stdMat } from './kit.js';
import { Builder, node, mat, group, scheme, multi, D2R } from './_v3b.js';

const VINYLS = [[17, 19], [16, 44], [15, 69], [14, 94]];
const BRICK_Z = [7.8, 8.9, 9.9, 11.1, 12.3, 13.5, 14.8, 16.2, 17.6, 19.1, 20.6, 22.3, 24, 25.8, 27.6, 29.6, 31.6, 33.7, 35.9, 38.2, 40.6, 43.1, 45.7, 48.4];

// silhouette poses as polylines in a 1 × 1 box (x -0.5 … 0.5, y 0 … 1): our own generic figures
const POSES = [
  // 0: arm raised high, legs apart
  [[[-0.12, 0], [0, 0.45], [0.12, 0]], [[0, 0.45], [0, 0.75]], [[0, 0.72], [0.18, 0.86], [0.24, 1]], [[0, 0.72], [-0.2, 0.6], [-0.3, 0.5]], [[-0.04, 0.8], [0, 0.86], [0.04, 0.8], [0, 0.75]]],
  // 1: player with a guitar across the body
  [[[-0.1, 0], [-0.02, 0.45], [0.08, 0]], [[-0.02, 0.45], [0, 0.75]], [[-0.22, 0.42], [0.3, 0.7]], [[0, 0.7], [0.14, 0.58]], [[0, 0.7], [-0.14, 0.5]], [[-0.04, 0.8], [0, 0.86], [0.04, 0.8], [0, 0.75]]],
  // 2: seated drummer with sticks, a drum in front
  [[[-0.2, 0.15], [-0.05, 0.3], [0.05, 0.5]], [[0.05, 0.5], [0.04, 0.68]], [[0.04, 0.65], [-0.2, 0.5], [-0.32, 0.62]], [[0.04, 0.65], [0.26, 0.52], [0.36, 0.66]], [[-0.3, 0.3], [0.3, 0.3], [0.3, 0.12], [-0.3, 0.12], [-0.3, 0.3]], [[0, 0.73], [0.04, 0.78], [0.08, 0.73], [0.04, 0.69]]],
  // 3: player with a long-necked bass held upright
  [[[-0.1, 0], [0, 0.45], [0.06, 0]], [[0, 0.45], [0, 0.75]], [[-0.15, 0.4], [0.12, 0.95]], [[0, 0.7], [0.08, 0.6]], [[0, 0.7], [-0.12, 0.48]], [[-0.04, 0.8], [0, 0.86], [0.04, 0.8], [0, 0.75]]],
  // 4: chevron
  [[[-0.45, 0.25], [0, 0.65], [0.45, 0.25]]],
];

export default {
  name: 'QueenEnvironment',
  label: 'Queen',
  colors: scheme({
    left: [0.58, 0.568, 0.555],
    right: [0.524, 0.135, 0.679],
    envLeft: [0.933, 0.639, 0.122],
    envRight: [0.043, 0.718, 0.898],
    envWhite: [0.725, 0.725, 0.725],
    wall: [0.933, 0.639, 0.122],
    envLeftBoost: [0.769, 0.145, 0.075],
    envRightBoost: [0.4, 0.008, 0.725],
  }),
  build() {
    const B = new Builder('QueenEnvironment');
    const u = B.u;
    const R = rng(1975);
    const V = (x, y, z) => [x, y, z];
    const tube = B.glow(GEO.tube, 520, { haloScale: 3, haloOpacity: 0.17 });
    const boxes = B.glow(GEO.box, 120, { haloOpacity: 0.2 });
    // record piece: a 320° arc of an annulus (so the spin shows), in the YZ plane facing ±x
    const arcGeo = (inner) => {
      const g = new THREE.RingGeometry(inner, 1, 40, 1, 0.3, Math.PI * 2 - 0.6);
      g.rotateY(Math.PI / 2);
      return B.own(g);
    };
    const pieces = [arcGeo(0.95), arcGeo(0.94), arcGeo(0.92), arcGeo(0.88)];
    const vinylBanks = pieces.map((g) => B.bank(g, 8, { opacity: 0.9 }));
    const discGeo = B.own(new THREE.CircleGeometry(1, 40).rotateY(Math.PI / 2));
    const discs = B.props(discGeo, stdMat(0x0b0b0e, { roughness: 0.3, metalness: 0.6, side: THREE.DoubleSide }), 8);
    const lg = {};

    // ---- vinyls (0 – 9)
    for (const [s, id, ringBase, mirZ] of [[-1, 0, 1, true], [1, 5, 6, false]]) {
      const T = [];
      const L = [];
      VINYLS.forEach(([x, z], k) => {
        const t = node(u, [s * x, 0, z]);
        T.push(t);
        B.prop(t, discs, mat([s * 0.2, 0, 0], [0, 0, 0], 8));
        const rz = [];
        const parts = [];
        const radii = [8, 6.3, 4.6, 3];
        for (let p = 0; p < 4; p++) {
          const pv = node(t);
          rz.push(pv);
          parts.push(B.light(pv, vinylBanks[p], mat([0, 0, 0], [p * 37, 0, 0], radii[p])));
        }
        L.push(multi(...parts));
        lg[ringBase + k] = group([], { count: 4, rot: { z: rz, mirror: { z: mirZ } } });
      });
      lg[id] = group(L, { rot: { x: T }, tr: { y: T, z: T } });
    }

    // ---- tunnel pieces (10): three rings of 20 around (0, 1.8, 8), all at the top at rest
    {
      const rz = [];
      const ty = [];
      const L = [];
      for (let r = 0; r < 3; r++) {
        for (let k = 0; k < 20; k++) {
          const p = node(u, [0, 1.8, 8], [0, 0, 180]);
          const tz = node(p);
          const tyy = node(tz);
          rz.push(p);
          ty.push(tyy);
          // piece: a curved bar (two segments) at radius 5 (local -y = up, the pivot is rolled 180°)
          L.push(multi(
            B.tube(tyy, tube, V(-0.9, -4.93, 0), V(0, -5, 0), 0.07, 3),
            B.tube(tyy, tube, V(0, -5, 0), V(0.9, -4.93, 0), 0.07, 3),
          ));
          ty[ty.length - 1].userData.tz = tz;
        }
      }
      lg[10] = group(L, { rot: { z: rz, mirror: { z: true } }, tr: { y: ty, z: ty.map((o) => o.userData.tz) } });
    }

    // ---- distant circular lasers (11, 12)
    {
      const circle = node(u, [0, 2, 66.4]);
      lg[11] = group([], { count: 1, rot: { z: [circle] }, tr: { z: [circle] } });
      const rx = [];
      const ry = [];
      const L = [];
      for (let k = 0; k < 20; k++) {
        const a = (k / 20) * Math.PI * 2;
        const base = node(circle, [5.4 * Math.sin(a), 5.4 * Math.cos(a), 0]);
        const src = node(base);
        ry.push(base);
        rx.push(src);
        L.push(multi(
          B.tube(src, tube, V(0, 0, 0), V(0, 0, -260), 0.02, 3),
          B.light(src, boxes, mat([0, 0, 0], [0, 0, 0], 0.12), mat([0, 0, 0], [0, 0, 0], 0.45)),
        ));
      }
      lg[12] = group(L, { rot: { x: rx, y: ry, mirror: { x: true } } });
    }

    // ---- top circular lasers (13, 14)
    {
      const ring = node(u, [0, 153.4, 65.9]);
      lg[13] = group([], { count: 1, rot: { y: [ring] } });
      const rx = [];
      const L = [];
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2;
        const base = node(ring, [-20 * Math.sin(a), 0.3, 20 * Math.cos(a)], [0, -30 * k, 0]);
        rx.push(base);
        L.push(B.tube(base, tube, V(0, 0, 0), V(0, -200, 0), 0.08, 3));
      }
      lg[14] = group(L, { rot: { x: rx } });
    }

    // ---- platform lanes (15, 16)
    for (const [s, id] of [[-1, 15], [1, 16]]) {
      const P = [];
      const L = [];
      for (const z of BRICK_Z) {
        const p = node(u, [s * 1.4, 0.1, z]);
        P.push(p);
        L.push(B.light(p, boxes, mat([0, 0, 0], [0, 0, 0], [0.13, 0.2, 0.4]), mat([0, 0, 0], [0, 0, 0], [0.4, 0.5, 0.8])));
      }
      lg[id] = group(L, { tr: { y: P, z: P, mirror: { z: s > 0 } } });
    }
    // dark deck under the bricks
    {
      const deck = [];
      for (const s of [-1, 1]) {
        const g = new THREE.BoxGeometry(1, 1, 1);
        g.applyMatrix4(mat([s * 1.4, -0.03, 28], [0, 0, 0], [1.1, 0.08, 44]));
        deck.push(g);
      }
      B.merge(deck, stdMat(0x101015, { roughness: 0.3, metalness: 0.7 }));
    }

    // ---- silhouette (17) + special event 40 (which silhouette)
    let pose = 0;
    const sil = [];
    {
      const piv = [];
      for (let c = 0; c < 3; c++) {
        const p = node(u, [0, -1, 57]);
        piv.push(p);
        const byPose = POSES.map((lines) => {
          const parts = [];
          for (const line of lines) {
            for (let i = 0; i < line.length - 1; i++) {
              const H = 18;
              parts.push(B.tube(p, tube, V(line[i][0] * H, line[i][1] * H, 0), V(line[i + 1][0] * H, line[i + 1][1] * H, 0), 0.12, 3));
            }
          }
          return multi(...parts);
        });
        const L = {
          r: 0, g: 0, b: 0, byPose,
          set(r, g, b) {
            this.r = r; this.g = g; this.b = b;
            for (let i = 0; i < byPose.length; i++) {
              if (i === pose) byPose[i].set(r, g, b);
              else byPose[i].set(0, 0, 0);
            }
          },
        };
        for (const bp of byPose) bp.set(0, 0, 0);
        sil.push(L);
      }
      lg[17] = group(sil, { tr: { y: piv, z: piv } });
    }
    const setPose = (v) => {
      pose = ((Math.round(v) % POSES.length) + POSES.length) % POSES.length;
      for (const L of sil) L.set(L.r, L.g, L.b);
    };

    // ---- stars
    {
      const n = 500;
      const pos = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const a = R() * Math.PI * 2;
        const e = Math.asin(R() * 0.95);
        const d = 260;
        pos.set([Math.cos(a) * Math.cos(e) * d, Math.sin(e) * d - 20, Math.sin(a) * Math.cos(e) * d], i * 3);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const stars = new THREE.Points(g, new THREE.PointsMaterial({ color: 0x9a9ab0, size: 1.1, sizeAttenuation: true, fog: false }));
      stars.frustumCulled = false;
      B.add(stars);
    }

    // ---- basic events: 4 platform glow, 6 ambient
    const haze = new SoftGlow(B.root, 300, 200, new THREE.Vector3(0, 30, -120), { gain: 0.25, power: 1.6 });
    B.owned.push(haze);
    const groups = {
      4: [multi(
        B.tube(null, tube, V(-1.5, 0.01, -1), V(1.5, 0.01, -1), 0.02, 3),
        B.tube(null, tube, V(-1.5, 0.01, 1), V(1.5, 0.01, 1), 0.02, 3),
        B.tube(null, tube, V(-1.5, 0.01, -1), V(-1.5, 0.01, 1), 0.02, 3),
        B.tube(null, tube, V(1.5, 0.01, -1), V(1.5, 0.01, 1), 0.02, 3),
      )],
      6: [haze],
    };

    return B.finish({
      groups,
      lightGroups: lg,
      customEvents: [40],
      onEvent(type, value) {
        if (type === 40) setPose(value);
      },
      reset() {
        setPose(0);
      },
      background: 0x020204,
      fog: { color: 0x030305, near: 60, far: 300 },
    });
  },
};
