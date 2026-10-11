// Fall Out Boy environment ("Pyro"): an outdoor rock concert at night. The player stands in the
// crowd under a small truss gantry with speakers; rows of flame pipes line both sides of the runway
// up to a wide stage with lit stairs, two video screens, a huge band crest hanging over the stage,
// a projector bar and a ring of spotlights in the rigging, scaffold towers covered in lamp boxes far
// left and right, and laser heads behind the stage. Recreated with simple shapes (our own geometry).
//
// v3 light groups (lightGroups[id].lights = elements in official order):
//   id  what                                     elements  order / notes                       rotation
//    0  left stage stairs (edge strips)             3      front step → top step               —
//    1  right stage stairs                          3      front step → top step               —
//    2  projector bar, left half                    5      centre → outside                    X, Y
//    3  projector bar, right half                   5      centre → outside                    X, Y (Y mirrored)
//    4  spotlights on the stage ring                3      left, centre, right                 X, Y
//    5  lamp boxes over the stage                  12      left → right (3 boxes × 4)          —
//    6  left lamp tower                            48      12 rows bottom → top, 4 per row,    —
//                                                          serpentine (row 0 outside → inside)
//    7  right lamp tower                           48      same, mirrored                      —
//    8  laser heads behind the stage, left          4      centre → outside                    X, Y
//    9  laser heads behind the stage, right         4      centre → outside                    X, Y (Y mirrored)
//   10  side laser heads, left                      3      inside → outside                    X, Y
//   11  side laser heads, right                     3      inside → outside                    X, Y (Y mirrored)
//   12  left flame pipes                           10      near → far (approx. order)          —
//   13  right flame pipes                          10      near → far (approx. order)          —
//   (beams rest pointing at the audience for 2–4, straight up for 8–11; Y = pan, X = tilt)
// Basic events: 0 video screens, 1 crest (logo), 2 / 3 audience projectors left / right,
// 4 runway strips + player place, 6 ambient sky glow behind the stage, 5 colour boost (runtime).
// Sources (facts only): ChroMapper's community recreation of PyroEnvironment (group names / ids,
// element counts and positions, rotation axes, mirror flags, basic event tracks, default colours),
// v3 maps on BeatSaver for the environment (groups 0–13 in use; fire 12 / 13 address 10 elements
// each; basic types 0–4, 6), gameplay footage for the look. Approximate: every shape (stage, trusses,
// screens, crest, crowd, flames are simple boxes / soft planes), beam lengths, the flame element order
// and the far speaker stacks (left out). The crest is a plain triangle with "FOB" stroke letters.
import { THREE, GEO, LightBank, GlowBank, PropBank, Rig, MultiLight, barXYZ, mergeGeos, mergeAll, beamGeometry, strokeText, skyDome, lightMaterial, MeshLight, V } from './kit.js';
import { fadeBeamBank, fadeBeamGeometry, fadeBeamMaterial, movingHead, rotGroup, pushHead, trussGeos, crowdGeometry } from './_v1lights.js';

const UP = V(0, 1, 0);
const AUD = V(0, 0, 1); // toward the audience (the player)
const XA = V(1, 0, 0);

