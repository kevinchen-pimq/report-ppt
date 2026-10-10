// Kaleidoscope environment (OST 4): a dark void with a spiral of 20 thin rings, each carrying two
// inward-pointing square pyramids (one above, one below the track) whose edge loops light up —
// seen down the runway they form jagged arcs of light — and, far behind, 20 back rings that each
// shoot two long beams outward, forming two sunburst fans. Recreated with simple shapes.
//
// Light groups (v2 basic event type → lights, Chroma lightID n = groups[type][n - 1]):
//   0  pyramid tip loops ....... 40  (ring 1 top, ring 1 bottom, ring 2 top, …)
//   1  pyramid middle loops .... 40  (same order)
//   2  inner loops, top pyramids 20  (ring 1 → 20)
//   3  inner loops, bottom ..... 20  (ring 1 → 20)
//   4  outer (base) loops ...... 80  (1–40 like type 0, then 41–80 the back-ring beams:
//                                    back ring 1 lower beam, back ring 1 upper beam, …)
// Counts: Chroma's light ID table for KaleidoscopeEnvironment (Aeroluna/Heck). Order and layout:
// ArcViewer's community recreation (facts only). Pyramid size / loop heights: approximate.
// Rings: 'small' = the 20 pyramid rings (event 8 spin, event 9 zoom 1 m ↔ 3 m spacing),
// 'big' = the 20 back rings (spin). No lasers (no laser-speed events in this environment).
import { THREE } from './kit.js';
import { LightSet, Rig, InstBank, barXYZ, stdMat, mergeGeos } from './_dKit.js';

const CY = 1.5; // ring centre height
const RB = 15; // radial distance of the pyramid base
const RT = 6; // radial distance of the pyramid tip
const HD = 3.0; // half diagonal of the pyramid base
const LOOP_T = { outer: 0.05, mid: 0.4, close: 0.65, tip: 0.88 };
const D2R = Math.PI / 180;

export default {
  name: 'KaleidoscopeEnvironment',
  label: 'Kaleidoscope',
  colors: {
    left: '#a82020',
    right: '#484848',
    envLeft: '#a82020',
    envRight: '#787878',
    envLeftBoost: '#800000',
    envRightBoost: '#7e0089',
    wall: '#404040',
  },
  build() {
    const root = new THREE.Group();
    root.name = 'KaleidoscopeEnvironment';
    const dark = stdMat(0x07070b, { roughness: 0.3, metalness: 0.7, flat: true });
    const block = stdMat(0x10131f, { roughness: 0.5, metalness: 0.4 });
    const owned = [dark, block];

    const lights = new LightSet(root, { max: 720, glowOpacity: 0.16 });
    const rig = new Rig(root);
    const pyrGeo = new THREE.ConeGeometry(HD, RB - RT + 0.6, 4, 1, false);
    owned.push(pyrGeo);
    const bodies = new InstBank(root, pyrGeo, dark, 40);
    const groups = { 0: [], 1: [], 2: [], 3: [], 4: [] };
    const outer = [];
    const tmp = new THREE.Matrix4();
    const rot = new THREE.Matrix4();

    // one diamond loop of 4 bars around the radial axis at distance r, in ring-local space,
    // for the pyramid on side `up` (+1 above, -1 below), all rotated by the ring's base angle
    const loop = (up, t, base, proxy) => {
      const r = (RB - t * (RB - RT)) * up;
      const h = HD * (1 - t) + 0.05;
      const pts = [[h, 0], [0, h], [-h, 0], [0, -h]];
      const bars = [];
      for (let k = 0; k < 4; k++) {
        const [ax, az] = pts[k];
        const [bx, bz] = pts[(k + 1) % 4];
        const m = barXYZ(ax, r, az, bx, r, bz, 0.13, 0.13);
        bars.push({ m: new THREE.Matrix4().multiplyMatrices(rot.makeRotationZ(base), m) });
      }
      return lights.light(bars, { fat: 3, glowGain: 0.9, rig, proxy });
    };

    // ---- 20 pyramid rings ---------------------------------------------------------------------
    const mainRings = [];
    for (let i = 0; i < 20; i++) {
      const p = rig.proxy(0, CY, -12 - i);
      const base = 15 * i * D2R;
      mainRings.push(p);
      const L = {};
      for (const up of [1, -1]) {
        L[up] = {
          tip: loop(up, LOOP_T.tip, base, p),
          mid: loop(up, LOOP_T.mid, base, p),
          close: loop(up, LOOP_T.close, base, p),
          outer: loop(up, LOOP_T.outer, base, p),
        };
        // dark pyramid body (cone with 4 sides, tip toward the centre)
        const yMid = up * (RB + RT - 0.6) / 2;
        tmp.makeRotationZ(base);
        const body = new THREE.Matrix4().compose(
          new THREE.Vector3(0, yMid, 0),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(up > 0 ? Math.PI : 0, Math.PI / 4, 0)),
          new THREE.Vector3(1, 1, 1),
        );
        rig.attach(p, bodies, tmp.multiply(body));
      }
      groups[0].push(L[1].tip, L[-1].tip);
      groups[1].push(L[1].mid, L[-1].mid);
      groups[2].push(L[1].close);
      groups[3].push(L[-1].close);
      outer.push(L[1].outer, L[-1].outer);
    }
    groups[4].push(...outer);

    // ---- 20 back rings with two outward beams each --------------------------------------------
    const backRings = [];
    const tilt = 25 * D2R;
    for (let k = 0; k < 20; k++) {
      const p = rig.proxy(0, CY - 0.5, -107);
      backRings.push(p);
      const base = 4 * k * D2R;
      for (const up of [-1, 1]) {
        const dy = Math.cos(tilt) * up;
        const dz = -Math.sin(tilt);
        const r0 = 1.2;
        const r1 = 260;
        const m = barXYZ(0, dy * r0, dz * r0, 0, dy * r1, dz * r1, 0.35, 0.35);
        const L = lights.light([{ m: new THREE.Matrix4().multiplyMatrices(rot.makeRotationZ(base), m) }], { fat: 4, glowGain: 0.7, rig, proxy: p });
        groups[4].push(L);
      }
    }

    // a few dark blocks around the player platform
    const bgeos = [];
    for (const s of [-1, 1]) {
      for (const [x, top, z, w, h, d] of [[3.4, -0.1, -2, 3, 0.8, 9], [6.6, 0.3, -6, 3.2, 1.2, 12], [10.2, 0.8, -11, 3.6, 1.8, 14]]) {
        const g = new THREE.BoxGeometry(w, h, d);
        g.translate(s * x, top - h / 2 - 0.05, z);
        bgeos.push(g);
      }
    }
    const blockMesh = mergeGeos(bgeos, block);
    root.add(blockMesh);
    owned.push(blockMesh.geometry);

    rig.sync();
    const banks = [...lights.banks, bodies];
    return {
      root,
      banks,
      groups,
      rings: [
        { type: 'small', objects: mainRings, step: 5, zoom: { near: 1, far: 3 } },
        { type: 'big', objects: backRings, step: 2 },
      ],
      lasers: { left: [], right: [] },
      update() {
        rig.sync();
      },
      dispose() {
        lights.dispose();
        bodies.dispose();
        for (const o of owned) o.dispose();
        root.removeFromParent();
      },
    };
  },
};
