// EDM environment (Electronic Mixtape): a black club void with a glossy floor, pure laser show. Rings
// of lasers float in front of the player (a big "close" circle and two small "distant" circles whose
// hair-thin beams shoot back past the player into a tunnel), two single-source laser points left and
// right of the runway each firing a circle of 24 beams and three fans of 10 beams, and a huge ring of
// wide light columns high overhead. Lane lasers run along the floor and the ceiling, spectrogram bars
// line the runway. Recreated with simple shapes (our own geometry).
//
// v3 light groups (lightGroups[id].lights = elements in official order; lasers rotate on X = tilt and
// Y = spin around the rest beam; whole circles rotate through groups 12–17):
//   id  what                                  elements  order / notes                    rotation
//    0  close circle (r 5 m, 15 m ahead)          24     clockwise from the top           X (mirrored), Y
//    1  top circle (r 40 m, 90 m up, beams down)  24     around the arena                 X (mirrored), Y
//    2  distant circle 1 (r 2.1 m, 11 m ahead)    24     clockwise from the top           X (mirrored), Y
//    3  distant circle 2                          24     counter-clockwise (mirror of 2)  X, Y (both mirrored)
//    4  left single-source circle (beams up)      24     15° steps around the source      X, Y
//    5  right single-source circle                24     same, mirrored                   X, Y (Y mirrored)
//    6  left single source, "up" fan              10     all from one point (fan when      X, Y
//    7  left single source, "out" fan             10       events spread the angles)      X, Y
//    8  right single source, "up" fan             10                                      X, Y (Y mirrored)
//    9  right single source, "out" fan            10                                      X, Y (both mirrored)
//   10  left single source, "down" fan            10                                      X, Y (both mirrored)
//   11  right single source, "down" fan           10                                      X (mirrored), Y
//   12  top circle rotation           1 (no light)                                        X, Y
//   13  close circle rotation         1 (no light)                                        X, Y
//   14  distant circle 1 rotation     1 (no light)                                        X, Y
//   15  distant circle 2 rotation     1 (no light)                                        X, Y
//   16  left single-source circle rotation   1 (no light)                                X, Y
//   17  right single-source circle rotation  1 (no light)                                X, Y (Y mirrored)
// Basic events: 0 lane lasers on the floor (left, right), 1 lane lasers at the ceiling (left, right),
// 4 spectrogram bars + player place, 5 colour boost (runtime).
// Sources (facts only): ChroMapper's community recreation of EDMEnvironment (group names / ids, element
// counts, circle centres / radii / angle steps, beam directions and lengths, rotation axes and mirror
// flags, basic event tracks, default colours), v3 maps on BeatSaver for the environment (groups 0–17 in
// use, 12–17 rotation only), gameplay footage. Approximate: beam widths and falloff (1500 m beams are
// drawn 300 m long), the spectrogram (static bar lengths, no audio), glow heads, the floor.
import { THREE, GEO, LightBank, Rig, MultiLight, GlowBank, barXYZ, V } from './kit.js';
import { D2R, Frame, fadeBeamBank, movingHead, rotGroup, pushHead } from './_v1lights.js';

const AUD = V(0, 0, 1);
const UP = V(0, 1, 0);

