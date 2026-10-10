// K/DA (KDAEnvironment) — a recreation with simple shapes, made for this project.
//
// Look: a wide dark, glassy stage floor that starts a few metres ahead of the player, held up by
// two stilts and a crossbar at its front edge; dozens of small glowing sticks lying scattered on it;
// two big dark arrowhead "spears" hovering up left and right with a glowing crystal inside; five
// long top lasers running down the length of the stage; seven crossing rotating lasers per side
// rising from emitter bars far out on the floor; vertical bottom lasers shining up through the glass;
// glow wires and a "^" chevron ahead. No rings.
//
// Light groups (v2 event type -> lights, in light-ID order):
//   0 bottom lasers (6):  pairs left/right from near to far (1 L, 2 R, 3 L, 4 R, 5 L, 6 R)
//   1 top lasers    (5):  left -> right (outer left, mid left, centre (lower), mid right, outer right)
//   2 left lasers   (7):  near -> far
//   3 right lasers  (9):  1-7 rotating lasers near -> far, 8 left spear crystal, 9 right spear crystal
//                         ("right lasers control the lights in the centre of the arrows")
//   4 center        (80): 1 left wire, 2 right wire, 3 chevron left stroke, 4 chevron right stroke,
//                         5-80 the 76 floor sticks, ordered roughly near -> far
// Lasers: 12 / 13 spin the side lasers around the vertical axis.
// ID order / counts source: community light-ID mapping as used by ArcViewer's K/DA recreation
// (facts only) plus the BSMG wiki environment notes. The stick layout is our own random scatter
// (the order near -> far follows the mapping); sizes / positions are approximate.
import { THREE, GEO, trs, mergeStatic, sceneryMaterials } from './kit.js';
import { GlowBank, Rig, rotatingLaser, rng, boxAt, V } from './_bxKit.js';

const _q = new THREE.Quaternion();
const _e = new THREE.Euler();

/** Box mesh placed by a parent matrix (no shear) and local position / rotation / size. */
function placedBox(material, parent, pos, rotZ, size) {
  const local = trs(pos, [0, 0, rotZ], [1, 1, 1]);
  const m = new THREE.Mesh(GEO.box, material);
  new THREE.Matrix4().multiplyMatrices(parent, local).decompose(m.position, m.quaternion, m.scale);
  m.scale.multiply(new THREE.Vector3(size[0], size[1], size[2]));
  return m;
}

