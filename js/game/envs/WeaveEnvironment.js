// Weave environment (OST 5): a black void with no floor. Close around the runway, rows of small
// pan / tilt laser heads hang on hair-thin threads that run off into the darkness; their short beams,
// fading out after a few metres, weave square tunnels, fans and crosses around the player. At the far
// end of the tunnel four rows of longer lasers ("distant square") point back toward the player.
// Recreated with simple shapes (our own geometry).
//
// v3 light groups (lightGroups[id].lights = elements in official order; every group rotates on X and Y:
// Y = pan around the beam's rest direction, X = tilt):
//   id  what                               elements  order                     rest beam
//    0  outer square, bottom left            8       near → far (2 m apart)    up
//    1  outer square, bottom right           8       near → far                up        (Y mirrored)
//    2  outer square, top left               8       near → far                down      (Y mirrored)
//    3  outer square, top right              8       near → far                down
//    4  inner square, bottom left            8       near → far                up
//    5  inner square, bottom right           8       near → far                up        (Y mirrored)
//    6  inner square, top left               8       near → far                down      (Y mirrored)
//    7  inner square, top right              8       near → far                down
//    8  side square, bottom left             8       near → far                inward    (Y mirrored)
//    9  side square, bottom right            8       near → far                inward
//   10  side square, top left                8       near → far                inward
//   11  side square, top right               8       near → far                inward    (Y mirrored)
//   12  distant square, top                 12       left → right              toward the player (X mirrored)
//   13  distant square, bottom              12       right → left              toward the player (X mirrored)
//   14  distant square, left                 8       bottom → top              toward the player (X mirrored)
//   15  distant square, right                8       top → bottom              toward the player (X mirrored)
// Basic events: 4 = player place (a glow frame around the platform), 5 = colour boost (runtime).
// No rings, no laser-speed events, no fx groups.
// Sources (facts only): ChroMapper's community recreation of WeaveEnvironment (group names / ids,
// element counts, pivot positions, rotation axes and mirror flags, beam lengths 12 m / 25 m), v3 maps on
// BeatSaver using the environment (group ids 0–15 in use), gameplay footage for the look. Default colours:
// ChroMapper's environment data. Approximate: head / housing shapes, beam width and falloff, thread
// lengths and the darkness of the void.
import { THREE, GEO, LightBank, GlowBank, PropBank, Rig, MultiLight, barXYZ, mergeGeos, beamGeometry, V } from './kit.js';
import { U, PanTilt, fadeBeamGeometry, fadeBeamMaterial, beamMatrix } from './_v1lights.js';

const X = V(1, 0, 0);
const Yv = V(0, 1, 0);
const Z = V(0, 0, 1);

// [id, x, y, unity z of element 0, beam dir, yaw axis, tilt axis, mirror y, mirror x]  (ours, z flipped by U)
const ROWS = [
  [0, -4, -0.5, 5.88, Yv, Yv, U(0, 0, -1), false],
  [1, 4, -0.5, 5.88, Yv, Yv, U(0, 0, 1), true],
  [2, -4, 3.5, 5.88, Yv.clone().negate(), Yv.clone().negate(), U(0, 0, 1), true],
  [3, 4, 3.5, 5.88, Yv.clone().negate(), Yv.clone().negate(), U(0, 0, -1), false],
  [4, -2, -1.5, 4.88, Yv, Yv, U(0, 0, -1), false],
  [5, 2, -1.5, 4.88, Yv, Yv, U(0, 0, 1), true],
  [6, -2, 4.5, 4.88, Yv.clone().negate(), Yv.clone().negate(), U(0, 0, 1), true],
  [7, 2, 4.5, 4.88, Yv.clone().negate(), Yv.clone().negate(), U(0, 0, -1), false],
  [8, -5, 0.75, 5.38, X, X, U(0, 0, -1), true],
  [9, 5, 0.75, 5.38, X.clone().negate(), X.clone().negate(), U(0, 0, 1), false],
  [10, -5, 2.25, 5.38, X, X, U(0, 0, 1), false],
  [11, 5, 2.25, 5.38, X.clone().negate(), X.clone().negate(), U(0, 0, -1), true],
];

