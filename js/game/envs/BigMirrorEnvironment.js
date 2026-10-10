// Big Mirror (BigMirrorEnvironment) — our own simplified recreation.
//
// Light groups (Chroma lightID n → groups[type][n - 1]); counts follow Heck/Chroma's LightIDTables
// (BigMirrorEnvironment.json); which object has which ID follows the community recreation in ArcViewer
// (scene facts only) where known, the rest is marked "approx".
//   0  back lasers (10): pairs of lasers rising from below the far track, crossing in an "X" over the track;
//      odd = left, even = right, near → far.
//   1  ring lights (60): 15 big diamond rings × 4 light bars [upper-right, lower-left, lower-right, upper-left].
//   2  left lasers (8): 1-4 rotating lasers (near → far), 5 wire on the mirror's side bar,
//      6 front tower strip, 7 rear tower strip, 8 approx: tower crossbar strip.
//   3  right lasers (8): mirror of 2.
//   4  center lights (16): 1-10 lasers from below the far track shooting down and outward (odd = left),
//      11/12 chevron left / right bar, 13/14 approx: left / right half of the mirror's front edge,
//      15/16 glow wires on the mirror floor (left / right).
// Rings: 15 big lit diamond rings (event 8, step 5°); no small rings, no zoom.
// Lasers 12 / 13: the 4 + 4 rotating lasers (cone sweep around the vertical).
// The wide "mirror" floor shows dimmed, clipped reflections of the lights above it (a second glow bank
// with y-mirrored instances; 1 extra draw call, no render-to-texture).
// Default colours: Big Mirror uses Beat Saber's "The First" scheme (BSMG wiki, Default Environment Colors).
import { THREE } from './kit.js';
import { ClassicKit, U, towerBlocks } from './_classicShared.js';
import { bigRings, chevron, trackLasers, rotatingLasers } from './_classicParts.js';

const HALF_W = 9.75;
const Z_NEAR = 6;
const Z_FAR = 306;

export default {
  name: 'BigMirrorEnvironment',
  label: 'Big Mirror',
  colors: { left: '#c81414', right: '#288ed2', envLeft: '#d91616', envRight: '#30acff', wall: '#ff3030' },
  build() {
    const kit = new ClassicKit({ maxLights: 140, mirror: { halfWidth: HALF_W, zNear: -Z_NEAR, zFar: -Z_FAR, k: 0.45 } });

    // --- the mirror floor (dark, glossy, drawn before the reflections)
    const floorGeo = new THREE.PlaneGeometry(HALF_W * 2, Z_FAR - Z_NEAR).rotateX(-Math.PI / 2);
    floorGeo.translate(0, -0.012, -(Z_NEAR + Z_FAR) / 2);
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x0c0e1c, roughness: 0.2, metalness: 0.5, transparent: true, opacity: 0.94, depthWrite: false,
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.renderOrder = 0;
    kit.root.add(floor);
    kit.owned.push(floorGeo, floorMat);

    // --- static scenery
    kit.box([0, -0.27, Z_NEAR - 0.05], [HALF_W * 2, 0.5, 0.1], [0, 0, 0], 'metal'); // front edge
    for (const s of [-1, 1]) {
      kit.box([s * 10, -0.25, 200], [0.5, 0.5, 600], [0, 0, 0], 'metal'); // side bars
      kit.box([s * 2.75, -50.4, 6.25], [0.5, 100, 0.5]); // stilts
      kit.box([s * 2.95, -50.2, 6.03], [0.2, 100, 0.2]);
      kit.box([s * 5.5, -49.6, 6.05], [0.25, 100, 0.5]);
    }
    const strips = {};
    for (const [name, s] of [['left', -1], ['right', 1]]) strips[name] = towerBlocks(kit, s, 39, -4);

    // --- lights
    const groups = { 0: [], 1: [], 2: [], 3: [], 4: [] };
    groups[0] = trackLasers(kit, { n: 5, emitX: -4, y0: -1, z0: 41, dz: 15, dir: [0.259, 0.966, 0], len: 420, width: 1.1, leftFirst: true });

    const big = bigRings(kit, { count: 15, y: 3, z0: 4, dz: 14 });
    groups[1] = big.lights.flat();

    const rot = rotatingLasers(kit, { n: 4, x: 20, y: 0, z0: 31, dz: 6, tilt: 50, up: 300, down: 0, width: 1.0 });
    for (const [name, type, s] of [['left', 2, -1], ['right', 3, 1]]) {
      const g = [...rot[name].lights];
      g.push(kit.line(U(s * 10, 0.05, -40), U(s * 10, 0.05, 500), 0.45)); // 5 side-bar wire
      for (const [a, b] of strips[name]) g.push(kit.line(a, b, 1.2));
      g.push(kit.line(U(s * 35, 13.6, 3), U(s * 35, 13.6, 53), 0.5));
      groups[type] = g;
    }

    groups[4] = trackLasers(kit, { n: 5, emitX: -4, y0: -1, z0: 41, dz: 15, dir: [-0.259, -0.966, 0], len: 400, width: 1.1, leftFirst: true, mirror: false });
    groups[4].push(...chevron(kit, { y: 5, z: 65 }));
    for (const s of [-1, 1]) groups[4].push(kit.line(U(s * 1.1, 0.02, Z_NEAR), U(s * HALF_W, 0.02, Z_NEAR), 0.4, { mirror: false }));
    for (const s of [-1, 1]) groups[4].push(kit.line(U(s * 5.5, 0.2, 6.2), U(s * 5.5, 0.2, 400), 0.45));

    return kit.finish({
      groups,
      rings: [{ type: 'big', objects: big.objects, step: 5 }],
      lasers: { left: rot.left.pivots, right: rot.right.pivots },
    });
  },
};
