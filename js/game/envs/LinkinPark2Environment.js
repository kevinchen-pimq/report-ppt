// Linkin Park 2 environment (Linkin Park x Mike Shinoda music pack) — our own recreation from simple
// shapes (no game assets). Look: a long round concrete tunnel with ribs, a flat reddish floor with
// low side walls, rows of glowing tunnel rings receding into the distance, huge partial arcs at the
// sides near the player, two rings of thin "circular lasers" converging down the tunnel, thick white
// laser beams from the sides, floor laser lines, small spectrogram blocks along the side walls and
// the LP logo far down the tunnel.
//
// v3 light groups (id → what, elements, rotation / translation axes). Element order: approximate.
//   0  Circular Lasers Global Distant  1   rot z, trans z   (whole distant laser ring)
//   1  Circular Lasers Local Distant  20   rot x y, trans z (beams on a circle, clockwise from top;
//                                          y = around the tunnel axis, x = tilt, z = toward the axis)
//   2  Circular Lasers Global Close    1   rot z, trans z
//   3  Circular Lasers Local Close    20   rot x y, trans z
//   4  Tunnels Rings                   4   rot z, trans x y z (dashed light rings, near → far)
//   5  Big Arcs Local                  4   trans y z        (L near, R near, L far, R far)
//   6  Laser Beams Local Left          2   rot x y z, trans x y z (thick beams: upper, lower)
//   7  Laser Beams Local Right         2   rot x y z, trans x y z
//   8  Floor Lasers Left               1
//   9  Floor Lasers Right              1
//  10  Tunnels Lights                 16   (thin rings far down the tunnel, near → far)
//  11  Logo                            1   trans x y z
//  12  Big Arcs Global                 4   rot z (around the tunnel axis; parent of group 5)
//  13  Spectrograms Floor Left        28   (blocks along the left side wall, near → far)
//  14  Spectrograms Floor Right       28
//  15  Spectrograms Tunnel Left        4   (vertical bars on the tunnel wall)
//  16  Spectrograms Tunnel Right       4
//  17  Laser Beams Global Left         2   rot z (around the tunnel axis; parent of group 6)
//  18  Laser Beams Global Right        2   rot z (parent of group 7)
// Basic events: 3 = ambient light (tints the tunnel). Value controls 40 (logos) / 41 (floor logos)
// are not shown (the logo is always the LP mark; no floor logos).
// Sources (facts only): group names — KivalEvan/BeatSaber-JSMap (MIT) renamer tables; element
// counts and axes — index filters / axes of ~40 BeatSaver maps made for this environment;
// GLS object list, look and colours — BSMG wiki (basic lighting environment list, preview image),
// Steam store screenshots, ArcViewer's colour table (GPL, values only).
// Approximate: tunnel size, ring / arc positions, which element sits where, translation scale (1 m
// per unit), the logo shape (simple bars).
import { THREE, GEO, GlowBank, LightBank, Rig, V, stdMat, mergeAll, trs, applyMirrors } from './kit.js';
import { LG, finishGroups, pivot, chainTubes, AmbientLight, ringGeometry, mat } from './_v3lg.js';

const TY = 4; // tunnel axis height
const TR = 10; // tunnel radius
const D2R = Math.PI / 180;

// Mirror flags (CONTRACT.md "Handedness"): lower case = rotation axes, upper case = translation
// axes whose event value the runtime negates, so that each group turns / moves the way Beat Saber's
// does with our pivots' orientation. Derived per element from the game's environment data (world
// rotation axis / translation direction of a +1 event in ChroMapper's UGEcko export) against ours;
// real maps send the same values to both groups of most left / right pairs, which then mirror.
const MIRROR = { 0: 'zZ', 2: 'zZ', 4: 'zZ', 5: 'Z', 6: 'xyZ', 7: 'xyXZ', 11: 'Z', 12: 'z', 18: 'z' };

