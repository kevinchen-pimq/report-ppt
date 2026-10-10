// Rocket League environment — our own recreation from simple shapes (no game assets).
// Look: a dark, glossy arena floor; two rocket cars posed nose-up on rock pedestals left and right of the
// runway, each ringed by four glowing posts; a big goal at the far end of the arena framed by light
// strips, arena walls and pillars with vertical light strips, long overhead lane lines, floor strips
// along the arena, and two arcs of rotating lasers behind the goal line that cross into X shapes.
//
// Event groups (v2 basic events) and light counts — ID order: approximate. No official light-ID
// table was found; groups follow the BSMG wiki description ("back lights, bottom lights, left & right
// lasers, center lights"; no rings; laser speed) and the light layout of the community editor
// ChroMapper (reference only: which group drives what, rough positions and per-group order).
//   0  back lights   12  1-4 overhead lane lines (x = -1.5, -1, 1, 1.5), 5 back-wall strips (all),
//                        6 / 7 outer side-wall strips L / R, 8 / 9 middle L / R, 10 / 11 inner L / R,
//                        12 the glowing posts around both car pedestals
//   1  bottom lights  6  1-4 long floor strips beside the runway (x = -6, -5, 5, 6),
//                        5 / 6 far lane lines past the goal L / R
//   2  left lasers    7  rotating lasers on the left arc, outer → inner
//   3  right lasers   7  same on the right
//   4  center lights  5  1 goal frame, 2 / 3 lane lights through the goal L / R, 4 / 5 small posts L / R
// rings: none. lasers: 7 + 7 (each a tilted beam spinning around Y, so it sweeps a cone).
import { THREE, GEO, mergeStatic, sceneryMaterials } from './kit.js';
import { V, GlowBank, MultiLight, Followers, mergeAll, place } from './_cKit.js';

const GOAL_Z = -48;

