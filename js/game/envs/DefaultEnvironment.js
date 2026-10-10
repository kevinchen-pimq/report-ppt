// The First (DefaultEnvironment) — our own simplified recreation.
//
// Light groups (Chroma lightID n → groups[type][n - 1]); counts follow Heck/Chroma's LightIDTables
// (DefaultEnvironment.json); which object has which ID follows the community recreation in ArcViewer
// (scene facts only) where known, the rest is marked "approx".
//   0  back lasers (10): pairs of lasers from the far track edges shooting down under the track toward
//      the player, crossing; ID 1 = nearest pair's beam that ends on the right, 2 = its left twin, … 9/10 farthest.
//   1  ring lights (60): 15 big diamond rings × 4 light bars [upper-right, lower-left, lower-right, upper-left].
//   2  left lasers (11): 1-4 rotating lasers (near → far), 5 glow wire beside the track,
//      6-7 tower light strips; 8-11 approx: tower crossbar strips (top, bottom), spire strip, hang-down strip.
//   3  right lasers (11): mirror of 2, but per ArcViewer the right tower strips are 6 = rear strip, 8 = front
//      strip; 7, 9-11 approx (crossbar top, crossbar bottom, spire, hang-down).
//   4  center lights (14): 1-10 lasers from the track edges up into the sky (odd = left, near → far),
//      11/12 chevron left / right bar; 13/14 approx: neon strips along the under-track supports (left / right).
// Rings: 15 big lit rings (event 8 spin, step 5°), 30 small dark rings (spin step 5°, event 9 zoom 2 ↔ 5 m).
// Lasers 12 / 13: the 4 + 4 rotating lasers (cone sweep around the vertical).
// Default colours: Beat Saber "The First" scheme (BSMG wiki, Default Environment Colors).
import { ClassicKit, U, towerBlocks, floatingTrack } from './_classicShared.js';
import { bigRings, smallRings, chevron, trackLasers, rotatingLasers } from './_classicParts.js';

export default {
  name: 'DefaultEnvironment',
  label: 'The First',
  colors: { left: '#c81414', right: '#288ed2', envLeft: '#d91616', envRight: '#30acff', wall: '#ff3030' },
  build() {
    const kit = new ClassicKit({ maxLights: 160 });

    // --- static scenery
    floatingTrack(kit, { halfWidth: 3, z0: 6, z1: 300, stiltX: 2.75 });
    for (const s of [-1, 1]) {
      kit.box([s * 5.5, -0.86, 200], [0.075, 0.075, 390], [0, 0, 0], 'metal');
      kit.box([s * 5.5, -2.15, 200], [0.075, 0.075, 390], [0, 0, 0], 'metal');
      kit.box([s * 5.5, -49.3, 6.25], [0.25, 100, 0.5]);
    }
    const strips = {};
    for (const [name, s] of [['left', -1], ['right', 1]]) strips[name] = towerBlocks(kit, s, 39, 0);

    // --- lights
    const groups = { 0: [], 1: [], 2: [], 3: [], 4: [] };
    groups[0] = trackLasers(kit, { n: 5, emitX: 2.8, y0: -2, z0: 63.6, dz: 20, dir: [-0.4228, -0.5825, -0.6945], len: 320, width: 1.1, leftFirst: false });

    const big = bigRings(kit, { count: 15, y: 3, z0: 12, dz: 14 });
    groups[1] = big.lights.flat();
    const small = smallRings(kit, { count: 30, y: 3, z0: 21, dz: 5, rotStep: 5 });

    const rot = rotatingLasers(kit, { n: 4, x: 20, y: 3.5, z0: 54, dz: 8, tilt: 60, width: 1.1 });
    for (const [name, type, s] of [['left', 2, -1], ['right', 3, 1]]) {
      const g = [...rot[name].lights];
      g.push(kit.line(U(s * 5.5, 0.35, 6.4), U(s * 5.5, 0.35, 400), 0.45)); // 5 glow wire
      const [front, rear] = strips[name].map(([a, b]) => kit.line(a, b, 1.2));
      const crossTop = kit.line(U(s * 35, 13.6, 7), U(s * 35, 13.6, 57), 0.5);
      const crossBottom = kit.line(U(s * 35, 10.4, 7), U(s * 35, 10.4, 57), 0.5);
      const spire = kit.line(U(s * 38.4, 16, 31.4), U(s * 38.4, 56, 31.4), 0.5);
      const hang = kit.line(U(s * 38.9, -4, 39.9), U(s * 38.9, 10.5, 39.9), 0.5);
      if (s < 0) g.push(front, rear, crossTop, crossBottom, spire, hang);
      else g.push(rear, crossTop, front, crossBottom, spire, hang);
      groups[type] = g;
    }

    groups[4] = trackLasers(kit, { n: 5, emitX: -2.7, y0: -2, z0: 63.6, dz: 20, dir: [-0.4226, 0.5826, 0.6943], len: 420, width: 1.3, leftFirst: true });
    groups[4].push(...chevron(kit, { y: 5, z: 65 }));
    for (const s of [-1, 1]) groups[4].push(kit.line(U(s * 2.75, -2.3, 6), U(s * 2.75, -2.3, 300), 0.45));

    return kit.finish({
      groups,
      rings: [
        { type: 'big', objects: big.objects, step: 5 },
        { type: 'small', objects: small.objects, step: 5, zoom: { near: 2, far: 5 } },
      ],
      lasers: { left: rot.left.pivots, right: rot.right.pivots },
    });
  },
};

