// Spooky environment (HalloweenEnvironment) — our own simplified recreation.
// A graveyard at night: the walkway runs between iron fences, tombstones and dead trees towards a
// gothic castle; a big moon hangs up-left, two pairs of sky lasers run overhead along the track and
// two rows of searchlight lasers behind the castle sweep across the sky.
//
// Light groups (v2 basic event type → lights, in light-ID order; Chroma lightID n = index n-1):
//   0  sky lasers   4: left outer, left inner, right inner, right outer (long beams above the track)
//   1  moon         1 (disc + halo)
//   2  left lasers  18: outermost (x ≈ -86) → innermost (x ≈ -22), behind the castle; spin (event 12)
//   3  right lasers 18: outermost (x ≈ +86) → innermost; spin (event 13)
//   4  walkway      3: left lane strip, right lane strip, castle interior (windows + gate)
// Source: BSMG wiki basic-lighting table (back lasers, moon, left/right lasers, walkway lights;
// laser speed) and the light layout/IDs of ChroMapper's community Halloween platform (read for
// facts only; it numbers each laser row 2…18, so ID 1 is taken to be the outermost laser of the
// row). The castle-interior light is "approximate" (the game drives it with event 4 as well).
// Default colours: Beat Saber Spooky scheme (as listed by ArcViewer / ChroMapper / BSMG wiki).
import { THREE, LightBank, GEO, tubeMatrix, trs, mergeStatic } from './kit.js';
import { MultiLight, rng, softLightMaterial, glowDiscGeometry, skyDome, SpinBank } from './_eShared.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const CASTLE_Z = -112;