export default {
  name: 'EDMEnvironment',
  label: 'EDM',
  colors: {
    left: '#a1a1a1',
    right: '#2db2e0',
    envLeft: '#15b700',
    envRight: '#005eb7',
    envLeftBoost: '#bc002d',
    envRightBoost: '#6d00c0',
    wall: '#2db2e0',
    envWhite: '#B9B9B9', // the game's white light colour (used when the map has none)
  },
  build() {
    const root = new THREE.Group();
    root.name = 'EDMEnvironment';
    const owned = [];
    const rig = new Rig(root);

    const { bank: beams, geometry: beamGeo } = fadeBeamBank(root, 210, { haloOpacity: 0.07, power: 1.2, widthEnd: 2, rows: 3 });
    const { bank: columns, geometry: colGeo } = fadeBeamBank(root, 24, { haloOpacity: 0.05, power: 0.8, widthEnd: 1.6, rows: 3 });
    owned.push(beamGeo, colGeo);
    const heads = new LightBank(root, GEO.box, 210);
    const lightGroups = {};

    const laser = (pos, dir, yaw, tilt, parent, len, width) => movingHead(rig, beams, pos, dir, yaw, tilt, {
      parent, len, width, halo: width * 7, haloLen: 0.4, start: 0.08, head: heads, headSize: [0.07, 0.07, 0.07], gains: [0.8, 1.2],
    });

    // circle rotation frames (groups 12–17): outer X pivot, inner Y pivot
    const circle = (id, pos, xAxis, yAxis, mirrorY) => {
      const f = new Frame(pos, yAxis, xAxis, ['x', 'y']);
      lightGroups[id] = { lights: [], count: 1, rotation: { x: [f.pivot.x], y: [f.pivot.y], mirror: { x: false, y: mirrorY } } };
      return f;
    };
    const cTop = circle(12, V(0, 90, 0), V(0.131, 0, -0.991), V(0, -1, 0), false);
    const cClose = circle(13, V(0, 1.5, -15), V(1, 0, 0), V(0, 0, 1), false);
    const cD1 = circle(14, V(0, 1.5, -11), V(1, 0, 0), V(0, 0, 1), false);
    const cD2 = circle(15, V(0, 1.5, -11), V(1, 0, 0), V(0, 0, 1), false);
    const cL = circle(16, V(-3, 1.5, -11), V(1, 0, 0), V(0, 1, 0), false);
    const cR = circle(17, V(3, 1.5, -11), V(1, 0, 0), V(0, 1, 0), true);

    // 0: close circle, r 5 around (0, 1.5), beams toward the player, tilt axis tangential
    {
      const g = rotGroup(false, true);
      for (let i = 0; i < 24; i++) {
        const t = (90 - 15 * i) * D2R;
        const p = V(5 * Math.cos(t), 1.5 + 5 * Math.sin(t), -15);
        pushHead(g, laser(p, AUD, AUD, V(-Math.sin(t), Math.cos(t), 0), cClose, 60, 0.06));
      }
      lightGroups[0] = g;
    }
    // 1: top circle, r 40 at 90 m, wide columns down
    {
      const g = rotGroup(false, true);
      for (let i = 0; i < 24; i++) {
        const f = (-82.5 + 15 * i) * D2R;
        const p = V(40 * Math.cos(f), 90, 40 * Math.sin(f));
        const e = movingHead(rig, columns, p, V(0, -1, 0), V(0, -1, 0), V(-Math.sin(f), 0, Math.cos(f)), {
          parent: cTop, len: 200, width: 1.2, halo: 6, haloLen: 0.9, start: 0.2, head: heads, headSize: [0.5, 0.5, 0.5], gains: [0.5, 1],
        });
        pushHead(g, e);
      }
      lightGroups[1] = g;
    }
    // 2 / 3: distant circles, r 2.1 around (0, 1.5) at 11 m; hair-thin beams back past the player
    for (const [id, s, fr] of [[2, 1, cD1], [3, -1, cD2]]) {
      const g = rotGroup(s < 0, true);
      for (let i = 0; i < 24; i++) {
        const t = (90 + s * 3.5 - s * 15 * i) * D2R;
        const p = V(2.1 * Math.cos(t), 1.5 + 2.1 * Math.sin(t), -11);
        pushHead(g, laser(p, AUD, AUD, V(-Math.sin(t), Math.cos(t), 0), fr, 300, 0.025));
      }
      lightGroups[id] = g;
    }
    // 4 / 5: single-source circles: 24 beams up from one point, tilt axes 15° apart around it
    for (const [id, s, fr] of [[4, -1, cL], [5, 1, cR]]) {
      const g = rotGroup(s > 0, false);
      for (let i = 0; i < 24; i++) {
        const a = 15 * i * D2R;
        pushHead(g, laser(V(s * 3, 1.5, -11), UP, UP, V(-Math.cos(a), 0, s * Math.sin(a)), fr, 300, 0.025));
      }
      lightGroups[id] = g;
    }
    // 6–11: single-source fans (10 beams each, all from one point toward the player at rest)
    for (const [id, s, tiltAxis, mx, my] of [
      [6, -1, V(1, 0, 0), false, false], [7, -1, V(0, 1, 0), false, false], [8, 1, V(1, 0, 0), false, true],
      [9, 1, V(0, 1, 0), true, true], [10, -1, V(1, 0, 0), true, true], [11, 1, V(1, 0, 0), true, false],
    ]) {
      const g = rotGroup(my, mx);
      for (let i = 0; i < 10; i++) pushHead(g, laser(V(s * 3, 1.5, -11), AUD, AUD, tiltAxis, null, 300, 0.025));
      lightGroups[id] = g;
    }

    // ---- static: glossy black floor -----------------------------------------------------------
    const floorMat = new THREE.MeshStandardMaterial({ color: 0x050508, roughness: 0.25, metalness: 0.7 });
    owned.push(floorMat);
    const floorGeo = new THREE.PlaneGeometry(400, 400);
    floorGeo.rotateX(-Math.PI / 2);
    floorGeo.translate(0, -0.06, -100);
    owned.push(floorGeo);
    root.add(new THREE.Mesh(floorGeo, floorMat));

    // ---- basic events -----------------------------------------------------------------------------
    const strips = new GlowBank(root, GEO.box, 12, { haloOpacity: 0.15 });
    const groups = { 0: [], 1: [], 4: [] };
    for (const [ty, y] of [[0, 0.02], [1, 3]]) {
      for (const s of [-1, 1]) groups[ty].push(strips.light([{ m: barXYZ(s * 3, y, 2, s * 3, y, -300, 0.04, 0.04) }], { fat: 6, glowGain: 0.7 }));
    }
    // spectrogram: rows of bars along both runway sides on the floor and at the ceiling (one light)
    const specBank = new LightBank(root, GEO.box, 200);
    {
      const L = new MultiLight();
      let seed = 7;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      for (let k = 0; k < 44; k++) {
        const z = -1.2 - 1.45 * k;
        for (const s of [-1, 1]) {
          const len = 0.4 + 1.3 * rnd() * (1 - k / 60);
          L.push(specBank.add(barXYZ(s * 1.55, 0.0, z, s * (1.55 + len), 0.0, z, 0.12, 0.02)), 0.3);
          L.push(specBank.add(barXYZ(s * 1.55, 4.0, z, s * (1.55 + len * 0.8), 4.0, z, 0.12, 0.02)), 0.2);
        }
      }
      groups[4].push(L);
      groups[4].push(strips.light([
        { m: barXYZ(-1.5, 0.005, 1.0, -1.5, 0.005, -1.0, 0.04, 0.01) },
        { m: barXYZ(1.5, 0.005, 1.0, 1.5, 0.005, -1.0, 0.04, 0.01) },
        { m: barXYZ(-1.5, 0.005, 1.0, 1.5, 0.005, 1.0, 0.04, 0.01) },
      ], { fat: 5, glowGain: 0.8 }));
    }

    rig.update(true);
    const banks = [...beams.banks, ...columns.banks, heads, ...strips.banks, specBank];
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
        columns.dispose();
        strips.dispose();
        heads.mesh.material.dispose();
        heads.dispose();
        specBank.mesh.material.dispose();
        specBank.dispose();
        for (const o of owned) o.dispose();
        root.removeFromParent();
      },
      background: '#000000',
    };
  },
};