export default {
  name: 'RocketEnvironment',
  label: 'Rocket League',
  colors: {
    left: '#ff7f00',
    right: '#0087ff',
    envLeft: '#e67c53',
    envRight: '#66b7ff',
    wall: '#519cb9',
  },
  build() {
    const root = new THREE.Group();
    root.name = 'RocketEnvironment';
    const mats = sceneryMaterials();
    const carMat = new THREE.MeshStandardMaterial({ color: 0x6a7088, roughness: 0.35, metalness: 0.6 });
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x2b2627, roughness: 0.85, metalness: 0.1, flatShading: true });
    const glow = new GlowBank(root, GEO.tube, 128, { halo: 3, haloOpacity: 0.17 });
    const groups = { 0: [], 1: [], 2: [], 3: [], 4: [] };
    const multi = (segs, r) => new MultiLight(segs.map(([a, b]) => glow.tube(a, b, r)));

    // ---------------- group 0: back lights
    for (const x of [-1.5, -1, 1, 1.5]) groups[0].push(glow.tube(V(x, 9, 2), V(x, 9, -160), 0.025));
    // 5: strips on the back wall around the goal
    {
      const z = GOAL_Z - 0.6;
      const segs = [];
      for (const x of [-21.7, -13.3, -10.9, 10.9, 13.3, 21.7]) segs.push([V(x, 0.2, z), V(x, Math.abs(x) > 20 ? 14 : Math.abs(x) > 12 ? 9 : 11, z)]);
      segs.push([V(-6, 12.5, z), V(6, 12.5, z)]);
      segs.push([V(-21.7, 14, z), V(-13.3, 9, z)], [V(21.7, 14, z), V(13.3, 9, z)]);
      groups[0].push(multi(segs, 0.06));
    }
    // 6-11: side wall strips (outer, middle, inner) L / R
    for (const [x, z, h] of [[40, -14, 17], [35, -38, 12], [28, -46, 9]]) {
      for (const s of [-1, 1]) groups[0].push(glow.tube(V(s * x, 0, z), V(s * x, h, z), 0.08));
    }
    // 12: posts around the car pedestals
    {
      const segs = [];
      for (const s of [-1, 1]) {
        const cx = s * 11;
        const cz = -23;
        for (const [dx, dz] of [[-5, 0], [5, 0], [0, -5], [0, 5]]) segs.push([V(cx + dx, 0, cz + dz), V(cx + dx, 5, cz + dz)]);
      }
      groups[0].push(multi(segs, 0.05));
    }

    // ---------------- group 1: bottom lights
    for (const x of [-6, -5, 5, 6]) groups[1].push(glow.tube(V(x, -0.18, 6), V(x, -0.18, -150), 0.03));
    for (const x of [-2, 2]) groups[1].push(glow.tube(V(x, -0.18, GOAL_Z - 2), V(x, -0.18, -240), 0.03));

    // ---------------- groups 2 / 3: rotating lasers on two arcs behind the goal line
    const lasers = { left: [], right: [] };
    const follow = new Followers();
    const arc = [[46, -35], [41, -41], [36, -45], [31, -48], [25.5, -50], [20, -52], [12.5, -56]];
    for (const [type, s, list] of [[2, -1, lasers.left], [3, 1, lasers.right]]) {
      for (const [x, z] of arc) {
        const pivot = new THREE.Group();
        pivot.position.set(s * x, -0.3, z);
        pivot.rotation.y = s * 0.6;
        pivot.userData.axis = 'y'; // tilted beam spinning around Y sweeps a cone, always upward
        root.add(pivot);
        list.push(pivot);
        groups[type].push(glow.tubeFollow(follow, pivot, V(0, 0, 0), V(-s * 120 * Math.sin(0.5), 120 * Math.cos(0.5), 0), 0.05));
      }
    }

    // ---------------- group 4: center lights
    {
      const z = GOAL_Z + 0.3;
      // 1: goal frame (posts + crossbar) and the stepped skirt line along the arena wall base
      groups[4].push(multi([
        [V(-9, 0, z), V(-9, 7.2, z)], [V(9, 0, z), V(9, 7.2, z)], [V(-9, 7.2, z), V(9, 7.2, z)],
        [V(-9, 3.2, z), V(-14, 3.2, z)], [V(9, 3.2, z), V(14, 3.2, z)],
        [V(-14, 3.2, z), V(-16, 1.2, z + 1.5)], [V(14, 3.2, z), V(16, 1.2, z + 1.5)],
        [V(-16, 1.2, z + 1.5), V(-30, 1.2, z + 3)], [V(16, 1.2, z + 1.5), V(30, 1.2, z + 3)],
      ], 0.07));
      groups[4].push(glow.tube(V(-2, 0.4, GOAL_Z - 10), V(-2, 0.4, -160), 0.03));
      groups[4].push(glow.tube(V(2, 0.4, GOAL_Z - 10), V(2, 0.4, -160), 0.03));
      groups[4].push(glow.tube(V(-1, 3.3, GOAL_Z - 17), V(-1, 4.6, GOAL_Z - 17), 0.07));
      groups[4].push(glow.tube(V(1, 3.3, GOAL_Z - 17), V(1, 4.6, GOAL_Z - 17), 0.07));
    }

    // ---------------- static scenery
    const box = new THREE.BoxGeometry(1, 1, 1);
    const B = (pos, scale, rot = [0, 0, 0]) => place(box.clone(), pos, rot, scale);
    const dark = [];
    // arena floor (glossy) — leaves the runway to the game
    const floorMesh = new THREE.Mesh(GEO.plane, mats.floor);
    floorMesh.rotation.x = -Math.PI / 2;
    floorMesh.position.set(0, -0.2, -60);
    floorMesh.scale.set(120, 180, 1);
    // back wall with the goal opening, goal box behind it
    const wz = GOAL_Z - 1;
    // low stands either side of the goal (the lasers behind them stay visible), lintel above it
    dark.push(B([-25, 2, wz], [32, 4, 1]), B([25, 2, wz], [32, 4, 1]), B([0, 10, wz], [20, 5.6, 1]));
    for (const s of [-1, 1]) dark.push(B([s * 25, 4.5, wz - 3], [32, 1.2, 5], [0.5, 0, 0]));
    dark.push(B([0, 3.6, GOAL_Z - 6], [18, 7.2, 0.6]), B([-9.3, 3.6, GOAL_Z - 3.5], [0.4, 7.2, 5]), B([9.3, 3.6, GOAL_Z - 3.5], [0.4, 7.2, 5]), B([0, 7.4, GOAL_Z - 3.5], [18.6, 0.4, 5]));
    // curved arena walls: panels leaning outward on both sides
    for (const s of [-1, 1]) {
      for (let i = 0; i < 6; i++) {
        const z = 8 - i * 10;
        const x = 34 + (i > 3 ? (i - 3) * -3 : 0);
        dark.push(B([s * x, 2.6, z], [1, 6.5, 10.2], [0, 0, s * 0.6]));
      }
      // tall pillars behind the goal line
      for (const [x, z] of [[18, -54], [30, -50], [42, -40]]) dark.push(B([s * x, 15, z], [2.5, 34, 2.5]));
      // car pedestal plinths
      dark.push(B([s * 11, 0.3, -23], [7, 0.6, 7], [0, Math.PI / 4, 0]));
    }
    // roof ring of the arena
    for (const s of [-1, 1]) dark.push(B([s * 30, 26, -20], [2, 2, 90]));
    dark.push(B([0, 26, -55], [62, 2, 2]));
    const darkMesh = new THREE.Mesh(mergeAll(dark), mats.dark);
    darkMesh.matrixAutoUpdate = false;

    // rock pedestals (low-poly stacked boulders)
    const rocks = [];
    const ico = new THREE.IcosahedronGeometry(1, 0);
    for (const s of [-1, 1]) {
      const cx = s * 11;
      const cz = -23;
      rocks.push(place(ico.clone(), [cx, 1.4, cz], [0.3, 0.8 * s, 0.2], [3.2, 2.0, 3.0]));
      rocks.push(place(ico.clone(), [cx - s * 0.4, 3.2, cz + 0.4], [0.9, 0.2, 0.5 * s], [2.2, 2.0, 2.4]));
      rocks.push(place(ico.clone(), [cx - s * 0.9, 4.8, cz + 0.2], [0.2, 1.1, 0.9], [1.4, 1.6, 1.6]));
      rocks.push(place(ico.clone(), [cx + s * 1.3, 2.0, cz - 1.4], [0.5, 0.3, 0.1], [1.5, 1.2, 1.4]));
    }
    ico.dispose();
    const rockMesh = new THREE.Mesh(mergeAll(rocks), rockMat);
    rockMesh.matrixAutoUpdate = false;

    // the two cars: chunky body, cabin, spoiler, four big wheels; posed nose-up, facing the runway
    const cars = [];
    const wheel = new THREE.CylinderGeometry(0.62, 0.62, 0.5, 12);
    wheel.rotateZ(Math.PI / 2);
    for (const s of [-1, 1]) {
      const parts = [
        B([0, 0.55, 0], [2.1, 0.6, 4.4]),
        B([0, 1.05, 0.35], [1.7, 0.5, 2.0], [-0.08, 0, 0]),
        B([0, 0.95, -1.75], [2.0, 0.3, 0.9], [0.15, 0, 0]),
        B([0, 1.35, 1.9], [1.9, 0.08, 0.5]),
        B([-0.7, 1.15, 1.9], [0.12, 0.5, 0.3]),
        B([0.7, 1.15, 1.9], [0.12, 0.5, 0.3]),
      ];
      for (const [wx, wz] of [[-1.15, -1.45], [1.15, -1.45], [-1.15, 1.4], [1.15, 1.4]]) parts.push(place(wheel.clone(), [wx, 0.55, wz]));
      const car = mergeAll(parts);
      // nose (−Z) up, turned toward the runway and the player, scaled up like a statue
      const m = new THREE.Matrix4().compose(
        V(s * 10.6, 6.6, -23.4),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0.55, s * 1.75, 0, 'YXZ')),
        V(1.25, 1.25, 1.25),
      );
      car.applyMatrix4(m);
      cars.push(car);
    }
    wheel.dispose();
    box.dispose();
    const carMesh = new THREE.Mesh(mergeAll(cars), carMat);
    carMesh.matrixAutoUpdate = false;
    const floor = mergeStatic([floorMesh], mats.floor);
    root.add(floor, darkMesh, rockMesh, carMesh);

    follow.update(true);
    const banks = [...glow.banks];
    return {
      root,
      banks,
      groups,
      rings: [],
      lasers,
      update() {
        follow.update();
      },
      dispose() {
        glow.dispose();
        for (const x of [floor, darkMesh, rockMesh, carMesh]) x.geometry.dispose();
        carMat.dispose();
        rockMat.dispose();
        Object.values(mats).forEach((x) => x.dispose());
      },
    };
  },
};
