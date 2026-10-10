// Skrillex environment (Skrillex music pack): a dark, mirrored void around the track. Long laser
// lines run along the track on an octagon around it, every 25 m an octagon-like slice of short
// bars (top diagonal, side, bottom diagonal) frames the runway, rows of "moving" vertical bars run
// along both sides, big diamond-shaped rings stand far apart down the track and the spiky logo
// shards sit at the end, mirrored above and below. Recreated with simple shapes for this project.
//
// Light groups (v2 basic event type → lights, Chroma lightID n = groups[type][n - 1]):
//   0  logo shards ..................... 8   (1–4 upper shards left → right, 5–8 the mirrored
//                                             lower shards; split into 8: approximate)
//   1  secondary (lower) ring lights ... 66  (1–6 lower long lines / far V: LL, LB, LM, RM, RB,
//                                             RR, then 5 secondary diamond rings × 12 segments,
//                                             near → far, each ring clockwise from the left corner)
//   2  left lights ..................... 23  (1 floor logo, 2 far side line, then 7 slices near →
//                                             far × [upper diagonal, side bar, lower diagonal])
//   3  right lights .................... 23  (mirror of 2)
//   4  primary (upper) ring lights ..... 66  (like 1: upper lines LL, LB, LT, RT, RB, RR + 5
//                                             primary rings × 12)
//   6  extra left lasers ............... 24  (1–4 long octagon-corner lines TT, TM, BM, BB, then
//                                             20 moving vertical bars near → far)
//   7  extra right lasers .............. 24  (mirror of 6)
// Counts: Chroma's light ID table for SkrillexEnvironment (Aeroluna/Heck). Order, layout and
// rough positions: ChroMapper's community recreation (facts only); ring size: approximate.
// Rings: 'big' = primary rings (event 8 spin), 'small' = secondary rings (spin; the official
// environment spins them on event 9 together with a laser mode, there is no ring zoom).
// Lasers: event 12 / 13 speed drives the 20 moving bars per side up and down.
import { THREE } from './kit.js';
import { LightBank } from './kit.js';
import { LightSet, Rig, InstBank, MultiLight, barXYZ, stdMat } from './_dKit.js';

const CY = 1.5; // the environment is mirrored around this height
const NEAR = 25;
const FAR = -260;
const RING_R = 79; // half diagonal of the (huge) diamond rings
const S2 = Math.SQRT1_2;

