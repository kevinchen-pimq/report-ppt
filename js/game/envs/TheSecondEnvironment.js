// The Second environment (5th anniversary remake of The First): the classic dark corridor — the runway
// on a long floating track construction, huge square rings spinning around everything, a tunnel of
// small square rings with neon tubes, tall dark buildings with neon edges left and right, anniversary
// flags, rows of spotlights below the sides, centre-line lasers above and below the track and the
// chevron logo at the end. Recreated with simple shapes (our own geometry).
//
// v3 light groups (lightGroups[id].lights = elements in official order):
//   id  what                                         elements  order                      rotation
//    0  big rings (4 neon tubes each)                   15      near → far (8 m apart)     X (ring spin)
//    1  small rings (2 side tubes each)                 24      near → far (3.5 m apart)   X (ring spin)
//    2  runway dashes, left                             12      near → far                 —
//    3  runway dashes, right                            12      near → far                 —
//    4  spotlights, left (below the side)               12      near → far                 X, Y (Y mirrored)
//    5  spotlights, right                               12      near → far                 X (mirrored), Y
//    6  top lasers "left bottom"  (beams up)             4      near → far (10 m apart)    X, Y
//    7  top lasers "right bottom" (beams up)             4                                 X, Y (both mirrored)
//    8  top lasers "left top"     (beams down)           4                                 X (mirrored), Y
//    9  top lasers "right top"    (beams down)           4                                 X, Y (Y mirrored)
//   10  bottom lasers "left bottom" (beams up)           4                                 X, Y
//   11  bottom lasers "right bottom" (beams up)          4                                 X, Y (both mirrored)
//   12  bottom lasers "left top"    (beams down)         4                                 X, Y (both mirrored)
//   13  bottom lasers "right top"   (beams down)         4                                 X, Y
//   (all centre-line lasers sit on the track axis, x = 0; X tilts them sideways, Y spins the beam)
// Basic events: 0 building neon edges, 1 chevron logo, 2 / 3 flags left / right, 4 far runway lasers +
// player place, 9 small-ring zoom (rings: small × 24, zoom only — The Second has no ring-spin event,
// the rings turn through light group 1), 5 colour boost (runtime).
// Sources (facts only): ChroMapper's community recreation of TheSecondEnvironment (group names / ids,
// element counts, ring spacing and sizes, laser / spotlight positions, rotation axes and mirror
// flags, basic event tracks, default colours; its small-ring colour data is inconsistent — here every
// small-ring element is one ring with both tubes, matching its 24 ring-rotation elements), v3 maps
// on BeatSaver for the environment (groups 0–13; basic 0–4, 9), gameplay footage. Approximate: all
// shapes (buildings are plain boxes, the track construction is a slab on stilts), the anniversary cake
// and spectrogram walls are left out, beam widths / falloff, the small-ring zoom spacing.
import { THREE, GEO, LightBank, GlowBank, PropBank, Rig, MultiLight, barXYZ, mergeGeos, beamGeometry, V } from './kit.js';
import { U, Frame, fadeBeamBank, movingHead, rotGroup, pushHead } from './_v1lights.js';

const UP = V(0, 1, 0);
const DOWN = V(0, -1, 0);
const ZA = V(0, 0, 1);

