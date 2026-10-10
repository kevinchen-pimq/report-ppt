// Billie Eilish environment (BillieEnvironment) — our own simplified recreation.
// A rainy night valley: the track runs out along a water channel towards a low sun between
// mountain ridges; rays fan out of the sun, laser rows rise out of the water on both sides.
//
// Light groups (v2 basic event type → lights, in light-ID order; Chroma lightID n = index n-1):
//   0  "Water 4"  4: L channel strip, R channel strip, L glow, R glow  (far channel, z -31.5 … horizon)
//   1  "Water 1"  4: L, R, L glow, R glow                               (channel segment z -7.5 … -15.5)
//   2  left sun rays   18 (spin with event 12)
//   3  right sun rays  18 (spin with event 13)
//   4  sun / moon       1 (disc + halo)
//   6  "Water 2"  4: L, R, L glow, R glow                               (z -15.5 … -23.5)
//   7  "Water 3"  4: L, R, L glow, R glow                               (z -23.5 … -31.5)
//   10 left bottom lasers   9 (near → far)
//   11 right bottom lasers  9 (near → far)
// Source for groups / counts / ID order: BSMG wiki basic-lighting table (water channel lights,
// left/right rays, sun/moon, left/right lasers; 6/7 extra water, 10/11 lasers) and the light IDs
// in ChroMapper's community Billie platform (read for facts only). Not handled here: rain toggle
// (event 8 in this environment) and ray mode (event 9) — the contract maps 8/9 to rings.
// Default colours: Beat Saber Billie scheme (as listed by ArcViewer / ChroMapper / BSMG wiki).
import { THREE, LightBank, GEO, tubeMatrix, trs, mergeStatic, lightMaterial } from './kit.js';
import { MultiLight, rng, softLightMaterial, glowDiscGeometry, fadeStripGeometry, skyDome, ridgeGeometry } from './_eShared.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const WATER_Y = -0.55;
const SUN = V(0, 15, -140);

