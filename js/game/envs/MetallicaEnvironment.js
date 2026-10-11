// Metallica environment — our own recreation from simple shapes (no game assets).
// Look: a dark rock-concert hall. Both sides of the runway are lined with bent steel pillars (a
// column that kinks inward at the top) carrying bent light strips, a laser, a lightning bolt, a
// work lamp and a row of small bulbs; long "infinite" lasers run along both side walls; fire jets
// burst beside the runway; scaffold trusses hang over the track; the far end is a centre stage
// (portal frame, chevron, bulbs, front lasers) with laser fans and lightning bolts behind it.
// Nearly every part can move, as the official description says.
//
// v3 light groups (id → what, elements, rotation / translation axes). Ids, names, counts and
// colour / transform / fx flags: bsmap (KivalEvan, environment + renamer tables); usage checked
// against Metallica-environment maps on BeatSaver (445ba). Element order and geometry: ours
// (index 0 = nearest the player).
//   1 / 2   pillars L / R global          6  (no light) outer pivot of pillar k    rot xyz, tra xyz
//   40 / 41 pillars L / R column global   6  (no light) inner pivot of pillar k    rot xyz, tra xyz
//   22 / 23 pillars L / R local          24  bent strip 4k … 4k+3 of pillar k      rot xyz, tra xyz
//   9 / 10  pillars L / R lasers          6  laser from the top of pillar k        rot xyz, tra xyz
//   12 / 13 pillars L / R lightning bolts 6  bolt on pillar k                      rot x y, tra y
//   14 / 15 pillars L / R construction light 6 work lamp on pillar k               (colour only)
//   34 / 35 pillars L / R point lights   60  bulb 10k … 10k+9 of pillar k, bottom → top (colour only)
//   3 / 4   center stage left / right     7  portal bars, outer → inner            rot xyz, tra xyz
//   5       center stage mid              5  horizontal portal bars, low → high    rot xyz, tra xyz
//   11      center stage front lasers     5  lasers from the stage front, L → R    rot xyz, tra xyz
//   33      center stage point lights    16  bulbs along the stage edge, L → R     (colour only)
//   0       chevron                       1  chevron on the stage                  rot xyz, tra xyz
//   7 / 8   stage BG lasers left / right  6  laser fans behind the stage           rot xyz, tra xyz
//   16 / 18 BG lightning bolts L / R      4  bolts in the far background           (colour only)
//   17 / 19 BG construction point light L / R 4 lamps on the far scaffolds         (colour only)
//   20      effects lighting A            4  big flash glows high above the track  tra xyz
//   21      effects lighting B            4  (no light) outer pivot of flash i     tra xyz
//   6       runway                        3  left strip, right strip, stage-front bar (colour only)
//   24 / 25 runway lasers L / R           4  lasers beside the runway              rot xyz, tra xyz
//   27 / 28 runway fire burst L / R       4  tall fire jets beside the runway      (colour only)
//   38 / 39 runway fire continuous L / R  4  low flames at the same spots          (colour only)
//   26      scaffoldings top              4  (no light) trusses over the track     rot xyz, tra xyz
//   31      scaffoldings back             1  (no light) truss wall behind the stage tra xyz
//   36 / 37 scaffoldings far L / R        3  (no light) towers far out             rot xyz, tra xyz
//   29 / 30 infinite lasers L / R        12  long lasers along the side walls, low → high rot, tra xyz
//   32      effect stars                  4  star field quadrants                  (colour only)
//   fx: 42 / 43 pillars L / R scratches (24), 44 runway / chevron mask strength (1) — stored only.
// Basic events: 6 (light) → background haze glow. Events 8 / 13 (used by Metallica maps,
// meaning undocumented) have no effect here.
// Approximate: every position / size; flames are glowing cones (no particles); lightning bolts
// are static zig-zags; element order inside groups.
import { THREE, GEO, GlowBank, LightBank, PropBank, Rig, V, SoftGlow, MultiLight, trs, rng, softLightMaterial, glowDiscGeometry, mergeAll, beamGeometry, stdMat, applyMirrors } from './kit.js';
import { pivot, lightGroup, addPivot, multi, fxGroup, starField, disposeAll, rigPolyline, polyline } from './_v4common.js';

const PX = 7.5; // pillar distance from the track axis
const PZ0 = -14;
const PDZ = 13;
const STAGE_Z = -100;

