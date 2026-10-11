// The Weeknd environment (v3 group lighting) — our own recreation from simple shapes, no game assets.
// Look: a night city street. The track runs between two rows of tall glowing lamp posts, each with
// a "gyroscope" of three nested rings beside it; big office blocks with 5 × 5 window grids rise on
// both sides (front faces and side faces lit separately, neon strips on the roof edges), a skyline of
// background towers all around, a ring with six lasers floating over the far end of the street, a
// stack of huge chevrons in the sky and side lasers shooting toward the player from far away.
//
// Light groups (id → what, elements, rotation / translation axes). Element order = official order.
//   0  Poles Left ............ 4  lamp posts, near → far              translation y (±5)
//   1  Poles Right ........... 4  same, right                          translation y (±5)
//   2  Rings Left (no light) . 4  ring sets of the left lamps          translation y (1 … 13)
//   3  Rings Right (no light)  4  same, right                          translation y (1 … 13)
//   4  Arrows ................ 8  sky chevrons, near → far             translation z (±100; + = away)
//   5  Side Lasers Left ...... 4  beams from far ahead toward the player  rotation x (mirror x),
//                                                                       translation x (±10), y (±18)
//   6  Side Lasers Right ..... 4  same, right (translation mirror x)
//   7  Runway Lane ........... 12 dashes on the centre line, near → far
//   8  Center Ring ........... 1  ring over the far end                rotation y, translation y (±5)
//   9  Center Ring Lasers .... 6  lasers around that ring (60° apart)  rotation x, y (ours: mirror x, y)
//   10 Left 1 Front .......... 25 5 × 5 windows, front face of the near left block (rows top → bottom,
//                                  serpentine, first row starting on the outer side)
//   11 Left 1 Side ........... 25 side face (toward the street) of that block (first row near → far)
//   12 Left 2 Side ........... 25 small windows on the side of the middle left block
//   13 Left 3 Front .......... 25 front face of the far left block
//   14 Left 3 Side ........... 25 side face of the far left block
//   15–19 Right 1 Front, Right 1 Side, Right 2 Side, Right 3 Front, Right 3 Side (mirror images)
//   20 Buildings Left (no light)  3  the three left blocks            translation x (±10), y (-10 … 0)
//   21 Buildings Right (no light) 3  same, right (mirror x)
//   22 Roof Left ............. 8  neon strips on the roof edges of left blocks 1 and 3
//   23 Roof Right ............ 8  same, right
//   29–32 Lamp Rings Left 1–4 . 3 each  the three nested rings of left lamp 1 … 4 (outer → inner;
//                                  each ring hangs inside the previous one)  rotation x, z;
//                                  translation y (±0.5)
//   33–36 Lamp Rings Right 1–4  3 each  same, right (rotation mirror z)
//   37 Background Left ....... 6  background towers on the left, by height tier (low → tall)
//   38 Background Right ...... 6  same, right
//   40 Side Buildings (no light) 2  the outermost block on each side   translation y (-10 … 0)
// (ids 24–28 and 39 are not used by the environment.)
// Basic events: 0 / 1 runway lasers left / right (long beams beside the track), 4 player platform
// glow, 6 ambient (haze), 5 colour boost.
//
// Sources (facts only — ids, names, counts, order, positions, axes, limits, default colours): the
// environment's scene data in ChroMapper (github.com/Caeden117/ChroMapper, dev branch,
// Assets/__Scenes/Environments/Data/TheWeekndEnvironment.json); ArcViewer's colour table;
// gameplay videos / thumbnails for the look.
// Approximate: shapes (posts are tubes, windows plain squares, chevrons flat V shapes), building
// bodies, the background skyline (procedural boxes; tiers by height like the original), the
// windows of the outermost blocks (left out), very distant objects (chevrons × 0.75, side lasers
// × 0.42, drawn closer but scaled so they look the same from the player).
import { THREE, GEO, SoftGlow, rng, stdMat } from './kit.js';
import { Builder, node, mat, ringGeometry, chevronGeometry, boxGeo, group, scheme, multi, D2R } from './_v3b.js';

const LAMP_Z = [6.55, 16.6, 26.6, 36.5];
const RING_R = 1.13;
const RING_S = [0.98, 0.81, 0.6];