export default {
  name: 'LinkinPark2Environment',
  label: 'Linkin Park 2',
  colors: {
    left: '#a92a2b',
    right: '#63848e',
    envLeft: '#a92a2c',
    envRight: '#9fb0b5',
    envLeftBoost: '#eb9841',
    envRightBoost: '#48759f',
    wall: '#a92a2c',
    envWhite: '#C0AC97', // the game's white light colour (used when the map has none)
    envWhiteBoost: '#B9B9B9',
  },
  build() {
    const root = new THREE.Group();
    root.name = 'LinkinPark2Environment';
    const rig = new Rig(root);
    const owned = [];
    const own = (x) => (owned.push(x), x);

    // ---- light banks
    const glow = new GlowBank(root, GEO.tube, 90, { haloScale: 3, haloOpacity: 0.16 });
    // dashed ring (4 arcs with gaps, so ring rotation reads) for tunnel rings and tunnel lights
    const dashed = (inner, outer) => {
      const parts = [];
      for (let k = 0; k < 4; k++) parts.push(ringGeometry(inner, outer, 14, (k * 90 + 8) * D2R, 74 * D2R));
      return own(mergeAll(parts));
    };
    const rings = new GlowBank(root, dashed(0.985, 1), 24, { haloGeometry: dashed(0.955, 1.03), haloOpacity: 0.2 });
    const arcGeo = own(ringGeometry(0.975, 1, 20, -52 * D2R, 104 * D2R));
    const arcHalo = own(ringGeometry(0.93, 1.045, 20, -52 * D2R, 104 * D2R));
    const arcs = new GlowBank(root, arcGeo, 4, { haloGeometry: arcHalo, haloOpacity: 0.2 });
    const spec = new LightBank(root, GEO.box, 56);

    const G = {};
    for (let i = 0; i <= 18; i++) G[i] = LG();

    // ---- circular lasers: a global pivot on the tunnel axis, 20 local pivots on a circle,
    // each holding a thin beam converging toward the far end of the tunnel
    const circle = (gGlobal, gLocal, z, rad) => {
      const gp = pivot(0, TY, z);
      G[gGlobal].rotation.z.push(gp);
      G[gGlobal].translation.z.push(gp);
      for (let i = 0; i < 20; i++) {
        const a = (90 - i * 18) * D2R;
        const c = Math.cos(a);
        const s = Math.sin(a);
        // as in the game, per laser: a wrapper on the tunnel axis (rotation y = around the axis,
        // its local y pointing down the tunnel), a mount on the circle (x = tangent, z = inward),
        // and the laser pivot (translation z = toward the axis, rotation x = tilt)
        const wrap = pivot(0, 0, 0, -Math.PI / 2, 0, 0);
        const mount = new THREE.Object3D();
        mount.position.set(c * rad, 0, s * rad); // wrapper frame: z = up
        const X = V(s, -c, 0);
        const Y = V(0, 0, 1);
        const Z = V(-c, -s, 0);
        const qw = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, Y, Z));
        mount.quaternion.copy(wrap.quaternion).invert().multiply(qw);
        const lp = pivot();
        const e = V(c * 1.2 - c * rad, s * 1.2 - s * rad, -150 - z);
        const end = V(X.dot(e), Y.dot(e), Z.dot(e));
        G[gLocal].lights.push(rig.tube([gp, wrap, mount, lp], glow, V(0, 0, 0), end, 0.035));
        G[gLocal].rotation.x.push(lp);
        G[gLocal].rotation.y.push(wrap);
        G[gLocal].translation.z.push(lp);
      }
    };
    circle(0, 1, -40, 7.5);
    circle(2, 3, -4, 8.6);

    // ---- tunnel rings (4) and tunnel lights (16)
    [-14, -32, -54, -80].forEach((z) => {
      const p = pivot(0, TY, z);
      G[4].lights.push(rig.light(p, rings, mat(0, 0, 0, 0, 0, 0, TR - 0.5, TR - 0.5, 1)));
      G[4].rotation.z.push(p);
      for (const ax of ['x', 'y', 'z']) G[4].translation[ax].push(p);
    });
    for (let i = 0; i < 16; i++) {
      const z = -92 - i * 4.2;
      G[10].lights.push(rings.add(mat(0, TY, z, 0, 0, (i * 23) * D2R, TR - 0.4, TR - 0.4, 1)));
    }

    // ---- big arcs: global pivot (rot z around the tunnel axis) → local pivot (trans y z)
    [[-1, -7], [1, -7], [-1, -21], [1, -21]].forEach(([s, z]) => {
      // the left arcs are the right ones turned 180° about the axis in the light's own matrix, so
      // translation y moves all four up (as in the game)
      const gp = pivot(0, TY, z);
      const lp = pivot(0, 0, 0);
      G[12].rotation.z.push(gp);
      G[5].translation.y.push(lp);
      G[5].translation.z.push(lp);
      G[5].lights.push(rig.light([gp, lp], arcs, mat(0, 0, 0, 0, 0, s < 0 ? Math.PI : 0, TR - 0.9, TR - 0.9, 1)));
    });

    // ---- laser beams: global pivot on the tunnel axis (rot z) → local pivot at the beam origin
    for (const [s, gL, gG] of [[-1, 6, 17], [1, 7, 18]]) {
      [[6.4, 3.6], [7.4, -1.4]].forEach(([dx, dy]) => {
        const gp = pivot(0, TY, -3);
        const lp = pivot(s * dx, dy, 0);
        const end = V(-s * dx + s * 0.6, -dy * 0.85, -160);
        G[gG].rotation.z.push(gp);
        for (const ax of ['x', 'y', 'z']) {
          G[gL].rotation[ax].push(lp);
          G[gL].translation[ax].push(lp);
        }
        G[gL].lights.push(rig.tube([gp, lp], glow, V(0, 0, 0), end, 0.22));
      });
    }

    // ---- floor lasers
    G[8].lights.push(glow.tube(V(-2.4, 0.03, 0.5), V(-2.4, 0.03, -150), 0.04));
    G[9].lights.push(glow.tube(V(2.4, 0.03, 0.5), V(2.4, 0.03, -150), 0.04));

    // ---- spectrograms: blocks on top of the side walls, bars on the tunnel wall
    for (const [s, g] of [[-1, 13], [1, 14]]) {
      for (let i = 0; i < 28; i++) G[g].lights.push(spec.add(trs([s * 4.15, 1.32, -3 - i * 3.1], [0, 0, 0], [0.08, 0.24, 0.5])));
    }
    for (const [s, g] of [[-1, 15], [1, 16]]) {
      for (let i = 0; i < 4; i++) {
        const z = -9 - i * 9;
        G[g].lights.push(glow.tube(V(s * 8.4, 1.8, z), V(s * 8.4, 5.6, z), 0.09));
      }
    }

    // ---- LP logo (simple boxy bars), on its own pivot (translation)
    {
      const p = pivot(0, 4.6, -96);
      const h = 4;
      const w = 2.1;
      const r = 0.13;
      const segs = [
        // L
        [V(-w - 0.3, h / 2, 0), V(-w - 0.3, -h / 2, 0), r],
        [V(-w - 0.3, -h / 2, 0), V(-0.35, -h / 2, 0), r],
        // P
        [V(0.35, -h / 2, 0), V(0.35, h / 2, 0), r],
        [V(0.35, h / 2, 0), V(w + 0.3, h / 2, 0), r],
        [V(w + 0.3, h / 2, 0), V(w + 0.3, 0, 0), r],
        [V(w + 0.3, 0, 0), V(0.35, 0, 0), r],
      ];
      G[11].lights.push(chainTubes(rig, [p], glow, segs));
      for (const ax of ['x', 'y', 'z']) G[11].translation[ax].push(p);
    }

    // ---- static scenery
    const concrete = own(stdMat(0x2c2220, { roughness: 0.92, metalness: 0.05, side: THREE.BackSide }));
    const wallMat = own(stdMat(0x231a18, { roughness: 0.85, metalness: 0.1 }));
    const floorMat = own(stdMat(0x4a2620, { roughness: 0.75, metalness: 0.15 }));
    const shellGeo = new THREE.CylinderGeometry(TR, TR, 175, 32, 1, true);
    shellGeo.rotateX(Math.PI / 2);
    shellGeo.translate(0, TY, -80);
    const shell = new THREE.Mesh(mergeAll([shellGeo]), concrete);
    const parts = [];
    for (let z = -2; z > -158; z -= 7) {
      const t = new THREE.TorusGeometry(TR - 0.25, 0.32, 4, 32);
      t.translate(0, TY, z);
      parts.push(t);
    }
    for (const s of [-1, 1]) {
      const b = new THREE.BoxGeometry(0.7, 1.15, 160);
      b.translate(s * 4.5, 0.575, -78);
      parts.push(b);
      // dark slat wall between the side wall and the tunnel
      const sl = new THREE.BoxGeometry(0.3, 2.6, 160);
      sl.translate(s * 7.6, 1.3, -78);
      parts.push(sl);
    }
    const walls = new THREE.Mesh(mergeAll(parts), wallMat);
    const fl = new THREE.PlaneGeometry(20, 170);
    fl.rotateX(-Math.PI / 2);
    fl.translate(0, -0.01, -78);
    const floor = new THREE.Mesh(mergeAll([fl]), floorMat);
    for (const m of [shell, walls, floor]) {
      m.matrixAutoUpdate = false;
      root.add(m);
    }

    const ambient = new AmbientLight([concrete, wallMat, floorMat], 0.05);

    finishGroups(G);
    rig.update(true);
    const banks = [...glow.banks, ...rings.banks, ...arcs.banks, spec];
    return {
      root,
      banks,
      groups: { 3: [ambient] },
      lightGroups: applyMirrors(G, MIRROR),
      update() {
        rig.update();
      },
      dispose() {
        for (const b of [glow, rings, arcs]) b.dispose();
        spec.mesh.material.dispose();
        spec.dispose();
        for (const m of [shell, walls, floor]) m.geometry.dispose();
        for (const o of owned) o.dispose();
      },
    };
  },
};