export default {
  name: 'TheSecondEnvironment',
  label: 'The Second',
  colors: {
    left: '#c81414',
    right: '#288ed2',
    envLeft: '#d91616',
    envRight: '#30acff',
    envLeftBoost: '#d216d9',
    envRightBoost: '#00ffa5',
    wall: '#ff3030',
    envWhite: '#B9B9B9', // the game's white light colour (used when the map has none)
  },
  build() {
    const root = new THREE.Group();
    root.name = 'TheSecondEnvironment';
    const owned = [];
    const rig = new Rig(root);
    const dark = new THREE.MeshStandardMaterial({ color: 0x0c0d16, roughness: 0.55, metalness: 0.5 });
    const ringMat = new THREE.MeshStandardMaterial({ color: 0x15172a, roughness: 0.45, metalness: 0.6 });
    owned.push(dark, ringMat);

    const tubes = new GlowBank(root, GEO.box, 260, { haloOpacity: 0.16 });
    const { bank: beams, geometry: beamGeo } = fadeBeamBank(root, 60, { haloOpacity: 0.07, power: 1.3, widthEnd: 2.5, rows: 4 });
    owned.push(beamGeo);
    const heads = new LightBank(root, GEO.box, 60);
    const housings = new PropBank(root, GEO.box, dark, 60, { ownMaterial: true });
    const ringBodies = new PropBank(root, GEO.box, ringMat, 15 * 4 + 24 * 4);
    const lightGroups = {};

    // a bar between two points given relative to a ring centre c (reference x, y; same z) → matrix
    // in the frame's innermost pivot space (bars lie in the ring plane: cross-section w × d)
    const ringBar = (f, c, a, b, w, d) => {
      const pa = f.pointLocal(U(a[0], c[1] + a[1], c[2]));
      const pb = f.pointLocal(U(b[0], c[1] + b[1], c[2]));
      return barXYZ(pa.x, pa.y, pa.z, pb.x, pb.y, pb.z, w, d, new THREE.Matrix4());
    };
    const fatTube = (m) => new THREE.Matrix4().copy(m).multiply(new THREE.Matrix4().makeScale(4, 1, 4));
    const squareSides = (H, over) => [[[-H - over, -H], [H + over, -H]], [[-H - over, H], [H + over, H]], [[-H, -H], [-H, H]], [[H, -H], [H, H]]];

    // ---- 0: big square rings (46 m), 15 × 8 m apart, a 6 m neon tube in the middle of each side ---
    {
      const g = { lights: [], rotation: { x: [], mirror: { x: false } } };
      for (let k = 0; k < 15; k++) {
        const c = [0, 5, 7 + 8 * k];
        const f = new Frame(U(...c), null, ZA, ['x']);
        for (const [a, b] of squareSides(23, 0.65)) f.attach(rig, ringBodies, ringBar(f, c, a, b, 1.3, 0.8));
        const L = new MultiLight();
        for (const [a, b] of [[[-22.2, -3], [-22.2, 3]], [[22.2, -3], [22.2, 3]], [[-3, -22.2], [3, -22.2]], [[-3, 22.2], [3, 22.2]]]) {
          const bm = ringBar(f, c, a, b, 0.16, 0.16);
          L.push(f.light(rig, tubes, bm, fatTube(bm)));
        }
        g.lights.push(L);
        g.rotation.x.push(f.pivot.x);
      }
      lightGroups[0] = g;
    }

    // ---- 1: small square rings (10.3 m) — each hangs on a zoom holder (basic event 9) -----------
    const zoomers = [];
    {
      const g = { lights: [], rotation: { x: [], mirror: { x: false } } };
      for (let k = 0; k < 24; k++) {
        const c = [0, 1.9, 14 + 3.5 * k];
        const holder = new THREE.Object3D();
        holder.position.copy(U(...c));
        zoomers.push(holder);
        // the ring frame hangs inside the holder (pivot chain: holder → ring spin)
        const parent = { chain: [holder], inv: new THREE.Matrix4().makeTranslation(-holder.position.x, -holder.position.y, -holder.position.z), pre: null };
        const f = new Frame(U(...c), null, ZA, ['x'], parent);
        for (const [a, b] of squareSides(5.15, 0.22)) f.attach(rig, ringBodies, ringBar(f, c, a, b, 0.45, 0.45));
        const L = new MultiLight();
        for (const s of [1, -1]) {
          const bm = ringBar(f, c, [s * 4.85, 1.67], [s * 4.85, 5.02], 0.09, 0.09);
          L.push(f.light(rig, tubes, bm, fatTube(bm)));
        }
        g.lights.push(L);
        g.rotation.x.push(f.pivot.x);
      }
      lightGroups[1] = g;
    }

    // ---- 2 / 3: runway dashes ------------------------------------------------------------------
    for (const [id, s] of [[2, -1], [3, 1]]) {
      const g = { lights: [] };
      for (let k = 0; k < 12; k++) {
        const z = 7.77 + 6 * k;
        g.lights.push(tubes.light([{ m: barXYZ(s * 2.35, 0.01, -z, s * 2.35, 0.01, -z - 4, 0.06, 0.02) }], { fat: 5, glowGain: 0.7 }));
      }
      lightGroups[id] = g;
    }

    // ---- 4 / 5: spotlights below the sides, beams up ------------------------------------------
    for (const [id, s] of [[4, -1], [5, 1]]) {
      const g = rotGroup(s < 0, s > 0);
      for (let k = 0; k < 12; k++) {
        const e = movingHead(rig, beams, U(s * 11.69, -4.8, 13.16 + 2.237 * k), UP, UP, ZA, {
          len: 14, width: 0.12, halo: 0.7, start: 0.5, head: heads, headSize: [0.18, 0.22, 0.18], housing: housings, housingSize: [0.45, 0.35, 0.45],
        });
        pushHead(g, e);
      }
      lightGroups[id] = g;
    }

    // ---- 6–13: centre-line lasers above / below the track -------------------------------------
    for (const [id, y, dir, yawAxis, mx, my] of [
      [6, 6.84, UP, UP, false, false], [7, 6.84, UP, UP, true, true], [8, 6.84, DOWN, UP, true, false], [9, 6.84, DOWN, UP, false, true],
      [10, -5.07, UP, UP, false, false], [11, -5.07, UP, UP, true, true], [12, -5.07, DOWN, DOWN, true, true], [13, -5.07, DOWN, DOWN, false, false],
    ]) {
      const g = rotGroup(my, mx);
      for (let k = 0; k < 4; k++) {
        const e = movingHead(rig, beams, U(0, y, 34.98 + 10 * k), dir, yawAxis, ZA, {
          len: 125, width: 0.14, halo: 0.8, haloLen: 0.5, start: 0.25, head: heads, headSize: [0.12, 0.12, 0.12], gains: [0.8, 1.2],
        });
        pushHead(g, e);
      }
      lightGroups[id] = g;
    }

    // ---- static scenery -------------------------------------------------------------------------
    const statics = [];
    const box = (cx, cy, cz, w, h, d) => {
      const b = new THREE.BoxGeometry(w, h, d);
      b.translate(cx, cy, cz);
      statics.push(b);
    };
    // track construction: a slab under the runway with stilts, side rails
    box(0, -0.75, -100, 4.4, 1.4, 206);
    for (let z = -6; z > -200; z -= 12) for (const s of [-1, 1]) box(s * 1.6, -12, z, 0.6, 22, 0.6);
    for (const s of [-1, 1]) box(s * 2.3, -0.14, -100, 0.12, 0.1, 206);
    // near buildings: two tall blocks at the sides ahead, a wall of them behind the player
    for (const s of [-1, 1]) {
      box(s * 20, 5.5, -33, 9, 175, 25);
      box(s * 4.8 + s * 2.5, 5.5, 15.6, 20, 175, 9);
      // a row of more distant blocks
      for (let k = 0; k < 4; k++) box(s * (34 + 6 * k), -10 + 8 * k, -70 - 22 * k, 10, 150, 14);
    }
    // flags: two banners on each near side, two behind (on poles)
    const flagPanels = [];
    for (const s of [-1, 1]) {
      for (const z of [10.87, 14.87]) {
        flagPanels.push([U(s * 17.0, 7.8, z), 'side']);
        statics.push(beamGeometry(U(s * 17.0, -2, z), U(s * 17.0, 12.8, z), 0.12, 0.12));
      }
      for (const x of [6.8, 10.8]) flagPanels.push([U(s * x, 7.8, -13.0), 'back']);
    }
    const flagMat = new THREE.MeshStandardMaterial({ color: 0x1b1d33, roughness: 0.8, metalness: 0.1, side: THREE.DoubleSide });
    owned.push(flagMat);
    const flagGeos = flagPanels.map(([p, kind]) => {
      const g = new THREE.PlaneGeometry(3.9, 7.6);
      if (kind === 'side') g.rotateY(Math.PI / 2);
      g.translate(p.x, p.y, p.z);
      return g;
    });
    const flagMesh = mergeGeos(flagGeos, flagMat);
    const staticMesh = mergeGeos(statics, dark);
    owned.push(flagMesh.geometry, staticMesh.geometry);
    root.add(flagMesh, staticMesh);

    // ---- basic events ---------------------------------------------------------------------------
    const groups = { 0: [], 1: [], 2: [], 3: [], 4: [] };
    // 0: building neon edges (vertical tubes on the inner corners, short ones at their feet)
    {
      const L = new MultiLight();
      for (const s of [-1, 1]) {
        for (const z of [20.6, 45.4]) L.push(tubes.core.add(barXYZ(s * 15.6, -40, -z, s * 15.6, 90, -z, 0.12, 0.12)));
        for (const z of [8.9, 12.9, 33.0, 37.0]) L.push(tubes.core.add(barXYZ(s * 15.45, 0.05, -z, s * 15.45, 10.7, -z, 0.08, 0.08)), 0.8);
      }
      groups[0].push(L);
    }
    // 1: chevron logo at the end of the track
    groups[1].push(tubes.light([
      { m: barXYZ(0, 4.65, -65, -2.05, 6.07, -65, 0.18, 0.18) },
      { m: barXYZ(0, 4.65, -65, 2.05, 6.07, -65, 0.18, 0.18) },
    ], { fat: 4, glowGain: 0.9 }));
    // 2 / 3: flags (the neon tube along each banner's top + a faint outline)
    for (const [ty, s] of [[2, -1], [3, 1]]) {
      const L = new MultiLight();
      for (const [p, kind] of flagPanels) {
        if (Math.sign(p.x) !== s) continue;
        const top = p.y + 3.85;
        const a = kind === 'side' ? [p.x, top, p.z - 1.95] : [p.x - 1.95, top, p.z];
        const b = kind === 'side' ? [p.x, top, p.z + 1.95] : [p.x + 1.95, top, p.z];
        L.push(tubes.light([{ m: barXYZ(...a, ...b, 0.09, 0.09) }], { fat: 5, glowGain: 0.8 }));
      }
      groups[ty].push(L);
    }
    // 4: far runway lasers + player place frame
    for (const s of [-1, 1]) groups[4].push(tubes.light([{ m: barXYZ(s * 4.25, -0.1, -8.3, s * 4.25, -0.1, -200, 0.07, 0.07) }], { fat: 5, glowGain: 0.6 }));
    groups[4].push(tubes.light([
      { m: barXYZ(-1.5, 0.005, 1.0, -1.5, 0.005, -1.0, 0.04, 0.01) },
      { m: barXYZ(1.5, 0.005, 1.0, 1.5, 0.005, -1.0, 0.04, 0.01) },
      { m: barXYZ(-1.5, 0.005, 1.0, 1.5, 0.005, 1.0, 0.04, 0.01) },
    ], { fat: 5, glowGain: 0.8 }));

    rig.update(true);
    const banks = [...tubes.banks, ...beams.banks, heads, housings, ringBodies];
    return {
      root,
      banks,
      groups,
      lightGroups,
      rings: [{ type: 'small', objects: zoomers, step: 0, zoom: { near: 1.6, far: 3.5 }, spinEvent: 8 }],
      update() {
        rig.update();
      },
      dispose() {
        tubes.dispose();
        beams.dispose();
        heads.mesh.material.dispose();
        heads.dispose();
        housings.dispose();
        ringBodies.dispose();
        for (const o of owned) o.dispose();
        root.removeFromParent();
      },
    };
  },
};
