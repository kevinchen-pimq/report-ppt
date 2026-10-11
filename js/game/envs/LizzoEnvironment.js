// Lizzo environment: a candy-coloured disco. The runway is a dance floor of light tiles; puffy clouds
// outlined with bulbs float along both sides, tall stands carry big neon letters "LI Z" / "Z O" and two
// neon peaches, a rainbow of five bulb arcs (with a ring of lasers on each side) closes the end of the
// track under a square lighting rig, and laser heads hide under the floor and far out at the sides.
// Recreated with simple shapes (our own geometry).
//
// v3 light groups (lightGroups[id].lights = elements in official order):
//   id  what                                         elements  order                          rotation
//    0  dance floor tiles (4 columns × 10 rows)         40      rows near → far, serpentine     —
//                                                               (row 0 left → right, row 1 back …)
//    1  rainbow arc, inner (bulbs)                      16      left end → over → right end     —
//    2–4 rainbow arcs 2 … 4                         16 each      same                           —
//    5  rainbow arc, outer                              16      same                            —
//    6  left rainbow ring (rotation only)                1                                      Y
//    7  right rainbow ring (rotation only)               1                                      Y (mirrored)
//    8  lasers on the left ring                         12      30° steps around the ring       X, Y
//    9  lasers on the right ring                        12      same, other way round           X, Y (Y mirrored)
//   10  top lasers under the square rig                 12      left → right, beams down        X, Y
//   11  bulbs on the left stands                         6      bottom → top level              —
//   12  bulbs on the right stands                        6      bottom → top level              —
//   13  bulbs around the left clouds                    14      along each outline (interleaved) —
//   14  bulbs around the right clouds                   14      same                            —
//   15  lasers under the floor, left                     4      near → far (10 m), beams up     X, Y
//   16  lasers under the floor, right                    4      near → far                      X, Y (Y mirrored)
//   17  far left stand lasers                            3      one source, beams up            X, Y (Y mirrored)
//   18  far right stand lasers                           3      one source                      X (mirrored), Y
//   19  laser arc behind the rainbow                    14      right end → over → left end,    X (mirrored), Y
//                                                               beams toward the player
// Basic events: 0 / 1 runway strips left / right, 2 / 3 rainbow ring rims left / right, 4 top square rig,
// 6 ambient sky glow, 7 / 8 peaches left / right, 9 "LI", 10 left "Z", 11 right "Z", 12 "O",
// 5 colour boost (runtime). 16 / 17 (balloon particles) are not drawn.
// Sources (facts only): ChroMapper's community recreation of LizzoEnvironment (group names / ids,
// element counts, tile layout and order, arc radii, ring / laser positions and rotation axes, mirror
// flags, stand / letter / cloud placement, basic event tracks, default colours), v3 maps on BeatSaver
// for the environment (groups 0–19 in use; basic 0–12, 16, 17), gameplay footage. Approximate: every
// shape (stands are boxes, clouds three-bump silhouettes, letters our own strokes, peaches simple
// outlines), bulb counts per cloud / stand, the static rainbow band colours. The dance-floor tiles are
// additive light panels lying just above the game's runway (they are light group 0).
import { THREE, GEO, LightBank, GlowBank, Rig, MultiLight, barXYZ, mergeGeos, beamGeometry, skyDome, V } from './kit.js';
import { D2R, Frame, fadeBeamBank, fadeBeamMaterial, movingHead, rotGroup, pushHead, trussGeos } from './_v1lights.js';

const UP = V(0, 1, 0);
const AUD = V(0, 0, 1);
const EYE = V(0, 1.5, 0);
const ROW_Z = [0.59, 1.93, 3.53, 5.8, 9.18, 13.99, 21.17, 31.9, 49.73, 107.76];
const ROW_L = [0.49, 0.53, 0.68, 1.02, 1.51, 2.09, 3.34, 4.68, 8.88, 36.9];
const COL_X = [-1.25, -0.4, 0.4, 1.25];

