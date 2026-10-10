// Triangle (TriangleEnvironment) — our own simplified recreation.
//
// Light groups (Chroma lightID n → groups[type][n - 1]); counts follow Heck/Chroma's LightIDTables
// (TriangleEnvironment.json); which object has which ID follows the community recreation in ArcViewer
// (scene facts only) where known, the rest is marked "approx".
//   0  back lasers (10): pairs of lasers from the far track edges shooting down, outward and toward the
//      player (a "V" under the track); odd = left, even = right, near → far.
//   1  ring lights (60): 15 big diamond rings × 4 light bars [upper-right, lower-left, lower-right, upper-left].
//   2  left lasers (11): 1-7 rotating lasers (near → far), 8 glow wire along the track edge,
//      9 front tower strip, 10 rear tower strip, 11 approx: tower crossbar strip.
//   3  right lasers (11): 1-7 rotating, 8 glow wire, 9 front tower strip, 10 approx: crossbar strip,
//      11 rear tower strip (ArcViewer has 9 and 11 for the right strips).
//   4  center lights (11): 1-10 lasers from the far track edges up into the sky, crossing over the track
//      (an "X"); odd = left, near → far; 11 approx: neon line under the track centre.
// Rings: 15 big lit diamond rings (event 8, step 5°) and 30 small dark triangle rings (event 8 spin, 7° step;
// event 9 zoom 5 ↔ 10 m).
// Lasers 12 / 13: the 7 + 7 rotating lasers (cone sweep around the vertical).
// Default colours: Triangle uses Beat Saber's "The First" scheme (BSMG wiki, Default Environment Colors).
import { ClassicKit, U, DEG, towerBlocks, floatingTrack, polyFrame } from './_classicShared.js';
import { bigRings, trackLasers, rotatingLasers } from './_classicParts.js';

export default {
  name: 'TriangleEnvironment',
  label: 'Triangle',
  colors: { left: '#c81414', right: '#288ed2', envLeft: '#d91616', envRight: '#30acff', wall: '#ff3030' },
  build() {
    const kit = new ClassicKit({ maxLights: 160 });

    // --- static scenery
    floatingTrack(kit, { halfWidth: 3, z0: 6, z1: 300, stiltX: 2.75 });
    const strips = {};
    for (const [name, s] of [['left', -1], ['right', 1]]) strips[name] = towerBlocks(kit, s, 39, 0);

    // --- lights
    const groups = { 0: [], 1: [], 2: [], 3: [], 4: [] };
    groups[0] = trackLasers(kit, { n: 5, emitX: -4, y0: -1, z0: 36, dz: 15, dir: [-0.259, -0.74, -0.621], len: 340, width: 1.1, leftFirst: true });

    const big = bigRings(kit, { count: 15, y: 3, z0: 12, dz: 14 });
    groups[1] = big.lights.flat();
    // small triangle rings (dark), apex to the left in ring space, base angle 45°
    const tri = polyFrame([[-11.3, 0], [15.1, 15.2], [15.1, -15.2]], 1.1, 0.9).rotateZ(45 * DEG);
    const small = kit.rings({ count: 30, y: 2, z0: 26, dz: 5, bodyGeo: tri, bodyMat: 'dark', rotStep: 4 });

    const rot = rotatingLasers(kit, { n: 7, x: 50, y: -4, z0: 68.5, dz: 2, tilt: 55, up: 320, down: 40, width: 1.1 });
    for (const [name, type, s] of [['left', 2, -1], ['right', 3, 1]]) {
      const g = [...rot[name].lights];
      g.push(kit.line(U(s * 3, 0, 6.1), U(s * 3, 0, 400), 0.45)); // 8 glow wire
      const [front, rear] = strips[name].map(([a, b]) => kit.line(a, b, 1.2));
      const cross = kit.line(U(s * 35, 13.6, 7), U(s * 35, 13.6, 57), 0.5);
      if (s < 0) g.push(front, rear, cross);
      else g.push(front, cross, rear);
      groups[type] = g;
    }

    groups[4] = trackLasers(kit, { n: 5, emitX: -4, y0: -1, z0: 36, dz: 15, dir: [0.259, 0.74, 0.621], len: 420, width: 1.3, leftFirst: true });
    groups[4].push(kit.line(U(0, -2.3, 6), U(0, -2.3, 300), 0.5));

    return kit.finish({
      groups,
      rings: [
        { type: 'big', objects: big.objects, step: 5 },
        { type: 'small', objects: small.objects, step: 7, zoom: { near: 5, far: 10 } },
      ],
      lasers: { left: rot.left.pivots, right: rot.right.pivots },
    });
  },
};

