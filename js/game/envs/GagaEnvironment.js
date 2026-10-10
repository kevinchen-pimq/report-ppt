// Lady Gaga environment (GagaEnvironment) — our own simplified recreation.
// A dark mirror plain under a huge two-layer aurora; the runway (on piers, flanked by ribbed tubes)
// leads to a ring logo and two giant vertical centre beams; three Tesla-coil towers stand on each
// side, each with glowing discs, and lightning arcs from their coil discs towards the logo.
//
// Light groups (v2 basic event type → lights, in light-ID order; Chroma lightID n = index n-1):
//   0  upper aurora   1
//   1  lower aurora   1
//   2  tower 3 (left far)   8: bottom disc, upper disc, top disc, coil lightning,
//                               runway bars left: near outer, near inner, far outer, far inner
//   3  tower 4 (right far)  8: same order, runway bars on the right
//   4  centre beams   2: left beam, right beam (behind the logo)
//   6  tower 2 (left middle)  4: bottom disc, upper disc, top disc, coil lightning
//   7  tower 5 (right middle) 4: same
//   10 tower 1 (left near)    4: same
//   11 tower 6 (right near)   4: same
// Source: BSMG wiki basic-lighting table (upper/lower auroras, tower lights, centre lights; 6/7/10/11
// additional tower lights) and the light layout of ChroMapper's community Gaga platform (read for
// facts only: which tower each event drives, 3 glowing discs + 1 lightning per tower, 4 runway
// bars in groups 2/3). The order inside each group is approximate (no official ID list found).
// Not handled: tower coil heights (events 12/13 and 16-19 in this environment) — the coil discs
// stay at a fixed height; the contract's laser-speed objects are not used here.
// Default colours: Beat Saber Lady Gaga scheme (as listed by ArcViewer / ChroMapper / BSMG wiki).
import { THREE, LightBank, MeshLight, GEO, tubeMatrix, trs, mergeStatic, lightMaterial } from './kit.js';
import { MultiLight, rng, softLightMaterial, glowDiscGeometry, skyDome, ridgeGeometry } from './_eShared.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const FLOOR_Y = -3;
const LOGO = V(0, 6.5, -74);