export default {
  name: 'PyroEnvironment',
  label: 'Fall Out Boy',
  colors: {
    left: '#93000a',
    right: '#ffab00',
    envLeft: '#ff1c34',
    envRight: '#e2bc43',
    envLeftBoost: '#ff002d',
    envRightBoost: '#c3c3c3',
    wall: '#d9b36d',
  },
  build() {
    const root = new THREE.Group();
    root.name = 'PyroEnvironment';
    const owned = [];
    const rig = new Rig(root);
    const m4 = new THREE.Matrix4();

    const dark = new THREE.MeshStandardMaterial({ color: 0x120d0f, roughness: 0.7, metalness: 0.45 });
    const black = new THREE.MeshBasicMaterial({ color: 0x040203 });
    owned.push(dark, black);

    const { bank: beams, geometry: beamGeo } = fadeBeamBank(root, 40, { haloOpacity: 0.07, power: 1.5, widthEnd: 4 });
    owned.push(beamGeo);
    const heads = new LightBank(root, GEO.box, 40);
    const housings = new PropBank(root, GEO.box, dark, 40, { ownMaterial: true });
    const lamps = new GlowBank(root, GEO.box, 160, { haloOpacity: 0.14 });

    // flame: narrow at the nozzle, widest low down, licking up to a point; bright core fading upward
    const flameGeo = fadeBeamGeometry({
      rows: 6, planes: 3,
      profile: (t) => 0.25 + 0.95 * Math.sin(Math.PI * Math.min(1, 0.15 + t * 1.1)) * (1 - 0.55 * t),
      bright: (t) => Math.pow(1 - t, 1.1) * Math.min(1, 0.45 + t * 3),
    });
    owned.push(flameGeo);
    const flameMat = fadeBeamMaterial(1);
    const flames = new LightBank(root, flameGeo, 20, { material: flameMat });

    const statics = [];
    const blacks = [];
    const lightGroups = {};
    const head = (pos, dir, yaw, tilt, len, opts = {}) => movingHead(rig, beams, pos, dir, yaw, tilt, {
      len, width: 0.22, halo: 1.1, start: 0.5, head: heads, headSize: [0.35, 0.3, 0.35], housing: housings, housingSize: [0.7, 0.6, 0.7], ...opts,
    });

    // ---- stage: three steps with a slot for the runway, stage deck behind, back wall ----------
    for (const s of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        const y = 1.05 + 0.55 * i;
        const z = -51.3 - 1.8 * i;
        const xi = 2.5 + 0.85 * i;
        const g = new THREE.BoxGeometry(32 - xi, y, 50);
        g.translate(s * (xi + (32 - xi) / 2), y / 2 - 0.2, z - 25);
        statics.push(g);
      }
    }
    {
      const wall = new THREE.BoxGeometry(70, 30, 2);
      wall.translate(0, 13, -84);
      statics.push(wall);
    }
    // front scaffold squares under the stage lip
    for (const x of [-12.2, -7.25, -2.15, 2.15, 7.99, 12.94, 18.04, -18]) {
      if (Math.abs(x) < 2) continue;
      trussGeos(V(x - 1.4, -1, -50.1), V(x + 1.4, -1, -50.1), 2.4, 1.4, 0.06, 4, statics);
    }
    // stage rigging: projector bar, side towers, the round spotlight truss
    trussGeos(V(-20, 23.4, -58.1), V(20, 23.4, -58.1), 1.0, 1.5, 0.09, 3, statics);
    trussGeos(V(-14, 26.5, -56.9), V(14, 26.5, -56.9), 0.8, 1.6, 0.07, 3, statics);
    for (const s of [-1, 1]) {
      trussGeos(V(s * 23.5, -1, -59.8), V(s * 23.5, 33, -59.8), 1.6, 1.8, 0.1, 3, statics);
      // hanging speaker stacks beside the stage
      for (let k = 0; k < 4; k++) {
        const g = new THREE.BoxGeometry(2.2, 1.7, 1.6);
        g.rotateX(0.05 * k);
        g.translate(s * 20.5, 20.5 - 1.75 * k, -57.3);
        statics.push(g);
      }
    }
    {
      const segs = 16;
      let prev = null;
      for (let k = 0; k <= segs; k++) {
        const a = Math.PI * (k / segs);
        const p = V(-Math.cos(a) * 18.5, 33.4, -70.4 + Math.sin(a) * 18.3);
        if (prev) trussGeos(prev, p, 1.2, 1.4, 0.09, 3, statics);
        prev = p;
      }
      // drop lines from the ring to the spotlights
      for (const x of [-6.15, 0, 6.15]) statics.push(beamGeometry(V(x, 33.4, x ? -53.4 : -52.2), V(x, 31.4, x ? -53.4 : -52.2), 0.08, 0.08));
    }
    // lamp towers far left / right (scaffold with 12 lamp boxes each)
    for (const s of [-1, 1]) {
      trussGeos(V(s * 41.65, -2.5, -50.5), V(s * 41.65, 28.5, -50.5), 3.8, 2.2, 0.12, 4, statics);
      for (const y of [1.08, 3.08, 5.08, 8.08, 10.08, 12.08, 15.08, 17.08, 19.08, 22.08, 24.08, 26.08]) {
        const g = new THREE.BoxGeometry(3.6, 0.7, 0.9);
        g.rotateY(s * -Math.PI / 4);
        g.translate(s * 40.52, y, -49.38 - 0.25);
        statics.push(g);
      }
    }
    // video screens (frames + legs)
    for (const s of [-1, 1]) {
      const g = new THREE.BoxGeometry(10.4, 6.4, 0.4);
      g.rotateY(s * 0.26);
      g.translate(s * 12.1, 4.2, -32.4);
      statics.push(g);
      trussGeos(V(s * 16.6, -1, -31.1), V(s * 16.6, 8.5, -31.1), 0.9, 1.2, 0.06, 3, statics);
      trussGeos(V(s * 7.6, -1, -33.5), V(s * 7.6, 8.5, -33.5), 0.9, 1.2, 0.06, 3, statics);
    }
    // gantry over the player: two triangular truss towers and a top beam, speakers hanging on them
    for (const s of [-1, 1]) {
      trussGeos(V(s * 4.4, -2, -3.35), V(s * 4.4, 7.2, -3.35), 0.9, 1.1, 0.05, 3, statics);
      for (const [y, z, sc] of [[1.1, -3.3, 0.85], [3.9, -3.4, 0.95], [1.1, 0.7, 0.85], [3.9, 0.7, 0.95]]) {
        const g = new THREE.BoxGeometry(0.75 * sc, 1.6 * sc, 0.6 * sc);
        g.rotateY(s * (z < 0 ? -0.6 : -1.4));
        g.rotateZ(-s * 0.2);
        g.translate(s * 3.6, y, z);
        statics.push(g);
      }
    }
    trussGeos(V(-4.9, 6.6, -3.35), V(4.9, 6.6, -3.35), 0.9, 1.1, 0.05, 3, statics);
    // flame pipes: low cages along both sides of the runway
    const FIRE_Z = [9.85, 13.7, 17.55, 21.4, 25.25, 29.1, 32.95, 36.8, 40.65, 44.5];
    for (const s of [-1, 1]) {
      for (const z of FIRE_Z) {
        const g = new THREE.BoxGeometry(1.2, 0.9, 1.6);
        g.translate(s * 3.2, 0.2, -z);
        statics.push(g);
        statics.push(beamGeometry(V(s * 3.2, 0.6, -z), V(s * 3.2, 1.5, -z), 0.18, 0.18));
      }
      const rail = new THREE.BoxGeometry(0.15, 0.15, 38);
      rail.translate(s * 3.2, 0.1, -27.2);
      statics.push(rail);
    }
    // crowd: rows of silhouettes around the player (not on the runway, not on the stage)
    const crowdLines = [];
    for (const s of [-1, 1]) {
      for (let r = 0; r < 4; r++) {
        const x = s * (5.2 + r * 3.4);
        crowdLines.push([[x, 6 + r], [x, -46 + r * 0.5]]);
      }
    }
    for (let r = 0; r < 3; r++) {
      const z = 3.5 + r * 3;
      crowdLines.push([[-5 - r * 2.6, z], [5 + r * 2.6, z]]);
    }
    for (const line of crowdLines) blacks.push(crowdGeometry(line, { h: 1.7, y0: -0.6, spacing: 0.6 }));
    {
      const ground = new THREE.PlaneGeometry(260, 220);
      ground.rotateX(-Math.PI / 2);
      ground.translate(0, -0.6, -40);
      blacks.push(ground);
    }

    const staticMesh = mergeGeos(statics, dark);
    const blackMesh = mergeGeos(blacks, black);
    owned.push(staticMesh.geometry, blackMesh.geometry);
    root.add(staticMesh, blackMesh);
    const sky = skyDome(0x050207, 0x2a0a12, 0x000000, 300);
    owned.push(sky.geometry, sky.material);
    root.add(sky);

    // ---- light groups ---------------------------------------------------------------------------
    // 0 / 1: stairs: each step's front edge strip running outward + its inner edge running back
    for (const [id, s] of [[0, -1], [1, 1]]) {
      const g = { lights: [] };
      for (let i = 0; i < 3; i++) {
        const y = 1.05 + 0.55 * i + 0.02;
        const z = -51.3 - 1.8 * i + 0.02;
        const xi = 2.5 + 0.85 * i;
        g.lights.push(lamps.light([
          { m: barXYZ(s * xi, y, z, s * 31.8, y, z, 0.07, 0.07) },
          { m: barXYZ(s * xi, y, z, s * xi, y, z - 1.8, 0.07, 0.07) },
        ], { fat: 5, glowGain: 0.7 }));
      }
      lightGroups[id] = g;
    }
    // 2 / 3: projector bar, beams toward the audience
    for (const [id, s] of [[2, -1], [3, 1]]) {
      const g = rotGroup(s > 0);
      for (let i = 0; i < 5; i++) pushHead(g, head(V(s * (1.95 + 3.9 * i), 22.84, -58.13), AUD, UP, XA, 38));
      lightGroups[id] = g;
    }
    // 4: three spotlights hanging from the stage ring
    {
      const g = rotGroup(false);
      for (const [x, z] of [[-6.15, -53.33], [0, -52.12], [6.15, -53.33]]) pushHead(g, head(V(x, 31.0, z), AUD, UP, XA, 60, { width: 0.3, halo: 1.6 }));
      lightGroups[4] = g;
    }
    // 5: lamp boxes over the stage
    {
      const g = { lights: [] };
      for (const x of [-12.68, -11.56, -10.44, -9.32, -1.68, -0.56, 0.56, 1.68, 9.32, 10.44, 11.56, 12.68]) {
        g.lights.push(lamps.light([{ m: barXYZ(x, 25.6, -56.3, x, 26.3, -56.3, 0.75, 0.12), g: barXYZ(x, 25.3, -56.2, x, 26.6, -56.2, 1.6, 0.05) }]));
      }
      const box = (x0, x1) => {
        const b = new THREE.BoxGeometry(x1 - x0, 1.0, 0.8);
        b.translate((x0 + x1) / 2, 25.95, -56.85);
        return b;
      };
      const extra = mergeGeos([box(-13.3, -8.7), box(-2.3, 2.3), box(8.7, 13.3)], dark);
      owned.push(extra.geometry);
      root.add(extra);
      lightGroups[5] = g;
    }
    // 6 / 7: lamp towers, 12 rows × 4, serpentine, facing the track diagonally
    for (const [id, s] of [[6, -1], [7, 1]]) {
      const g = { lights: [] };
      const rows = [1.08, 3.08, 5.08, 8.08, 10.08, 12.08, 15.08, 17.08, 19.08, 22.08, 24.08, 26.08];
      const face = new THREE.Matrix4().makeRotationY(s * -Math.PI / 4);
      rows.forEach((y, r) => {
        for (let j = 0; j < 4; j++) {
          const k = r % 2 ? 3 - j : j;
          const x = s * (41.72 - 0.8 * k);
          const z = -48.21 - 0.78 * k;
          const mm = new THREE.Matrix4().makeTranslation(x - s * 0.33, y, z + 0.33).multiply(face).multiply(new THREE.Matrix4().makeScale(0.62, 0.5, 0.08));
          const mh = new THREE.Matrix4().makeTranslation(x - s * 0.36, y, z + 0.36).multiply(face).multiply(new THREE.Matrix4().makeScale(1.3, 1.1, 0.02));
          g.lights.push(lamps.light([{ m: mm, g: mh }]));
        }
      });
      lightGroups[id] = g;
    }
    // 8 / 9: laser heads behind the stage, beams up
    for (const [id, s] of [[8, -1], [9, 1]]) {
      const g = rotGroup(s > 0);
      for (let i = 0; i < 4; i++) pushHead(g, head(V(s * (6.7 + 3.7 * i), 2.9, -75.39), UP, UP, XA, 90, { width: 0.16, halo: 0.9, start: 0.6 }));
      lightGroups[id] = g;
    }
    // 10 / 11: side laser heads near the towers, beams up
    for (const [id, s] of [[10, -1], [11, 1]]) {
      const g = rotGroup(s > 0);
      for (let i = 0; i < 3; i++) pushHead(g, head(V(s * (38.04 + 3.09 * i), 0.3, -66.74), UP, UP, XA, 90, { width: 0.16, halo: 0.9, start: 0.6 }));
      lightGroups[id] = g;
    }
    // 12 / 13: flames (alternating short loop flames and tall bursts)
    for (const [id, s] of [[12, -1], [13, 1]]) {
      const g = { lights: [] };
      FIRE_Z.forEach((z, i) => {
        const h = i % 2 ? 8.5 : 5.4;
        const mm = new THREE.Matrix4().compose(V(s * 3.2, 1.5, -z), new THREE.Quaternion(), V(1.7, h, 1.7));
        g.lights.push(new MultiLight([flames.add(mm)], [0.8]));
      });
      lightGroups[id] = g;
    }

    // ---- basic event groups ---------------------------------------------------------------------
    const groups = { 0: [], 1: [], 2: [], 3: [], 4: [], 6: [] };
    // 0: video screens (soft lit panels)
    {
      const L = new MultiLight();
      for (const s of [-1, 1]) {
        const mm = new THREE.Matrix4().compose(V(s * 12.08, 4.2, -32.15), new THREE.Quaternion().setFromAxisAngle(UP, s * 0.26), V(9.6, 5.8, 0.02));
        L.push(lamps.core.add(mm), 0.35);
      }
      groups[0].push(L);
    }
    // 1: crest over the stage (triangle + letters)
    {
      const parts = [];
      const T = [V(-6.5, 21.5, 0), V(6.5, 21.5, 0), V(0, 8.8, 0)];
      for (let k = 0; k < 3; k++) parts.push(beamGeometry(T[k], T[(k + 1) % 3], 0.45, 0.2));
      for (const [a, b] of [[V(-6.5, 21.5, 0), V(-5, 24, 0)], [V(-5, 24, 0), V(-2.5, 22.2, 0)], [V(-2.5, 22.2, 0), V(0, 25, 0)], [V(0, 25, 0), V(2.5, 22.2, 0)], [V(2.5, 22.2, 0), V(5, 24, 0)], [V(5, 24, 0), V(6.5, 21.5, 0)]]) {
        parts.push(beamGeometry(a, b, 0.35, 0.2));
      }
      const txt = strokeText('FOB', 3.2, 0.42);
      txt.translate(0, 14.6, 0);
      parts.push(txt);
      const geo = mergeAll(parts);
      geo.translate(-0.11, 0, -66.3);
      owned.push(geo);
      const mat = lightMaterial();
      owned.push(mat);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.renderOrder = 2;
      root.add(mesh);
      groups[1].push(new MeshLight(mesh));
    }
    // 2 / 3: audience projectors (on the gantry, at the sides, behind the crowd) — fixed beams
    const fixedBeam = (p, d, len) => {
      const e = movingHead(rig, beams, p, d, UP, XA, { len, width: 0.12, halo: 0.6, start: 0.25, head: heads, headSize: [0.2, 0.18, 0.2], housing: housings, housingSize: [0.35, 0.3, 0.35] });
      return e.light;
    };
    groups[2].push(
      fixedBeam(V(-2.65, 5.69, -3.96), V(-0.17, -0.09, -0.98), 14),
      fixedBeam(V(-24.83, 3.88, -5.76), V(0.99, 0.02, 0.11), 14),
      fixedBeam(V(-24.39, 3.9, -9.71), V(0.99, 0.02, 0.11), 14),
      fixedBeam(V(-15.9, 5.84, 29.85), V(0.5, -0.17, -0.85), 18),
    );
    groups[3].push(
      fixedBeam(V(2.24, 5.69, -3.92), V(0.17, -0.09, -0.98), 14),
      fixedBeam(V(25.5, 4.0, -7.94), V(-0.77, -0.01, -0.64), 14),
      fixedBeam(V(24.35, 3.97, -11.37), V(-1, -0.02, 0.09), 14),
      fixedBeam(V(19.06, 5.87, 28.62), V(-0.5, -0.18, -0.85), 18),
    );
    // 4: runway edge strips + player place frame
    for (const s of [-1, 1]) groups[4].push(lamps.light([{ m: barXYZ(s * 2.27, 0.02, -0.6, s * 2.27, 0.02, -48, 0.06, 0.03) }], { fat: 5, glowGain: 0.6 }));
    groups[4].push(lamps.light([
      { m: barXYZ(-1.5, 0.005, 1.0, -1.5, 0.005, -1.0, 0.04, 0.01) },
      { m: barXYZ(1.5, 0.005, 1.0, 1.5, 0.005, -1.0, 0.04, 0.01) },
      { m: barXYZ(-1.5, 0.005, 1.0, 1.5, 0.005, 1.0, 0.04, 0.01) },
    ], { fat: 5, glowGain: 0.8 }));
    // 6: ambient glow of the sky behind the stage (vertical gradient planes)
    let amb;
    {
      const g = new THREE.PlaneGeometry(1, 1, 1, 4);
      const pos = g.attributes.position;
      const col = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i++) {
        const t = pos.getY(i) + 0.5;
        const c = Math.pow(1 - t, 1.6) * 0.55;
        col.set([c, c, c], i * 3);
      }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      owned.push(g);
      amb = new LightBank(root, g, 3, { material: fadeBeamMaterial(1), renderOrder: -5 });
      const L = new MultiLight();
      L.push(amb.add(new THREE.Matrix4().compose(V(0, 30, -150), new THREE.Quaternion(), V(320, 90, 1))));
      L.push(amb.add(new THREE.Matrix4().compose(V(-150, 30, -40), new THREE.Quaternion().setFromAxisAngle(UP, Math.PI / 2), V(260, 90, 1))), 0.6);
      L.push(amb.add(new THREE.Matrix4().compose(V(150, 30, -40), new THREE.Quaternion().setFromAxisAngle(UP, -Math.PI / 2), V(260, 90, 1))), 0.6);
      groups[6].push(L);
    }

    rig.update(true);
    const banks = [...beams.banks, heads, housings, ...lamps.banks, flames, amb];
    return {
      root,
      banks,
      groups,
      lightGroups,
      update() {
        rig.update();
      },
      dispose() {
        beams.dispose();
        lamps.dispose();
        heads.mesh.material.dispose();
        heads.dispose();
        housings.dispose();
        flames.mesh.material.dispose();
        flames.dispose();
        amb.mesh.material.dispose();
        amb.dispose();
        for (const o of owned) o.dispose();
        root.removeFromParent();
      },
      fog: { color: 0x0a0306, near: 40, far: 260 },
    };
  },
};
