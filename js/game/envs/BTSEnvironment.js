// BTS environment (BTS music pack): the track floats above a sea of clouds toward the glowing BTS
// "door" logo, which hangs between two rows of tall dark pillars; fans of lasers shoot sideways out
// of the pillars, beams rise from their tops, a staircase climbs toward the logo and two huge
// striped towers (stacked slabs that spin) stand far out on the left and right.
// Recreated with simple shapes for this project.
//
// Light groups (v2 basic event type → lights, Chroma lightID n = groups[type][n - 1]):
//   0  logo ............................ 3   (1 left door, 2 right door, 3 logo reflection)
//   1  center lasers (rising beams) .... 20  (1–16 pillar pairs near → far, 4 per pair: left
//                                             beam, left strip, right beam, right strip — odd =
//                                             the beam rising from a moving cube, even = a neon
//                                             strip on the column before it; 17–20 far beams)
//   2  left lasers ..................... 27  (9 side lights × 3 IDs: beam, emitter glow, flare;
//                                             one per pillar near → far)
//   3  right lasers .................... 27  (mirror of 2)
//   4  runway lights ................... 5   (1 left rail, 2 right rail, 3 left stair edge,
//                                             4 right stair edge, 5 cross bar at the stair foot)
// Counts: Chroma's light ID table for BTSEnvironment (Aeroluna/Heck). Layout and rough positions:
// ChroMapper's community recreation (facts only); the in-group ID order is approximate.
// Rings: two 'big' ring sets = the 30 slabs of each striped tower (event 8 "tower spin" rotates
// them around the vertical axis). Environment event (customEvents) 9 = pillar control: the 4 cubes
// per side (with the beams rising from them) jump up / drop back (maps send it in quick pairs). Lasers: the 9
// side lights per side swing up / down like a wave with events 12 / 13.
import { THREE, GEO, GlowBank, Rig, PropBank, MultiLight, SoftGlow, barXYZ, wash, stdMat, mergeGeos } from './kit.js';

