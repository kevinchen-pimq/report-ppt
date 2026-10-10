// Linkin Park environment (Linkin Park music pack): a long concrete tunnel with a rounded
// (arched) ceiling, thick arch ribs every 14 m, bar lights along the ceiling, two glowing wires
// on the floor beside the track, fans of long laser lines running along the tunnel walls and the
// "LP" logo at the far end. Recreated with simple shapes for this project.
//
// Light groups (v2 basic event type → lights, Chroma lightID n = groups[type][n - 1]):
//   0  floor wires ............................ 2   (1 left, 2 right)
//   1  ceiling bar lights ...................... 16  (8 bars near → far; the official table maps
//                                                    IDs in pairs to the same light, so IDs 2k-1 and
//                                                    2k both drive bar k)
//   2  left lasers ............................. 20  (1–18 tunnel laser lines from the side wall
//                                                    (horizontal) up to the top in 5° steps,
//                                                    19–20 the two wires in the upper-left corner)
//   3  right lasers ............................ 20  (mirror of 2)
//   4  center light: LP logo ................... 1
// Counts: Chroma's light ID table for LinkinParkEnvironment (Aeroluna/Heck). Order and rough
// positions: ArcViewer's community recreation (facts only). Ceiling bar pair order: approximate.
// Event 12 / 13 (laser speed) spin each tunnel laser line around the tunnel axis (one pivot each,
// random phase). No rings (event 8 "laser mode" is not modelled by the contract).
import { THREE, GEO } from './kit.js';
import { LightSet, Rig, MultiLight, barXYZ, wash, stdMat, mergeGeos } from './_dKit.js';

const TUNNEL_R = 3.8; // half width of the tunnel = radius of the arch
const ARCH_Y = 1.0; // arch centre height
const NEAR = 6; // tunnel starts behind the player
const FAR = -104; // end wall
const LASER_R = 2.5; // radius of the tunnel laser lines around (0, ARCH_Y)

