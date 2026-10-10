// BTS environment (BTS music pack): the track floats above a sea of clouds toward the glowing BTS
// "door" logo, which hangs between two rows of tall dark pillars; fans of lasers shoot sideways out
// of the pillars, beams rise from their tops, a staircase climbs toward the logo and two huge
// striped towers (stacked slabs that spin) stand far out on the left and right.
// Recreated with simple shapes for this project.
//
// Light groups (v2 basic event type → lights, Chroma lightID n = groups[type][n - 1]):
//   0  logo ............................ 3   (1 left door, 2 right door, 3 logo reflection)
//   1  center lasers (rising beams) .... 20  (1–8 left pillars near → far, 2 beams each,
//                                             9–16 right pillars, 17–18 left far beams,
//                                             19–20 right far beams)
//   2  left lasers ..................... 27  (9 emitters on the left pillars, near/low → far/high,
//                                             3 beams each)
//   3  right lasers .................... 27  (mirror of 2)
//   4  runway lights ................... 5   (1 left rail, 2 right rail, 3 left stair edge,
//                                             4 right stair edge, 5 cross bar at the stair foot)
// Counts: Chroma's light ID table for BTSEnvironment (Aeroluna/Heck). Layout and rough positions:
// ChroMapper's community recreation (facts only); the in-group ID order is approximate.
// Rings: two 'big' ring sets = the 30 slabs of each striped tower (event 8 "tower spin" rotates
// them around the vertical axis). Event 9 (pillar control) is not modelled. Lasers: the 9 emitters
// per side spin around the track axis with events 12 / 13.
import { THREE } from './kit.js';
import { LightSet, Rig, InstBank, MultiLight, SoftGlow, barXYZ, wash, stdMat, mergeGeos } from './_dKit.js';

const D2R = Math.PI / 180;
const PILLARS = [
  // [x (abs), z, top y]  — near → far
  [7.2, -46, 4.5],
  [7.6, -56, 6.5],
  [8.0, -66, 8.5],
  [8.4, -76, 10.5],
];
const LOGO_Z = -90;
const LOGO_Y = 10;