export default {
  name: 'SkrillexEnvironment',
  label: 'Skrillex',
  colors: {
    left: '#b2245e',
    right: '#545261',
    envLeft: '#cc4795',
    envRight: '#119391',
    envLeftBoost: '#cf4e4e',
    envRightBoost: '#47cc72',
    wall: '#289a9a',
  },
  build() {
    const root = new THREE.Group();
    root.name = 'SkrillexEnvironment';
    const frameMat = stdMat(0x101016, { roughness: 0.45, metalness: 0.6 });
    const owned = [frameMat];

    const lights = new LightSet(root, { max: 320, glowOpacity: 0.17 });
    const rig = new Rig(root);
    const groups = { 0: [], 1: [], 2: [], 3: [], 4: [], 6: [], 7: [] };
    const line = (x, y, w = 0.07) => lights.light([{ m: barXYZ(x, y, NEAR, x, y, FAR, w) }], { fat: 4, glowGain: 0.8 });
    // short bar centred at (x, y, z) along direction (dx, dy) in the XY plane
    const stub = (x, y, z, dx, dy, len, w = 0.14) =>
      lights.light([{ m: barXYZ(x - (dx * len) / 2, y - (dy * len) / 2, z, x + (dx * len) / 2, y + (dy * len) / 2, z, w) }], { fat: 3.5 });

    // ---- 1 / 4: long lines + far V / Λ (6 each) --------------------------------------------
    const up = (y) => CY + y; // heights relative to the mirror centre
    groups[4].push(
      line(-9.5, up(4.5)), // LL
      stub(-5, up(5), -180, S2, S2, 5), // LB
      line(-4.5, up(9.5)), // LT
      line(4.5, up(9.5)), // RT
      stub(5, up(5), -180, -S2, S2, 5), // RB
      line(9.5, up(4.5)), // RR
    );
    groups[1].push(
      line(-9.5, up(-4.5)), // LL
      stub(-5, up(-5), -180, -S2, S2, 5), // LB
      line(-4.5, up(-9.5)), // LM
      line(4.5, up(-9.5)), // RM
      stub(5, up(-5), -180, S2, S2, 5), // RB
      line(9.5, up(-4.5)), // RR
    );

    // ---- diamond rings ------------------------------------------------------------------------
    const frames = new InstBank(root, new THREE.BoxGeometry(1, 1, 1), frameMat, 40);
    owned.push(frames.mesh.geometry);
    const corners = [[-1, 0], [0, 1], [1, 0], [0, -1]]; // left, top, right, bottom
    const SEG = [[0.0, 0.18], [0.29, 0.71], [0.82, 1.0]]; // fractions of a side (R, M, L)
    const makeRing = (z, type) => {
      const p = rig.proxy(0, CY, z);
      for (let s = 0; s < 4; s++) {
        const [ax, ay] = corners[s];
        const [bx, by] = corners[(s + 1) % 4];
        // dark frame beam on the outside of the light segments
        const fm = barXYZ(ax * (RING_R + 3), ay * (RING_R + 3), 0, bx * (RING_R + 3), by * (RING_R + 3), 0, 4, 3);
        rig.attach(p, frames, fm);
        for (const [t0, t1] of SEG) {
          const m = barXYZ(
            (ax + (bx - ax) * t0) * RING_R, (ay + (by - ay) * t0) * RING_R, 0.75,
            (ax + (bx - ax) * t1) * RING_R, (ay + (by - ay) * t1) * RING_R, 1.6, 0.7, 0.7,
          );
          groups[type].push(lights.light([{ m }], { fat: 4, rig, proxy: p }));
        }
      }
      return p;
    };
    const primary = [];
    const secondary = [];
    for (let k = 0; k < 5; k++) {
      secondary.push(makeRing(-5 - 50 * k, 1));
      primary.push(makeRing(-20 - 50 * k, 4));
    }

    // ---- 2 / 3: floor logo, far side line, 7 slices -------------------------------------------
    for (const [type, s] of [[2, -1], [3, 1]]) {
      groups[type].push(logoScribble(lights, s));
      groups[type].push(line(s * 20, CY, 0.12));
      for (let k = 0; k < 7; k++) {
        const z = 10 - 25 * k;
        groups[type].push(
          stub(s * 7.4, up(7.4), z, S2, -s * S2, 5.2), // upper diagonal (tangent of the octagon)
          stub(s * 9.5, CY, z, 0, 1, 3.6), // side bar
          stub(s * 7.4, up(-7.4), z, S2, s * S2, 5.2), // lower diagonal
        );
      }
    }

    // ---- 6 / 7: octagon corner lines + 20 moving bars -----------------------------------------
    const lasers = { left: [], right: [] };
    for (const [type, s, list] of [[6, -1, lasers.left], [7, 1, lasers.right]]) {
      groups[type].push(line(s * 4.2, up(15)), line(s * 15, up(4.2)), line(s * 15, up(-4.2)), line(s * 4.2, up(-15)));
      for (let i = 0; i < 20; i++) {
        const z = -10 * i;
        const p = rig.proxy(s * 12.5, CY, z);
        const off = i * 0.55;
        p.userData.map = (proxy, out) => out.makeTranslation(proxy.position.x, CY + Math.sin(proxy.rotation.z + off) * 2.2, proxy.position.z);
        groups[type].push(lights.light([{ m: barXYZ(0, -2.2, 0, 0, 2.2, 0, 0.13) }], { fat: 3.5, rig, proxy: p }));
        list.push(p);
      }
    }

    // ---- 0: logo shards (own bank: triangular prisms) -----------------------------------------
    const shardGeo = new THREE.BufferGeometry();
    {
      // thin triangle (base at y = 0 from x -0.5..0.5, tip at y = 1), extruded ±0.5 in z
      const v = [-0.5, 0, 0.5, 0.5, 0, 0.5, 0, 1, 0.5, -0.5, 0, -0.5, 0.5, 0, -0.5, 0, 1, -0.5];
      const idx = [0, 1, 2, 5, 4, 3, 0, 3, 4, 0, 4, 1, 1, 4, 5, 1, 5, 2, 2, 5, 3, 2, 3, 0];
      shardGeo.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
      shardGeo.setIndex(idx);
      shardGeo.computeVertexNormals();
    }
    owned.push(shardGeo);
    const shards = new LightBank(root, shardGeo, 8);
    const shardDefs = [[-3.4, 10, 1.4, -0.18], [-1.2, 14, 1.6, -0.06], [1.0, 12, 1.5, 0.05], [3.1, 8.5, 1.2, 0.16]];
    const zLogo = -120;
    for (const sign of [1, -1]) {
      for (const [x, h, w, tilt] of shardDefs) {
        const m = new THREE.Matrix4().compose(
          new THREE.Vector3(x, CY + sign * 4.5, zLogo),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, sign > 0 ? tilt : Math.PI - tilt)),
          new THREE.Vector3(w, h, 0.6),
        );
        const L = new MultiLight([shards.add(m)], [1]);
        const gm = new THREE.Matrix4().compose(
          new THREE.Vector3(x, CY + sign * (4.5 + h * 0.45), zLogo - 0.4),
          new THREE.Quaternion(),
          new THREE.Vector3(w * 2.6, h * 1.05, 0.05),
        );
        L.push(lights.glow.add(gm), 0.45);
        groups[0].push(L);
      }
    }

    rig.sync();
    const banks = [...lights.banks, shards, frames];
    return {
      root,
      banks,
      groups,
      rings: [
        { type: 'big', objects: primary, step: 8 },
        { type: 'small', objects: secondary, step: 8 },
      ],
      lasers,
      update() {
        rig.sync();
      },
      dispose() {
        lights.dispose();
        shards.mesh.material.dispose();
        shards.dispose();
        frames.dispose();
        for (const o of owned) o.dispose();
        root.removeFromParent();
      },
    };
  },
};