/** Zig-zag lightning bolt points (local, pointing down from 0). */
function bolt(rand, h, w) {
  const pts = [V(0, 0, 0)];
  let x = 0;
  for (let i = 1; i <= 5; i++) {
    x += (i % 2 ? 1 : -1) * w * (0.6 + rand() * 0.6);
    pts.push(V(x, (-h * i) / 5, 0));
  }
  return pts;
}

/** Cone flame: bright base, dark tip (vertex colours), base at y = 0, height 1, radius 1. */
function flameGeometry() {
  const g = new THREE.ConeGeometry(1, 1, 10, 4, true).translate(0, 0.5, 0);
  const p = g.attributes.position;
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const t = 1 - p.getY(i);
    const c = t * t;
    col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = c;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

// Mirror flags (CONTRACT.md "Handedness"): lower case = rotation axes, upper case = translation
// axes whose event value the runtime negates, so that each group turns / moves the way Beat Saber's
// does with our pivots' orientation. Derived per element from the game's environment data (world
// rotation axis / translation direction of a +1 event in ChroMapper's UGEcko export) against ours;
// real maps send the same values to both groups of most left / right pairs, which then mirror.
const MIRROR = { 0: 'xyZ', 1: 'xyZ', 2: 'xzXZ', 3: 'xyzZ', 4: 'xXZ', 5: 'xyZ', 7: 'xyzZ', 8: 'xXZ',
  9: 'zXZ', 10: 'yZ', 11: 'yzX', 12: 'xy', 13: 'xy', 20: 'Z', 21: 'Z', 22: 'xyzZ', 23: 'xXZ',
  24: 'yzZ', 25: 'XZ', 26: 'xyZ', 29: 'xyzZ', 30: 'xXZ', 31: 'Z', 36: 'xzZ', 37: 'xyXZ', 40: 'xyzZ',
  41: 'xXZ' };

export default {
  name: 'MetallicaEnvironment',
  label: 'Metallica',
  colors: {
    left: '#485567',
    right: '#93B7D2',
    envLeft: '#DD7E61',
    envRight: '#4174DD',
    envWhite: '#839BAD',
    envLeftBoost: '#E50906',
    envRightBoost: '#6501BD',
    wall: '#D61800',
  },
  build() {
    const root = new THREE.Group();
    root.name = 'MetallicaEnvironment';
    const owned = [];
    const rand = rng(1981);
    const rig = new Rig();
    const all = 'xyz';
    const m = new THREE.Matrix4();
    const LG = {};
    for (const id of [22, 23, 9, 10, 3, 4, 5, 11, 0, 7, 8, 24, 25, 29, 30]) LG[id] = lightGroup(all, all);
    for (const id of [1, 2, 40, 41]) LG[id] = lightGroup(all, all, { count: 6 });
    LG[12] = lightGroup('xy', 'y');
    LG[13] = lightGroup('xy', 'y');
    LG[20] = lightGroup('', all, { scale: 1 });
    LG[21] = lightGroup('', all, { count: 4 });
    LG[26] = lightGroup(all, all, { count: 4 });
    LG[31] = lightGroup('', all, { count: 1 });
    LG[36] = lightGroup(all, all, { count: 3 });
    LG[37] = lightGroup(all, all, { count: 3 });
    for (const id of [14, 15, 34, 35, 33, 16, 18, 17, 19, 6, 27, 28, 38, 39, 32]) LG[id] = lightGroup();

    const glow = new GlowBank(root, GEO.tube, 460, { haloScale: 3, haloOpacity: 0.16 });
    const T = (chain, a, b, r = 0.04) => rig.tube(chain, glow, a, b, r);
    const steel = stdMat(0x24262c, { roughness: 0.4, metalness: 0.85 });
    owned.push(steel);
    const props = new PropBank(root, GEO.box, steel, 260, { ownMaterial: true });
    const bulbGeo = new THREE.OctahedronGeometry(1, 0);
    owned.push(bulbGeo);
    const bulbs = new LightBank(root, bulbGeo, 4 * 70 + 180);
    owned.push(bulbs.mesh.material);
    const box = (chain, a, b, w, d = w) => {
      // steel beam a → b (pivot-local), via the rig
      const g = new THREE.Matrix4();
      const dir = new THREE.Vector3().subVectors(b, a);
      const len = dir.length();
      g.compose(new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), dir.normalize()), V(w, len, d));
      rig.attach(chain, props, g);
    };

    // ---- pillars: global (1 / 2) → column (40 / 41) → strips, laser, bolt, lamp, bulbs
    for (const [s, gid, cid, lid, lzr, bid, cl, pl] of [[-1, 1, 40, 22, 9, 12, 14, 34], [1, 2, 41, 23, 10, 13, 15, 35]]) {
      for (let k = 0; k < 6; k++) {
        const gp = addPivot(LG[gid], pivot(root, s * PX, 0, PZ0 - k * PDZ));
        const cp = addPivot(LG[cid], pivot(gp));
        const c = [gp, cp];
        // steel: column, kinked top, a back leg and a few scaffold rungs (outer side)
        box(c, V(0, -3, 0), V(0, 9, 0), 0.9, 1.4);
        box(c, V(0, 9, 0), V(-s * 3, 13.5, 0), 0.8, 1.2);
        box(c, V(s * 2.6, -3, 0), V(s * 2.6, 11, 0), 0.25);
        for (let y = 0; y < 11; y += 2.6) box(c, V(0, y, 0), V(s * 2.6, y + 1.3, 0), 0.15);
        // 4 bent strips on the inner face (front → back)
        for (let q = 0; q < 4; q++) {
          const zq = 0.45 - q * 0.3;
          const lp = addPivot(LG[lid], pivot(cp, -s * 0.5, 0, zq));
          LG[lid].lights.push(rigPolyline(rig, [gp, cp, lp], glow, [V(0, -1 + q * 0.4, 0), V(0, 8.6 + q * 0.15, 0), V(-s * 3.1, 13.2, 0)], 0.04, false));
        }
        // laser from the kinked top
        const zp = addPivot(LG[lzr], pivot(cp, -s * 3, 13.5, 0));
        LG[lzr].lights.push(T([gp, cp, zp], V(0, 0, 0), V(-s * 8, 40, -10), 0.04));
        // lightning bolt on the outer leg
        const bp = addPivot(LG[bid], pivot(cp, s * 1.3, 10, 0.6));
        LG[bid].lights.push(rigPolyline(rig, [gp, cp, bp], glow, bolt(rand, 6, 0.7), 0.05, false));
        // work lamp + bulbs
        LG[cl].lights.push(rig.light(c, bulbs, trs([-s * 0.6, 4.5, 0.8], [0.6, 0.6, 0], [0.32, 0.32, 0.32], m)));
        for (let i = 0; i < 10; i++) {
          LG[pl].lights.push(rig.light(c, bulbs, trs([-s * 0.55, -0.5 + i * 0.95, -0.75], [0.5, 0.5, 0], [0.09, 0.09, 0.09], m)));
        }
      }
    }

    // ---- centre stage
    {
      const parts = [];
      const bx = new THREE.BoxGeometry(1, 1, 1);
      const P = (a, b, w, d = w) => parts.push(beamGeometry(a, b, w, d, bx));
      // platform (in front of the portal, below the track level at the near edge)
      parts.push(bx.clone().scale(16, 1.2, 8).translate(0, -0.6, STAGE_Z - 2));
      parts.push(bx.clone().scale(10, 0.6, 5).translate(0, 0.3, STAGE_Z - 3));
      // portal frame
      for (const s of [-1, 1]) {
        P(V(s * 7, -1, STAGE_Z - 6), V(s * 7, 14, STAGE_Z - 6), 1.2);
        P(V(s * 7, 14, STAGE_Z - 6), V(s * 3, 18, STAGE_Z - 6), 1);
      }
      P(V(-3, 18, STAGE_Z - 6), V(3, 18, STAGE_Z - 6), 1);
      bx.dispose();
      const mesh = new THREE.Mesh(mergeAll(parts), steel);
      mesh.matrixAutoUpdate = false;
      root.add(mesh);
      owned.push(mesh);
    }
    // left / right portal bars (3 / 4): 7 each, outer → inner
    for (const [s, id] of [[-1, 3], [1, 4]]) {
      for (let i = 0; i < 7; i++) {
        const x = s * (6.4 - i * 0.75);
        const p = addPivot(LG[id], pivot(root, x, 0.6, STAGE_Z - 5.4));
        const top = 13.4 - i * 0.9;
        LG[id].lights.push(rigPolyline(rig, [p], glow, [V(0, 0, 0), V(0, top, 0), V(-s * 1.4, top + 1.6, 0)], 0.05, false));
      }
    }
    // mid bars (5): horizontal, low → high
    for (let i = 0; i < 5; i++) {
      const p = addPivot(LG[5], pivot(root, 0, 8 + i * 1.9, STAGE_Z - 5.6));
      const w = 4.2 - i * 0.35;
      LG[5].lights.push(T([p], V(-w, 0, 0), V(w, 0, 0), 0.06));
    }
    // front lasers (11)
    for (let i = 0; i < 5; i++) {
      const p = addPivot(LG[11], pivot(root, (i - 2) * 2.4, 0.7, STAGE_Z + 1.2));
      LG[11].lights.push(T([p], V(0, 0, 0), V((i - 2) * 6, 40, -6), 0.04));
    }
    // stage point lights (33): along the platform's front edge
    for (let i = 0; i < 16; i++) {
      LG[33].lights.push(bulbs.add(trs([-7.5 + i, 0.05, STAGE_Z + 2.05], [0.5, 0.5, 0], [0.13, 0.13, 0.13], m)));
    }
    // chevron (0)
    {
      const p = addPivot(LG[0], pivot(root, 0, 2.2, STAGE_Z - 4.5));
      LG[0].lights.push(rigPolyline(rig, [p], glow, [V(-2.2, 0, 0), V(0, 1.4, 0), V(2.2, 0, 0)], 0.1, false));
    }
    // BG laser fans (7 / 8)
    for (const [s, id] of [[-1, 7], [1, 8]]) {
      for (let i = 0; i < 6; i++) {
        const p = addPivot(LG[id], pivot(root, s * (3 + i * 0.6), 16, STAGE_Z - 9));
        const a = (10 + i * 13) * (Math.PI / 180);
        LG[id].lights.push(T([p], V(0, 0, 0), V(s * Math.sin(a) * 60, Math.cos(a) * 60, -8), 0.05));
      }
    }
    // BG lightning bolts (16 / 18) and far lamps (17 / 19)
    for (const [s, bid, lid] of [[-1, 16, 17], [1, 18, 19]]) {
      for (let i = 0; i < 4; i++) {
        const x = s * (20 + i * 9);
        const z = STAGE_Z - 20 - i * 6;
        const pts = bolt(rand, 18, 2.2).map((v) => v.add(V(x, 34, z)));
        LG[bid].lights.push(polyline(glow, pts, 0.14, false));
        LG[lid].lights.push(bulbs.add(trs([x, 6 + i * 2, z + 4], [0.5, 0.5, 0], [0.5, 0.5, 0.5], m)));
      }
    }

    // ---- effects lighting: B (21, pivot) → A (20, soft flash glow)
    const flashGeo = glowDiscGeometry(24, 0.2, 1);
    const flashMat = softLightMaterial({ opacity: 0.5 });
    owned.push(flashGeo, flashMat);
    const flashes = new LightBank(root, flashGeo, 4, { material: flashMat });
    for (let i = 0; i < 4; i++) {
      const b = addPivot(LG[21], pivot(root, (i % 2 ? 1 : -1) * 14, 26, -30 - i * 18));
      const a = addPivot(LG[20], pivot(b));
      LG[20].lights.push(rig.light([b, a], flashes, trs([0, 0, 0], [0, 0, 0], [16, 10, 1], m)));
    }

    // ---- runway (6): strips + stage-front bar; runway lasers (24 / 25); fire (27 / 28, 38 / 39)
    LG[6].lights.push(glow.tube(V(-1.5, 0.03, -1), V(-1.5, 0.03, STAGE_Z + 3), 0.03, 2.2));
    LG[6].lights.push(glow.tube(V(1.5, 0.03, -1), V(1.5, 0.03, STAGE_Z + 3), 0.03, 2.2));
    LG[6].lights.push(glow.tube(V(-8, 0.05, STAGE_Z + 2.3), V(8, 0.05, STAGE_Z + 2.3), 0.06));
    const flameGeo = flameGeometry();
    const flameMat = softLightMaterial({ opacity: 0.9 });
    owned.push(flameGeo, flameMat);
    const flames = new LightBank(root, flameGeo, 16, { material: flameMat });
    for (const [s, lz, fb, fc] of [[-1, 24, 27, 38], [1, 25, 28, 39]]) {
      for (let i = 0; i < 4; i++) {
        const z = -20 - i * 18;
        const p = addPivot(LG[lz], pivot(root, s * 3, 0, z - 6));
        LG[lz].lights.push(T([p], V(0, 0, 0), V(s * 12, 30, -4), 0.035));
        LG[fb].lights.push(flames.add(trs([s * 4.2, -0.2, z], [0, 0, -s * 0.35], [0.7, 6, 0.7], m)));
        LG[fc].lights.push(flames.add(trs([s * 4.2, -0.2, z], [0, 0, 0], [0.45, 1.4, 0.45], m)));
        // fire nozzle
        rig.attach([p], props, trs([0, -0.2, 6], [0, 0, 0], [0.8, 0.6, 0.8], m));
      }
    }

    // ---- scaffoldings: top trusses (26), back wall (31), far towers (36 / 37)
    for (let i = 0; i < 4; i++) {
      const p = addPivot(LG[26], pivot(root, 0, 19, -24 - i * 18));
      box([p], V(-10, 0, 0), V(10, 0, 0), 0.5);
      box([p], V(-10, 1.6, 0), V(10, 1.6, 0), 0.3);
      for (let x = -9; x <= 9; x += 3) box([p], V(x, 0, 0), V(x + 1.5, 1.6, 0), 0.12);
    }
    {
      const p = addPivot(LG[31], pivot(root, 0, 0, STAGE_Z - 14));
      for (let x = -16; x <= 16; x += 4) box([p], V(x, -2, 0), V(x, 26, 0), 0.4);
      for (let y = 2; y <= 26; y += 6) box([p], V(-16, y, 0), V(16, y, 0), 0.3);
    }
    for (const [s, id] of [[-1, 36], [1, 37]]) {
      for (let i = 0; i < 3; i++) {
        const p = addPivot(LG[id], pivot(root, s * 30, 0, -40 - i * 26));
        for (const dx of [-1.5, 1.5]) box([p], V(dx, -4, 0), V(dx, 30, 0), 0.35);
        for (let y = -2; y < 30; y += 4) box([p], V(-1.5, y, 0), V(1.5, y + 2, 0), 0.15);
      }
    }

    // ---- infinite lasers (29 / 30): long lasers along both side walls, low → high
    for (const [s, id] of [[-1, 29], [1, 30]]) {
      for (let i = 0; i < 12; i++) {
        const p = addPivot(LG[id], pivot(root, s * (12 + (i % 2) * 0.6), -1 + i * 1.7, 4));
        LG[id].lights.push(T([p], V(0, 0, 0), V(0, 0, -230), 0.04));
      }
    }

    // ---- stars: dim static field + 4 coloured quadrants (32)
    owned.push(starField(root, rng(9), 500, 140, 260, { size: 0.6, color: 0x707a88 }));
    for (let qd = 0; qd < 4; qd++) {
      const L = new MultiLight();
      const sx = qd % 2 ? 1 : -1;
      const back = qd >= 2;
      for (let i = 0; i < 60; i++) {
        const x = sx * (16 + rand() * 60);
        const y = 4 + rand() * 50;
        const z = back ? -70 - rand() * 90 : 4 - rand() * 70;
        const sc = 0.12 + rand() * 0.2;
        L.push(bulbs.add(trs([x, y, z], [rand(), rand(), 0], [sc, sc, sc], m)), 0.8);
      }
      LG[32].lights.push(L);
    }

    // ---- basic event 6: background haze
    const haze = new SoftGlow(root, 380, 200, V(0, 14, STAGE_Z - 130), { gain: 0.22, power: 1.5 });
    owned.push(haze);

    const fx = { 42: fxGroup(24), 43: fxGroup(24), 44: fxGroup(1) };
    rig.update(true);
    return {
      root,
      banks: [...glow.banks, props, bulbs, flashes, flames],
      groups: { 6: [haze] },
      lightGroups: applyMirrors(LG, MIRROR),
      fx,
      background: 0x030306,
      update() {
        rig.update();
      },
      dispose() {
        glow.dispose();
        for (const b of [props, bulbs, flashes, flames]) b.dispose();
        disposeAll(owned);
      },
    };
  },
};
