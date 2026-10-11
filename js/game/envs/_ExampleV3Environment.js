// Minimal example of a v3 (group lighting) environment module (see CONTRACT.md). Not a real environment.
// Group 0: 8 tilting beams (rotation z), group 1: 6 bars that move up / down (translation y).
import { THREE, MeshLight, GEO, lightMaterial } from './kit.js';

export default {
  name: '_ExampleV3Environment',
  label: 'Example v3',
  colors: { left: '#c81e1e', right: '#2a8fe0', envLeft: '#c81e1e', envRight: '#2a8fe0', wall: '#ff3030' },
  build() {
    const root = new THREE.Group();
    const owned = [];
    const beam = (len, r) => {
      const m = new THREE.Mesh(GEO.tube, lightMaterial());
      m.scale.set(r, len, r);
      m.position.y = len / 2;
      owned.push(m.material);
      return m;
    };
    // group 0: beams on pivots fanned across the back
    const g0 = { lights: [], rotation: { z: [], mirror: { z: false } } };
    for (let i = 0; i < 8; i++) {
      const pivot = new THREE.Group();
      pivot.position.set((i - 3.5) * 4, 0, -50);
      const b = beam(30, 0.15);
      pivot.add(b);
      root.add(pivot);
      g0.lights.push(new MeshLight(b));
      g0.rotation.z.push(pivot);
    }
    // group 1: horizontal bars over the runway that slide vertically
    const g1 = { lights: [], translation: { y: [], scale: 2 } };
    for (let i = 0; i < 6; i++) {
      const holder = new THREE.Group();
      holder.position.set(0, 6, -15 - i * 6);
      const b = beam(12, 0.08);
      b.rotation.z = Math.PI / 2;
      b.position.set(0, 0, 0);
      holder.add(b);
      root.add(holder);
      g1.lights.push(new MeshLight(b));
      g1.translation.y.push(holder);
    }
    return {
      root,
      banks: [],
      groups: {},
      lightGroups: { 0: g0, 1: g1 },
      dispose() {
        for (const o of owned) o.dispose();
      },
    };
  },
};
