// FitBeat environment — our own recreation from simple shapes (no game assets).
// Look: a long tunnel in the dark: a tight twisting tunnel of square frames ahead of the player with
// thin laser bars along their top / bottom edges, a much larger tunnel of diamond (45°) frames whose
// very long edge lasers form the big "X" of parallel lines, rotating lasers rising from both sides,
// and a small chevron floating over the far end of the runway.
//
// Event groups (v2 basic events) and light counts — ID order: approximate. No official light-ID
// table was found; the layout follows the BSMG wiki description ("ring lasers, outer lasers,
// left & right lasers, chevron"; spin + ring zoom; laser speed) and the ring/light layout of the
// community viewers ArcViewer / ChroMapper (used only as reference for which group drives what).
//   0  ring lasers   30  small-ring tunnel, ring k (front → back): id 2k+1 = top bar, 2k+2 = bottom bar
//   1  outer lasers  30  big diamond rings, ring k (front → back): id 2k+1 = upper edge, 2k+2 = lower edge
//   2  left lasers    8  rotating lasers on the left, front → back
//   3  right lasers   8  rotating lasers on the right, front → back
//   4  chevron        2  1 = left arm, 2 = right arm
// rings: small × 15 (spin + zoom), big × 15 (spin). lasers: 8 + 8 (tilted beams spinning around Y).
// (In the game the back-top ring lasers show the opposite colour; the runtime decides colours, so not reproduced.)
import { THREE, GEO, trs, mergeStatic, sceneryMaterials } from './kit.js';
import { V, GlowBank, PropBank, Followers } from './_cKit.js';

const SMALL_N = 15;
const SMALL_Z0 = -17;
const SMALL_DZ = 1.75;
const SMALL_Y = 1.6;
const SMALL_R = 4.2; // half size of the small square frames
const BIG_N = 15;
const BIG_Z0 = -9;
const BIG_DZ = 10;
const BIG_Y = 3.2;
const BIG_R = 10; // distance of the diamond edges from the centre
const YAW = THREE.MathUtils.degToRad(15); // laser bars are yawed slightly out of the ring plane
const YAW_C = Math.cos(YAW);
const YAW_S = Math.sin(YAW);

