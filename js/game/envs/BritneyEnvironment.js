// Britney Spears environment — our own recreation from simple shapes (no game assets).
// Look: a round, tiered pop stage at the end of the runway (glowing tier rims, an inverted cone
// under it), a dark LED band ("display") hovering above the stage showing stars / hearts, laser
// fans shooting down from under the band and a starburst up from its top, a small arch (the
// chevron) on the stage, big tilted rings and two spirals around it, a curtain of vertical lasers
// behind and beside the stage, and floating speaker cubes on both sides of the runway whose
// speaker rings light up — all in starry space.
//
// v3 light groups (id → what, elements, rotation / translation axes). Ids, names, counts and
// colour / transform / fx flags: bsmap (KivalEvan, environment + renamer tables); axes / value
// ranges checked against a Britney map on BeatSaver (43042). Element order and geometry: ours.
//   0 / 2  cubes local left / right     24  (no light) cube k: own pivot           rot xyz, tra xyz
//   1 / 3  cubes global left / right    24  (no light) cube k: outer pivot         rot xyz, tra xyz
//   18 / 19 cubes speaker lights L / R  96  speaker 4k … 4k+3 of cube k (2 × 2 on the
//                                           face toward the runway)                rot z, tra z (push out)
//   5   display local                    1  LED band above the stage               rot xyz, tra xyz
//   6 / 8  top lasers set 01 / 02 global 18 (no light) outer pivot of laser i      rot xyz, tra xyz
//   7 / 9  top lasers set 01 / 02 local  18 laser i: set 01 = fan down from under the
//                                           band, set 02 = starburst up from its top rot xyz, tra xyz
//   10  chevron                          1  arch on the stage                      rot xyz, tra xyz
//   11  outer cylinders bottom lasers   76  vertical lasers on a 300° arc behind / beside the stage,
//                                           left → right                            rot xyz
//   12  runway                           1  both runway edge strips               (colour only)
//   14  outer cylinders local            2  big tilted rings around the stage, L / R rot xyz, tra xyz
//   15  spirals local                    2  spirals left / right behind the stage  rot xyz, tra xyz
//   16  stage top                        3  tier top rims, outer → inner           (colour only)
//   17  stage sides                      3  tier side bands, outer → inner         (colour only)
//   21  stars color                      4  star field quadrants (front-left, front-right,
//                                           back-left, back-right)                 (colour only)
//   fx: 13 stage mask offset (3), 20 display mask strength (1), 22 chevron mask strength (1) —
//       stored, no visual.
// Basic events: 6 (light) → background haze glow. Events 8 / 9 / 12 (used by Britney maps;
// meaning not documented, probably display content) have no effect here.
// Approximate: all positions / sizes; the display's changing pictures are one fixed pattern;
// speaker / cube layout (8 × 3 per side); element order inside groups.
import { THREE, GEO, GlowBank, LightBank, PropBank, Rig, V, SoftGlow, MeshLight, MultiLight, trs, rng, lightMaterial, mergeAll, stdMat } from './kit.js';
import { pivot, lightGroup, addPivot, multi, fxGroup, starField, disposeAll, rigPolyline, ringGeometry } from './_v4common.js';

const SZ = -58; // stage centre
const DISPLAY_Y = 10.5;

