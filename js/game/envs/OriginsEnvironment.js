// Origins (OriginsEnvironment) — our own simplified recreation.
//
// Light groups (Chroma lightID n → groups[type][n - 1]); counts follow Heck/Chroma's LightIDTables
// (OriginsEnvironment.json); positions / ID order from the community recreation in ArcViewer (scene
// facts only) — every ID is accounted for.
//   0  back lasers (4): two pairs of lasers from under the track centre shooting down and outward, crossing;
//      1 = near pair's beam that ends on the left (emitted at the right edge), 2 = its twin, 3/4 = far pair.
//   1  ring lights (60): 15 light-only rings × 4 bars [top-left, bottom-right, top-right, bottom-left].
//   2  left lasers (6): 1-5 rotating lasers (near → far), 6 glow wire along the left track edge.
//   3  right lasers (6): mirror of 2.
//   4  center lights (2): chevron left / right bar.
// Rings: one set of 15 "big" light rings (event 8 spin, 3° step); no small rings, no zoom.
// Lasers 12 / 13: the 5 + 5 rotating lasers (cone sweep around the vertical).
// Default colours: Beat Saber "Origins" scheme (BSMG wiki, Default Environment Colors).
import { THREE } from './kit.js';
import { ClassicKit, U } from './_classicShared.js';
import { chevron, trackLasers, rotatingLasers } from './_classicParts.js';

export default {
  name: 'OriginsEnvironment',
  label: 'Origins',
  colors: { left: '#ad9200', right: '#b40089', envLeft: '#7dafb3', envRight: '#0aafe7', wall: '#104965' },
  build() {
    const kit = new ClassicKit({ maxLights: 96 });

    // --- static scenery
    // segmented track: the game draws the centre (|x| < 1) up to 40 m; we add the outer rails and
    // continue the four centre strips beyond it
    for (const s of [-1, 1]) {
      kit.box([s * 3.1, -0.07, 156], [0.45, 0.15, 300], [0, 0, 0], 'metal');
      for (const x of [0.3, 0.9]) kit.box([s * x, -0.07, 173], [0.45, 0.15, 266], [0, 0, 0], 'metal');
      // two massive stilts under the track front
      kit.box([s * 2, -100.05, 7.25], [1, 200, 2]);
      kit.box([s * 2, -99.8, 6], [0.5, 200, 0.5]);
    }
    kit.box([0, -0.07, 6], [300, 0.15, 0.1], [0, 0, 0], 'metal'); // long horizontal edge at the track front
    // the two "combs" of slanted pillars rising from far below to the track level
    const tilt = 40 * Math.PI / 180;
    for (const s of [-1, 1]) {
      for (let z = -33; z <= 112; z += 2) {
        const top = new THREE.Vector3(s * (15 - 0.105 * (z + 1)), 0, -z);
        const dir = new THREE.Vector3(s * Math.sin(tilt), -Math.cos(tilt), -0.067).normalize();
        const mid = top.clone().addScaledVector(dir, 200);
        const m = kit.rawBox([mid.x, mid.y, mid.z], [0.75, 400, 0.75]);
        m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().negate());
      }
    }

    // --- lights
    const groups = { 0: [], 1: [], 2: [], 3: [], 4: [] };
    groups[0] = trackLasers(kit, { n: 2, emitX: 0.9, y0: -0.1, z0: 17, dz: 5, dir: [-0.174, -0.985, 0], len: 300, width: 0.8, leftFirst: true });

    // light-only rings
    const W = 1.4;
    const v = (x, y) => new THREE.Vector3(x, y, 0);
    const ringSet = kit.rings({
      count: 15, y: 4, z0: 7, dz: 5,
      lightSegs: [
        [v(-7.8, 13.4), v(-13.4, 7.8), W], // top
        [v(13.4, -7.8), v(7.8, -13.4), W], // bottom
        [v(13.4, 7.8), v(7.8, 13.4), W], // right
        [v(-7.8, -13.4), v(-13.4, -7.8), W], // left
      ],
    });
    groups[1] = ringSet.lights.flat();

    const rot = rotatingLasers(kit, { n: 5, x: 17, y: -6, z0: 34, dz: 2, tilt: 55, up: 300, down: 20, width: 0.8 });
    for (const [name, type, s] of [['left', 2, -1], ['right', 3, 1]]) {
      groups[type] = [...rot[name].lights, kit.line(U(s * 2, 0.1, 6.2), U(s * 2, 0.1, 306), 0.4)];
    }
    groups[4] = chevron(kit, { y: 5, z: 65 });

    return kit.finish({
      groups,
      rings: [{ type: 'big', objects: ringSet.objects, step: 3 }],
      lasers: { left: rot.left.pivots, right: rot.right.pivots },
    });
  },
};