export default {
  name: 'FitBeatEnvironment',
  label: 'FitBeat',
  colors: {
    left: '#cc9b28',
    right: '#ca29ae',
    envLeft: '#cc8f8f',
    envRight: '#8f8fcc',
    wall: '#474766',
  },
  build() {
    const root = new THREE.Group();
    root.name = 'FitBeatEnvironment';
    const mats = sceneryMaterials();
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x24222e, roughness: 0.5, metalness: 0.6 });
    const follow = new Followers();
    const m = new THREE.Matrix4();

    // one glow bank (core + halo) for every light = 2 draw calls
    const glow = new GlowBank(root, GEO.tube, 160, { halo: 3.2, haloOpacity: 0.16 });
    // ring frames (instanced boxes that follow the ring pivots) = 1 draw call
    const frames = new PropBank(root, GEO.box, frameMat, 4 * (SMALL_N + BIG_N) + 8);
    const groups = { 0: [], 1: [], 2: [], 3: [], 4: [] };

    const addFollowedTube = (pivots, a, b, r, list) => list.push(glow.tubeFollow(follow, pivots, a, b, r));
    const addFrame = (pivot, half, thick, rot = 0) => {
      // a square frame of 4 boxes in the pivot's XY plane (rotated by rot around Z)
      for (let s = 0; s < 4; s++) {
        const a = rot + (s * Math.PI) / 2;
        const cx = Math.cos(a) * half;
        const cy = Math.sin(a) * half;
        trs([cx, cy, 0], [0, 0, a], [thick, half * 2 + thick, thick], m);
        follow.add(frames, frames.add(m), pivot, m);
      }
    };

    // small twisting tunnel: rings of square frames, with laser bars along top & bottom (group 0)
    const small = [];
    for (let k = 0; k < SMALL_N; k++) {
      const ring = new THREE.Group();
      ring.position.set(0, SMALL_Y, SMALL_Z0 - k * SMALL_DZ);
      root.add(ring);
      small.push(ring);
      addFrame(ring, SMALL_R, 0.22);
      const L = SMALL_R * 2.6;
      for (const sy of [1, -1]) {
        const y = sy * (SMALL_R - 0.35);
        addFollowedTube(ring, V(-L * YAW_C, y, L * YAW_S * sy), V(L * YAW_C, y, -L * YAW_S * sy), 0.035, groups[0]);
      }
    }

    // big diamond tunnel (45°): very long edge lasers (group 1) -> the big X
    const big = [];
    const d45 = Math.PI / 4;
    const roll45 = (v) => v.set(v.x * Math.cos(d45) - v.y * Math.sin(d45), v.x * Math.sin(d45) + v.y * Math.cos(d45), v.z);
    for (let k = 0; k < BIG_N; k++) {
      const ring = new THREE.Group();
      ring.position.set(0, BIG_Y, BIG_Z0 - k * BIG_DZ);
      root.add(ring);
      big.push(ring);
      addFrame(ring, BIG_R, 0.6, d45);
      const L = 70;
      for (const s of [1, -1]) {
        // top / bottom edge of the (pre-roll) square, yawed a little so the far ends recede,
        // then rolled 45° with the diamond
        const y = s * BIG_R * 0.94;
        const a = roll45(V(-L * YAW_C, y, L * YAW_S * s));
        const b = roll45(V(L * YAW_C, y, -L * YAW_S * s));
        addFollowedTube(ring, a, b, 0.06, groups[1]);
      }
    }

    // rotating lasers (groups 2 / 3): beams rising from below both sides of the runway
    const lasers = { left: [], right: [] };
    for (const [type, side, list] of [[2, -1, lasers.left], [3, 1, lasers.right]]) {
      for (let i = 0; i < 8; i++) {
        const pivot = new THREE.Group();
        pivot.position.set(side * 7.5, -2.5, -20 - i * 6);
        pivot.rotation.y = side * 0.5;
        pivot.userData.axis = 'y'; // tilted beam spinning around Y sweeps a cone, always upward
        root.add(pivot);
        list.push(pivot);
        groups[type].push(glow.tubeFollow(follow, pivot, V(0, 0, 0), V(-side * 90 * Math.sin(0.45), 90 * Math.cos(0.45), 0), 0.05));
      }
    }

    // chevron (group 4) over the far end of the runway
    {
      const cz = -62;
      const cy = 4.2;
      groups[4].push(glow.tube(V(-1.3, cy - 0.8, cz), V(0, cy + 0.15, cz), 0.07));
      groups[4].push(glow.tube(V(1.3, cy - 0.8, cz), V(0, cy + 0.15, cz), 0.07));
    }

    // static scenery: leaning side pillars + a dark floor slab far below (merged, 1 draw call)
    const parts = [];
    for (const side of [-1, 1]) {
      for (let i = 0; i < 9; i++) {
        const p = new THREE.Mesh(GEO.box, mats.dark);
        p.position.set(side * 13, 4, -14 - i * 14);
        p.rotation.z = side * 0.35;
        p.scale.set(1.2, 26, 1.2);
        parts.push(p);
      }
    }
    const floor = new THREE.Mesh(GEO.box, mats.dark);
    floor.position.set(0, -9, -60);
    floor.scale.set(80, 0.5, 160);
    parts.push(floor);
    const scenery = mergeStatic(parts, mats.dark);
    root.add(scenery);

    follow.update(true);
    const banks = [...glow.banks, frames];
    return {
      root,
      banks,
      groups,
      rings: [
        { type: 'small', objects: small, step: 4, zoom: { near: 1.0, far: SMALL_DZ } },
        { type: 'big', objects: big, step: 2, zoom: { near: BIG_DZ, far: BIG_DZ } },
      ],
      lasers,
      update() {
        follow.update();
      },
      dispose() {
        glow.dispose();
        frames.dispose();
        scenery.geometry.dispose();
        frameMat.dispose();
        Object.values(mats).forEach((x) => x.dispose());
      },
    };
  },
};
