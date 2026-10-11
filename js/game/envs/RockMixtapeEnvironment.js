// Rock Mixtape environment (v3 group lighting) — our own recreation from simple shapes, no game assets.
// Look: a rocky canyon at night. The track is a guitar neck (frets across it, five strings along it,
// fret-marker dots, a pixel equalizer at its start), ladders of short vertical lasers line both
// sides, spiky "claws" of neon tubes curl up out of the abyss beside the track, video screens stand
// left and right, layered mountain walls carry stacked contour lines of light, a row of gothic arches
// forms a tunnel at the far end under a horned demon face with glowing eyes, five tall laser beams
// rise behind it on each side and an aurora hangs in the sky.
//
// Light groups (id → what, elements, rotation / translation axes). Element order = official order.
//   0  Far Left .............. 5  vertical beams far behind the face, inner → outer
//                                  rotation x, y; translation x (±30), z (±50)
//   1  Far Right ............. 5  same, right (rotation mirror y, translation mirror x)
//   2–13 Mountain 1–12 ....... 10 each  contour lines of one mountain wall, bottom → top
//                                  (approx.: 1–6 = left walls near → far, 7–12 = right walls)
//   14 Eyes .................. 3  the face's eyes, three nested outlines (outer → inner)  translation y (±10)
//   15 Frets ................. 10 lines across the track, near → far (guitar fret spacing)
//   16 Strings ............... 5  lines along the track, left → right (x = -2 … 2)
//   17 Tunnel ................ 5  gothic arches at the far end, near → far   translation z (±45)
//   18 Side Left ............. 24 ladder of 12 laser pairs left of the track: per rung bottom, top
//   19 Side Right ............ 24 same, right
//   20 Side Left Rotation (no light)  12  the 12 rungs   rotation x, z
//   21 Side Right Rotation (no light) 12  same, right (mirror z)
//   22 Face Left ............. 8  left horn, eight nested copies (each 0.85 × the previous)
//                                  rotation y (set), z (each copy); translation x (±10)
//   23 Face Right ............ 8  same, right (rotation mirror y)
//   24 Spikes Left ........... 36 neon spike clusters: claw 1 (12), claw 2 (12), claw 3 (12), near → far;
//                                  per claw two arcs of 6 clusters, bottom → top
//   25 Spikes Left Movement (no light) 3  the three claws   rotation z; translation x, y (±20)
//   26 Spikes Right .......... 36 same, right
//   27 Spikes Right Movement (no light) 3
//   28 Dots .................. 5  fret-marker dots on the track (the third is a pair)
//   29 Face Movement (no light) 2  the face (eyes + horns) parts   translation y (±20)
//   30 Equalizer ............. 16 columns of the pixel equalizer, left → right
//   31 Screens Left 1 ........ 4  near left screen, its four stacked pieces top → bottom  rotation y; translation y
//   32 Screens Left 2 ........ 4  far left screen
//   33 Screens Right 1 / 34 Screens Right 2: same, right
//   35 Left Screens Move (no light)  2  the two left screens   rotation x, z; translation x, y, z (±20)
//   36 Right Screens Move (no light) 2  same, right (mirror y, z / x)
//   37 Side Z Translation (no light) 2  left / right laser ladder   translation z (±20)
// Basic events: 0 player platform glow, 3 "BG Bloom" (glow behind the tunnel), 4 "Aurora" (sky),
// 6 ambient (haze), 5 colour boost.
//
// Sources (facts only — ids, names, counts, order, positions, axes, limits, default colours): the
// environment's scene data in ChroMapper (github.com/Caeden117/ChroMapper, dev branch,
// Assets/__Scenes/Environments/Data/RockMixtapeEnvironment.json); ArcViewer's colour table;
// gameplay videos / thumbnails for the look.
// Approximate: the mountain walls (the original lights 120 contour bands of one mesh through a
// colour array; which mountain is where is our guess), the face (a dark mask with tube outlines),
// horn and claw shapes, screen size / angle, the equalizer (lies flat at the start of the track:
// the original stands on the front of a raised runway that our track does not have), distant
// beams (× 0.6, drawn closer).
import { THREE, GEO, SoftGlow, rng, stdMat, ridgeGeometry, fadeStripGeometry, softLightMaterial } from './kit.js';
import { Builder, node, mat, boxGeo, group, scheme, multi, D2R } from './_v3b.js';