export default {
  name: 'BritneyEnvironment',
  label: 'Britney Spears',
  colors: {
    left: '#E92499',
    right: '#3F94FF',
    envLeft: '#FD03FC',
    envRight: '#3181E7',
    envLeftBoost: '#FF7582',
    envRightBoost: '#7BEDCB',
    wall: '#D61800',
  },
  build() {
    const root = new THREE.Group();
    root.name = 'BritneyEnvironment';
    const owned = [];
    const rand = rng(31);
    const rig = new Rig();
    const all = 'xyz';
    const LG = {};
    for (const id of [5, 7, 9, 10, 14, 15]) LG[id] = lightGroup(all, all);
    for (const id of [0, 1, 2, 3]) LG[id] = lightGroup(all, all, { count: 24 });
    LG[6] = lightGroup(all, all, { count: 18 });
    LG[8] = lightGroup(all, all, { count: 18 });
    LG[11] = lightGroup(all);
    LG[18] = lightGroup('z', 'z', { scale: 0.1 });
    LG[19] = lightGroup('z', 'z', { scale: 0.1 });
    for (const id of [12, 16, 17, 21]) LG[id] = lightGroup();

    const glow = new GlowBank(root, GEO.tube, 300, { haloScale: 3, haloOpacity: 0.15 });
    const T = (chain, a, b, r = 0.04) => rig.tube(chain, glow, a, b, r);
    const m = new THREE.Matrix4();

    // ---- stage: three tiers + inverted cone (static), tier rims (16) and side bands (17)
    const stageMat = stdMat(0x15121c, { roughness: 0.5, metalness: 0.5 });
    owned.push(stageMat);
    const tiers = [[11.5, -1.2, 0.6], [8.2, -0.6, 0.6], [5, 0, 0.6]]; // radius, bottom y, height
    {
      const parts = [];
      for (const [r, y0, h] of tiers) parts.push(new THREE.CylinderGeometry(r, r, h, 48).translate(0, y0 + h / 2, SZ));
      parts.push(new THREE.ConeGeometry(11, 16, 32, 1, true).rotateX(Math.PI).translate(0, -9.2, SZ));
      parts.push(new THREE.CylinderGeometry(1.1, 2.2, 2.4, 24).translate(0, 1.8, SZ)); // centre plinth
      const mesh = new THREE.Mesh(mergeAll(parts), stageMat);
      mesh.matrixAutoUpdate = false;
      root.add(mesh);
      owned.push(mesh);
    }
    const rimGeo = ringGeometry(0.955, 64).rotateX(-Math.PI / 2);
    const bandGeo = new THREE.CylinderGeometry(1, 1, 1, 64, 1, true);
    owned.push(rimGeo, bandGeo);
    const rims = new LightBank(root, rimGeo, 3);
    const bands = new LightBank(root, bandGeo, 3, { material: lightMaterial({ opacity: 0.85 }) });
    owned.push(rims.mesh.material, bands.mesh.material);
    for (const [r, y0, h] of tiers) {
      LG[16].lights.push(rims.add(trs([0, y0 + h + 0.01, SZ], [0, 0, 0], [r, 1, r], m)));
      LG[17].lights.push(bands.add(trs([0, y0 + h * 0.55, SZ], [0, 0, 0], [r + 0.02, h * 0.6, r + 0.02], m)));
    }

    // ---- runway strips (12)
    LG[12].lights.push(multi([
      glow.tube(V(-1.5, 0.03, -1), V(-1.5, 0.03, SZ + 9), 0.03, 2.2),
      glow.tube(V(1.5, 0.03, -1), V(1.5, 0.03, SZ + 9), 0.03, 2.2),
    ]));

    // ---- display (5): dark LED band with a ring of diamonds, hovering above the stage
    const disp = addPivot(LG[5], pivot(root, 0, DISPLAY_Y, SZ));
    {
      const body = new THREE.Mesh(new THREE.CylinderGeometry(5.2, 5.2, 3.4, 40, 1, true), stdMat(0x0d0b12, { roughness: 0.6, metalness: 0.4, side: THREE.DoubleSide }));
      disp.add(body);
      owned.push(body);
      const parts = [];
      const N = 14;
      for (let i = 0; i < N; i++) {
        const a = (i / N) * Math.PI * 2;
        // a four-pointed star (two thin crossed diamonds) on the band surface, facing outward
        for (const [w, h] of [[0.42, 1.25], [1.25, 0.42]]) {
          const g = new THREE.CircleGeometry(1, 4).scale(w, h, 1);
          g.translate(0, 0, 5.23).rotateY(a);
          parts.push(g);
        }
        const dot = new THREE.CircleGeometry(0.16, 4).translate(0, 1.3, 5.23).rotateY(a + Math.PI / N);
        parts.push(dot);
      }
      const led = new THREE.Mesh(mergeAll(parts), lightMaterial());
      led.material.side = THREE.DoubleSide;
      disp.add(led);
      owned.push(led);
      LG[5].lights.push(new MeshLight(led));
    }

    // ---- top lasers: set 01 (6 global / 7 local) fan down from under the band,
    //      set 02 (8 / 9) burst up and out from its top
    for (const [gid, lid, y, r, dir, len] of [[6, 7, DISPLAY_Y - 1.8, 3.4, -1, 18], [8, 9, DISPLAY_Y + 1.8, 4.8, 1, 46]]) {
      for (let i = 0; i < 18; i++) {
        const a = (i / 18) * Math.PI * 2 + (dir > 0 ? Math.PI / 18 : 0);
        const gp = addPivot(LG[gid], pivot(root, Math.sin(a) * r, y, SZ + Math.cos(a) * r, 0, a, 0));
        const lp = addPivot(LG[lid], pivot(gp));
        // in the pivot frame +z points outward from the band axis
        const out = dir < 0 ? V(0, -len * 0.62, len * 0.78) : V(0, len * 0.55, len * 0.84);
        LG[lid].lights.push(T([gp, lp], V(0, 0, 0), out, 0.035));
      }
    }

    // ---- chevron (10): arch on the stage
    {
      const p = addPivot(LG[10], pivot(root, 0, 4.1, SZ + 0.6));
      const pts = [];
      for (let i = 0; i <= 8; i++) {
        const a = Math.PI * (0.08 + 0.84 * (i / 8));
        pts.push(V(Math.cos(a) * 1.3, Math.sin(a) * 1.3 - 0.6, 0));
      }
      LG[10].lights.push(rigPolyline(rig, [p], glow, pts, 0.07, false));
    }

    // ---- outer cylinders bottom lasers (11): 76 vertical lasers on an arc around the back
    for (let i = 0; i < 76; i++) {
      const a = (-150 + (300 * i) / 75) * (Math.PI / 180); // 0 = straight behind the stage
      const R = 24;
      const p = addPivot(LG[11], pivot(root, Math.sin(a) * R, -2, SZ - Math.cos(a) * R));
      LG[11].lights.push(T([p], V(0, 0, 0), V(0, 34, 0), 0.03));
    }

    // ---- outer cylinders (14): two big tilted rings around the stage
    for (const s of [-1, 1]) {
      const p = addPivot(LG[14], pivot(root, 0, 3, SZ, 0, s * 0.6, s * 0.18));
      const pts = [];
      for (let i = 0; i < 28; i++) {
        const a = (i / 28) * Math.PI * 2;
        pts.push(V(Math.cos(a) * 15, Math.sin(a) * 15, 0));
      }
      LG[14].lights.push(rigPolyline(rig, [p], glow, pts, 0.09));
    }

    // ---- spirals (15): helices left / right behind the stage
    for (const s of [-1, 1]) {
      const p = addPivot(LG[15], pivot(root, s * 19, 0, SZ - 8));
      const pts = [];
      const n = 40;
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const a = t * Math.PI * 2 * 3.5;
        const r = 1.2 + 1.6 * t;
        pts.push(V(Math.cos(a) * r, -2 + t * 26, Math.sin(a) * r));
      }
      LG[15].lights.push(rigPolyline(rig, [p], glow, pts, 0.06, false));
    }

    // ---- speaker cubes: 24 per side (8 along z × 3 high), 4 speaker rings each
    const cubeMat = stdMat(0x1a1622, { roughness: 0.45, metalness: 0.55 });
    owned.push(cubeMat);
    const cubes = new PropBank(root, GEO.box, cubeMat, 48);
    const spkGeo = ringGeometry(0.62, 20);
    owned.push(spkGeo);
    const speakers = new LightBank(root, spkGeo, 192);
    owned.push(speakers.mesh.material);
    for (const [s, loc, glob, spk] of [[-1, 0, 1, 18], [1, 2, 3, 19]]) {
      for (let k = 0; k < 24; k++) {
        const col = k % 8;
        const row = Math.floor(k / 8);
        const x = s * (12.5 + (col % 2) * 2.5 + row * 1.5);
        const y = 1.5 + row * 4.5 + (col % 2) * 1.2 + (rand() - 0.5) * 0.8;
        const z = -12 - col * 6.5 - row * 2.5;
        const gp = addPivot(LG[glob], pivot(root, x, y, z, 0, (rand() - 0.5) * 0.3, 0));
        const lp = addPivot(LG[loc], pivot(gp));
        rig.attach([gp, lp], cubes, trs([0, 0, 0], [0, 0, 0], [1.7, 1.7, 1.7], m));
        for (let q = 0; q < 4; q++) {
          const sx = (q % 2 ? 0.4 : -0.4) * -s; // nearer the player first
          const sy = q < 2 ? 0.4 : -0.4;
          // speaker pivot on the face toward the runway, local +z = face normal
          const sp = addPivot(LG[spk], pivot(lp, -s * 0.86, sy, sx, 0, -s * Math.PI / 2, 0));
          LG[spk].lights.push(rig.light([gp, lp, sp], speakers, trs([0, 0, 0], [0, 0, 0], [0.32, 0.32, 1], m)));
        }
      }
    }

    // ---- stars: dim static field + 4 coloured quadrants (21)
    owned.push(starField(root, rng(5), 500, 140, 260, { size: 0.6, color: 0x6f6a80 }));
    const starGeo = new THREE.OctahedronGeometry(1, 0);
    owned.push(starGeo);
    const starBank = new LightBank(root, starGeo, 4 * 70);
    owned.push(starBank.mesh.material);
    for (let qd = 0; qd < 4; qd++) {
      const L = new MultiLight();
      const sx = qd % 2 ? 1 : -1;
      const back = qd >= 2;
      for (let i = 0; i < 70; i++) {
        const x = sx * (6 + rand() * 60);
        const y = -6 + rand() * 50;
        const z = back ? SZ - 10 - rand() * 80 : 6 - rand() * (Math.abs(SZ) + 4);
        if (Math.abs(x) < 9 && y < 14) continue;
        const sc = 0.12 + rand() * 0.18;
        L.push(starBank.add(trs([x, y, z], [rand(), rand(), 0], [sc, sc, sc], m)), 0.8);
      }
      LG[21].lights.push(L);
    }

    // ---- basic event 6: background haze
    const haze = new SoftGlow(root, 360, 200, V(0, 12, SZ - 140), { gain: 0.2, power: 1.6 });
    owned.push(haze);

    const fx = { 13: fxGroup(3), 20: fxGroup(1), 22: fxGroup(1) };
    rig.update(true);
    return {
      root,
      banks: [...glow.banks, rims, bands, cubes, speakers, starBank],
      groups: { 6: [haze] },
      lightGroups: LG,
      fx,
      background: 0x030208,
      update() {
        rig.update();
      },
      dispose() {
        glow.dispose();
        for (const b of [rims, bands, cubes, speakers, starBank]) b.dispose();
        disposeAll(owned);
      },
    };
  },
};