// The jagged "SKRILLEX" floor logo as one light: a spiky zigzag scribble lying on the lower
// diagonal wall of the octagon, beside the track (side s = -1 left, +1 right).
function logoScribble(lights, s) {
  const pts = [
    [0, 0.2], [0.35, 1.3], [0.6, 0.1], [0.95, 1.5], [1.2, 0.3], [1.5, 1.2], [1.65, 0.0], [2.0, 1.6], [2.3, 0.4],
    [2.6, 1.3], [2.85, 0.1], [3.2, 1.45], [3.5, 0.35], [3.8, 1.25], [4.1, 0.0], [4.5, 1.5], [4.8, 0.5],
  ];
  // wall basis: across = along the lower diagonal (toward the centre-top), along = -Z
  const ox = s * 6.2;
  const oy = CY - 5.0;
  const ux = -s * Math.SQRT1_2;
  const uy = Math.SQRT1_2;
  const z0 = -20;
  const bars = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const [a0, b0] = pts[i];
    const [a1, b1] = pts[i + 1];
    bars.push({
      m: barXYZ(ox + ux * b0 * 1.2, oy + uy * b0 * 1.2, z0 - a0 * 1.6, ox + ux * b1 * 1.2, oy + uy * b1 * 1.2, z0 - a1 * 1.6, 0.1),
    });
  }
  return lights.light(bars, { fat: 3, glowGain: 0.7 });
}