// our own stroke letters (4 × 6 grid) for the neon words
const STROKES = {
  L: [[0, 6, 0, 0], [0, 0, 3.2, 0]],
  I: [[1.6, 0, 1.6, 6]],
  Z: [[0, 6, 4, 6], [4, 6, 0, 0], [0, 0, 4, 0]],
  O: [[1, 0, 3, 0], [3, 0, 4, 1], [4, 1, 4, 5], [4, 5, 3, 6], [3, 6, 1, 6], [1, 6, 0, 5], [0, 5, 0, 1], [0, 1, 1, 0]],
};

export default {
  name: 'LizzoEnvironment',
  label: 'Lizzo',
  colors: {
    left: '#ffcf60',
    right: '#ab41e5',
    envLeft: '#d6a537',
    envRight: '#d13de0',
    envLeftBoost: '#ff668d',
    envRightBoost: '#5ecbff',
    wall: '#ff8030',
  },
  build() {
    const root = new THREE.Group();
    root.name = 'LizzoEnvironment';
    const owned = [];
    const rig = new Rig(root);
    const q = new THREE.Quaternion();
    const lightGroups = {};

    const tiles = new LightBank(root, GEO.box, 40);
    const bulbGeo = new THREE.CircleGeometry(1, 6);
    owned.push(bulbGeo);
    const bulbs = new GlowBank(root, bulbGeo, 760, { haloOpacity: 0.22 });
    for (const b of bulbs.banks) b.mesh.material.side = THREE.DoubleSide;
    const neon = new GlowBank(root, GEO.box, 240, { haloOpacity: 0.18 });
    const { bank: beams, geometry: beamGeo } = fadeBeamBank(root, 70, { haloOpacity: 0.08, power: 1.4, widthEnd: 3, rows: 4 });
    owned.push(beamGeo);
    const heads = new LightBank(root, GEO.box, 70);

    // a bulb (disc facing the player) at p, radius r
    const faceQ = (p) => {
      const m = new THREE.Matrix4().lookAt(EYE, p, UP);
      return new THREE.Quaternion().setFromRotationMatrix(m);
    };
    const bulb = (p, r = 0.16) => {
      const fq = faceQ(p);
      return bulbs.add(new THREE.Matrix4().compose(p, fq, V(r, r, r)), new THREE.Matrix4().compose(p, fq, V(r * 3.2, r * 3.2, r * 3.2)));
    };

    // ---- 0: dance floor ------------------------------------------------------------------------
    {
      const g = { lights: [] };
      for (let r = 0; r < 10; r++) {
        const len = ROW_L[r] * 2.45 - 0.08;
        for (let j = 0; j < 4; j++) {
          const c = r % 2 ? 3 - j : j;
          const w = c === 0 || c === 3 ? 0.78 : 0.68;
          const m = new THREE.Matrix4().compose(V(COL_X[c], 0.012, -ROW_Z[r]), q.identity(), V(w, 0.004, len));
          g.lights.push(new MultiLight([tiles.add(m)], [0.55]));
        }
      }
      lightGroups[0] = g;
    }

    // ---- 1–5: rainbow arcs of bulbs + static rainbow bands --------------------------------------
    const RB = [[7.0, -64.51], [8.2, -63.61], [9.4, -62.71], [10.6, -61.81], [11.8, -60.91]];
    RB.forEach(([r, z], i) => {
      const g = { lights: [] };
      for (let k = 0; k < 16; k++) {
        const a = (176 - k * 11.6) * D2R;
        g.lights.push(bulb(V(r * Math.cos(a), 2.1 + r * Math.sin(a), z + 0.05), 0.2));
      }
      lightGroups[1 + i] = g;
    });
    {
      const pos = [];
      const col = [];
      const bandCols = [[0.45, 0.15, 0.75], [0.15, 0.35, 0.9], [0.15, 0.75, 0.35], [0.95, 0.85, 0.2], [1.0, 0.45, 0.1], [0.95, 0.12, 0.25]];
      for (let b = 0; b < 6; b++) {
        const r0 = 6.4 + b * 1.2;
        const r1 = r0 + 1.15;
        const z = -64.6 + b * 0.9;
        const c = bandCols[b];
        for (let k = 0; k < 24; k++) {
          const a0 = (k / 24) * Math.PI;
          const a1 = ((k + 1) / 24) * Math.PI;
          const P = (r, a) => [r * Math.cos(a), 2.1 + r * Math.sin(a), z];
          for (const p of [P(r0, a0), P(r1, a0), P(r1, a1), P(r0, a0), P(r1, a1), P(r0, a1)]) {
            pos.push(...p);
            col.push(c[0] * 0.55, c[1] * 0.55, c[2] * 0.55);
          }
        }
      }
      const gg = new THREE.BufferGeometry();
      gg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      gg.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      const mat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, toneMapped: false, fog: false });
      owned.push(gg, mat);
      root.add(new THREE.Mesh(gg, mat));
    }

    // ---- 6–9: rainbow rings (rotation) with 12 lasers each ------------------------------------
    const ringRims = {};
    for (const [ringId, laserId, s] of [[6, 8, -1], [7, 9, 1]]) {
      const C = V(s * 8.59, 4.26, -61.81);
      const n = V(-s * 0.088, 0.94, 0.33).normalize();
      const f = new Frame(C, n.clone().negate(), null, ['y']);
      lightGroups[ringId] = { lights: [], count: 1, rotation: { y: [f.pivot.y], mirror: { y: s > 0 } } };
      const u = V(-s * 0.96, -0.06, -0.28);
      u.addScaledVector(n, -u.dot(n)).normalize();
      const v = new THREE.Vector3().crossVectors(n, u);
      const g = rotGroup(s > 0, false);
      for (let i = 0; i < 12; i++) {
        const a = -s * 30 * i * D2R;
        const p = C.clone().addScaledVector(u, 4 * Math.cos(a)).addScaledVector(v, 4 * Math.sin(a));
        const tilt = v.clone().multiplyScalar(Math.cos(a)).addScaledVector(u, -Math.sin(a));
        pushHead(g, movingHead(rig, beams, p, n, n, tilt, {
          parent: f, len: 20, width: 0.07, halo: 0.45, start: 0.2, head: heads, headSize: [0.12, 0.12, 0.12], gains: [0.8, 1.2],
        }));
      }
      lightGroups[laserId] = g;
      // rim (basic 2 / 3): 24 neon segments
      const bars = [];
      for (let k = 0; k < 24; k++) {
        const a0 = (k / 24) * Math.PI * 2;
        const a1 = ((k + 1) / 24) * Math.PI * 2;
        const pa = C.clone().addScaledVector(u, 4.35 * Math.cos(a0)).addScaledVector(v, 4.35 * Math.sin(a0));
        const pb = C.clone().addScaledVector(u, 4.35 * Math.cos(a1)).addScaledVector(v, 4.35 * Math.sin(a1));
        bars.push({ m: barXYZ(pa.x, pa.y, pa.z, pb.x, pb.y, pb.z, 0.12, 0.12) });
      }
      ringRims[s] = neon.light(bars, { fat: 4, glowGain: 0.7 });
    }

    // ---- 10: top lasers under the square rig ----------------------------------------------------
    {
      const g = rotGroup(false, false);
      for (let k = 0; k < 12; k++) {
        pushHead(g, movingHead(rig, beams, V(-16.81 + 3.2 * k, 26.2, -51.45), V(0, -1, 0), V(0, -1, 0), V(1, 0, 0), {
          len: 16, width: 0.1, halo: 0.6, start: 0.3, head: heads, headSize: [0.25, 0.2, 0.25],
        }));
      }
      lightGroups[10] = g;
    }

    // ---- stands (static), stand bulbs 11 / 12, letters and peaches -----------------------------
    const standMat = new THREE.MeshStandardMaterial({ color: 0x3a1430, roughness: 0.6, metalness: 0.2 });
    owned.push(standMat);
    const statics = [];
    // [centre x, centre z, bulb base y, bulb step, face edge A (x, z), face edge B (x, z)]
    const STANDS_L = [
      [-18.66, -11.04, -2.46, 1.68, [-16.51, -9.15], [-15.98, -12.34]],
      [-21.3, -29.12, -0.16, 1.68, [-19.54, -26.86], [-18.43, -29.9]],
      [-16.6, -41.4, 0.73, 2.14, [-15.9, -37.83], [-12.89, -40.63]],
    ];
    const STANDS_R = [
      [18.81, -12.43, -1.34, 1.68], [20.6, -30.22, -0.49, 1.78], [16.43, -40.42, 2.25, 1.95],
    ].map(([x, z, b, st], i) => {
      const [lx, lz, , , A, B] = STANDS_L[i];
      return [x, z, b, st, [x - (A[0] - lx), z + (A[1] - lz)], [x - (B[0] - lx), z + (B[1] - lz)]];
    });
    for (const [gid, list] of [[11, STANDS_L], [12, STANDS_R]]) {
      const g = { lights: [] };
      const levels = [[], [], [], [], [], []];
      list.forEach(([cx, cz, base, step, A, B], si) => {
        const top = (gid === 11 ? [6.0, 8.76, 12.28] : [7.25, 9.08, 12.56])[si];
        // the stand: a box behind its front face (face = edge A → edge B)
        const fx = (A[0] + B[0]) / 2;
        const fz = (A[1] + B[1]) / 2;
        const w = Math.hypot(B[0] - A[0], B[1] - A[1]) + 0.6;
        const dx = cx - fx;
        const dz = cz - fz;
        const dlen = Math.hypot(dx, dz);
        const depth = 2 * dlen + 0.4;
        const box = new THREE.BoxGeometry(w, top + 14, depth);
        box.rotateY(Math.atan2(-(B[1] - A[1]), B[0] - A[0]));
        box.translate(cx, (top - 14) / 2, cz);
        statics.push(box);
        for (let k = 0; k < 6; k++) {
          const y = base + step * k;
          for (const E of [A, B]) levels[k].push(V(E[0] + (dx / dlen) * -0.05, y, E[1] + (dz / dlen) * -0.05));
        }
      });
      for (let k = 0; k < 6; k++) {
        const L = new MultiLight();
        for (const p of levels[k]) L.push(bulb(p, 0.26));
        g.lights.push(L);
      }
      lightGroups[gid] = g;
    }
    // neon words / peaches on the stands (basic 7–12)
    const word = (text, p, h) => {
      const k = h / 6;
      const adv = 5.2 * k;
      const width = text.length * adv - 1.2 * k;
      const fq = faceQ(p);
      const bars = [];
      let x0 = -width / 2;
      for (const ch of text) {
        for (const [ax, ay, bx, by] of STROKES[ch]) {
          const a = V(x0 + ax * k, ay * k - h / 2, 0).applyQuaternion(fq).add(p);
          const b = V(x0 + bx * k, by * k - h / 2, 0).applyQuaternion(fq).add(p);
          bars.push({ m: barXYZ(a.x, a.y, a.z, b.x, b.y, b.z, 0.22, 0.22) });
        }
        x0 += adv;
      }
      return neon.light(bars, { fat: 3.5, glowGain: 0.9 });
    };
    const peach = (p, h) => {
      const fq = faceQ(p);
      const bars = [];
      const pts = [];
      const R = h * 0.42;
      for (let k = 0; k <= 20; k++) {
        // a peach: round body with a pointed top (heart-ish), drawn as a closed outline
        const t = (k / 20) * Math.PI * 2;
        const x = R * Math.sin(t) * (1 - 0.12 * Math.cos(t));
        const y = -R * Math.cos(t) + (Math.abs(Math.sin(t)) < 0.3 && Math.cos(t) < 0 ? R * 0.25 * (1 - Math.abs(Math.sin(t)) / 0.3) : 0);
        pts.push(V(x, y, 0));
      }
      for (let k = 0; k < 20; k++) bars.push([pts[k], pts[k + 1]]);
      bars.push([V(0, R * 1.05, 0), V(-R * 0.15, -R * 0.2, 0)]); // cleft
      bars.push([V(0, R * 1.05, 0), V(R * 0.55, R * 1.35, 0)], [V(R * 0.55, R * 1.35, 0), V(R * 0.2, R * 1.1, 0)]); // leaf
      return neon.light(bars.map(([a, b]) => {
        const A = a.clone().applyQuaternion(fq).add(p);
        const B = b.clone().applyQuaternion(fq).add(p);
        return { m: barXYZ(A.x, A.y, A.z, B.x, B.y, B.z, 0.2, 0.2) };
      }), { fat: 3.5, glowGain: 0.9 });
    };

    // ---- 13 / 14: clouds (silhouettes, bulbs around the outline) --------------------------------
    const cloudMat = new THREE.MeshStandardMaterial({ color: 0x2a0f2e, roughness: 0.9, metalness: 0, side: THREE.DoubleSide });
    owned.push(cloudMat);
    const cloudGeos = [];
    const CLOUDS = {
      13: [[-9.26, -0.53, -29.7, 8.5], [-7.09, -1.1, -43.59, 8.8], [-6.12, -0.95, 10.41, 5.6], [-8.37, -0.5, 0.26, 5.6], [-7.44, -1.31, -4.39, 6.4], [-8.65, -0.67, -13.56, 10.4], [-6.11, -2.03, -21.41, 7.1]],
      14: [[7.9, -0.65, -31.8, 7.8], [7.5, -1.22, -51.99, 8.9], [7.0, -0.73, -10.8, 6.8], [8.07, -2.39, 11.71, 6.6], [11.63, -0.9, 0.1, 6.1], [7.05, -1.71, -3.17, 4.7], [7.12, -1.76, -20.64, 5.8]],
    };
    const outline = (w) => {
      const circles = [[-0.28 * w, 0.0, 0.24 * w], [0.02 * w, 0.12 * w, 0.3 * w], [0.3 * w, -0.02 * w, 0.21 * w]];
      const yb = -0.16 * w;
      const x0 = -0.5 * w;
      const x1 = 0.5 * w;
      const top = [];
      for (let k = 0; k <= 40; k++) {
        const x = x0 + ((x1 - x0) * k) / 40;
        let y = yb;
        for (const [cx, cy, r] of circles) if (Math.abs(x - cx) < r) y = Math.max(y, cy + Math.sqrt(r * r - (x - cx) * (x - cx)));
        top.push([x, y]);
      }
      return { top, yb };
    };
    for (const gid of [13, 14]) {
      const g = { lights: [] };
      const per = Array.from({ length: 14 }, () => new MultiLight());
      for (const [cx, cy, cz, w] of CLOUDS[gid]) {
        const p = V(cx, cy + 0.6, cz);
        const fq = faceQ(V(cx, cy, cz));
        const { top, yb } = outline(w);
        // silhouette
        const shape = new THREE.Shape();
        shape.moveTo(top[0][0], yb);
        for (const [x, y] of top) shape.lineTo(x, y);
        shape.lineTo(top[top.length - 1][0], yb);
        const sg = new THREE.ShapeGeometry(shape, 2);
        sg.applyQuaternion(fq);
        sg.translate(p.x, p.y, p.z);
        cloudGeos.push(sg);
        // bulbs: 42 evenly along the outline (top arc + bottom edge), element = index % 14
        const path = [...top, [top[top.length - 1][0], yb], [top[0][0], yb], top[0]];
        const segL = [];
        let total = 0;
        for (let k = 0; k + 1 < path.length; k++) {
          const l = Math.hypot(path[k + 1][0] - path[k][0], path[k + 1][1] - path[k][1]);
          segL.push(l);
          total += l;
        }
        for (let b = 0; b < 42; b++) {
          let d = (b / 42) * total;
          let k = 0;
          while (k < segL.length - 1 && d > segL[k]) d -= segL[k++];
          const t = segL[k] ? d / segL[k] : 0;
          const x = path[k][0] + (path[k + 1][0] - path[k][0]) * t;
          const y = path[k][1] + (path[k + 1][1] - path[k][1]) * t;
          const bp = V(x, y, 0.08).applyQuaternion(fq).add(p);
          per[b % 14].push(bulb(bp, 0.11));
        }
      }
      g.lights.push(...per);
      lightGroups[gid] = g;
    }
    const cloudMesh = mergeGeos(cloudGeos, cloudMat);
    owned.push(cloudMesh.geometry);
    root.add(cloudMesh);

    // ---- 15–18: laser heads under the floor and far out at the stands ---------------------------
    for (const [id, s] of [[15, -1], [16, 1]]) {
      const g = rotGroup(s > 0, false);
      for (let k = 0; k < 4; k++) {
        pushHead(g, movingHead(rig, beams, V(s * 2.7, -4.47, -7.28 - 10 * k), UP, UP, V(1, 0, 0), {
          len: 16, width: 0.1, halo: 0.6, start: 0.3, head: heads, headSize: [0.22, 0.2, 0.22],
        }));
      }
      lightGroups[id] = g;
    }
    for (const [id, s] of [[17, -1], [18, 1]]) {
      const g = rotGroup(s < 0, s > 0);
      for (let k = 0; k < 3; k++) {
        pushHead(g, movingHead(rig, beams, V(s * 41.09, 0, -58.2), UP, UP, V(0, 0, 1), {
          len: 70, width: 0.25, halo: 1.4, haloLen: 0.6, start: 0.4, head: heads, headSize: [0.5, 0.4, 0.5],
        }));
      }
      lightGroups[id] = g;
    }
    // ---- 19: laser arc behind the rainbow, beams toward the player ------------------------------
    {
      const g = rotGroup(false, true);
      for (let k = 0; k < 14; k++) {
        const a = (15 + k * (150 / 13)) * D2R;
        pushHead(g, movingHead(rig, beams, V(13.5 * Math.cos(a), 2.1 + 13.5 * Math.sin(a), -62.24), AUD, AUD, V(-Math.sin(a), Math.cos(a), 0), {
          len: 25, width: 0.08, halo: 0.5, start: 0.15, head: heads, headSize: [0.15, 0.15, 0.15], gains: [0.8, 1.2],
        }));
      }
      lightGroups[19] = g;
    }

    // ---- static: square rig truss, sky ---------------------------------------------------------
    const RIG = [[-17.9, -42.9], [17.9, -42.9], [17.9, -61.3], [-17.9, -61.3]];
    for (let k = 0; k < 4; k++) {
      const [ax, az] = RIG[k];
      const [bx, bz] = RIG[(k + 1) % 4];
      trussGeos(V(ax, 26.9, az), V(bx, 26.9, bz), 0.8, 2.6, 0.06, 3, statics);
    }
    statics.push(beamGeometry(V(-17.9, 26.6, -51.45), V(17.9, 26.6, -51.45), 0.25, 0.25));
    const staticMesh = mergeGeos(statics, standMat);
    owned.push(staticMesh.geometry);
    root.add(staticMesh);
    const sky = skyDome(0x12051a, 0x3a0c38, 0x05010a, 300);
    owned.push(sky.geometry, sky.material);
    root.add(sky);

    // ---- basic events ---------------------------------------------------------------------------
    const groups = { 0: [], 1: [], 2: [], 3: [], 4: [], 6: [], 7: [], 8: [], 9: [], 10: [], 11: [], 12: [] };
    for (const [ty, s] of [[0, -1], [1, 1]]) groups[ty].push(neon.light([{ m: barXYZ(s * 1.85, 0.02, -0.4, s * 1.85, 0.02, -160, 0.05, 0.02) }], { fat: 5, glowGain: 0.6 }));
    groups[2].push(ringRims[-1]);
    groups[3].push(ringRims[1]);
    {
      const bars = [];
      for (let k = 0; k < 4; k++) {
        const [ax, az] = RIG[k];
        const [bx, bz] = RIG[(k + 1) % 4];
        bars.push({ m: barXYZ(ax, 26.34, az, bx, 26.34, bz, 0.12, 0.12) });
      }
      groups[4].push(neon.light(bars, { fat: 4, glowGain: 0.7 }));
      groups[4].push(neon.light([
        { m: barXYZ(-1.65, 0.006, 1.0, -1.65, 0.006, -0.1, 0.04, 0.01) },
        { m: barXYZ(1.65, 0.006, 1.0, 1.65, 0.006, -0.1, 0.04, 0.01) },
        { m: barXYZ(-1.65, 0.006, 1.0, 1.65, 0.006, 1.0, 0.04, 0.01) },
      ], { fat: 5, glowGain: 0.8 }));
    }
    groups[7].push(peach(V(-17.89, 6.3 + 2.4, -11.46), 4.4));
    groups[8].push(peach(V(18.61, 7.55 + 2.4, -12.95), 4.4));
    groups[9].push(word('LI', V(-20.35, 9.06 + 2.5, -28.65), 4.6));
    groups[10].push(word('Z', V(-15.67, 12.58 + 2.7, -39.94), 5.0));
    groups[11].push(word('Z', V(15.41, 12.86 + 2.7, -39.06), 5.0));
    groups[12].push(word('O', V(20.06, 9.38 + 2.6, -29.32), 4.8));
    // 6: ambient glow behind everything (vertical gradient planes)
    let amb;
    {
      const g = new THREE.PlaneGeometry(1, 1, 1, 4);
      const pos = g.attributes.position;
      const col = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i++) {
        const t = pos.getY(i) + 0.5;
        const c = Math.pow(1 - t, 1.4) * 0.5;
        col.set([c, c, c], i * 3);
      }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      owned.push(g);
      amb = new LightBank(root, g, 3, { material: fadeBeamMaterial(1), renderOrder: -5 });
      const L = new MultiLight();
      L.push(amb.add(new THREE.Matrix4().compose(V(0, 20, -160), q.identity(), V(340, 110, 1))));
      L.push(amb.add(new THREE.Matrix4().compose(V(-150, 20, -40), new THREE.Quaternion().setFromAxisAngle(UP, Math.PI / 2), V(260, 110, 1))), 0.6);
      L.push(amb.add(new THREE.Matrix4().compose(V(150, 20, -40), new THREE.Quaternion().setFromAxisAngle(UP, -Math.PI / 2), V(260, 110, 1))), 0.6);
      groups[6].push(L);
    }

    rig.update(true);
    const banks = [tiles, ...bulbs.banks, ...neon.banks, ...beams.banks, heads, amb];
    return {
      root,
      banks,
      groups,
      lightGroups,
      update() {
        rig.update();
      },
      dispose() {
        bulbs.dispose();
        neon.dispose();
        beams.dispose();
        for (const b of [tiles, heads, amb]) {
          b.mesh.material.dispose();
          b.dispose();
        }
        for (const o of owned) o.dispose();
        root.removeFromParent();
      },
    };
  },
};