const FRETS = [5.9, 9.9, 15.2, 21.6, 28.7, 39.9, 51.2, 64.1, 81.1, 99.1];
const ARC_A = [[-9.5, -10.6], [-11.8, -7.4], [-12.9, -4.2], [-13.2, -1.4], [-12.9, 1.2], [-11.8, 3.7]];
const ARC_B = [[-8.1, -12.3], [-11, -9], [-12.6, -5.9], [-13.3, -2.7], [-13.2, -0.1], [-12.5, 2.5]];

export default {
  name: 'RockMixtapeEnvironment',
  label: 'Rock Mixtape',
  colors: scheme({
    left: [0.6, 0.423, 0.042],
    right: [0.601, 0.744, 0.78],
    envLeft: [0.75, 0.12, 0.162],
    envRight: [0.95, 0.582, 0.162],
    envWhite: [0.725, 0.725, 0.725],
    wall: [1, 1, 1],
    envLeftBoost: [0.96, 0.134, 0.919],
    envRightBoost: [0.378, 0.813, 0.9],
  }),
  build() {
    const B = new Builder('RockMixtapeEnvironment');
    const u = B.u;
    const R = rng(1971);
    const tube = B.glow(GEO.tube, 700, { haloScale: 3, haloOpacity: 0.17 });
    const flat = B.glow(GEO.plane, 1500, { haloOpacity: 0.16 });
    const panel = B.bank(GEO.plane, 16, { opacity: 0.5 });
    const lg = {};
    const V = (x, y, z) => [x, y, z];
    // flat strip a → b (both in the pivot's space) facing `normal` ('x' | 'y' | 'z'), width w
    const strip = (pivot, a, b, w, normal, glowK = 4) => {
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const dz = b[2] - a[2];
      const len = Math.hypot(dx, dy, dz);
      const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
      const dir = new THREE.Vector3(dx, dy, dz).normalize();
      const n = normal === 'x' ? new THREE.Vector3(1, 0, 0) : normal === 'y' ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);
      const side = new THREE.Vector3().crossVectors(n, dir).normalize();
      const nn = new THREE.Vector3().crossVectors(dir, side);
      const basis = new THREE.Matrix4().makeBasis(dir, side, nn);
      const mk = (k) => basis.clone().scale(new THREE.Vector3(len + w * (k - 1) * 0.5, w * k, 1)).setPosition(mid[0], mid[1], mid[2]);
      return B.light(pivot, flat, mk(1), mk(glowK));
    };

    // ---- guitar neck: frets (15), strings (16), dots (28), equalizer (30)
    lg[15] = group(FRETS.map((z) => B.tube(null, tube, V(-2.25, 0.02, z), V(2.25, 0.02, z), 0.04, 2.5)));
    lg[16] = group([-2, -1, 0, 1, 2].map((x) => B.tube(null, tube, V(x, 0.025, 5.8), V(x, 0.025, 230), 0.022, 2.5)));
    {
      const dot = (x, z, k) => B.light(null, flat, mat([x, 0.02, z], [90, 0, 0], [0.55, 0.55 * k, 1]), mat([x, 0.02, z], [90, 0, 0], [1.5, 1.5 * k, 1]));
      lg[28] = group([dot(0, 7.9, 1.4), dot(0, 18.4, 1.6), multi(dot(-1.1, 34.3, 1), dot(1.1, 34.3, 1)), dot(0, 57.7, 2.7), dot(0, 90.1, 4.2)]);
      const eq = [];
      for (let c = 0; c < 16; c++) {
        // vertical pixel display on the front of the neck (z = 5.7, below the track surface)
        const x = -2.1 + c * 0.28;
        const parts = [];
        for (let r = 0; r < 5; r++) parts.push(B.light(null, flat, mat([x, -0.2 - r * 0.25, 5.65], [0, 0, 0], [0.22, 0.19, 1]), null));
        eq.push(multi(...parts));
      }
      lg[30] = group(eq);
    }

    // ---- side laser ladders (18 – 21, 37)
    for (const [s, id, rotId] of [[-1, 18, 20], [1, 19, 21]]) {
      const ladder = node(u, [0, 0, 0]);
      const L = [];
      const rx = [];
      const rz = [];
      for (let k = 0; k < 12; k++) {
        const rl = node(ladder, [s * 2.6, -0.3, 10 + 2 * k]);
        const rw = node(rl);
        rz.push(rl);
        rx.push(rw);
        L.push(B.tube(rw, tube, V(0, -1.75, 0), V(0, 1.75, 0), 0.04, 3));
        L.push(B.tube(rw, tube, V(0, 2.7, 0), V(0, 4.7, 0), 0.04, 3));
      }
      lg[id] = group(L);
      lg[rotId] = group([], { count: 12, rot: { x: rx, z: rz, mirror: { z: s > 0 } } });
      (lg[37] ??= group([], { count: 2, tr: { z: [] } })).translation.z.push(ladder);
    }

    // ---- spike claws (24 – 27)
    for (const [s, id, moveId] of [[-1, 24, 25], [1, 26, 27]]) {
      const L = [];
      const claws = [];
      [12, 24, 36].forEach((z, ci) => {
        const claw = node(u, [s * 11, -4, z]);
        claws.push(claw);
        for (const arc of [ARC_A, ARC_B]) {
          arc.forEach(([x, y], k) => {
            const cx = s * -x - s * 11;
            const cy = y + 4;
            const cz = arc === ARC_A ? 0 : 1.2;
            // three spikes radiating from the cluster centre, pointing up / out
            const parts = [];
            for (let j = 0; j < 3; j++) {
              const a = (j / 3) * Math.PI * 2 + k * 0.7 + ci;
              const len = 1.8 + R() * 0.8;
              const d = [s * (0.6 + 0.4 * Math.cos(a)), 0.8 + 0.5 * Math.sin(a), Math.sin(a * 2) * 0.9];
              const n = Math.hypot(...d);
              parts.push(B.tube(claw, tube, V(cx, cy, cz), V(cx + (d[0] / n) * len, cy + (d[1] / n) * len, cz + (d[2] / n) * len), 0.035, 2.2));
            }
            L.push(multi(...parts));
          });
        }
      });
      lg[id] = group(L);
      lg[moveId] = group([], { count: 3, rot: { z: claws }, tr: { x: claws, y: claws } });
    }

    // ---- video screens (31 – 36)
    const screenBody = B.props(GEO.box, stdMat(0x111013, { roughness: 0.6, metalness: 0.4 }), 32);
    for (const [s, ids, moveId] of [[-1, [31, 32], 35], [1, [33, 34], 36]]) {
      const moves = [];
      [48, 68].forEach((z, si) => {
        const scr = node(u, [s * 12.5, 0, z], [0, s * -38, 0]);
        moves.push(scr);
        const rot = { y: [], mirror: { y: s < 0 } };
        const tr = { y: [] };
        const L = [];
        for (let p = 0; p < 4; p++) {
          const piece = node(scr, [0, 1.9 - p * 6.3 - (si ? -2 : 0), 0]);
          rot.y.push(piece);
          tr.y.push(piece);
          B.prop(piece, screenBody, mat([0, 0, 0.35], [0, 0, 0], [9.9, 6.1, 0.5]));
          L.push(multi(B.light(piece, panel, mat([0, 0, -0.05], [0, 0, 0], [9.2, 5.6, 1])), B.light(piece, flat, mat([0, 2.9, -0.1], [0, 0, 0], [9.6, 0.12, 1]), mat([0, 2.9, -0.1], [0, 0, 0], [10, 0.6, 1]))));
        }
        lg[ids[si]] = group(L, { rot, tr });
      });
      lg[moveId] = group([], { count: 2, rot: { x: moves, z: moves, mirror: { y: s > 0, z: s > 0 } }, tr: { x: moves, y: moves, z: moves, mirror: { x: s > 0 } } });
    }

    // ---- tunnel arches (17)
    {
      const T = [];
      const piv = [];
      const arch = [[7.3, -20.6], [7.3, 1.9], [6.2, 8.5], [4.8, 12.5], [2.4, 14], [0, 15.1]];
      for (let k = 0; k < 5; k++) {
        const w = node(u, [0, 0, 100 + 20 * k]);
        piv.push(w);
        const parts = [];
        for (const sx of [-1, 1]) {
          for (let i = 0; i < arch.length - 1; i++) {
            parts.push(B.tube(w, tube, V(sx * arch[i][0], arch[i][1], 0), V(sx * arch[i + 1][0], arch[i + 1][1], 0), 0.14, 2.5));
          }
        }
        T.push(multi(...parts));
      }
      lg[17] = group(T, { tr: { z: piv } });
    }

    // ---- demon face: mask (static), eyes (14), horns (22 / 23), face parts (29)
    {
      const faceL = node(u, [0, 0, 0]);
      const faceR = node(u, [0, 0, 0]);
      lg[29] = group([], { count: 2, tr: { y: [faceL, faceR] } });
      // dark mask
      const mask = [];
      mask.push(boxGeo([0, 22, 128], [24, 26, 6], [0, 0, 0]));
      mask.push(boxGeo([0, 9, 127], [14, 10, 6], [0, 0, 0]));
      for (const sx of [-1, 1]) mask.push(boxGeo([sx * 9, 12, 127.5], [8, 14, 6], [0, 0, sx * 25]));
      B.merge(mask, stdMat(0x0a0607, { roughness: 0.8, metalness: 0.2 }));
      // eyes: three nested slanted outlines
      const E = [];
      const eyePivots = [];
      for (let i = 0; i < 3; i++) {
        const eyes = node(faceL, [0, 28.6, 118.1]);
        eyePivots.push(eyes);
        const k = 1 - i * 0.22;
        const parts = [];
        for (const sx of [-1, 1]) {
          const pts = [[1.2, 0.6], [8.6, 3.8], [6.6, -1.6], [1.2, 0.6]].map(([x, y]) => [sx * (1.5 + x * k), y * k - 1.2]);
          for (let j = 0; j < 3; j++) parts.push(B.tube(eyes, tube, V(pts[j][0], pts[j][1], -0.3 * i), V(pts[j + 1][0], pts[j + 1][1], -0.3 * i), 0.14, 2.5));
        }
        E.push(multi(...parts));
      }
      lg[14] = group(E, { tr: { y: eyePivots } });
      for (const [s, id, faceNode] of [[-1, 22, faceL], [1, 23, faceR]]) {
        const set = node(faceNode, [s * 8, 36, 133], [0, s < 0 ? 180 : 0, 0]);
        const rz = [];
        const ry = [];
        const L = [];
        let parent = set;
        // horn outline in the set's space: +x points outward
        const outer = [[0, -3], [5, -1.5], [10, 2.5], [13.5, 8], [15, 14.5]];
        const inner = [[0, 3], [4.5, 3.5], [8.5, 6], [12, 10], [15, 14.5]];
        for (let i = 0; i < 8; i++) {
          const w = node(parent, [0, 0, 0], [0, 0, 0], i === 0 ? 1 : 0.85);
          const zw = node(w);
          ry.push(w);
          rz.push(zw);
          const parts = [];
          for (const line of [outer, inner]) {
            for (let j = 0; j < line.length - 1; j++) parts.push(B.tube(zw, tube, V(line[j][0], line[j][1], 0), V(line[j + 1][0], line[j + 1][1], 0), 0.16, 2.5));
          }
          L.push(multi(...parts));
          parent = zw;
        }
        lg[id] = group(L, { rot: { y: ry, z: rz, mirror: { y: s > 0 } }, tr: { x: ry } });
      }
    }

    // ---- far beams behind the face (0 / 1), drawn at 0.6 scale
    {
      const far = node(u, [0, 1.7, 0], [0, 0, 0], 0.6);
      for (const [s, id] of [[-1, 0], [1, 1]]) {
        const ry = [];
        const rx = [];
        const L = [];
        for (let k = 0; k < 5; k++) {
          const base = node(far, [s * (4 + 4 * k), -9.7, 232.7]);
          const src = node(base);
          ry.push(base);
          rx.push(src);
          L.push(B.tube(src, tube, V(0, 0, 0), V(0, 600, 0), 0.3, 2.5));
        }
        lg[id] = group(L, { rot: { x: rx, y: ry, mirror: { y: s > 0 } }, tr: { x: ry, z: ry, mirror: { x: s > 0 } } });
      }
    }

    // ---- mountain walls with contour lines (2 – 13)
    {
      const rock = [];
      const layout = [[22, 16, 30], [44, 21, 30], [68, 27, 32], [94, 33, 34], [124, 40, 38], [160, 48, 44]];
      for (const s of [-1, 1]) {
        layout.forEach(([zc, x0, len], j) => {
          const id = 2 + j + (s > 0 ? 6 : 0);
          const z0 = zc - len / 2;
          const z1 = zc + len / 2;
          rock.push(ridgeGeometry(R, [s * x0, z0], [s * (x0 + 4), z1], 7, 34 + j * 4, 52 + j * 5, 26, [s, 0], -40));
          const L = [];
          for (let i = 0; i < 10; i++) {
            const y = -8 + i * 4.6;
            const xo = s * (x0 + 1.5 + (y + 8) * 0.28);
            const pts = [];
            const n = 5;
            for (let q = 0; q <= n; q++) {
              const t = q / n;
              pts.push([xo + s * 1.6 * (R() - 0.3) + s * 4 * t, y + (R() - 0.5) * 1.6, z0 + 2 + (len - 4) * t]);
            }
            const parts = [];
            for (let q = 0; q < n; q++) parts.push(strip(null, pts[q], pts[q + 1], 0.32, 'x', 4));
            L.push(multi(...parts));
          }
          lg[id] = group(L);
        });
      }
      B.merge(rock, stdMat(0x120c0b, { roughness: 0.95, metalness: 0.05, flat: true }));
    }

    // ---- runway frame (the neck) under / beside the track
    B.merge([boxGeo([0, -0.8, 65.9], [4.7, 1.55, 120]), boxGeo([0, -6, 65.9], [2.2, 9, 120])], stdMat(0x0d0b0c, { roughness: 0.5, metalness: 0.4 }));

    // ---- basic events: platform glow (0), BG bloom (3), aurora (4), ambient (6)
    const groups = {
      0: [multi(
        B.tube(null, tube, V(-1.55, 0.01, -1.05), V(1.55, 0.01, -1.05), 0.025, 3),
        B.tube(null, tube, V(-1.55, 0.01, 1.05), V(1.55, 0.01, 1.05), 0.025, 3),
        B.tube(null, tube, V(-1.55, 0.01, -1.05), V(-1.55, 0.01, 1.05), 0.025, 3),
        B.tube(null, tube, V(1.55, 0.01, -1.05), V(1.55, 0.01, 1.05), 0.025, 3),
      )],
      3: [B.tube(null, tube, V(0, 2.8, 100), V(0, 9.8, 100), 0.5, 6)],
    };
    {
      // aurora: a few tall soft curtains high in the sky
      const geo = B.own(fadeStripGeometry());
      const auroraMat = B.own(softLightMaterial({ opacity: 0.55 }));
      auroraMat.side = THREE.DoubleSide;
      auroraMat.forceSinglePass = true;
      const aur = new THREE.InstancedMesh(geo, auroraMat, 7);
      aur.frustumCulled = false;
      for (let i = 0; i < 7; i++) {
        const x = (i - 3) * 34;
        aur.setMatrixAt(i, mat([x, 95 + Math.abs(i - 3) * -6, 170 - Math.abs(i - 3) * 8], [0, (i - 3) * 9, 90], [70, 40, 1]));
      }
      u.add(aur);
      B.owned.push({ dispose: () => aur.dispose() });
      const aurora = {
        r: 0, g: 0, b: 0,
        set(r, g, b) {
          this.r = r; this.g = g; this.b = b;
          auroraMat.color.setRGB(r, g, b);
          aur.visible = r + g + b > 0.002;
        },
      };
      aurora.set(0, 0, 0);
      groups[4] = [aurora];
    }
    const haze = new SoftGlow(B.root, 520, 220, new THREE.Vector3(0, 20, -190), { gain: 0.22, power: 1.5 });
    B.owned.push(haze);
    groups[6] = [haze];

    return B.finish({
      groups,
      lightGroups: lg,
      background: 0x050304,
      fog: { color: 0x070405, near: 50, far: 300 },
    });
  },
};