export default {
  name: 'BTSEnvironment',
  label: 'BTS',
  colors: {
    left: '#ff1768',
    right: '#cc00c0',
    envLeft: '#c82080',
    envRight: '#b120dd',
    envLeftBoost: '#e68aff',
    envRightBoost: '#59ceff',
    wall: '#ab2e8d',
  },
  build() {
    const root = new THREE.Group();
    root.name = 'BTSEnvironment';
    const stone = stdMat(0x16121e, { roughness: 0.7, metalness: 0.2 });
    const towerMat = stdMat(0x2a2638, { roughness: 0.8, metalness: 0.1 });
    const cloudMat = stdMat(0x16121e, { roughness: 1.0, metalness: 0.0 });
    const owned = [stone, towerMat, cloudMat];

    // ---- static: pillars, logo blocks, staircase ----------------------------------------------
    const sg = [];
    for (const s of [-1, 1]) {
      for (const [x, z, top] of PILLARS) {
        const h = top + 14;
        const g = new THREE.BoxGeometry(2.6, h, 2.6);
        g.rotateY(45 * D2R);
        g.translate(s * x, top - h / 2, z);
        sg.push(g);
      }
      // big blocks flanking the logo
      const b = new THREE.BoxGeometry(3.6, 30, 5);
      b.translate(s * 5.6, LOGO_Y + 4 - 15, LOGO_Z + 3);
      sg.push(b);
    }
    for (let i = 0; i < 16; i++) {
      const z0 = -42 - i * 3.4;
      const top = -0.3 + i * 0.55;
      const g = new THREE.BoxGeometry(5.2, 3, 3.4);
      g.translate(0, top - 1.5, z0 - 1.7);
      sg.push(g);
    }
    const statics = mergeGeos(sg, stone);
    root.add(statics);
    owned.push(statics.geometry);

    // ---- clouds (instanced puffs below the track) ---------------------------------------------
    const puffGeo = new THREE.IcosahedronGeometry(1, 1);
    {
      // smooth normals (the icosahedron is non-indexed and would look faceted)
      const pa = puffGeo.attributes.position;
      const na = puffGeo.attributes.normal;
      for (let i = 0; i < pa.count; i++) {
        const x = pa.getX(i);
        const y = pa.getY(i);
        const z = pa.getZ(i);
        const l = Math.hypot(x, y, z) || 1;
        na.setXYZ(i, x / l, y / l, z / l);
      }
    }
    owned.push(puffGeo);
    const clouds = new InstBank(root, puffGeo, cloudMat, 150);
    {
      let seed = 7;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      // clusters of puffs (cumulus-like), keeping clear of the track near the player
      for (let c = 0; c < 30; c++) {
        const side = c % 2 ? 1 : -1;
        const cz = 10 - rnd() * 165;
        const cx = side * (11 + rnd() * 70);
        const cy = -6 - rnd() * 3;
        for (let i = 0; i < 5; i++) {
          const r = 2.5 + rnd() * 4;
          const x = cx + (rnd() - 0.5) * 12;
          const z = cz + (rnd() - 0.5) * 10;
          const y = cy + r * 0.25 + rnd() * 1.2;
          q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * 6);
          m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(r * 1.3, r * 0.7, r));
          clouds.add(m);
        }
      }
    }

    // ---- towers: 2 × 30 spinning slabs --------------------------------------------------------
    const rig = new Rig(root);
    const slabGeo = new THREE.BoxGeometry(1, 1, 1);
    owned.push(slabGeo);
    const slabs = new InstBank(root, slabGeo, towerMat, 60);
    const towers = [];
    for (const s of [-1, 1]) {
      const list = [];
      for (let i = 0; i < 30; i++) {
        // proxy rotated so its local Z is world up: ring spin (rotation.z) turns the slab
        const p = rig.proxy(s * 34, -22 + i * 2.1, -100, -Math.PI / 2, 0, 0);
        const local = new THREE.Matrix4().compose(
          new THREE.Vector3(0, 0, 0),
          new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), i * 5 * D2R),
          new THREE.Vector3(9, 9, 1.25), // local X/Y = horizontal, local Z = height
        );
        rig.attach(p, slabs, local);
        list.push(p);
      }
      towers.push(list);
    }

    // ---- lights -------------------------------------------------------------------------------
    const lights = new LightSet(root, { max: 200, glowOpacity: 0.2 });
    const groups = { 0: [], 1: [], 2: [], 3: [], 4: [] };

    // 0: logo — two "doors" (trapezoid outlines), plus a dimmer reflection below
    const door = (s, yBase, flip, gain) => {
      // outer edge taller than the inner edge; s = -1 left door, +1 right door
      const H = 6;
      const xi = s * 0.5; // inner edge x
      const xo = s * 3; // outer edge x
      const f = flip ? -1 : 1;
      const yo0 = yBase;
      const yo1 = yBase + f * H;
      const yi0 = yBase + f * H * 0.12;
      const yi1 = yBase + f * H * 0.82;
      const w = 0.24;
      const bars = [
        { m: barXYZ(xo, yo0, LOGO_Z, xo, yo1, LOGO_Z, w, 0.1) },
        { m: barXYZ(xi, yi0, LOGO_Z, xi, yi1, LOGO_Z, w, 0.1) },
        { m: barXYZ(xo, yo1, LOGO_Z, xi, yi1, LOGO_Z, w, 0.1) },
        { m: barXYZ(xo, yo0, LOGO_Z, xi, yi0, LOGO_Z, w, 0.1) },
      ];
      return lights.light(bars, { fat: 3, glowGain: 0.9, coreGain: gain });
    };
    const leftDoor = door(-1, LOGO_Y - 3, false, 1);
    const rightDoor = door(1, LOGO_Y - 3, false, 1);
    const halo = lights.glow.add(barXYZ(0, LOGO_Y - 6, LOGO_Z - 0.6, 0, LOGO_Y + 6, LOGO_Z - 0.6, 12, 0.02));
    leftDoor.push(halo, 0.25);
    rightDoor.push(halo, 0.25);
    const refl = new MultiLight();
    for (const s of [-1, 1]) {
      const L = door(s, LOGO_Y - 6.6, true, 0.35);
      refl.push(L, 1);
    }
    groups[0].push(leftDoor, rightDoor, refl);

    // 1: rising beams from the pillar tops, then far diagonal beams
    const rising = { [-1]: [], [1]: [] };
    for (const s of [-1, 1]) {
      for (const [x, z, top] of PILLARS) {
        for (const lean of [4, 11]) {
          const a = lean * D2R;
          const x0 = s * x;
          rising[s].push(lights.light([{ m: barXYZ(x0, top, z, x0 + s * Math.sin(a) * 140, top + Math.cos(a) * 140, z - 10, 0.09) }], { fat: 4 }));
        }
      }
    }
    const far = { [-1]: [], [1]: [] };
    for (const s of [-1, 1]) {
      for (const y of [2, 12]) {
        far[s].push(lights.light([{ m: barXYZ(s * 26, y, -150, s * 150, y + 18, -30, 0.25) }], { fat: 4, glowGain: 0.7 }));
      }
    }
    groups[1].push(...rising[-1], ...rising[1], ...far[-1], ...far[1]);

    // 2 / 3: 9 laser emitters per side, 3 beams each, spinning around the track axis
    const lasers = { left: [], right: [] };
    for (const [type, s, list] of [[2, -1, lasers.left], [3, 1, lasers.right]]) {
      for (let k = 0; k < 9; k++) {
        const p = rig.proxy(s * (9.0 + k * 0.12), 0.2 + k * 1.05, -42 - k * 4.6);
        list.push(p);
        for (const pitch of [6, 12, 18]) {
          const a = pitch * D2R;
          const m = barXYZ(0, 0, 0, s * Math.cos(a) * 160, Math.sin(a) * 160, 6, 0.06);
          groups[type].push(lights.light([{ m }], { fat: 4, glowGain: 0.8, rig, proxy: p }));
        }
      }
    }

    // 4: runway lights
    const stairTop = -42 - 16 * 3.4;
    groups[4].push(
      lights.light([{ m: barXYZ(-1.2, 0.0, 1, -1.2, 0.0, -41.5, 0.05, 0.03) }], { fat: 2.5, glowGain: 0.6 }),
      lights.light([{ m: barXYZ(1.2, 0.0, 1, 1.2, 0.0, -41.5, 0.05, 0.03) }], { fat: 2.5, glowGain: 0.6 }),
      lights.light([{ m: barXYZ(-2.6, -0.25, -42, -2.6, -0.3 + 15 * 0.55, stairTop, 0.1) }], { fat: 4 }),
      lights.light([{ m: barXYZ(2.6, -0.25, -42, 2.6, -0.3 + 15 * 0.55, stairTop, 0.1) }], { fat: 4 }),
      lights.light([{ m: barXYZ(-2.6, -0.25, -42, 2.6, -0.25, -42, 0.1) }], { fat: 4 }),
    );

    // sky haze far behind everything, in the average light colour
    const haze = new SoftGlow(root, 420, 200, new THREE.Vector3(0, 14, -175), { gain: 0.55, power: 1.3 });
    rig.sync();

    const all = Object.values(groups).flat();
    const bounce = wash(all, (r, g, b) => {
      cloudMat.emissive.setRGB(r * 0.16, g * 0.16, b * 0.16);
      towerMat.emissive.setRGB(r * 0.2, g * 0.2, b * 0.2);
      stone.emissive.setRGB(r * 0.08, g * 0.08, b * 0.08);
      haze.set(r, g, b);
    });

    const banks = [...lights.banks, clouds, slabs];
    return {
      root,
      banks,
      groups,
      rings: [
        { type: 'big', objects: towers[0], step: 4 },
        { type: 'big', objects: towers[1], step: 4 },
      ],
      lasers,
      update() {
        rig.sync();
        bounce();
      },
      dispose() {
        lights.dispose();
        haze.dispose();
        clouds.dispose();
        slabs.dispose();
        for (const o of owned) o.dispose();
        root.removeFromParent();
      },
    };
  },
};