export default {
  name: 'WeaveEnvironment',
  label: 'Weave',
  colors: {
    left: '#c81414',
    right: '#288ed2',
    envLeft: '#d91616',
    envRight: '#30acff',
    envLeftBoost: '#d216d9',
    envRightBoost: '#a1a1a1',
    wall: '#ff3030',
    envWhite: '#B9B9B9', // the game's white light colour (used when the map has none)
  },
  build() {
    const root = new THREE.Group();
    root.name = 'WeaveEnvironment';
    const owned = [];
    const rig = new Rig(root);

    const beamGeo = fadeBeamGeometry({ rows: 5, power: 1.8, widthEnd: 3 });
    owned.push(beamGeo);
    const beams = new GlowBank(root, beamGeo, 136, { haloOpacity: 0.08 });
    for (const b of beams.banks) {
      b.mesh.material.dispose();
      b.mesh.material = fadeBeamMaterial(b === beams.core ? 1 : 0.08);
    }
    const heads = new LightBank(root, GEO.box, 136);
    const housingMat = new THREE.MeshStandardMaterial({ color: 0x16171d, roughness: 0.5, metalness: 0.6 });
    owned.push(housingMat);
    const housings = new PropBank(root, GEO.box, housingMat, 136);

    const lightGroups = {};
    const threads = [];
    const tmp = new THREE.Matrix4();
    const tmpH = new THREE.Matrix4();

    // one laser head: pivot at p, beam along dir (rest), pan around yawAxis, tilt around tiltAxis
    const element = (p, dir, yawAxis, tiltAxis, len) => {
      const pt = new PanTilt(p, yawAxis, tiltAxis);
      const d = pt.toLocal(dir);
      const start = d.clone().multiplyScalar(0.42);
      const core = pt.light(rig, beams, beamMatrix(start, d, len, 0.07, tmp), beamMatrix(start, d, len * 0.7, 0.4, tmpH));
      const hm = new THREE.Matrix4().compose(d.clone().multiplyScalar(0.3), new THREE.Quaternion().setFromUnitVectors(Yv, d), V(0.09, 0.2, 0.09));
      const head = pt.light(rig, heads, hm);
      const bm = new THREE.Matrix4().compose(d.clone().multiplyScalar(0.08), new THREE.Quaternion().setFromUnitVectors(Yv, d), V(0.26, 0.24, 0.26));
      pt.attach(rig, housings, bm);
      // the thread the head hangs on, running away behind it
      const far = p.clone().addScaledVector(dir, -120);
      threads.push(beamGeometry(p, far, 0.025, 0.025));
      return { pt, light: new MultiLight([core, head], [0.6, 1.4]) };
    };

    for (const [id, x, y, z0, dir, ya, ta, mirY] of ROWS) {
      const g = { lights: [], rotation: { x: [], y: [], mirror: { x: false, y: mirY } } };
      for (let i = 0; i < 8; i++) {
        const e = element(U(x, y, z0 + 2 * i), dir, ya, ta, 12);
        g.lights.push(e.light);
        g.rotation.x.push(e.pt.tilt);
        g.rotation.y.push(e.pt.yaw);
      }
      lightGroups[id] = g;
    }

    // distant square: rows of longer lasers at the end of the tunnel pointing back at the player
    const toward = V(0, 0, 1);
    const distant = [
      [12, 12, (i) => [-2.75 + 0.5 * i, 3.75], U(1, 0, 0)],
      [13, 12, (i) => [2.75 - 0.5 * i, -0.75], U(-1, 0, 0)],
      [14, 8, (i) => [-3.25, -0.25 + 0.5 * i], U(0, 1, 0)],
      [15, 8, (i) => [3.25, 3.25 - 0.5 * i], U(0, -1, 0)],
    ];
    for (const [id, n, at, tiltAxis] of distant) {
      const g = { lights: [], rotation: { x: [], y: [], mirror: { x: true, y: false } } };
      for (let i = 0; i < n; i++) {
        const [x, y] = at(i);
        const e = element(U(x, y, 20.9), toward, toward, tiltAxis, 25);
        g.lights.push(e.light);
        g.rotation.x.push(e.pt.tilt);
        g.rotation.y.push(e.pt.yaw);
      }
      lightGroups[id] = g;
    }

    // hair-thin threads (static, barely lit)
    const threadMat = new THREE.MeshBasicMaterial({ color: 0x23252e, fog: true });
    owned.push(threadMat);
    const threadMesh = mergeGeos(threads, threadMat);
    owned.push(threadMesh.geometry);
    root.add(threadMesh);

    // player place (event 4): a soft frame on the floor around the platform
    const frame = new GlowBank(root, GEO.box, 4, { haloOpacity: 0.18 });
    const frameLight = frame.light([
      { m: barXYZ(-1.5, 0.005, 1.0, -1.5, 0.005, -1.0, 0.04, 0.01) },
      { m: barXYZ(1.5, 0.005, 1.0, 1.5, 0.005, -1.0, 0.04, 0.01) },
      { m: barXYZ(-1.5, 0.005, 1.0, 1.5, 0.005, 1.0, 0.04, 0.01) },
    ], { fat: 5, glowGain: 0.8 });

    rig.update(true);
    const banks = [...beams.banks, heads, housings, ...frame.banks];
    return {
      root,
      banks,
      groups: { 4: [frameLight] },
      lightGroups,
      update() {
        rig.update();
      },
      dispose() {
        beams.dispose();
        heads.mesh.material.dispose();
        heads.dispose();
        housings.dispose();
        frame.dispose();
        for (const o of owned) o.dispose();
        root.removeFromParent();
      },
      background: '#000000',
    };
  },
};