/** Aurora curtain: a folded ribbon of vertical rays, bright at the hem, fading upwards. */
function auroraGeometry(rand, { x0, x1, z, depth, y0, height, cols, phase }) {
  const pos = [];
  const col = [];
  const idx = [];
  const rows = [0, 0.3, 1];
  const rowLevel = [1, 0.55, 0];
  for (let i = 0; i <= cols; i++) {
    const t = i / cols;
    const x = x0 + (x1 - x0) * t;
    const zz = z + Math.sin(t * 9 + phase) * depth + Math.sin(t * 23 + phase * 2) * depth * 0.3;
    const hem = y0 + Math.sin(t * 5 + phase) * height * 0.12;
    const h = height * (0.7 + 0.3 * Math.sin(t * 13 + phase * 3));
    const ray = 0.35 + 0.65 * Math.pow(0.5 + 0.5 * Math.sin(t * 61 + phase), 2) * (0.6 + 0.4 * rand());
    const edge = Math.min(1, Math.min(t, 1 - t) * 5);
    for (let r = 0; r < rows.length; r++) {
      pos.push(x, hem + h * rows[r], zz - rows[r] * 6);
      const c = rowLevel[r] * ray * edge;
      col.push(c, c, c);
    }
  }
  for (let i = 0; i < cols; i++) {
    for (let r = 0; r < rows.length - 1; r++) {
      const a = i * 3 + r, b = (i + 1) * 3 + r;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}

export default {
  name: 'GagaEnvironment',
  label: 'Lady Gaga',
  colors: {
    left: '#D96EC8', right: '#78CC68',
    envLeft: '#B4A53D', envRight: '#E429BF',
    envLeftBoost: '#C05C38', envRightBoost: '#00B4FF',
    wall: '#FD00C5',
  },
  build() {
    const root = new THREE.Group();
    root.name = 'GagaEnvironment';
    const owned = [];
    const rand = rng(2021);

    // ---- static scenery -------------------------------------------------------------------
    const sky = skyDome(0x03040a, 0x0e0c1c, 0x020206);
    root.add(sky);
    owned.push(sky.geometry, sky.material);

    const floorMat = new THREE.MeshStandardMaterial({ color: 0x07070d, roughness: 0.18, metalness: 0.9 });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(700, 700), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, FLOOR_Y, -150);
    root.add(floor);
    owned.push(floor.geometry, floorMat);

    // low hills on the horizon under the aurora
    const hillMat = new THREE.MeshStandardMaterial({ color: 0x15131f, roughness: 0.9, metalness: 0.1, flatShading: true, fog: false });
    const hillGeos = [
      ridgeGeometry(rand, [-200, -132], [200, -132], 30, 4, 13, 24, [0, -1], FLOOR_Y),
      ridgeGeometry(rand, [-120, -40], [-90, -150], 10, 5, 16, 30, [-1, 0], FLOOR_Y),
      ridgeGeometry(rand, [120, -40], [90, -150], 10, 5, 16, 30, [1, 0], FLOOR_Y),
    ];
    const hills = mergeStatic(hillGeos.map((g) => new THREE.Mesh(g, hillMat)), hillMat);
    for (const g of hillGeos) g.dispose();
    root.add(hills);
    owned.push(hills.geometry, hillMat);

    const metalMat = new THREE.MeshStandardMaterial({ color: 0x23222e, roughness: 0.35, metalness: 0.85 });
    const parts = [];
    const temp = [];
    const G = (g) => (temp.push(g), g);
    const rib = G(new THREE.CylinderGeometry(1, 1, 1, 10, 1, false));
    const cyl = G(new THREE.CylinderGeometry(1, 1, 1, 12, 1, false));
    const legGeo = G(new THREE.CylinderGeometry(1, 1, 1, 5, 1, true));
    const ringGeo = G(new THREE.TorusGeometry(1, 0.05, 6, 48));
    const hookGeo = G(new THREE.TorusGeometry(1, 0.12, 6, 20, Math.PI * 1.1));
    const put = (geo, p, r, s) => {
      const m = new THREE.Mesh(geo, metalMat);
      m.position.set(p[0], p[1], p[2]);
      if (r) m.rotation.set(r[0], r[1], r[2]);
      if (s) m.scale.set(s[0], s[1], s[2]);
      parts.push(m);
    };
    const m4 = new THREE.Matrix4();
    const putTube = (a, b, r) => {
      const m = new THREE.Mesh(legGeo, metalMat);
      tubeMatrix(a, b, r, m4).decompose(m.position, m.quaternion, m.scale);
      parts.push(m);
    };

    // ribbed tubes alongside the runway
    for (const s of [-1, 1]) {
      for (let z = 2.5; z > -48; z -= 1.05) put(rib, [s * 4.7, -0.4, z], [Math.PI / 2, 0, 0], [1.05, 0.85, 1.05]);
    }
    // runway piers (cross beam + legs down to the mirror floor) and the runway beyond z = -40
    for (const z of [-8, -24, -90]) {
      put(GEO.box, [0, -0.32, z], null, [4, 0.28, 0.5]);
      for (const s of [-1, 1]) put(GEO.box, [s * 1.7, (FLOOR_Y - 0.3) / 2, z], null, [0.35, -FLOOR_Y - 0.3, 0.35]);
    }
    put(GEO.box, [0, -0.08, -66], null, [2, 0.12, 52]);
    // logo: a large ring with a hook, standing over the end of the runway
    put(ringGeo, [LOGO.x, LOGO.y, LOGO.z], null, [8, 8, 6]);
    put(hookGeo, [LOGO.x - 4.5, LOGO.y + 8.8, LOGO.z], [0, 0, 0.4], [3, 3, 3]);
    // beam bases behind the logo
    for (const s of [-1, 1]) put(cyl, [s * 2.4, FLOOR_Y + 0.3, -100], null, [1.6, 0.6, 1.6]);

    // Tesla towers: 4 legs, collars, discs (static bodies; their glowing rims are lights)
    const TOWERS = [ // [x, z, event type]
      [-34, -40, 10], [-42, -72, 6], [-30, -104, 2],
      [30, -104, 3], [42, -72, 7], [34, -40, 11],
    ];
    const DISCS = [[0.5, 2.4], [26, 2.4], [31, 3.4]]; // bottom, upper, top: [y, radius]
    const COIL = [14, 1.8];
    for (const [x, z] of TOWERS) {
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
        const dx = Math.cos(a) * 0.8, dz = Math.sin(a) * 0.8;
        putTube(V(x + dx * 1.6, FLOOR_Y, z + dz * 1.6), V(x + dx, 31, z + dz), 0.14);
      }
      for (let y = 4; y < 31; y += 4.5) put(cyl, [x, y, z], null, [1.15, 0.18, 1.15]);
      for (const [y, r] of [...DISCS, COIL]) put(cyl, [x, y, z], null, [r, 0.35, r]);
      put(cyl, [x, FLOOR_Y + 0.5, z], null, [2.6, 1, 2.6]);
    }
    const metal = mergeStatic(parts, metalMat);
    root.add(metal);
    owned.push(metal.geometry, metalMat);
    for (const g of temp) g.dispose();

    // ---- lights ---------------------------------------------------------------------------
    const groups = { 0: [], 1: [], 2: [], 3: [], 4: [], 6: [], 7: [], 10: [], 11: [] };
    const banks = [];

    // 0 / 1: aurora curtains (one mesh each; vertex colours shape the rays)
    for (const [type, opts] of [
      [0, { x0: -230, x1: 230, z: -205, depth: 14, y0: 24, height: 70, cols: 96, phase: 0.7 }],
      [1, { x0: -170, x1: 190, z: -176, depth: 9, y0: 2, height: 34, cols: 80, phase: 2.1 }],
    ]) {
      const geo = auroraGeometry(rand, opts);
      const mat = softLightMaterial({ opacity: 0.85 });
      mat.side = THREE.DoubleSide;
      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false;
      mesh.renderOrder = -5;
      root.add(mesh);
      groups[type].push(new MeshLight(mesh));
      owned.push(geo, mat);
    }

    // tower lights: glowing rims (torus bank) + soft glow under each disc
    const rimGeo = new THREE.TorusGeometry(1, 0.06, 5, 32);
    const glowGeo = glowDiscGeometry(24, 0.35, 0.8);
    owned.push(rimGeo, glowGeo);
    const rimBank = new LightBank(root, rimGeo, 6 * 4);
    const glowBank = new LightBank(root, glowGeo, 6 * 4, { material: softLightMaterial({ opacity: 0.6 }) });
    const boltBank = new LightBank(root, GEO.box, 6 * 16 + 8);
    banks.push(rimBank, glowBank, boltBank);
    const flatX = [-Math.PI / 2, 0, 0];
    const disc = (x, y, z, r) => new MultiLight([
      rimBank.add(trs([x, y + 0.18, z], [Math.PI / 2, 0, 0], [r, r, 1])),
      glowBank.add(trs([x, y - 0.2, z], [Math.PI / 2, 0, 0], [r * 1.9, r * 1.9, 1])),
    ], [1, 0.5]);
    const bolt = (a, b, segs, amp) => {
      const pts = [a];
      const d = b.clone().sub(a);
      for (let i = 1; i < segs; i++) {
        const p = a.clone().addScaledVector(d, i / segs);
        p.x += (rand() - 0.5) * amp;
        p.y += (rand() - 0.5) * amp;
        p.z += (rand() - 0.5) * amp;
        pts.push(p);
      }
      pts.push(b);
      const out = [];
      const q = new THREE.Quaternion();
      for (let i = 0; i < pts.length - 1; i++) {
        const dd = pts[i + 1].clone().sub(pts[i]);
        q.setFromUnitVectors(V(0, 1, 0), dd.clone().normalize());
        const mid = pts[i].clone().add(pts[i + 1]).multiplyScalar(0.5);
        out.push(boltBank.add(new THREE.Matrix4().compose(mid, q, V(0.12, dd.length(), 0.12))));
      }
      return out;
    };
    for (const [x, z, type] of TOWERS) {
      const s = Math.sign(x);
      const lights = DISCS.map(([y, r]) => disc(x, y, z, r));
      // lightning: coil disc → towards the logo, with one fork; plus the coil disc rim
      const from = V(x - s * COIL[1], COIL[0], z);
      const to = V(LOGO.x + s * 8.5, LOGO.y + 3, LOGO.z);
      const main = bolt(from, to, 12, 3.2);
      const forkFrom = from.clone().lerp(to, 0.35).add(V(0, 0.5, 0));
      const fork = bolt(forkFrom, forkFrom.clone().add(V(-s * 3, -4, -4)), 3, 1.5);
      const coil = rimBank.add(trs([x, COIL[0] + 0.18, z], [Math.PI / 2, 0, 0], [COIL[1], COIL[1], 1]));
      lights.push(new MultiLight([...main, ...fork, coil]));
      groups[type].push(...lights);
    }
    // groups 2 / 3: small vertical bars beside the runway piers (near pair, far pair)
    for (const [type, s] of [[2, -1], [3, 1]]) {
      for (const z of [-7.2, -23.2]) {
        for (const x of [2.05, 1.85]) groups[type].push(boltBank.add(trs([s * x, -0.75, z + 0.3], [0, 0, 0], [0.07, 0.6, 0.07])));
      }
    }

    // 4: centre beams behind the logo (core + wide glow)
    const beamBank = new LightBank(root, GEO.tube, 2);
    const beamGlow = new LightBank(root, GEO.tube, 2, { material: lightMaterial({ opacity: 0.22 }) });
    banks.push(beamBank, beamGlow);
    for (const s of [-1, 1]) {
      groups[4].push(new MultiLight([
        beamBank.add(tubeMatrix(V(s * 2.4, FLOOR_Y, -100), V(s * 2.4, 320, -100), 0.45)),
        beamGlow.add(tubeMatrix(V(s * 2.4, FLOOR_Y, -100), V(s * 2.4, 320, -100), 1.5)),
      ], [1, 0.7]));
    }

    return {
      root,
      banks,
      groups,
      rings: [],
      lasers: { left: [], right: [] },
      dispose() {
        for (const b of banks) b.dispose();
        for (const o of owned) o.dispose();
        for (const b of banks) b.mesh.material.dispose();
      },
    };
  },
};