export default {
  name: 'TheWeekndEnvironment',
  label: 'The Weeknd',
  colors: scheme({
    left: [0.584, 0.129, 0.129],
    right: [0.224, 0.29, 0.329],
    envLeft: [1, 0.298, 0.141],
    envRight: [0.167, 0.375, 0.708],
    envWhite: [0.877, 0.877, 0.877],
    envWhiteBoost: [0.98, 0.929, 0.863],
    wall: [0.918, 0.298, 0.008],
    envLeftBoost: [0.957, 0.604, 0.122],
    envRightBoost: [0.525, 0.827, 0.992],
  }),
  build() {
    const B = new Builder('TheWeekndEnvironment');
    const u = B.u;
    const m = B.m;
    const R = rng(1984);

    const concrete = stdMat(0x0d0c12, { roughness: 0.85, metalness: 0.15 });
    const tube = B.glow(GEO.tube, 120, { haloScale: 3, haloOpacity: 0.18 });
    const ringCore = B.own(ringGeometry(0.05, 3, 28));
    const ringHalo = B.own(ringGeometry(0.16, 3, 24));
    const rings = B.glow(ringCore, 30, { haloGeometry: ringHalo, haloOpacity: 0.2 });
    const win = B.bank(GEO.plane, 330);
    const chevCore = B.own(chevronGeometry(0.16));
    const chevHalo = B.own(chevronGeometry(0.42));
    const chev = B.glow(chevCore, 8, { haloGeometry: chevHalo, haloOpacity: 0.22 });
    const blocks = B.props(GEO.box, concrete, 80);
    const lg = {};

    // ---- lamps: posts (0 / 1), ring sets (2 / 3) and their nested rings (29–36)
    for (const [side, postId, setId, ringBase] of [[-1, 0, 2, 29], [1, 1, 3, 33]]) {
      const posts = [];
      const postPivots = [];
      const sets = [];
      LAMP_Z.forEach((z, k) => {
        const pp = node(u, [side * 5.72, 0, z]);
        postPivots.push(pp);
        posts.push(B.tube(pp, tube, [0, -7.5, 0], [0, 7.5, 0], 0.13));
        const set = node(u, [side * 4.36, 0, z], [0, side < 0 ? 270 : 90, 0]);
        sets.push(set);
        const rot = { x: [], z: [], mirror: { z: side > 0 } };
        const tr = { y: [] };
        const lights = [];
        let parent = set;
        for (let i = 0; i < 3; i++) {
          const wx = node(parent);
          const wz = node(wx);
          rot.x.push(wx);
          rot.z.push(wz);
          tr.y.push(wx);
          lights.push(B.light(wz, rings, mat([0, 0, 0], [0, 0, 0], RING_R * RING_S[i])));
          parent = wz;
        }
        lg[ringBase + k] = group(lights, { rot, tr });
      });
      lg[postId] = group(posts, { tr: { y: postPivots } });
      lg[setId] = group([], { count: 4, tr: { y: sets } });
    }

    // ---- 7: runway lane dashes (on the centre line, just above the track)
    {
      const L = [];
      for (let k = 0; k < 12; k++) L.push(B.tube(null, tube, [0, 0.015, 0.2 + 8 * k], [0, 0.015, 4.2 + 8 * k], 0.03, 2.5));
      lg[7] = group(L);
    }

    // ---- 8 / 9: centre ring with six lasers over the far end
    {
      const c = node(u, [0, 16.9, 100], [5.6, 0, 0]);
      lg[8] = group([B.light(c, rings, mat([0, 0, 0], [0, 0, 0], 7.7))], { rot: { y: [c] }, tr: { y: [c] } });
      const ry = [];
      const rx = [];
      const L = [];
      for (let k = 0; k < 6; k++) {
        const a = 60 * k * D2R;
        const base = node(c, [6.9 * Math.cos(a), -2, 6.9 * Math.sin(a)], [0, 270 - 60 * k, 0]);
        const src = node(base);
        ry.push(base);
        rx.push(src);
        // beam leaves downward, tilted slightly outward (Unity roll ≈ 175°)
        const t = 175 * D2R;
        L.push(B.tube(src, tube, [0, 0, 0], [-Math.sin(t) * 160, Math.cos(t) * 160, 0], 0.06, 2.5));
      }
      lg[9] = group(L, { rot: { x: rx, y: ry, mirror: { x: true, y: true } } }); // the game's bases are rolled ≈ 180° (ours: the beam)
    }

    // ---- 4: chevrons in the sky (drawn at 0.75 scale toward the player)
    {
      const sky = node(u, [0, 1.7, 0], [0, 0, 0], 0.75);
      const pivots = [];
      const L = [];
      const eye = new THREE.Vector3(0, 0, 0);
      for (let k = 0; k < 8; k++) {
        const p = node(sky, [0, 127.1 - 8.03 * k - 1.7, 60 + 34.07 * k]);
        pivots.push(p);
        // face the player, tip down
        const P = new THREE.Vector3(p.position.x, p.position.y, p.position.z);
        const look = new THREE.Matrix4().lookAt(P, eye, new THREE.Vector3(0, 1, 0));
        const q = new THREE.Quaternion().setFromRotationMatrix(look);
        const lm = new THREE.Matrix4().compose(new THREE.Vector3(), q, new THREE.Vector3(30, 22, 1));
        L.push(B.light(p, chev, lm));
      }
      lg[4] = group(L, { tr: { z: pivots } }); // + = away from the player (the game's mirror z is in a turned frame)
    }

    // ---- 5 / 6: side lasers from far ahead (drawn at 0.42 scale)
    {
      const far = node(u, [0, 1.7, 0], [0, 0, 0], 0.42);
      for (const [side, id] of [[-1, 5], [1, 6]]) {
        const tx = [];
        const rx = [];
        const L = [];
        for (let k = 0; k < 4; k++) {
          const sl = node(far, [side * 20, 16.3, 600], [270, 0, 0]);
          const rb = node(sl);
          tx.push(sl);
          rx.push(rb);
          L.push(B.tube(rb, tube, [0, 0, 0], [0, 700, 0], 0.12, 2.5));
        }
        lg[id] = group(L, { rot: { x: rx, mirror: { x: true } }, tr: { x: tx, y: tx, mirror: { x: side > 0 } } });
      }
    }

    // ---- buildings with window grids (10–23), side buildings (40)
    const winGrid = (pivot, cols, rows, face, size) => {
      // cols: positions along the face (first = start of the first row), rows: heights top → bottom
      const L = [];
      rows.forEach((y, r) => {
        const order = r % 2 ? [...cols].reverse() : cols;
        for (const c of order) {
          const p = face.axis === 'z' ? [c, y, face.at] : [face.at, y, c];
          const rot = face.axis === 'z' ? [0, 0, 0] : [0, 90, 0];
          L.push(B.light(pivot, win, mat(p.map((v, i) => v - pivot.position.getComponent(i)), rot, [size[0], size[1], 1])));
        }
      });
      return L;
    };
    const span = (a, b, n) => Array.from({ length: n }, (_, i) => a + ((b - a) * i) / (n - 1));
    const bodies = (pivot, x0, x1, z0, z1, top) => {
      const P = pivot.position;
      const cx = (x0 + x1) / 2;
      const cz = (z0 + z1) / 2;
      const bottom = -110;
      B.prop(pivot, blocks, mat([cx - P.x, (top + bottom) / 2 - P.y, cz - P.z], [0, 0, 0], [Math.abs(x1 - x0), top - bottom, Math.abs(z1 - z0)]));
      // floor slabs sticking out a little
      for (let y = top - 3; y > -40; y -= 11.3) {
        B.prop(pivot, blocks, mat([cx - P.x, y - P.y, cz - P.z], [0, 0, 0], [Math.abs(x1 - x0) + 2, 0.9, Math.abs(z1 - z0) + 2]));
      }
    };
    const roofStrip = (pivot, a, b) => {
      const P = pivot.position;
      return B.tube(pivot, tube, [a[0] - P.x, a[1] - P.y, a[2] - P.z], [b[0] - P.x, b[1] - P.y, b[2] - P.z], 0.18, 3);
    };
    for (const [s, ids, bId, roofId] of [[-1, [10, 11, 12, 13, 14], 20, 22], [1, [15, 16, 17, 18, 19], 21, 23]]) {
      const X = (x) => s * -x; // left-side coordinates (negative x) mirrored for the right
      const w1 = node(u, [X(-49.7), -41.8, 61.2]);
      const w2 = node(u, [X(-48.1), -48.1, 112]);
      const w3 = node(u, [X(-31.4), -34.5, 171.7]);
      // block 1: front (z = 33) and street side (x = -47)
      lg[ids[0]] = group(winGrid(w1, span(X(-86.6), X(-51.5), 5), span(36.7, -8.6, 5), { axis: 'z', at: 33.1 }, [5.8, 7.4]));
      lg[ids[1]] = group(winGrid(w1, span(39.9, 80.8, 5), span(36.6, -8.8, 5), { axis: 'x', at: X(-46.9) }, [6.8, 7.4]));
      bodies(w1, X(-91), X(-47.2), 33.5, 86, 43);
      // block 2: small windows on its street side (x = -32.9)
      lg[ids[2]] = group(winGrid(w2, span(101.3, 122.9, 5), span(12.7, -25.3, 5), { axis: 'x', at: X(-32.8) }, [2.6, 1.6]));
      bodies(w2, X(-58), X(-33.1), 97, 127, 18);
      // block 3: front (z = 145) and street side (x = -26)
      lg[ids[3]] = group(winGrid(w3, span(X(-64.3), X(-31.9), 5), span(36.7, -4.7, 5), { axis: 'z', at: 145.1 }, [5.4, 6.8]));
      lg[ids[4]] = group(winGrid(w3, span(152.2, 189.7, 5), span(37.1, -4.3, 5), { axis: 'x', at: X(-26.1) }, [6.2, 6.8]));
      bodies(w3, X(-69), X(-26.3), 145.4, 196, 43);
      lg[bId] = group([], { count: 3, tr: { x: [w1, w2, w3], y: [w1, w2, w3], mirror: { x: s > 0 } } });
      // roof neon strips: block 1 front (2), block 1 side (2), block 3 front (2), block 3 side (2)
      const ry = 45.8;
      lg[roofId] = group([
        roofStrip(w1, [X(-91), ry, 33.3], [X(-73), ry, 33.3]),
        roofStrip(w1, [X(-69), ry, 33.3], [X(-51), ry, 33.3]),
        roofStrip(w1, [X(-47), ry, 37], [X(-47), ry, 56]),
        roofStrip(w1, [X(-47), ry, 59], [X(-47), ry, 78]),
        roofStrip(w3, [X(-66), ry, 145.2], [X(-46.5), ry, 145.2]),
        roofStrip(w3, [X(-45.5), ry, 145.2], [X(-26), ry, 145.2]),
        roofStrip(w3, [X(-26), ry, 148], [X(-26), ry, 167]),
        roofStrip(w3, [X(-26), ry, 169], [X(-26), ry, 188]),
      ]);
    }
    {
      // 40: outermost block on each side (beside / slightly behind the player)
      const pivots = [-1, 1].map((s) => {
        const p = node(u, [0, 0, 0]);
        bodies(p, s * 56, s * 85, -10, 18.6, 34.8);
        return p;
      });
      lg[40] = group([], { count: 2, tr: { y: pivots } });
    }

    // ---- 37 / 38: background skyline, tiers by height (lit facades)
    {
      const facade = B.bank(GEO.plane, 260, { opacity: 0.32 });
      const geos = [];
      for (const [s, id] of [[-1, 37], [1, 38]]) {
        const tiers = [[], [], [], [], [], []];
        for (let i = 0; i < 70; i++) {
          // ring of towers 110 … 260 m away, around the whole street (also behind the player)
          const a = (-80 + R() * 250) * D2R;
          const d = 110 + R() * 150;
          const x = s * (Math.abs(Math.cos(a)) * d + 60);
          const z = Math.sin(a) * d * 1.3 + 60;
          const tier = Math.min(5, Math.floor(Math.pow(R(), 1.7) * 6));
          const h = 30 + tier * 34 + R() * 20;
          const w = 12 + R() * 16;
          geos.push(boxGeo([x, -60 + h / 2, z], [w, h, w]));
          // facade facing the street
          tiers[tier].push(facade.add(mat([x - s * (w / 2 + 0.05), -60 + h * 0.62, z], [0, 90, 0], [w * 0.8, h * 0.66, 1])));
        }
        lg[id] = group(tiers.map((t) => multi(...t)));
      }
      B.merge(geos, stdMat(0x07070c, { roughness: 0.9, metalness: 0.1 }));
    }

    // ---- static: the ground far below the street, a dark slab under the track
    {
      const ground = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), stdMat(0x050508, { roughness: 1, metalness: 0 }));
      ground.rotation.x = -Math.PI / 2;
      ground.position.set(0, -60, -150);
      B.add(ground);
      B.merge([boxGeo([0, -1.2, 120], [4.8, 2.3, 260])], stdMat(0x0b0b10, { roughness: 0.4, metalness: 0.5 }));
    }

    // ---- basic events: runway lasers (0 / 1), platform glow (4), ambient haze (6)
    const groups = {
      0: [B.tube(null, tube, [-2.5, 0.1, -20], [-2.5, 0.1, 300], 0.04, 3)],
      1: [B.tube(null, tube, [2.5, 0.1, -20], [2.5, 0.1, 300], 0.04, 3)],
      4: [multi(
        B.tube(null, tube, [-1.5, 0.01, -1], [1.5, 0.01, -1], 0.025, 3),
        B.tube(null, tube, [-1.5, 0.01, 1], [1.5, 0.01, 1], 0.025, 3),
        B.tube(null, tube, [-1.5, 0.01, -1], [-1.5, 0.01, 1], 0.025, 3),
        B.tube(null, tube, [1.5, 0.01, -1], [1.5, 0.01, 1], 0.025, 3),
      )],
    };
    const haze = new SoftGlow(B.root, 700, 260, new THREE.Vector3(0, 30, -280), { gain: 0.18, power: 1.6 });
    B.owned.push(haze);
    groups[6] = [haze];

    return B.finish({
      groups,
      lightGroups: lg,
      background: 0x020206,
      fog: { color: 0x030308, near: 70, far: 420 },
    });
  },
};