export default {
  name: 'HalloweenEnvironment',
  label: 'Spooky',
  colors: {
    left: '#D17F47', right: '#615B66',
    envLeft: '#E63B00', envRight: '#7591ED',
    envLeftBoost: '#56A156', envRightBoost: '#9A54DB',
    wall: '#D1712F',
  },
  build() {
    const root = new THREE.Group();
    root.name = 'HalloweenEnvironment';
    const owned = [];
    const rand = rng(1031);

    // ---- static scenery -------------------------------------------------------------------
    const sky = skyDome(0x020605, 0x10241f, 0x040606);
    root.add(sky);
    owned.push(sky.geometry, sky.material);

    const groundMat = new THREE.MeshStandardMaterial({ color: 0x14121a, roughness: 0.95, metalness: 0.05 });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(700, 700), groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, -0.03, -150);
    root.add(ground);
    owned.push(ground.geometry, groundMat);

    const stoneMat = new THREE.MeshStandardMaterial({ color: 0x3a3742, roughness: 0.9, metalness: 0.05, flatShading: true });
    const ironMat = new THREE.MeshStandardMaterial({ color: 0x18161c, roughness: 0.4, metalness: 0.8 });
    const woodMat = new THREE.MeshStandardMaterial({ color: 0x221d20, roughness: 0.9, metalness: 0.1, flatShading: true });
    const stone = [], iron = [], wood = [];
    const temp = []; // geometries created here, disposed after merging
    const G = (g) => (temp.push(g), g);
    const cyl8 = G(new THREE.CylinderGeometry(1, 1, 1, 8));
    const cone4 = G(new THREE.ConeGeometry(1, 1, 4));
    const cone8 = G(new THREE.ConeGeometry(1, 1, 8));
    const branch = G(new THREE.CylinderGeometry(0.6, 1, 1, 5, 1, true));
    const mound = G(new THREE.SphereGeometry(1, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2));
    const put = (list, geo, mat, p, r, s) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(p[0], p[1], p[2]);
      if (r) m.rotation.set(r[0], r[1], r[2]);
      if (s) m.scale.set(s[0], s[1], s[2]);
      list.push(m);
      return m;
    };
    const putM = (list, geo, mat, matrix) => {
      const m = new THREE.Mesh(geo, mat);
      matrix.decompose(m.position, m.quaternion, m.scale);
      list.push(m);
    };

    // iron fences along the walkway (posts with spikes, two rails, stone pillars every 6 m),
    // turning outwards behind the player
    for (const s of [-1, 1]) {
      const runs = [[[s * 2.5, 1.5], [s * 2.5, -52]], [[s * 2.5, 1.5], [s * 8, 3.5]]];
      for (const [a, b] of runs) {
        const dx = b[0] - a[0], dz = b[1] - a[1];
        const len = Math.hypot(dx, dz);
        const yaw = Math.atan2(dx, dz);
        const n = Math.floor(len / 0.42);
        for (let i = 0; i <= n; i++) {
          const t = i / n;
          const x = a[0] + dx * t, z = a[1] + dz * t;
          put(iron, GEO.box, ironMat, [x, 0.55, z], null, [0.035, 1.1, 0.035]);
          put(iron, cone4, ironMat, [x, 1.16, z], null, [0.04, 0.12, 0.04]);
        }
        for (const y of [0.2, 0.92]) put(iron, GEO.box, ironMat, [a[0] + dx / 2, y, a[1] + dz / 2], [0, yaw, 0], [0.04, 0.05, len]);
        for (let d = 0; d <= len; d += 6) {
          const x = a[0] + (dx * d) / len, z = a[1] + (dz * d) / len;
          put(stone, GEO.box, stoneMat, [x, 0.7, z], null, [0.34, 1.4, 0.34]);
          put(stone, GEO.box, stoneMat, [x, 1.45, z], null, [0.44, 0.1, 0.44]);
          put(stone, cone4, stoneMat, [x, 1.62, z], [0, Math.PI / 4, 0], [0.22, 0.25, 0.22]);
        }
      }
    }

    // walkway continuation past the game's runway, up to the castle gate
    put(stone, GEO.box, stoneMat, [0, -0.02, -77], null, [2.2, 0.06, 74]);
    for (let z = -42; z > -112; z -= 1.6) {
      put(stone, GEO.box, stoneMat, [(rand() - 0.5) * 0.3, 0.02, z], [0, (rand() - 0.5) * 0.2, 0], [1.6 + rand() * 0.4, 0.06, 1.1]);
    }

    // graves: tombstones (rounded tops), crosses, grave mounds — on both sides of the fences
    for (let i = 0; i < 64; i++) {
      const s = i % 2 ? 1 : -1;
      const x = s * (3.4 + rand() * 14);
      const z = 2 - rand() * 66;
      const kind = rand();
      const yaw = (rand() - 0.5) * 0.5, lean = (rand() - 0.5) * 0.25;
      const h = 0.7 + rand() * 0.7;
      if (kind < 0.55) {
        const w = 0.5 + rand() * 0.35;
        put(stone, GEO.box, stoneMat, [x, h / 2, z], [lean, yaw, 0], [w, h, 0.16]);
        put(stone, cyl8, stoneMat, [x - Math.sin(lean) * 0 , h, z], [Math.PI / 2 + lean, yaw, 0], [w / 2, 0.16, w / 2]);
      } else if (kind < 0.8) {
        put(stone, GEO.box, stoneMat, [x, h * 0.6, z], [lean, yaw, 0], [0.14, h * 1.2, 0.14]);
        put(stone, GEO.box, stoneMat, [x, h * 0.85, z], [lean, yaw, 0], [0.62, 0.13, 0.14]);
      } else {
        put(stone, mound, stoneMat, [x, 0, z], [0, yaw, 0], [0.6, 0.25, 1.1]);
        put(stone, GEO.box, stoneMat, [x, h * 0.45, z - 1], [lean, yaw, 0], [0.55, h * 0.9, 0.14]);
      }
    }

    // dead trees: tapered branches, recursive
    const m4 = new THREE.Matrix4();
    const grow = (a, dir, len, r, depth) => {
      const b = a.clone().addScaledVector(dir, len);
      tubeMatrix(a, b, r, m4);
      putM(wood, branch, woodMat, m4);
      if (depth === 0) return;
      const n = depth > 2 ? 2 : 3;
      for (let k = 0; k < n; k++) {
        const d = dir.clone();
        const axis = V(rand() - 0.5, 0, rand() - 0.5).normalize();
        d.applyAxisAngle(axis, 0.45 + rand() * 0.55);
        d.y = Math.max(d.y, -0.1);
        d.normalize();
        grow(b, d, len * (0.55 + rand() * 0.2), r * 0.6, depth - 1);
      }
    };
    const trees = [[-7, -6, 8], [8.5, -12, 9], [-12, -24, 11], [13, -30, 10], [-9.5, -42, 9], [10, -50, 12],
      [-22, -60, 14], [24, -68, 15], [-18, -88, 16], [19, -95, 15], [-34, -30, 13], [33, -14, 12]];
    for (const [x, z, h] of trees) {
      const lean = V((rand() - 0.5) * 0.3, 1, (rand() - 0.5) * 0.3).normalize();
      grow(V(x, -0.1, z), lean, h * 0.45, h * 0.035, 4);
    }

    // castles: the big one at the end of the walkway + three smaller ones in the distance
    const castle = (cx, cz, k, withSpire) => {
      const P = (x, y, z) => [cx + x * k, y * k, cz + z * k];
      put(stone, GEO.box, stoneMat, P(0, 8, -6), null, [24 * k, 16 * k, 12 * k]);
      for (let x = -11; x <= 11; x += 2) put(stone, GEO.box, stoneMat, P(x, 16.6, 0), null, [1 * k, 1.2 * k, 0.8 * k]);
      for (const sx of [-1, 1]) {
        put(stone, cyl8, stoneMat, P(sx * 13, 12, -2), null, [3 * k, 24 * k, 3 * k]);
        put(stone, cone8, stoneMat, P(sx * 13, 29, -2), null, [3.6 * k, 10 * k, 3.6 * k]);
        put(stone, cyl8, stoneMat, P(sx * 6.5, 10, 0.5), null, [1.4 * k, 20 * k, 1.4 * k]);
        put(stone, cone8, stoneMat, P(sx * 6.5, 23.5, 0.5), null, [1.7 * k, 7 * k, 1.7 * k]);
      }
      put(stone, GEO.box, stoneMat, P(0, 17, -1), null, [7 * k, 34 * k, 7 * k]);
      if (withSpire) {
        put(stone, cone4, stoneMat, P(0, 44, -1), [0, Math.PI / 4, 0], [5.4 * k, 20 * k, 5.4 * k]);
        for (const sx of [-1, 1]) put(stone, cone4, stoneMat, P(sx * 3.6, 37, 2.5), [0, Math.PI / 4, 0], [0.9 * k, 6 * k, 0.9 * k]);
      }
    };
    castle(0, CASTLE_Z, 1, true);
    castle(-62, -205, 0.8, true);
    castle(82, -175, 0.7, false);
    castle(-95, -140, 0.6, false);

    const mergedStone = mergeStatic(stone, stoneMat);
    const mergedIron = mergeStatic(iron, ironMat);
    const mergedWood = mergeStatic(wood, woodMat);
    root.add(mergedStone, mergedIron, mergedWood);
    owned.push(mergedStone.geometry, mergedIron.geometry, mergedWood.geometry, stoneMat, ironMat, woodMat);
    for (const g of temp) g.dispose();

    // ---- lights ---------------------------------------------------------------------------
    const groups = { 0: [], 1: [], 2: [], 3: [], 4: [] };
    const banks = [];

    // 0: sky lasers — two pairs of long beams high above the track; 4: lane strips
    const tubeBank = new LightBank(root, GEO.tube, 6);
    banks.push(tubeBank);
    for (const [x, y] of [[-9, 16.9], [-7.5, 16.9], [7.5, 17.2], [9, 17.2]]) {
      groups[0].push(tubeBank.add(tubeMatrix(V(x, y, 30), V(x, y, -260), 0.13)));
    }
    groups[4].push(tubeBank.add(tubeMatrix(V(-1.12, 0.03, 1), V(-1.12, 0.03, -108), 0.035)));
    groups[4].push(tubeBank.add(tubeMatrix(V(1.12, 0.03, 1), V(1.12, 0.03, -108), 0.035)));

    // 4 (ID 3): castle interior — lit windows, rose window and the gate
    const winBank = new LightBank(root, GEO.plane, 24);
    banks.push(winBank);
    const fz = CASTLE_Z + 0.05;
    const wins = [];
    for (const y of [5, 11]) for (const x of [-9.5, -6.5, 6.5, 9.5]) wins.push(winBank.add(trs([x, y, fz], [0, 0, 0], [0.9, 2.4, 1])));
    wins.push(winBank.add(trs([0, 4.2, CASTLE_Z + 2.55], [0, 0, 0], [2.6, 5.5, 1]))); // gate
    wins.push(winBank.add(trs([0, 21, CASTLE_Z + 2.55], [0, 0, Math.PI / 4], [2.2, 2.2, 1]))); // rose window
    for (const x of [-1.6, 1.6]) wins.push(winBank.add(trs([x, 28, CASTLE_Z + 2.55], [0, 0, 0], [0.7, 3, 1])));
    for (const x of [-13, 13]) for (const y of [8, 15]) wins.push(winBank.add(trs([x, y, CASTLE_Z + 1.05], [0, 0, 0], [0.7, 1.8, 1])));
    groups[4].push(new MultiLight(wins, wins.map(() => 0.85)));

    // 1: moon
    const discGeo = glowDiscGeometry(32, 0.9, 1);
    const haloGeo = glowDiscGeometry(24, 0.05, 1);
    owned.push(discGeo, haloGeo);
    const moonBank = new LightBank(root, discGeo, 1, { material: softLightMaterial() });
    const haloBank = new LightBank(root, haloGeo, 1, { material: softLightMaterial({ opacity: 0.55 }) });
    banks.push(moonBank, haloBank);
    groups[1].push(new MultiLight([
      moonBank.add(trs([-26, 46, -168], [0, 0.15, 0], [8, 8, 1])),
      haloBank.add(trs([-26, 46, -168.5], [0, 0.15, 0], [30, 30, 1])),
    ], [1, 0.6]));

    // 2 / 3: two rows of searchlight lasers behind the castle, leaning towards the centre so the
    // rows cross over the walkway; laser speed spins each beam around the vertical (a cone sweep)
    const spin = new SpinBank(root, GEO.tube, 36);
    banks.push(spin.bank);
    const lasers = { left: [], right: [] };
    const local = new THREE.Matrix4();
    const base = new THREE.Matrix4();
    for (const [type, s, list] of [[2, -1, lasers.left], [3, 1, lasers.right]]) {
      const tilt = -s * THREE.MathUtils.degToRad(55);
      const dir = V(Math.sin(-tilt), Math.cos(tilt), 0);
      tubeMatrix(V(0, 0, 0), dir.multiplyScalar(320), 0.16, local);
      for (let i = 0; i < 18; i++) {
        base.makeTranslation(s * (86.2 - i * 3.75), 0, -97.5 - (i % 2) * 2);
        const { light, pivot } = spin.add(base, local, 'y');
        groups[type].push(light);
        list.push(pivot);
      }
    }

    return {
      root,
      banks,
      groups,
      rings: [],
      lasers,
      update() {
        spin.sync();
      },
      dispose() {
        for (const b of banks) b.dispose();
        for (const o of owned) o.dispose();
        for (const b of banks) b.mesh.material.dispose();
      },
    };
  },
};