export default {
  name: 'LinkinParkEnvironment',
  label: 'Linkin Park',
  colors: {
    left: '#a92a2b',
    right: '#63848e',
    envLeft: '#c0ac97',
    envRight: '#9fb0b5',
    envLeftBoost: '#eb9841',
    envRightBoost: '#48759f',
    wall: '#a92a2c',
  },
  build() {
    const root = new THREE.Group();
    root.name = 'LinkinParkEnvironment';
    const concrete = stdMat(0x24231f, { roughness: 0.92, metalness: 0.05, side: THREE.DoubleSide });
    const floorMat = stdMat(0x181714, { roughness: 0.85, metalness: 0.1 });
    const owned = [concrete, floorMat];

    // ---- static scenery ---------------------------------------------------------------------
    const geos = [];
    const len = NEAR - FAR;
    // arched ceiling (half cylinder along Z)
    const arch = new THREE.CylinderGeometry(TUNNEL_R, TUNNEL_R, len, 28, 1, true, Math.PI / 2, Math.PI);
    arch.rotateX(Math.PI / 2);
    arch.translate(0, ARCH_Y, (NEAR + FAR) / 2);
    geos.push(arch);
    // vertical wall parts below the arch
    for (const s of [-1, 1]) {
      const w = new THREE.BoxGeometry(0.2, ARCH_Y + 0.2, len);
      w.translate(s * (TUNNEL_R + 0.1), (ARCH_Y - 0.2) / 2, (NEAR + FAR) / 2);
      geos.push(w);
    }
    // end wall with a smaller arched niche around the logo
    const end = new THREE.BoxGeometry(TUNNEL_R * 2 + 0.4, TUNNEL_R + ARCH_Y + 0.4, 0.4);
    end.translate(0, (TUNNEL_R + ARCH_Y) / 2, FAR);
    geos.push(end);
    // arch ribs (thick rounded frames every 14 m)
    const rib = new THREE.Shape();
    const ro = TUNNEL_R;
    const ri = TUNNEL_R - 0.45;
    rib.moveTo(-ro, -0.15);
    rib.lineTo(-ro, ARCH_Y);
    rib.absarc(0, ARCH_Y, ro, Math.PI, 0, true);
    rib.lineTo(ro, -0.15);
    rib.lineTo(ri, -0.15);
    rib.lineTo(ri, ARCH_Y);
    rib.absarc(0, ARCH_Y, ri, 0, Math.PI, false);
    rib.lineTo(-ri, -0.15);
    for (let k = 0; k < 7; k++) {
      const g = new THREE.ExtrudeGeometry(rib, { depth: 0.6, bevelEnabled: false, curveSegments: 14 });
      g.translate(0, 0, -15 - k * 14);
      geos.push(g);
    }
    // a smaller niche frame right in front of the end wall
    {
      const g = new THREE.ExtrudeGeometry(rib, { depth: 0.8, bevelEnabled: false, curveSegments: 14 });
      g.scale(0.62, 0.62, 1);
      g.translate(0, 0.1, FAR + 0.3);
      geos.push(g);
    }
    const shell = mergeGeos(geos, concrete);
    root.add(shell);
    owned.push(shell.geometry);

    const floorGeo = new THREE.BoxGeometry(TUNNEL_R * 2, 0.1, len);
    floorGeo.translate(0, -0.17, (NEAR + FAR) / 2);
    const floor = new THREE.Mesh(floorGeo, floorMat);
    root.add(floor);
    owned.push(floorGeo);

    // ---- lights -----------------------------------------------------------------------------
    const lights = new LightSet(root, { max: 96, glowOpacity: 0.18 });
    const rig = new Rig(root);
    const groups = { 0: [], 1: [], 2: [], 3: [], 4: [] };

    // 0: floor wires beside the track
    for (const s of [-1, 1]) {
      groups[0].push(lights.light([{ m: barXYZ(s * 1.9, 0.0, NEAR, s * 1.9, 0.0, FAR + 1, 0.04, 0.02) }], { fat: 6 }));
    }

    // 1: ceiling bars, 8 physical bars, two IDs each
    for (let k = 0; k < 8; k++) {
      const z = -9 - k * 14;
      const L = lights.light([{ m: barXYZ(-0.95, ARCH_Y + TUNNEL_R - 0.16, z, 0.95, ARCH_Y + TUNNEL_R - 0.16, z, 0.07, 0.28) }], { fat: 3.5 });
      groups[1].push(L, L);
    }

    // 2 / 3: 18 tunnel laser lines per side (each its own pivot around the tunnel axis) + 2 wires
    const lasers = { left: [], right: [] };
    for (const [type, s, list] of [[2, -1, lasers.left], [3, 1, lasers.right]]) {
      for (let i = 0; i < 18; i++) {
        const a = THREE.MathUtils.degToRad(s < 0 ? 180 - 5 * i : 5 * i);
        const p = rig.proxy(0, ARCH_Y, 0);
        const x = Math.cos(a) * LASER_R;
        const y = Math.sin(a) * LASER_R;
        groups[type].push(lights.light([{ m: barXYZ(x, y, NEAR, x, y, FAR + 1, 0.03) }], { fat: 2.4, glowGain: 0.8, rig, proxy: p }));
        list.push(p);
      }
      for (const [x, y] of [[2.3, 3.75], [2.65, 3.4]]) {
        groups[type].push(lights.light([{ m: barXYZ(s * x, y, NEAR, s * x, y, FAR + 1, 0.05) }], { fat: 3 }));
      }
    }

    // 4: LP logo at the end of the tunnel (flat glowing letter shapes + a soft fog halo)
    {
      const z = FAR + 1.2;
      const cx = 0;
      const cy = 2.05;
      const S = 1.5;
      const rect = (x0, y0, x1, y1) => ({ m: barXYZ(cx + ((x0 + x1) / 2) * S, cy + y0 * S, z, cx + ((x0 + x1) / 2) * S, cy + y1 * S, z, (x1 - x0) * S, 0.06) });
      const parts = [
        rect(-0.62, -0.5, -0.4, 0.5), // L stem
        rect(-0.62, -0.5, -0.02, -0.3), // L foot
        rect(0.02, -0.5, 0.24, 0.5), // P stem
        rect(0.02, 0.3, 0.62, 0.5), // P top
        rect(0.42, -0.08, 0.62, 0.5), // P bowl side
        rect(0.02, -0.08, 0.62, 0.1), // P bowl bottom
      ];
      const logo = lights.light(parts, { fat: 1.6, glowGain: 0.8 });
      const halo = lights.glow.add(barXYZ(0, cy - 2.2, z - 0.3, 0, cy + 2.2, z - 0.3, 4.4, 0.02));
      logo.push(halo, 0.35);
      groups[4].push(logo);
    }

    rig.sync();

    // concrete picks up some of the light colour (cheap bounce-light stand-in)
    const all = [...groups[0], ...groups[1], ...groups[2], ...groups[3], ...groups[4]];
    const bounce = wash(all, (r, g, b) => {
      concrete.emissive.setRGB(r * 0.12, g * 0.12, b * 0.12);
      floorMat.emissive.setRGB(r * 0.12, g * 0.12, b * 0.12);
    });

    const banks = lights.banks;
    return {
      root,
      banks,
      groups,
      rings: [],
      lasers,
      update() {
        rig.sync();
        bounce();
      },
      dispose() {
        lights.dispose();
        for (const o of owned) o.dispose();
        root.removeFromParent();
      },
    };
  },
};