const D2R = Math.PI / 180;
// 9 pillars per side in a row that climbs toward the logo (it reads as a staircase from the
// player): tall square columns, and between them 4 cubes that rise / sink with event 9.
// [x (centre, abs), z, top y, moves]  — near → far
const PILLAR_W = 3.4; // column width (square, turned 45° so its top reads as a diamond)
const CUBE = 3.6; // edge of the moving cubes (also turned 45°)
const HALF_DIAG = Math.SQRT1_2; // corner distance of a 45°-turned square, per unit edge
const PILLARS = Array.from({ length: 9 }, (_, i) => [6.6, -38 - i * 5.6, 1.2 + i * 1.3, i % 2 === 1]);
const TILT_X = 28 * D2R; // pillars lean their tops toward the player (top faces visible) ...
const TILT_Z = 8 * D2R; // ... and a little toward the track
const JUMP = 4; // how high the cubes jump (event 9)
const WAVE_REST = 5 * D2R; // side beams: tilt up at rest ...
const WAVE_AMP = 14 * D2R; // ... swing up / down by this much ...
const WAVE_LAG = 0.7; // ... each one this much phase behind the one in front of it
/** Pose of pillar i on side s: origin = centre of its top face (the 45° turn is not included). */
function pillarPose(s, i) {
  const [x, z, top] = PILLARS[i];
  return new THREE.Matrix4()
    .makeTranslation(s * x, top, z)
    .multiply(new THREE.Matrix4().makeRotationZ(s * TILT_Z))
    .multiply(new THREE.Matrix4().makeRotationX(TILT_X));
}
const _pt = new THREE.Vector3();
/** A point given relative to pillar i's top-face centre (its own axes), in world space. */
function pillarPoint(s, i, lx, ly, lz = 0) {
  return _pt.set(lx, ly, lz).applyMatrix4(pillarPose(s, i)).toArray();
}
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
    const pg = []; // the pillars move (event 9): own mesh
    for (const s of [-1, 1]) {
      PILLARS.forEach(([, , top, moves], i) => {
        const h = moves ? CUBE : top + 14;
        const g = moves ? new THREE.BoxGeometry(CUBE, CUBE, CUBE) : new THREE.BoxGeometry(PILLAR_W, h, PILLAR_W);
        g.translate(0, -h / 2, 0);
        g.rotateY(45 * D2R);
        g.applyMatrix4(pillarPose(s, i));
        (moves ? pg : sg).push(g);
      });
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
    const pillars = mergeGeos(pg, stone);
    root.add(statics, pillars);
    owned.push(statics.geometry, pillars.geometry);

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
    const clouds = new PropBank(root, puffGeo, cloudMat, 150);
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
    const slabs = new PropBank(root, slabGeo, towerMat, 60);
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
    const lights = new GlowBank(root, GEO.box, 200, { haloOpacity: 0.2 });
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

    // 1: rising beams, then far diagonal beams. IDs go by pillar pair, near → far: left beam, left
    // strip, right beam, right strip (maps chase the pairs with the odd IDs 1+3, 5+7, ...; the even
    // ones stay lit from whole-group events, so they are a neon strip on the pillar, not a beam).
    // The beam rises from the moving cube of the pair, the strip runs down the column before it.
    const rising = [];
    const lift = rig.proxy(0, 0, 0); // height of the moving cubes (event 9)
    for (let k = 0; k < 4; k++) {
      for (const s of [-1, 1]) {
        const a = 7 * D2R;
        const [x0, y0, z0] = pillarPoint(s, 2 * k + 1, 0, 0);
        rising.push(lights.light([{ m: barXYZ(x0, y0, z0, x0 + s * Math.sin(a) * 140, y0 + Math.cos(a) * 140, z0 - 10, 0.09) }], { fat: 4, rig, proxy: lift }));
        // down the column's corner toward the track
        const xe = -s * (PILLAR_W * HALF_DIAG + 0.04);
        const [ax, ay, az] = pillarPoint(s, 2 * k, xe, -0.2);
        rising.push(lights.light([{ m: barXYZ(ax, ay, az, ...pillarPoint(s, 2 * k, xe, -8), 0.1) }], { fat: 2 }));
      }
    }
    const far = { [-1]: [], [1]: [] };
    for (const s of [-1, 1]) {
      for (const y of [2, 12]) {
        far[s].push(lights.light([{ m: barXYZ(s * 26, y, -150, s * 150, y + 18, -30, 0.25) }], { fat: 4, glowGain: 0.7 }));
      }
    }
    groups[1].push(...rising, ...far[-1], ...far[1]);

    // 2 / 3: 9 side lights per side: one near the top of each pillar, near → far (those on the
    // moving cubes jump with them). One beam each, shooting sideways; 3 light IDs per light (beam,
    // emitter glow, flare at the beam's foot). Events 12 / 13 make the row swing up and down like a
    // wave: every beam follows the side's first laser, a little later the farther back it is
    // (update() turns that phase into the tilts).
    const lasers = { left: [], right: [] };
    const beam = (s, len, w) => barXYZ(0, 0, 0, s * len, 0, 0, w);
    for (const [type, s, list] of [[2, -1, lasers.left], [3, 1, lasers.right]]) {
      const mounts = PILLARS.map(([, , , moves], i) => [...pillarPoint(s, i, s * ((moves ? CUBE : PILLAR_W) * HALF_DIAG + 0.05), moves ? -CUBE / 2 : -1), moves]);
      for (const [x, y, z, moves] of mounts) {
        const p = rig.proxy(x, y, z);
        p.userData.setPhase = () => {}; // the wave is set in update()
        p.rotation.z = s * WAVE_REST;
        list.push(p);
        const chain = moves ? [lift, p] : p;
        groups[type].push(
          lights.light([{ m: beam(s, 160, 0.06) }], { fat: 4, glowGain: 0.8, rig, proxy: chain }),
          lights.light([{ m: barXYZ(-0.25, 0, 0, 0.25, 0, 0, 0.35), g: null }], { rig, proxy: chain }),
          lights.light([{ m: beam(s, 7, 0.16), g: null }], { coreGain: 0.5, rig, proxy: chain }),
        );
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
    let cubesUp = false;
    const wave = { last: [0, 0], env: [0, 0] };
    return {
      root,
      banks,
      groups,
      rings: [
        { type: 'big', objects: towers[0], step: 4 },
        { type: 'big', objects: towers[1], step: 4 },
      ],
      lasers,
      customEvents: [9],
      onEvent(type) {
        if (type === 9) cubesUp = !cubesUp; // pillar control
      },
      reset() {
        cubesUp = false;
        wave.last.fill(0);
        wave.env.fill(0);
      },
      update(t, dt) {
        const target = cubesUp ? JUMP : 0;
        const y = lift.position.y;
        if (y !== target) {
          lift.position.y = Math.abs(target - y) < 1e-3 ? target : y + (target - y) * (1 - Math.exp(-14 * dt));
          pillars.position.y = lift.position.y;
          pillars.updateMatrix();
        }
        // side beams: the wave fades in while the side's lasers move and out when they stop
        for (let side = 0; side < 2; side++) {
          const list = side ? lasers.right : lasers.left;
          const s = side ? 1 : -1;
          const ph = list[0].userData.phase || 0;
          const moving = ph !== wave.last[side];
          wave.last[side] = ph;
          wave.env[side] += ((moving ? 1 : 0) - wave.env[side]) * Math.min(1, dt * 6);
          const amp = WAVE_AMP * wave.env[side];
          for (let i = 0; i < list.length; i++) list[i].rotation.z = s * (WAVE_REST + amp * Math.sin(ph - i * WAVE_LAG));
        }
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