export default {
  name: 'KDAEnvironment',
  label: 'K/DA',
  colors: { left: '#a84329', right: '#801592', envLeft: '#ff653e', envRight: '#c220dd', wall: '#ff653e' },
  build() {
    const root = new THREE.Group();
    const mats = sceneryMaterials();
    const owned = [];
    const groups = { 0: [], 1: [], 2: [], 3: [], 4: [] };

    // ---------- floor (dark glass, slightly see-through so the bottom lasers shine through) ----------
    const glass = new THREE.MeshStandardMaterial({ color: 0x0c0a14, roughness: 0.15, metalness: 0.7, transparent: true, opacity: 0.72, depthWrite: false });
    const floorParts = [];
    for (const s of [-1, 1]) floorParts.push(boxAt(glass, [s * 101.15, -0.06, -153], [200, 0.1, 294]));
    floorParts.push(boxAt(glass, [0, -0.3, -170], [2.3, 0.1, 260]));
    const floor = mergeStatic(floorParts, glass);
    floor.renderOrder = -1;
    root.add(floor);
    owned.push(floor.geometry, glass);

    // ---------- static dark scenery ----------
    const dark = [];
    // front edge of the stage, crossbar and stilts
    for (const s of [-1, 1]) {
      dark.push(boxAt(mats.dark, [s * 101.15, -0.08, -6.05], [200, 0.18, 0.12]));
      dark.push(boxAt(mats.dark, [s * 2.5, -100, -7.25], [1, 200, 2]));
      dark.push(boxAt(mats.dark, [s * 2.5, -100, -6], [0.5, 200, 0.5]));
      dark.push(boxAt(mats.dark, [s * 101.3, -0.5, -6.5], [200, 0.3, 1]));
      // laser emitter bars far out on the floor
      dark.push(boxAt(mats.dark, [s * 17, 0.1, -45], [0.5, 0.5, 24]));
    }
    dark.push(boxAt(mats.dark, [0, 15, -100], [1, 1, 300]));

    // spears: an arrowhead frame (kite outline) hovering up left / right, tip pointing down to the centre
    const spearMatrices = [];
    for (const s of [-1, 1]) {
      _e.set((-22 * Math.PI) / 180, 0, (s * -57 * Math.PI) / 180);
      _q.setFromEuler(_e);
      const M = new THREE.Matrix4().compose(V(s * 5.4, 4.6, -13), _q, V(1.5, 1.5, 1.5));
      spearMatrices.push(M);
      const pts = [[0, -3.0], [-1.25, 0.15], [0, 1.25], [1.25, 0.15]];
      for (let i = 0; i < 4; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % 4];
        const mx = (a[0] + b[0]) / 2;
        const my = (a[1] + b[1]) / 2;
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
        dark.push(placedBox(mats.metal, M, [mx, my, 0], ang, [len + 0.35, 0.42, 0.55]));
      }
      // a short shaft behind the head
      dark.push(placedBox(mats.metal, M, [0, 2.6, 0.2], 0, [0.32, 3.0, 0.32]));
    }
    const darkMesh = mergeStatic(dark.filter((m) => m.material === mats.dark), mats.dark);
    const metalMesh = mergeStatic(dark.filter((m) => m.material === mats.metal), mats.metal);
    root.add(darkMesh, metalMesh);
    owned.push(darkMesh.geometry, metalMesh.geometry);

    // ---------- lights ----------
    const tubes = new GlowBank(root, GEO.tube, 128);
    const crystals = new GlowBank(root, GEO.box, 2);

    // 0: bottom lasers, vertical beams under the glass floor
    for (const z of [-15, -25, -35]) {
      for (const s of [-1, 1]) groups[0].push(tubes.tube(V(s * 5, -0.4, z), V(s * 5, -160, z), 0.09, 4));
    }
    // 1: top lasers along the stage
    for (const [x, y] of [[-16, 10], [-7, 10], [0, 7], [7, 10], [16, 10]]) groups[1].push(tubes.tube(V(x, y, 40), V(x, y, -280), 0.09, 4));

    // 2 / 3: rotating lasers rising from the emitter bars, tilted toward the centre
    const lasers = { left: [], right: [] };
    const tilt = (55 * Math.PI) / 180;
    const rig = new Rig();
    for (const [type, s, list] of [[2, -1, lasers.left], [3, 1, lasers.right]]) {
      for (let i = 0; i < 7; i++) {
        const { pivot, light } = rotatingLaser(root, rig, tubes, V(s * 17, 0.35, -36 - i * 3), -s * tilt, 220, 0.07);
        groups[type].push(light);
        list.push(pivot);
      }
    }
    // 3: spear crystals (IDs 8 left, 9 right): a flat rhombus inside each arrowhead
    for (const M of spearMatrices) {
      const at = (sx, sy, sz) => new THREE.Matrix4().multiplyMatrices(M, new THREE.Matrix4().makeTranslation(0, -0.3, 0.05))
        .multiply(new THREE.Matrix4().makeScale(sx, sy, sz)).multiply(new THREE.Matrix4().makeRotationZ(Math.PI / 4));
      groups[3].push(crystals.add(at(0.75, 1.4, 0.2), at(1.15, 2.0, 0.35)));
    }

    // 4: wires, chevron, floor sticks
    for (const s of [-1, 1]) groups[4].push(tubes.tube(V(s * 2.5, 0.12, -6), V(s * 2.5, 0.12, -300), 0.04, 3.5));
    {
      const c = V(0, 5, -65);
      const d = new THREE.Vector3(Math.sin(tilt), Math.cos(tilt), 0).multiplyScalar(3.4);
      groups[4].push(tubes.tube(c.clone().sub(d), c.clone().add(V(0, 0.02, 0)), 0.12, 4));
      groups[4].push(tubes.tube(c.clone().add(V(d.x, -d.y, 0)), c.clone().add(V(0, 0.02, 0)), 0.12, 4));
    }
    {
      const r = rng(1902);
      const sticks = [];
      for (let i = 0; i < 76; i++) {
        const side = r() < 0.5 ? -1 : 1;
        const x = side * (4.2 + Math.pow(r(), 1.3) * 21);
        // denser near the player, thinning out to ~95 m
        const z = 4.5 - Math.pow(r(), 1.35) * 100;
        sticks.push({ x, z, tall: r() < 0.62 });
      }
      sticks.sort((a, b) => b.z - a.z);
      for (const st of sticks) {
        const len = st.tall ? 1.5 : 0.75;
        // lying or leaning: random heading, elevation 10°..70°
        const head = r() * Math.PI * 2;
        const elev = ((10 + r() * 60) * Math.PI) / 180;
        const dir = V(Math.cos(head) * Math.cos(elev), Math.sin(elev), Math.sin(head) * Math.cos(elev));
        const base = V(st.x, st.z > -6 ? -0.05 : 0.0, st.z);
        if (st.z > -6) base.y = -0.15 - r() * 0.6; // in front of the stage: floating just below the edge
        groups[4].push(tubes.tube(base, base.clone().addScaledVector(dir, len), 0.035, 3.5));
      }
    }

    rig.update(true);
    const banks = [...tubes.banks, ...crystals.banks];
    return {
      root,
      banks,
      groups,
      rings: [],
      lasers,
      update() {
        rig.update();
      },
      dispose() {
        for (const g of owned) g.dispose();
        tubes.dispose();
        crystals.dispose();
        Object.values(mats).forEach((m) => m.dispose());
        root.removeFromParent();
      },
    };
  },
};