export default {
  name: 'BillieEnvironment',
  label: 'Billie Eilish',
  colors: {
    left: '#CCA46E', right: '#8C9CA3',
    envLeft: '#D1712F', envRight: '#F0B490',
    envLeftBoost: '#CC0000', envRightBoost: '#8EB3C6',
    wall: '#B68FC8',
  },
  build() {
    const root = new THREE.Group();
    root.name = 'BillieEnvironment';
    const owned = [];
    const rand = rng(1218);

    // ---- static scenery -------------------------------------------------------------------
    const sky = skyDome(0x05060c, 0x1a1c2a, 0x05060a);
    root.add(sky);
    owned.push(sky.geometry, sky.material);

    const waterMat = new THREE.MeshStandardMaterial({ color: 0x0b1220, roughness: 0.12, metalness: 0.85 });
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(700, 700), waterMat);
    sea.rotation.x = -Math.PI / 2;
    sea.position.set(0, WATER_Y - 0.12, -150);
    root.add(sea);
    owned.push(sea.geometry, waterMat);

    // mountains: two side ranges + a back range behind the sun; lit only by ambient, no fog so the
    // silhouettes stay readable against the sky
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x323848, roughness: 0.85, metalness: 0.05, flatShading: true, fog: false });
    const ridges = [
      ridgeGeometry(rand, [-26, -10], [-48, -170], 22, 8, 26, 26, [-1, 0]),
      ridgeGeometry(rand, [26, -10], [48, -170], 22, 8, 26, 26, [1, 0]),
      ridgeGeometry(rand, [-14, 12], [-60, 30], 6, 6, 16, 20, [-0.3, 1]),
      ridgeGeometry(rand, [14, 12], [60, 30], 6, 6, 16, 20, [0.3, 1]),
      ridgeGeometry(rand, [-130, -185], [130, -185], 26, 5, 16, 30, [0, -1]),
      ridgeGeometry(rand, [-90, -160], [-20, -168], 9, 4, 11, 16, [0, -1]),
      ridgeGeometry(rand, [20, -168], [90, -160], 9, 4, 11, 16, [0, -1]),
    ];
    const mountains = mergeStatic(ridges.map((g) => new THREE.Mesh(g, rockMat)), rockMat);
    for (const g of ridges) g.dispose();
    root.add(mountains);
    owned.push(mountains.geometry, rockMat);

    // track channel: slanted side walls along the runway out to the horizon + a track bed beyond
    // the game's runway (z < -40), and railing posts every 8 m
    const trackMat = new THREE.MeshStandardMaterial({ color: 0x141824, roughness: 0.5, metalness: 0.6 });
    const parts = [];
    const box = (p, r, s) => {
      const m = new THREE.Mesh(GEO.box, trackMat);
      m.position.set(...p);
      m.rotation.set(...r);
      m.scale.set(...s);
      parts.push(m);
    };
    for (const s of [-1, 1]) {
      box([s * 1.32, -0.22, -130], [0, 0, s * 0.47], [0.62, 0.08, 264]);
      box([s * 1.62, -0.45, -130], [0, 0, 0], [0.08, 0.3, 264]);
      for (let z = -7.5; z >= -63.5; z -= 8) {
        box([s * 1.25, 0.25, z], [0, 0, 0], [0.07, 0.9, 0.07]);
        box([s * 1.25, 0.68, z + 0.35], [0, 0, 0], [0.05, 0.05, 0.7]);
      }
    }
    box([0, -0.1, -150], [0, 0, 0], [2, 0.1, 220]); // track bed past the game's runway
    box([0, -1.2, 2.5], [0, 0, 0], [3.6, 1.3, 0.6]); // waterfall lip behind the player
    const track = mergeStatic(parts, trackMat);
    root.add(track);
    owned.push(track.geometry, trackMat);

    // rain: short streaks falling in a box around the player (one draw call, moved in update)
    const RAIN_H = 18;
    const rainPos = new Float32Array(700 * 6);
    for (let i = 0; i < 700; i++) {
      const x = (rand() - 0.5) * 50, y = rand() * RAIN_H * 2, z = 6 - rand() * 70;
      if (Math.abs(x) < 1.2 && z > -40) continue; // keep streaks off the runway
      rainPos.set([x, y, z, x + 0.03, y + 0.7, z], i * 6);
    }
    const rainGeo = new THREE.BufferGeometry();
    rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
    const rainMat = new THREE.LineBasicMaterial({ color: 0x8a9bb8, transparent: true, opacity: 0.22, depthWrite: false });
    const rain = new THREE.LineSegments(rainGeo, rainMat);
    rain.frustumCulled = false;
    root.add(rain);
    owned.push(rainGeo, rainMat);

    // ---- lights ---------------------------------------------------------------------------
    const groups = { 0: [], 1: [], 2: [], 3: [], 4: [], 6: [], 7: [], 10: [], 11: [] };
    const banks = [];

    // water channel strips lying on the water either side of the track; glow = soft wide band
    const coreBank = new LightBank(root, GEO.plane, 16);
    const glowGeo = fadeStripGeometry();
    owned.push(glowGeo);
    const glowBank = new LightBank(root, glowGeo, 16, { material: softLightMaterial({ opacity: 0.55 }) });
    banks.push(coreBank, glowBank);
    const flat = [-Math.PI / 2, 0, 0];
    const water = (z0, z1) => {
      const len = z0 - z1 - 0.6, zc = (z0 + z1) / 2;
      const L = coreBank.add(trs([-2.2, WATER_Y + 0.02, zc], flat, [0.14, len, 1]));
      const R = coreBank.add(trs([2.2, WATER_Y + 0.02, zc], flat, [0.14, len, 1]));
      const LG = glowBank.add(trs([-2.25, WATER_Y + 0.01, zc], flat, [1.6, len, 1]));
      const RG = glowBank.add(trs([2.25, WATER_Y + 0.01, zc], flat, [1.6, len, 1]));
      return [L, R, LG, RG];
    };
    groups[1] = water(-7.5, -15.5);
    groups[6] = water(-15.5, -23.5);
    groups[7] = water(-23.5, -31.5);
    groups[0] = water(-31.5, -280);

    // sun (group 4): bright disc + big soft halo
    const discGeo = glowDiscGeometry(32, 0.82, 1);
    const haloGeo = glowDiscGeometry(24, 0.05, 1);
    owned.push(discGeo, haloGeo);
    const sunBank = new LightBank(root, discGeo, 1, { material: softLightMaterial() });
    const haloBank = new LightBank(root, haloGeo, 1, { material: softLightMaterial({ opacity: 0.6 }) });
    banks.push(sunBank, haloBank);
    groups[4] = [new MultiLight([
      sunBank.add(trs([SUN.x, SUN.y, SUN.z], [0, 0, 0], [6.5, 6.5, 1])),
      haloBank.add(trs([SUN.x, SUN.y, SUN.z - 0.5], [0, 0, 0], [26, 26, 1])),
    ], [1, 0.7])];

    // sun rays (groups 2 / 3): 18 thin beams per side radiating from the sun. Each side is one
    // bank inside a pivot at the sun, spun around Z (facing the player) by laser speed 12 / 13.
    const lasers = { left: [], right: [] };
    for (const [type, side, list] of [[2, -1, lasers.left], [3, 1, lasers.right]]) {
      const pivot = new THREE.Group();
      pivot.position.copy(SUN).add(V(0, 0, 1));
      pivot.userData.axis = 'z';
      root.add(pivot);
      list.push(pivot);
      const bank = new LightBank(pivot, GEO.tube, 18);
      banks.push(bank);
      for (let i = 0; i < 18; i++) {
        // left rays on the left half, right rays on the right half (rest pose), 10° apart
        const a = (side < 0 ? Math.PI / 2 : -Math.PI / 2) + ((i + 0.5) / 18) * Math.PI;
        const dir = V(Math.cos(a), Math.sin(a), 0);
        groups[type].push(bank.add(tubeMatrix(dir.clone().multiplyScalar(7.5), dir.clone().multiplyScalar(240), 0.22)));
      }
    }

    // bottom lasers (10 / 11): 9 per side rising out of the water left / right of the track,
    // leaning outwards and back over the player's shoulders
    const lowBank = new LightBank(root, GEO.tube, 18);
    banks.push(lowBank);
    for (const [type, s] of [[10, -1], [11, 1]]) {
      const dir = V(s * 0.61, 0.32, 0.72).normalize();
      for (let i = 0; i < 9; i++) {
        const a = V(s * 9, WATER_Y, -18 - i * 5);
        groups[type].push(lowBank.add(tubeMatrix(a, a.clone().addScaledVector(dir, 130), 0.09)));
      }
    }

    let rainY = 0;
    return {
      root,
      banks,
      groups,
      rings: [],
      lasers,
      update(t) {
        rainY = -((t * 16) % RAIN_H);
        rain.position.y = rainY;
      },
      dispose() {
        for (const b of banks) b.dispose();
        for (const o of owned) o.dispose();
        for (const b of banks) b.mesh.material.dispose();
      },
    };
  },
};
