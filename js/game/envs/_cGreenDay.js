// Shared builder for GreenDayEnvironment and GreenDayGrenadeEnvironment (our own recreation from
// simple shapes, no game assets). See the two module files for the event-group tables.
import { THREE, GEO, LightBank, trs, mergeStatic, sceneryMaterials, lightMaterial } from './kit.js';
import { V, GlowBank, PropBank, MultiLight, Followers, mergeAll, beamGeometry, place, strokeText } from './_cKit.js';

export const GREEN_DAY_COLORS = {
  left: '#42c805',
  right: '#00b6ab',
  envLeft: '#00b6ab',
  envRight: '#42c805',
  wall: '#00cf17',
};

const RING_N = 10;
const RING_Z0 = -46;
const RING_DZ = 5;
const RING_Y = 5.4;

/** opts.rings: true → Green Day (ring lights + rings), false → Grenade (ambient window lights instead). */
export function buildGreenDay({ rings: withRings }) {
  const root = new THREE.Group();
  const mats = sceneryMaterials();
  const bldgMat = new THREE.MeshStandardMaterial({ color: 0x2c2e36, roughness: 0.9, metalness: 0.1 });
  const greyMat = new THREE.MeshStandardMaterial({ color: 0x8d8f94, roughness: 0.8, metalness: 0.05 });
  const skinMat = new THREE.MeshStandardMaterial({ color: 0x15151a, roughness: 0.7, metalness: 0.2 });
  const owned = [bldgMat, greyMat, skinMat];
  const follow = new Followers();
  const m = new THREE.Matrix4();
  const glow = new GlowBank(root, GEO.tube, 200, { halo: 3, haloOpacity: 0.17 });
  const banks = [...glow.banks];
  const groups = { 0: [], 1: [], 2: [], 3: [], 4: [] };
  const multi = (segs, r) => new MultiLight(segs.map(([a, b]) => glow.tube(a, b, r)));
  const box = new THREE.BoxGeometry(1, 1, 1);
  const B = (pos, scale, rot = [0, 0, 0]) => place(box.clone(), pos, rot, scale);

  // ---------------- stages with speaker stacks either side of the runway
  const dark = [];
  const grey = [];
  const STAGE = { xIn: 2.6, xOut: 10.5, zNear: -6, zFar: -15 };
  for (const s of [-1, 1]) {
    const cx = s * (STAGE.xIn + STAGE.xOut) / 2;
    const cz = (STAGE.zNear + STAGE.zFar) / 2;
    dark.push(B([cx, -0.3, cz], [STAGE.xOut - STAGE.xIn, 0.9, STAGE.zNear - STAGE.zFar]));
    // speaker cabinets (dark box + grey grille front facing the runway / player)
    const cabs = [
      // [x from runway, y, z, w, h, d] — two rows of amp cabinets, a few stacked on top
      [3.8, 0.6, -12.2, 2.0, 1.2, 1.0], [6.0, 0.6, -12.0, 2.2, 1.2, 1.0], [8.4, 0.6, -12.3, 2.2, 1.2, 1.0],
      [4.2, 1.75, -12.3, 1.8, 1.05, 0.9], [6.3, 1.85, -12.1, 2.0, 1.25, 0.9], [8.3, 1.7, -12.4, 1.6, 0.95, 0.9],
      [5.4, 2.85, -12.3, 1.5, 0.9, 0.8],
      [4.3, 0.45, -9.2, 1.9, 0.9, 0.9], [7.3, 0.5, -9.5, 2.3, 1.0, 0.9],
      [5.8, 1.3, -9.4, 1.4, 0.75, 0.8],
    ];
    for (const [x, y, z, w, h, d] of cabs) {
      dark.push(B([s * x, y + 0.15, z], [w, h, d]));
      grey.push(B([s * x, y + 0.15, z + d / 2 + 0.01], [w * 0.86, h * 0.78, 0.04]));
    }
    // amp heads on top
    dark.push(B([s * 7.3, 1.15, -9.5], [1.6, 0.3, 0.7]));
  }

  // ---------------- group 0: bottom lights — two levels of outline around each stage
  // per side: level 1 (upper) then level 2 (lower, a little wider); edges in the order
  // left: near, outer, far, inner — right: near, inner, far, outer
  for (const s of [-1, 1]) {
    for (const [y, g] of [[0.17, 0], [-0.55, 0.45]]) {
      const xi = s * (STAGE.xIn - g);
      const xo = s * (STAGE.xOut + g);
      const zn = STAGE.zNear + g;
      const zf = STAGE.zFar - g;
      const near = [V(xi, y, zn), V(xo, y, zn)];
      const outer = [V(xo, y, zn), V(xo, y, zf)];
      const far = [V(xo, y, zf), V(xi, y, zf)];
      const inner = [V(xi, y, zf), V(xi, y, zn)];
      const order = s < 0 ? [near, outer, far, inner] : [near, inner, far, outer];
      for (const [a, b] of order) groups[0].push(glow.tube(a, b, 0.045));
    }
  }

  // ---------------- city: buildings both sides, a bridge far ahead
  const city = [];
  const rnd = mulberry(7);
  for (const s of [-1, 1]) {
    let z = -2;
    while (z > -170) {
      const d = 8 + rnd() * 10;
      const w = 8 + rnd() * 10;
      const h = 14 + rnd() * 40 + (z < -60 ? 15 : 0);
      const x = s * (14 + w / 2 + rnd() * 6);
      city.push(B([x, h / 2 - 1, z - d / 2], [w, h, d]));
      // a stepped top on some
      if (rnd() > 0.5) city.push(B([x, h + 2, z - d / 2], [w * 0.6, 4, d * 0.6]));
      z -= d + 1 + rnd() * 4;
    }
    // close low buildings right behind the stages
    city.push(B([s * 17, 6, -8], [8, 14, 12]));
  }
  // bridge: two towers and a deck crossing high over the runway
  for (const s of [-1, 1]) city.push(B([s * 13, 18, -105], [3, 40, 3]));
  city.push(B([0, 27, -105], [30, 1.6, 4]));
  city.push(B([0, 34, -105], [28, 1.0, 1.0]));
  for (let i = -5; i <= 5; i++) city.push(beamGeometry(V(i * 2.4, 27, -105), V(i * 2.2, 34, -105), 0.25, 0.25, box));

  // ---------------- lasers (groups 2 / 3): fans from high up on the buildings at the back
  const lasers = { left: [], right: [] };
  for (const [type, s, list] of [[2, -1, lasers.left], [3, 1, lasers.right]]) {
    for (let i = 0; i < 6; i++) {
      // emitters high above the far end of the runway, fanning out toward the player's sides
      const pivot = new THREE.Group();
      pivot.position.set(s * (2.5 + i * 1.6), 24 + i * 1.2, -70);
      pivot.userData.axis = 'z';
      root.add(pivot);
      list.push(pivot);
      const target = V(s * (4 + i * 6), -2, 6);
      const dir = target.sub(pivot.position).normalize();
      groups[type].push(glow.tubeFollow(follow, pivot, V(0, 0, 0), dir.multiplyScalar(150), 0.045));
    }
  }

  // ---------------- center lights (group 4)
  // 1: GREEN DAY logo high above the far runway (one light, its own 1-instance bank)
  const logoGeo = strokeText('GREEN DAY', 1.5, 0.2, { spacing: 1.2 });
  logoGeo.translate(0, 7.5, -64);
  const logoBank = new LightBank(root, logoGeo, 1);
  groups[4].push(new MultiLight([logoBank.add(new THREE.Matrix4())]));
  banks.push(logoBank);
  owned.push(logoGeo, logoBank.mesh.material);
  // 2 / 3: two bundles of vertical beams either side of the far runway
  for (const s of [-1, 1]) {
    const segs = [];
    for (let k = 0; k < 4; k++) segs.push([V(s * (2.4 + k * 0.28), -20, -38 - k * 0.6), V(s * (2.4 + k * 0.28), 90, -38 - k * 0.6)]);
    groups[4].push(multi(segs, 0.035));
  }
  // 4: heart grenade outline, 5: the drips below it — held by a raised arm, left of the runway
  const H = { x: -3.6, y: 6.6, z: -28, k: 0.12 };
  const heartPt = (t) => V(H.x + H.k * 16 * Math.sin(t) ** 3, H.y + H.k * (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)), H.z);
  {
    const segs = [];
    const N = 22;
    for (let i = 0; i < N; i++) segs.push([heartPt((i / N) * Math.PI * 2), heartPt(((i + 1) / N) * Math.PI * 2)]);
    // grenade lever + pin ring
    segs.push([V(H.x + 0.2, H.y + 1.0, H.z), V(H.x + 0.9, H.y + 1.6, H.z)], [V(H.x + 0.9, H.y + 1.6, H.z), V(H.x + 1.4, H.y + 0.6, H.z)]);
    // a few inner highlight strokes
    segs.push([V(H.x - 0.9, H.y + 0.2, H.z), V(H.x - 0.2, H.y - 0.5, H.z)], [V(H.x + 0.3, H.y + 0.4, H.z), V(H.x + 0.9, H.y - 0.1, H.z)]);
    groups[4].push(multi(segs, 0.06));
    const drips = [];
    for (const [dx, len] of [[-0.6, 1.4], [-0.15, 2.2], [0.35, 1.1], [0.75, 1.7]]) drips.push([V(H.x + dx, H.y - 0.6, H.z + 0.05), V(H.x + dx, H.y - 0.6 - len, H.z + 0.05)]);
    groups[4].push(multi(drips, 0.07));
  }
  // the arm itself (static, dark) — forearm rising from below, fist gripping the heart
  const arm = [];
  arm.push(beamGeometry(V(-6.2, -4, -27.2), V(-4.3, 4.6, -28.4), 1.3, 1.3, box));
  arm.push(B([-4.0, 5.2, -28.4], [1.9, 1.4, 1.4], [0, 0, 0.12]));
  arm.push(B([-2.9, 5.5, -28.3], [0.55, 1.0, 1.0], [0, 0, -0.5]));

  // ---------------- group 1
  let ringObjs = [];
  if (withRings) {
    // rings: square frames down the far runway, a solid light bar at top and bottom of each
    const frameMat = skinMat;
    const props = new PropBank(root, GEO.box, frameMat, RING_N * 4);
    const bars = new LightBank(root, GEO.box, RING_N * 2);
    banks.push(props, bars);
    const half = 6;
    for (let k = 0; k < RING_N; k++) {
      const ring = new THREE.Group();
      ring.position.set(0, RING_Y, RING_Z0 - k * RING_DZ);
      root.add(ring);
      ringObjs.push(ring);
      for (let e = 0; e < 4; e++) {
        const a = (e * Math.PI) / 2;
        trs([Math.cos(a) * half, Math.sin(a) * half, 0], [0, 0, a], [0.5, half * 2 + 0.5, 0.5], m);
        follow.add(props, props.add(m), ring, m);
      }
      for (const sy of [1, -1]) {
        trs([0, sy * (half - 0.45), 0.3], [0, 0, 0], [2.4, 0.32, 0.4], m);
        const light = bars.add(m);
        follow.add(bars, bars.mesh.count - 1, ring, m);
        groups[1].push(light);
      }
    }
  } else {
    // Grenade "ambiance": window bands on the buildings closest to the runway, left (1) and right (2)
    const win = new LightBank(root, GEO.plane, 64, { material: lightMaterial({ opacity: 0.55 }) });
    banks.push(win);
    for (const s of [-1, 1]) {
      const list = [];
      for (let i = 0; i < 9; i++) {
        const z = -20 - i * 9;
        for (let r = 0; r < 3; r++) {
          const y = 4 + r * 4.5 + (i % 2) * 1.5;
          list.push(win.add(trs([s * 13.8, y, z], [0, -s * Math.PI / 2, 0], [5, 0.6, 1])));
        }
      }
      groups[1].push(new MultiLight(list));
    }
  }

  // ---------------- merge statics
  const floorMesh = new THREE.Mesh(GEO.plane, mats.floor);
  floorMesh.rotation.x = -Math.PI / 2;
  floorMesh.position.set(0, -1, -70);
  floorMesh.scale.set(140, 200, 1);
  const floor = mergeStatic([floorMesh], mats.floor);
  const darkMesh = new THREE.Mesh(mergeAll([...dark, ...arm]), skinMat);
  const greyMesh = new THREE.Mesh(mergeAll(grey), greyMat);
  const cityMesh = new THREE.Mesh(mergeAll(city), bldgMat);
  for (const x of [darkMesh, greyMesh, cityMesh]) x.matrixAutoUpdate = false;
  root.add(floor, darkMesh, greyMesh, cityMesh);
  box.dispose();

  follow.update(true);
  return {
    root,
    banks,
    groups,
    rings: withRings ? [{ type: 'big', objects: ringObjs, step: 6, zoom: { near: 2.5, far: RING_DZ } }] : [],
    lasers,
    update() {
      follow.update();
    },
    dispose() {
      for (const b of banks) b.dispose();
      for (const x of [floor, darkMesh, greyMesh, cityMesh]) x.geometry.dispose();
      for (const o of owned) o.dispose();
      Object.values(mats).forEach((x) => x.dispose());
    },
  };
}

function mulberry(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
