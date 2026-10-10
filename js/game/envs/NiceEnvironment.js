// Nice (NiceEnvironment) — our own simplified recreation.
//
// Light groups (Chroma lightID n → groups[type][n - 1]); counts follow Heck/Chroma's LightIDTables
// (NiceEnvironment.json); which object has which ID follows the community recreation in ArcViewer
// (scene facts only) where known, the rest is marked "approx".
//   0  back lasers (8): pairs of lasers from below the far track sides shooting straight down and outward;
//      odd = left, even = right, near → far.
//   1  ring lights (40): 10 big diamond rings × 4 light bars [upper-right, lower-left, lower-right, upper-left].
//   2  left lasers (11): 1-4 laser fan below the track end (4 lines through one hub, at 80° / 60° / 100° / 120°
//      from vertical), 5 long side wire, 6 front tower strip, 7 rear tower strip; 8-11 approx: tower
//      crossbar strips (top, bottom), spire strip, hang-down strip.
//   3  right lasers (11): 1-4 laser fan above the track end, 5 side wire, 6 rear tower strip, 7 front tower
//      strip (per ArcViewer), 8-11 approx as left.
//   4  center lights (14): 1-8 lasers rising from the far track sides, crossing in an "X" (odd = left),
//      9/10 glow wires along the track (left / right), 11/12 chevron left / right bar;
//      13/14 approx: left / right half of the long horizontal bar across the track front.
// Rings: 10 big lit diamond rings (event 8, step 5°) and 30 small dark diamond rings (event 8 spin, step 5°;
// event 9 zoom 1 ↔ 5 m).
// Lasers 12 / 13: the two 4-line fans spin around the vertical through their hub.
// Default colours: Nice uses Beat Saber's "The First" scheme (BSMG wiki, Default Environment Colors).
import { THREE } from './kit.js';
import { ClassicKit, U, DEG, towerBlocks } from './_classicShared.js';
import { bigRings, smallRings, chevron, trackLasers } from './_classicParts.js';

export default {
  name: 'NiceEnvironment',
  label: 'Nice',
  colors: { left: '#c81414', right: '#288ed2', envLeft: '#d91616', envRight: '#30acff', wall: '#ff3030' },
  build() {
    const kit = new ClassicKit({ maxLights: 140 });

    // --- static scenery: no track platform, only bars
    kit.box([0, -0.25, 6.3], [1000, 0.15, 0.2], [45, 0, 0], 'metal'); // long crossbar at the track front
    kit.box([0, -0.25, 6], [6, 0.3, 0.2], [0, 0, 0], 'metal');
    for (const s of [-1, 1]) kit.box([s * 25, 2, 220], [0.6, 0.5, 560], [0, 0, 0], 'metal'); // side bars
    const strips = {};
    for (const [name, s] of [['left', -1], ['right', 1]]) strips[name] = towerBlocks(kit, s, 36, 0);

    // --- lights
    const groups = { 0: [], 1: [], 2: [], 3: [], 4: [] };
    groups[0] = trackLasers(kit, { n: 4, emitX: -9, y0: -5, z0: 62.5, dz: 15, dir: [-0.259, -0.966, 0], len: 400, width: 1.1, leftFirst: true });

    const big = bigRings(kit, { count: 10, y: 3, z0: 65, dz: 4 });
    groups[1] = big.lights.flat();
    const small = smallRings(kit, { count: 30, y: 5, z0: 21, dz: 5, rotStep: 5 });

    // two laser fans (left = lower hub, right = upper hub); each line is its own pivot spinning around Y
    const lasers = { left: [], right: [] };
    for (const [name, type, hubY, s] of [['left', 2, -22, -1], ['right', 3, 28, 1]]) {
      const g = [];
      for (const ang of [80, 60, 100, 120]) {
        const d = new THREE.Vector3(-Math.sin(ang * DEG), Math.cos(ang * DEG), 0).multiplyScalar(250);
        const { pivot, lights } = kit.pivot(U(0, hubY, 55), [[d.clone().negate(), d]], 1.2);
        lasers[name].push(pivot);
        g.push(lights[0]);
      }
      g.push(kit.line(U(s * 24.6, 2, -60), U(s * 24.6, 2, 500), 0.45)); // 5 side wire
      const [front, rear] = strips[name].map(([a, b]) => kit.line(a, b, 1.2));
      const crossTop = kit.line(U(s * 32, 13.6, 7), U(s * 32, 13.6, 57), 0.5);
      const crossBottom = kit.line(U(s * 32, 10.4, 7), U(s * 32, 10.4, 57), 0.5);
      const spire = kit.line(U(s * 35.4, 16, 31.4), U(s * 35.4, 56, 31.4), 0.5);
      const hang = kit.line(U(s * 35.9, -4, 39.9), U(s * 35.9, 10.5, 39.9), 0.5);
      if (s < 0) g.push(front, rear);
      else g.push(rear, front);
      g.push(crossTop, crossBottom, spire, hang);
      groups[type] = g;
    }

    groups[4] = trackLasers(kit, { n: 4, emitX: -9, y0: -5, z0: 62.5, dz: 15, dir: [0.259, 0.966, 0], len: 420, width: 1.3, leftFirst: true });
    for (const s of [-1, 1]) groups[4].push(kit.line(U(s * 2, -0.2, 6.4), U(s * 2, -0.2, 400), 0.45));
    groups[4].push(...chevron(kit, { y: 5, z: 65 }));
    for (const s of [-1, 1]) groups[4].push(kit.line(U(s * 1.2, -0.1, 6.4), U(s * 160, -0.1, 6.4), 0.4));

    return kit.finish({
      groups,
      rings: [
        { type: 'big', objects: big.objects, step: 5 },
        { type: 'small', objects: small.objects, step: 5, zoom: { near: 1, far: 5 } },
      ],
      lasers,
    });
  },
};
