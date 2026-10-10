// Minimal example of an environment module (see CONTRACT.md). Not a real environment.
import { THREE, LightBank, MeshLight, GEO, tubeMatrix, trs, mergeStatic, sceneryMaterials, lightMaterial } from './kit.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

export default {
  name: '_ExampleEnvironment',
  label: 'Example',
  colors: { left: '#c81e1e', right: '#2a8fe0', envLeft: '#c81e1e', envRight: '#2a8fe0', wall: '#ff3030' },
  build() {
    const root = new THREE.Group();
    const mats = sceneryMaterials();
    const owned = [];
    // static scenery: two side towers, merged into one draw call
    const towers = [-1, 1].map((s) => {
      const m = new THREE.Mesh(GEO.box, mats.dark);
      m.position.set(s * 9, 6, -30);
      m.scale.set(1.5, 12, 1.5);
      return m;
    });
    const tower = mergeStatic(towers, mats.dark);
    root.add(tower);
    owned.push(tower.geometry);

    // all tube lights share one bank (one draw call)
    const bank = new LightBank(root, GEO.tube, 64);
    const groups = { 0: [], 1: [], 2: [], 3: [], 4: [] };
    // 0: back lasers fanned behind
    for (let i = 0; i < 8; i++) {
      const x = (i - 3.5) * 3;
      groups[0].push(bank.add(tubeMatrix(V(x, 0, -70), V(x * 1.6, 30, -75), 0.12)));
    }
    // 4: centre strips under the runway edges
    for (const s of [-1, 1]) groups[4].push(bank.add(tubeMatrix(V(s * 1.15, 0.02, 0), V(s * 1.15, 0.02, -40), 0.03)));

    // 2 / 3: rotating side lasers (each on its own pivot, so MeshLight)
    const lasers = { left: [], right: [] };
    for (const [type, s, list] of [[2, -1, lasers.left], [3, 1, lasers.right]]) {
      for (let i = 0; i < 4; i++) {
        const pivot = new THREE.Group();
        pivot.position.set(s * 6, 0.5, -18 - i * 8);
        pivot.userData.axis = 'z';
        const beam = new THREE.Mesh(GEO.tube, lightMaterial());
        beam.scale.set(0.06, 40, 0.06);
        beam.position.y = 20;
        pivot.add(beam);
        root.add(pivot);
        groups[type].push(new MeshLight(beam));
        list.push(pivot);
        owned.push(beam.material);
      }
    }

    // 1: rings of 4 light bars each; ring objects rotate, their lights are a bank inside each ring
    const ringObjects = [];
    const ringBanks = [];
    for (let r = 0; r < 10; r++) {
      const ring = new THREE.Group();
      ring.position.set(0, 3, -30 - r * 3);
      const rb = new LightBank(ring, GEO.box, 4);
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2;
        groups[1].push(rb.add(trs([Math.cos(a) * 7, Math.sin(a) * 7, 0], [0, 0, a + Math.PI / 2], [4, 0.12, 0.12])));
      }
      root.add(ring);
      ringObjects.push(ring);
      ringBanks.push(rb); // one bank per ring (it rotates with its ring): 1 draw call each
    }
    const banks = [bank, ...ringBanks];
    return {
      root,
      banks,
      groups,
      rings: [{ type: 'big', objects: ringObjects, step: 6, zoom: { near: 1.5, far: 3 } }],
      lasers,
      dispose() {
        for (const o of owned) o.dispose();
        for (const b of banks) b.dispose();
        Object.values(mats).forEach((m) => m.dispose());
      },
    };
  },
};
