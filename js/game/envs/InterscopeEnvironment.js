// Interscope environment (Interscope Mixtape): a low concrete parking garage. Five light "gates"
// span the track, each a top bar under a ceiling beam plus two diagonal bars on slanted concrete
// wedges; lowrider cars are parked at an angle between the gates; the far end glows in the light
// colour. Recreated with simple shapes for this project.
//
// Light groups (v2 basic event type → lights, Chroma lightID n = groups[type][n - 1]):
//   0  gate 4 (z ≈ -38) ........ 3  (1 left diagonal, 2 top bar, 3 right diagonal)
//   1  gate 1 (z ≈ -8, nearest)  3  (same order)
//   2  gate 3 (z ≈ -28) ........ 3
//   3  gate 2 (z ≈ -18) ........ 3
//   4  gate 5 (z ≈ -48) ........ 3
//   6  left lasers ............. 7  (lines along the track, left side; laser speed (12) moves
//                                    them up and down)
//   7  right lasers ............ 7  (same, right side, speed event 13)
// Counts: Chroma's light ID table for InterscopeEnvironment (Aeroluna/Heck). Gate ↔ event type
// assignment, the in-gate order and rough positions: ChroMapper's community recreation (facts
// only). Laser placement/motion: approximate. Environment events (customEvents), car hydraulics:
// 16 / 17 raise (value > 0) or lower (0) the cars on the left / right, 8 makes every car hop.
import { THREE, GEO, GlowBank, Rig, MultiLight, PropBank, barXYZ, wash, stdMat, mergeGeos, mergeAll } from './kit.js';

const GATE_Z = [-7.9, -17.9, -27.9, -37.9, -47.9];
// which gate (index into GATE_Z) each event type lights
const GATE_OF_TYPE = { 0: 3, 1: 0, 2: 2, 3: 1, 4: 4 };
const CEIL = 5.0;
const NEAR = 5;
const FAR = -62;

function carGeos(x, z, yaw, out) {
  // simple lowrider: body, hood/trunk, cabin, 4 wheels — in the car's frame (+X = nose)
  const parts = [];
  const body = new THREE.BoxGeometry(4.9, 0.5, 1.9);
  body.translate(0, 0.62, 0);
  parts.push(body);
  const cabin = new THREE.BoxGeometry(2.1, 0.46, 1.62);
  cabin.translate(-0.45, 1.09, 0);
  parts.push(cabin);
  const glass = new THREE.BoxGeometry(0.5, 0.36, 1.5);
  glass.rotateZ(0.7);
  glass.translate(0.72, 1.03, 0);
  parts.push(glass);
  for (const [wx, wz] of [[1.55, 0.86], [1.55, -0.86], [-1.5, 0.86], [-1.5, -0.86]]) {
    const w = new THREE.CylinderGeometry(0.34, 0.34, 0.26, 12);
    w.rotateX(Math.PI / 2);
    w.translate(wx, 0.34, wz);
    parts.push(w);
  }
  for (const p of parts) {
    p.rotateY(yaw);
    p.translate(x, 0, z);
    out.push(p);
  }
}

