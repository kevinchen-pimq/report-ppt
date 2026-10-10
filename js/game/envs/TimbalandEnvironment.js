// Timbaland environment — our own recreation from simple shapes (no game assets).
// Look: a dark, purple-blue space crossed by huge triangular trusses over the runway, leaning
// scaffold towers on both sides, the always-lit "TIMBALAND" lettering on both sides, a set of
// rings ahead whose side lasers fan out sideways into long rows of parallel bars, glowing strips
// along both runway edges and a trapezoid chevron at the far end.
//
// Event groups (v2 basic events) and light counts — ID order: approximate. No official light-ID
// table was found; groups follow the BSMG wiki description ("side lasers, intra-ring lasers,
// left & right ring lasers, center lights"; ring spin + zoom; side laser speed; the TIMBALAND text never
// turns off) and the per-ring id pattern of the community viewers ArcViewer / ChroMapper (reference only).
//   0  side lasers     20  per ring k (front → back): 2k+1 left, 2k+2 right — horizontal lasers fanning
//                          out sideways from the ring; each one also spins (laser speed 12 / 13)
//   1  intra-ring      20  per ring k: 2k+1 left, 2k+2 right — vertical bars on the inner sides of the ring
//   2  left ring laser 10  per ring k: k+1 — very long vertical beam on the ring's left side
//   3  right ring laser 10 per ring k: k+1 — same on the right
//   4  center lights    6  1 left runway strip, 2 right runway strip, 3 chevron left arm, 4 chevron left
//                          top bar, 5 chevron right top bar, 6 chevron right arm
// rings: big × 10 (spin + zoom). lasers: left = the 10 left side lasers, right = the 10 right ones
// (each spins around its ring's X axis, so it sweeps a fan but never crosses the runway).
import { THREE, GEO, trs, mergeStatic, sceneryMaterials } from './kit.js';
import { V, GlowBank, PropBank, Followers, strokeText, mergeAll, beamGeometry } from './_cKit.js';

const RING_N = 10;
const RING_Z0 = -34;
const RING_DZ = 3;
const RING_Y = 1.2;
const RING_X = 7; // half width of a ring

export default {
  name: 'TimbalandEnvironment',
  label: 'Timbaland',
  colors: {
    left: '#808080',
    right: '#198cff',
    envLeft: '#198cff',
    envRight: '#198cff',
    wall: '#808080',
  },
  build() {
    const root = new THREE.Group();
    root.name = 'TimbalandEnvironment';
    const mats = sceneryMaterials();
    const trussMat = new THREE.MeshStandardMaterial({ color: 0x1c1a2c, roughness: 0.55, metalness: 0.55 });
    const logoMat = new THREE.MeshBasicMaterial({ color: 0x3f7dff, toneMapped: false, fog: false });
    const follow = new Followers();
    const m = new THREE.Matrix4();

    const glow = new GlowBank(root, GEO.tube, 120, { halo: 3, haloOpacity: 0.17 });
    const ringProps = new PropBank(root, GEO.box, trussMat, RING_N * 3);
    const groups = { 0: [], 1: [], 2: [], 3: [], 4: [] };
    const lasers = { left: [], right: [] };

    // ---- rings
    const rings = [];
    const SIDE_LEN = 160;
    const c45 = Math.cos(Math.PI / 4);
    for (let k = 0; k < RING_N; k++) {
      const ring = new THREE.Group();
      ring.position.set(0, RING_Y, RING_Z0 - k * RING_DZ);
      root.add(ring);
      rings.push(ring);
      // ring body: two dark posts and a thin top bar
      for (const s of [-1, 1]) follow.add(ringProps, ringProps.add(trs([s * (RING_X + 0.35), 0, 0], [0, 0, 0], [0.35, 8.4, 0.35], m)), ring, m);
      follow.add(ringProps, ringProps.add(trs([0, 4.2, 0], [0, 0, 0], [2 * RING_X + 1, 0.3, 0.3], m)), ring, m);

      for (const [s, list] of [[-1, lasers.left], [1, lasers.right]]) {
        // 0: side laser, on its own pivot (child of the ring) so laser-speed events can spin it
        const pivot = new THREE.Group();
        pivot.position.set(s * RING_X, -0.4, 0);
        pivot.userData.axis = 'x';
        ring.add(pivot);
        list.push(pivot);
        groups[0].push(glow.tubeFollow(follow, [ring, pivot], V(0, 0, 0), V(s * SIDE_LEN * c45, 0, -SIDE_LEN * c45), 0.05));
      }
      for (const s of [-1, 1]) {
        // 1: intra-ring vertical bars
        groups[1].push(glow.tubeFollow(follow, ring, V(s * (RING_X - 0.35), -3.3, 0), V(s * (RING_X - 0.35), 3.3, 0), 0.07));
      }
      // 2 / 3: tall vertical ring lasers just outside the posts
      groups[2].push(glow.tubeFollow(follow, ring, V(-(RING_X + 0.9), -60, 0), V(-(RING_X + 0.9), 60, 0), 0.04));
      groups[3].push(glow.tubeFollow(follow, ring, V(RING_X + 0.9, -60, 0), V(RING_X + 0.9, 60, 0), 0.04));
    }

    // ---- center lights: runway strips + chevron
    groups[4].push(glow.tube(V(-1.9, 0.02, 0), V(-1.9, 0.02, -110), 0.05));
    groups[4].push(glow.tube(V(1.9, 0.02, 0), V(1.9, 0.02, -110), 0.05));
    {
      const z = -78;
      const yTop = 5.2;
      const yLow = 2.6;
      groups[4].push(glow.tube(V(-1.7, yTop, z), V(-3.4, yLow, z), 0.09)); // 3 left arm
      groups[4].push(glow.tube(V(-1.7, yTop, z), V(0, yTop, z), 0.09)); // 4 left top bar
      groups[4].push(glow.tube(V(0, yTop, z), V(1.7, yTop, z), 0.09)); // 5 right top bar
      groups[4].push(glow.tube(V(1.7, yTop, z), V(3.4, yLow, z), 0.09)); // 6 right arm
    }

    // ---- static scenery (merged per material)
    const parts = [];
    const box = new THREE.BoxGeometry(1, 1, 1);
    const P = (a, b, w, d = w) => parts.push(beamGeometry(a, b, w, d, box));
    // triangular trusses over the runway (A-frames with a crossbeam)
    for (const z of [-12, -22, -64, -78, -92, -106, -120]) {
      P(V(-16, -4, z), V(0, 20, z), 0.9);
      P(V(16, -4, z), V(0, 20, z), 0.9);
      P(V(-11, 12, z), V(11, 12, z), 0.6, 0.9);
      P(V(-5, 12, z), V(0, 20, z), 0.3); // king-post bracing
      P(V(5, 12, z), V(0, 20, z), 0.3);
    }
    // long purlins connecting the trusses
    for (const s of [-1, 1]) {
      P(V(s * 11, 12, -10), V(s * 11, 12, -120), 0.5);
      P(V(s * 5.3, 12, -10), V(s * 5.3, 12, -120), 0.35);
    }
    // leaning scaffold towers on both sides
    for (const s of [-1, 1]) {
      for (const z of [-6, -40, -95]) {
        const base = V(s * 15, -10, z);
        const top = V(s * 34, 40, z);
        P(base, top, 3.2, 3);
        P(V(s * 15, -10, z - 6), V(s * 34, 40, z - 6), 1.2);
        for (let t = 0.15; t < 1; t += 0.14) {
          const a = base.clone().lerp(top, t);
          P(a, V(a.x, a.y, z - 6), 0.5);
        }
      }
    }
    // dark platform beside the runway and a deep floor
    for (const s of [-1, 1]) {
      const g = box.clone();
      g.applyMatrix4(trs([s * 2.6, -0.15, -55], [0, 0, 0], [3.0, 0.3, 112]));
      parts.push(g);
    }
    const scenery = new THREE.Mesh(mergeAll(parts), trussMat);
    scenery.matrixAutoUpdate = false;
    root.add(scenery);
    const floorMesh = new THREE.Mesh(GEO.plane, mats.floor);
    floorMesh.rotation.x = -Math.PI / 2;
    floorMesh.position.set(0, -6, -60);
    floorMesh.scale.set(160, 200, 1);
    const floor = mergeStatic([floorMesh], mats.floor);
    root.add(floor);

    // ---- always-on TIMBALAND lettering on both sides
    const textGeo = strokeText('TIMBALAND', 2.2, 0.3, { spacing: 1.3 });
    const logoParts = [];
    for (const s of [-1, 1]) {
      const g = textGeo.clone();
      g.applyMatrix4(trs([s * 11.5, 6.0, -31], [0, -s * 1.15, 0], [1, 1, 1]));
      logoParts.push(g);
    }
    textGeo.dispose();
    const logo = new THREE.Mesh(mergeAll(logoParts), logoMat);
    logo.matrixAutoUpdate = false;
    root.add(logo);
    box.dispose();

    follow.update(true);
    const banks = [...glow.banks, ringProps];
    return {
      root,
      banks,
      groups,
      rings: [{ type: 'big', objects: rings, step: 5, zoom: { near: 1.6, far: RING_DZ } }],
      lasers,
      update() {
        follow.update();
      },
      dispose() {
        glow.dispose();
        ringProps.dispose();
        scenery.geometry.dispose();
        floor.geometry.dispose();
        logo.geometry.dispose();
        trussMat.dispose();
        logoMat.dispose();
        Object.values(mats).forEach((x) => x.dispose());
      },
    };
  },
};