export default {
  name: 'InterscopeEnvironment',
  label: 'Interscope',
  colors: {
    left: '#b9a050',
    right: '#964cb8',
    envLeft: '#b952e9',
    envRight: '#c3c2e9',
    envLeftBoost: '#ca6e6e',
    envRightBoost: '#b3b7c3',
    wall: '#964cb8',
  },
  build() {
    const root = new THREE.Group();
    root.name = 'InterscopeEnvironment';
    const concrete = stdMat(0x1a1a1d, { roughness: 0.95, metalness: 0.0 });
    const floorMat = stdMat(0x141417, { roughness: 0.7, metalness: 0.25 });
    const carMat = stdMat(0x1c1d22, { roughness: 0.3, metalness: 0.75 });
    const paint = stdMat(0x0d0d10, { roughness: 0.9 });
    const owned = [concrete, floorMat, carMat, paint];

    // ---- static scenery ---------------------------------------------------------------------
    const cgeos = [];
    const len = NEAR - FAR;
    const ceiling = new THREE.BoxGeometry(28, 0.6, len);
    ceiling.translate(0, CEIL + 0.3, (NEAR + FAR) / 2);
    cgeos.push(ceiling);
    const back = new THREE.BoxGeometry(28, CEIL, 0.5);
    back.translate(0, CEIL / 2, FAR - 4);
    cgeos.push(back);
    // side walls far out (mostly in the dark)
    for (const s of [-1, 1]) {
      const w = new THREE.BoxGeometry(0.5, CEIL, len);
      w.translate(s * 13, CEIL / 2, (NEAR + FAR) / 2);
      cgeos.push(w);
    }
    const wedge = new THREE.Shape();
    wedge.moveTo(3.75, 0);
    wedge.lineTo(6.95, 3.2);
    wedge.lineTo(8.6, 3.2);
    wedge.lineTo(8.6, 0);
    wedge.lineTo(3.75, 0);
    for (const z of GATE_Z) {
      // ceiling beam carrying the top bar
      const beam = new THREE.BoxGeometry(17.5, CEIL - 4.38, 0.8);
      beam.translate(0, (CEIL + 4.38) / 2, z);
      cgeos.push(beam);
      for (const s of [-1, 1]) {
        const g = new THREE.ExtrudeGeometry(wedge, { depth: 0.8, bevelEnabled: false });
        g.translate(0, 0, z - 0.4);
        if (s < 0) g.scale(-1, 1, 1);
        cgeos.push(g);
        // upper part of the pillar, from the wedge top to the ceiling beam
        const up = new THREE.BoxGeometry(1.65, CEIL - 3.2, 0.8);
        up.translate(s * 7.775, (CEIL + 3.2) / 2, z);
        cgeos.push(up);
      }
    }
    const shell = mergeGeos(cgeos, concrete);
    root.add(shell);
    owned.push(shell.geometry);
    // mirrored wedges have flipped winding: render concrete double sided
    concrete.side = THREE.DoubleSide;

    const floorGeo = new THREE.BoxGeometry(28, 0.1, len);
    floorGeo.translate(0, -0.07, (NEAR + FAR) / 2);
    const floor = new THREE.Mesh(floorGeo, floorMat);
    root.add(floor);
    owned.push(floorGeo);

    // dark painted dashes / parking marks on the floor
    const pgeos = [];
    for (let z = 2; z > FAR + 4; z -= 3.2) {
      for (const s of [-1, 1]) {
        const d = new THREE.BoxGeometry(0.16, 0.02, 1.6);
        d.translate(s * 2.75, -0.01, z);
        pgeos.push(d);
      }
    }
    for (const z of GATE_Z) {
      for (const s of [-1, 1]) {
        const d = new THREE.BoxGeometry(2.4, 0.02, 0.9);
        d.translate(s * 5.2, -0.01, z + 1.6);
        pgeos.push(d);
      }
    }
    const marks = mergeGeos(pgeos, paint);
    root.add(marks);
    owned.push(marks.geometry);

    // cars (between the gates, nose angled toward the track)
    // one car shape, 8 instances (hydraulics move them: events 8 / 16 / 17)
    const carParts = [];
    carGeos(0, 0, 0, carParts);
    const carGeo = mergeAll(carParts);
    owned.push(carGeo);
    const carBank = new PropBank(root, carGeo, carMat, 8);
    const cars = [];
    const yaw = Math.atan2(-0.34, 0.94); // nose toward +X (track) and slightly toward the player
    const cm = new THREE.Matrix4();
    const tilt = new THREE.Matrix4();
    const pose = (c) => {
      // lift: whole car up, nose (+X) tilted up a little; hop: extra bounce
      cm.makeRotationY(c.yaw).multiply(tilt.makeRotationZ(c.lift * 0.3));
      cm.setPosition(c.x, c.lift + c.hop, c.z);
      carBank.setMatrix(c.index, cm);
    };
    for (const [x, z] of [[4.6, -12.4], [4.6, -22.4], [5.1, -32.4], [5.1, -42.4]]) {
      for (const [cx, cyaw, side] of [[-x, yaw, 0], [x, Math.PI - yaw, 1]]) {
        const c = { x: cx, z, yaw: cyaw, side, index: carBank.add(cm), lift: 0, target: 0, hop: 0, vel: 0 };
        pose(c);
        cars.push(c);
      }
    }

    // ---- lights -----------------------------------------------------------------------------
    const lights = new GlowBank(root, GEO.box, 64, { haloOpacity: 0.22 });
    const rig = new Rig(root);
    const groups = { 0: [], 1: [], 2: [], 3: [], 4: [], 6: [], 7: [] };
    const gateLights = GATE_Z.map((z) => {
      const left = lights.light([{ m: barXYZ(-4.25, 0.6, z, -6.75, 3.1, z, 0.16, 0.34) }], { fat: 2.2 });
      const top = lights.light([{ m: barXYZ(-3.05, 4.25, z, 3.05, 4.25, z, 0.16, 0.42) }], { fat: 2.2 });
      const right = lights.light([{ m: barXYZ(4.25, 0.6, z, 6.75, 3.1, z, 0.16, 0.34) }], { fat: 2.2 });
      return [left, top, right];
    });
    for (const [type, gate] of Object.entries(GATE_OF_TYPE)) groups[type] = gateLights[gate];

    // 6 / 7: lines along the track that slide up and down with the laser speed
    const lasers = { left: [], right: [] };
    for (const [type, s, list] of [[6, -1, lasers.left], [7, 1, lasers.right]]) {
      for (let i = 0; i < 7; i++) {
        const p = rig.proxy(s * 2.5, 0, 0);
        const off = i * 0.9;
        p.userData.map = (proxy, out) => out.makeTranslation(proxy.position.x, 1.7 + Math.sin(proxy.rotation.z + off) * 1.0, 0);
        groups[type].push(lights.light([{ m: barXYZ(0, 0, -1, 0, 0, FAR + 2, 0.03) }], { fat: 2.5, glowGain: 0.7, rig, proxy: p }));
        list.push(p);
      }
    }

    // far-end haze in the gate colours
    const haze = new MultiLight();
    haze.push(lights.glow.add(barXYZ(0, 0, FAR - 3.5, 0, CEIL, FAR - 3.5, 26, 0.05)), 0.9);
    rig.sync();

    const gateAll = [...gateLights.flat()];
    const bounce = wash(gateAll, (r, g, b) => {
      concrete.emissive.setRGB(r * 0.24, g * 0.24, b * 0.24);
      floorMat.emissive.setRGB(r * 0.14, g * 0.14, b * 0.14);
      carMat.emissive.setRGB(r * 0.08, g * 0.08, b * 0.08);
      haze.set(r, g, b);
    });

    return {
      root,
      banks: [...lights.banks, carBank],
      groups,
      rings: [],
      lasers,
      customEvents: [8, 16, 17],
      onEvent(type, value) {
        for (const c of cars) {
          if (type === 8) c.vel = Math.max(c.vel, 2.2); // hop
          else if (type === 16 + c.side) c.target = value > 0 ? 0.45 : 0; // raise / lower one side
        }
      },
      reset() {
        for (const c of cars) {
          c.target = 0;
          c.vel = 0;
        }
      },
      update(t, dt) {
        for (let i = 0; i < cars.length; i++) {
          const c = cars[i];
          if (c.lift === c.target && c.hop === 0 && c.vel === 0) continue;
          c.lift += (c.target - c.lift) * (1 - Math.exp(-8 * dt));
          if (Math.abs(c.target - c.lift) < 1e-3) c.lift = c.target;
          c.vel -= 9.8 * dt;
          c.hop += c.vel * dt;
          if (c.hop <= 0) {
            c.hop = 0;
            c.vel = 0;
          }
          pose(c);
        }
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
