// Monstercat 2.0 environment (Monstercat Mixtape 2) — our own recreation from simple shapes
// (no game assets, no logo artwork: the cat head is a simple outline of our own).
// Look: a dark hall; the runway is flanked by rows of low dark domes standing in glowing floor
// rings; leaning columns of LED grid panels line both sides; big angled screens with wave lines
// float further out; chains of small square screens arc overhead; a ring of lasers hangs above
// the track; vertical lasers stand beside the track and at the far end, where a huge cat head
// (ears, headphones, eyes, mouth) looks back at the player.
//
// v3 light groups (id → what, elements, rotation / translation axes). Ids, names, counts and
// colour / transform / fx flags: bsmap (KivalEvan, environment + renamer tables); usage checked
// against Monstercat 2 maps on BeatSaver (4b5c9, 46ee6). Element order and geometry: ours
// (index 0 = nearest the player).
//   0   head move                     1  head outline (ears, face, headphones)      rot xyz, tra xyz
//   11 / 12 head lights L / R         3  eye strokes (outer → inner)                (colour only)
//   13  head lights mouth             1  mouth                                      (colour only)
//   1 / 3   light pillars L / R      32  LED panel 4g … 4g+3 of column g (bottom → top) rot, tra xyz
//   2 / 4   light pillars group L / R 8  (no light) column g                       rot x z, tra xyz
//   5 / 7   objects screens L / R     4  (no light) big screen i                    rot xyz, tra xyz
//   6 / 8   objects screens L / R color 8  2i frame, 2i+1 wave lines of screen i    (colour only)
//   16 / 17 objects screens runway rings L / R 16  floor ring i beside the runway   (colour only)
//   9   lasers circle global          1  (no light) the laser ring                  rot xyz, tra xyz
//   10  lasers circle                20  laser i around the ring                    rot x y, tra z
//   14 / 15 lasers vertical end L / R 4  vertical lasers at the far end, inner → outer rot, tra xyz
//   19 / 20 lasers vertical side L / R 4 vertical lasers beside the track           rot xyz, tra xyz
//   21 / 27 screens small left 1 / 2 color   32  2j frame, 2j+1 fill of small screen j (colour)
//   24 / 30 screens small right 1 / 2 color  32  same, right side                   (colour only)
//   22 / 28 / 25 / 31 screens small … local  16  (no light) small screen j          rot xyz, tra xyz
//   23 / 29 / 26 / 32 screens small … global 16  (no light) outer pivot of screen j rot xyz, tra xyz
//   fx: 18 objects teeth (1) — stored only.
// Basic events: 6 (light) → background haze glow. Event 8 (used by maps, meaning undocumented)
// has no effect here.
// Approximate: all positions / sizes and the head shape; the screens' animated content is a
// fixed pattern; element order inside groups.
import { THREE, GEO, GlowBank, LightBank, PropBank, Rig, V, SoftGlow, trs, rng, mergeAll, stdMat, lightMaterial } from './kit.js';
import { pivot, lightGroup, addPivot, multi, fxGroup, starField, disposeAll, rigPolyline, ringGeometry } from './_v4common.js';

const HEAD_Z = -118;
const HEAD_Y = 13;

/** LED grid panel: cols × rows filled cells in a unit square (XY plane, centred), for a LightBank. */
function gridPanelGeometry(cols, rows, gap = 0.18) {
  const parts = [];
  const cw = 1 / cols;
  const ch = 1 / rows;
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      parts.push(new THREE.PlaneGeometry(cw * (1 - gap), ch * (1 - gap)).translate(-0.5 + cw * (i + 0.5), -0.5 + ch * (j + 0.5), 0));
    }
  }
  return mergeAll(parts);
}

/** Square outline of four thin quads (unit square, XY plane), for a LightBank. */
function squareFrameGeometry(w = 0.1) {
  const parts = [];
  for (const [x, y, sx, sy] of [[0, 0.5 - w / 2, 1, w], [0, -0.5 + w / 2, 1, w], [0.5 - w / 2, 0, w, 1 - 2 * w], [-0.5 + w / 2, 0, w, 1 - 2 * w]]) {
    parts.push(new THREE.PlaneGeometry(sx, sy).translate(x, y, 0));
  }
  return mergeAll(parts);
}

export default {
  name: 'Monstercat2Environment',
  label: 'Monstercat 2.0',
  colors: {
    left: '#DF5885',
    right: '#634D9C',
    envLeft: '#9E0DD3',
    envRight: '#56B61C',
    envLeftBoost: '#B61C1C',
    envRightBoost: '#168CA5',
    wall: '#3B26A3',
  },
  build() {
    const root = new THREE.Group();
    root.name = 'Monstercat2Environment';
    const owned = [];
    const rand = rng(2024);
    const rig = new Rig();
    const all = 'xyz';
    const m = new THREE.Matrix4();
    const LG = {};
    for (const id of [0, 1, 3, 14, 15, 19, 20]) LG[id] = lightGroup(all, all);
    LG[2] = lightGroup('xz', all, { count: 8 });
    LG[4] = lightGroup('xz', all, { count: 8 });
    LG[5] = lightGroup(all, all, { count: 4 });
    LG[7] = lightGroup(all, all, { count: 4 });
    LG[9] = lightGroup(all, all, { count: 1 });
    LG[10] = lightGroup('xy', 'z');
    for (const id of [22, 23, 25, 26, 28, 29, 31, 32]) LG[id] = lightGroup(all, all, { count: 16 });
    for (const id of [6, 8, 11, 12, 13, 16, 17, 21, 24, 27, 30]) LG[id] = lightGroup();

    const glow = new GlowBank(root, GEO.tube, 320, { haloScale: 3, haloOpacity: 0.16 });
    const T = (chain, a, b, r = 0.04) => rig.tube(chain, glow, a, b, r);
    const dark = stdMat(0x121019, { roughness: 0.5, metalness: 0.5 });
    owned.push(dark);
    const props = new PropBank(root, GEO.box, dark, 40, { ownMaterial: true });

    // ---- runway rings (16 / 17) with dark domes (static)
    const ringGeo = ringGeometry(0.88, 40).rotateX(-Math.PI / 2);
    owned.push(ringGeo);
    const rings = new LightBank(root, ringGeo, 32);
    owned.push(rings.mesh.material);
    {
      const parts = [];
      for (const [s, id] of [[-1, 16], [1, 17]]) {
        for (let i = 0; i < 16; i++) {
          const x = s * 3.4;
          const z = -10 - i * 6;
          LG[id].lights.push(rings.add(trs([x, 0.03, z], [0, 0, 0], [1.45, 1, 1.45], m)));
          parts.push(new THREE.SphereGeometry(1.05, 12, 5, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.7, 1).translate(x, 0, z));
        }
      }
      // floor slabs either side of the runway
      for (const s of [-1, 1]) parts.push(new THREE.BoxGeometry(5, 0.4, 104).translate(s * 3.9, -0.21, -52));
      const mesh = new THREE.Mesh(mergeAll(parts), dark);
      mesh.matrixAutoUpdate = false;
      root.add(mesh);
      owned.push(mesh);
    }

    // ---- light pillars: column g (2 / 4) → 4 LED panels (1 / 3)
    const panelGeo = gridPanelGeometry(3, 4);
    owned.push(panelGeo);
    const panels = new LightBank(root, panelGeo, 64);
    owned.push(panels.mesh.material);
    for (const [s, pid, gid] of [[-1, 1, 2], [1, 3, 4]]) {
      for (let g = 0; g < 8; g++) {
        const cp = addPivot(LG[gid], pivot(root, s * 9.5, -0.5, -12 - g * 11, 0, s * 0.35, -s * 0.42));
        rig.attach([cp], props, trs([s * 0.35, 6, 0], [0, 0, 0], [0.5, 13, 1.6], m));
        for (let q = 0; q < 4; q++) {
          const lp = addPivot(LG[pid], pivot(cp, -s * 0.05, 2 + q * 3, 0, 0, -s * Math.PI / 2, 0));
          LG[pid].lights.push(rig.light([cp, lp], panels, trs([0, 0, 0], [0, 0, 0], [1.9, 2.6, 1], m)));
        }
      }
    }

    // ---- big screens (5 / 7 pivots, 6 / 8 colour: frame + wave lines)
    for (const [s, pid, cid] of [[-1, 5, 6], [1, 7, 8]]) {
      for (let i = 0; i < 4; i++) {
        const p = addPivot(LG[pid], pivot(root, s * 19, 6 + (i % 2) * 2.5, -22 - i * 22, 0.08, -s * 0.95, s * 0.12));
        const W = 5.5;
        const H = 3;
        rig.attach([p], props, trs([0, 0, -0.15], [0, 0, 0], [2 * W, 2 * H, 0.2], m));
        LG[cid].lights.push(rigPolyline(rig, [p], glow, [V(-W, -H, 0), V(W, -H, 0), V(W, H, 0), V(-W, H, 0)], 0.07));
        const waves = [];
        for (let w = 0; w < 3; w++) {
          const pts = [];
          const ph = rand() * 6;
          for (let u = 0; u <= 6; u++) {
            const x = -W * 0.85 + (1.7 * W * u) / 6;
            pts.push(V(x, -H * 0.55 + w * H * 0.55 + Math.sin(ph + u * 2.1) * 0.35, 0.05));
          }
          waves.push(rigPolyline(rig, [p], glow, pts, 0.035, false));
        }
        LG[cid].lights.push(multi(waves));
      }
    }

    // ---- small screens: 4 sets of 16 (global → local), frame + fill each
    const frameGeo = squareFrameGeometry(0.12);
    const fillGeo = new THREE.PlaneGeometry(0.62, 0.62);
    owned.push(frameGeo, fillGeo);
    const frames = new LightBank(root, frameGeo, 64);
    const fills = new LightBank(root, fillGeo, 64, { material: lightMaterial({ opacity: 0.6 }) });
    owned.push(frames.mesh.material, fills.mesh.material);
    for (const [s, set, cid, lid, gid] of [[-1, 0, 21, 22, 23], [1, 0, 24, 25, 26], [-1, 1, 27, 28, 29], [1, 1, 30, 31, 32]]) {
      for (let j = 0; j < 16; j++) {
        // an arc rising from the side toward the middle, set 2 further away and lower
        const t = j / 15;
        const a = (set ? 0.15 : 0.25) + t * 1.15;
        const R = set ? 13 : 11;
        const x = s * (Math.cos(a) * R + 1);
        const y = 3 + Math.sin(a) * R * 0.75;
        const z = (set ? -78 : -44) - t * 6;
        const gp = addPivot(LG[gid], pivot(root, x, y, z, 0, 0, -s * a * 0.6));
        const lp = addPivot(LG[lid], pivot(gp));
        const sz = 1.25;
        LG[cid].lights.push(rig.light([gp, lp], frames, trs([0, 0, 0], [0, 0, 0], [sz, sz, 1], m)));
        LG[cid].lights.push(rig.light([gp, lp], fills, trs([0, 0, -0.02], [0, 0, 0], [sz, sz, 1], m)));
      }
    }

    // ---- laser ring (9 global, 10 lasers): chords of a circle above the track → a star
    {
      const ring = addPivot(LG[9], pivot(root, 0, 15, -62));
      const R = 7;
      for (let i = 0; i < 20; i++) {
        const a = (i / 20) * Math.PI * 2;
        const b = a + Math.PI * 0.8;
        const p = addPivot(LG[10], pivot(ring, Math.cos(a) * R, Math.sin(a) * R, 0));
        const dir = V(Math.cos(b) * R - Math.cos(a) * R, Math.sin(b) * R - Math.sin(a) * R, 0).multiplyScalar(2.2);
        LG[10].lights.push(T([ring, p], V(0, 0, 0), dir, 0.035));
      }
    }

    // ---- vertical lasers: end (14 / 15) and side (19 / 20)
    for (const [s, eid, sid] of [[-1, 14, 19], [1, 15, 20]]) {
      for (let i = 0; i < 4; i++) {
        const pe = addPivot(LG[eid], pivot(root, s * (6 + i * 3.5), -2, HEAD_Z + 6 - i * 2));
        LG[eid].lights.push(T([pe], V(0, 0, 0), V(0, 50, 0), 0.05));
        const ps = addPivot(LG[sid], pivot(root, s * 6.2, -1, -24 - i * 16));
        LG[sid].lights.push(T([ps], V(0, 0, 0), V(0, 30, 0), 0.04));
      }
    }

    // ---- the head (0) with eyes (11 / 12) and mouth (13)
    {
      const head = addPivot(LG[0], pivot(root, 0, HEAD_Y, HEAD_Z));
      const c = [head];
      const R = 8.5;
      const face = [];
      // face outline: lower circle part + two pointed ears
      for (let i = 0; i <= 14; i++) {
        const a = Math.PI * (1.15 + (0.7 * i) / 14); // bottom arc
        face.push(V(Math.cos(a) * R, Math.sin(a) * R * 0.9, 0));
      }
      face.push(V(R * 0.95, R * 0.35, 0), V(R * 0.85, R * 1.25, 0), V(R * 0.35, R * 0.75, 0), V(-R * 0.35, R * 0.75, 0), V(-R * 0.85, R * 1.25, 0), V(-R * 0.95, R * 0.35, 0));
      const parts = [rigPolyline(rig, c, glow, face, 0.12)];
      // headphones: arcs + cups on both sides
      for (const s of [-1, 1]) {
        const arc = [];
        for (let i = 0; i <= 6; i++) {
          const a = Math.PI * (0.5 - s * 0.5) + s * (Math.PI * (-0.35 + (0.7 * i) / 6));
          arc.push(V(Math.cos(a) * R * 1.18, Math.sin(a) * R * 1.05, 0.2));
        }
        parts.push(rigPolyline(rig, c, glow, arc, 0.13, false));
      }
      LG[0].lights.push(multi(parts));
      for (const [s, id] of [[-1, 11], [1, 12]]) {
        // angry eye: three strokes, outer → inner
        const ex = s * R * 0.42;
        const k = R / 6;
        LG[id].lights.push(T(c, V(ex + s * 1.3 * k, 0.9 * k, 0.1), V(ex + s * 0.2 * k, 0.2 * k, 0.1), 0.16));
        LG[id].lights.push(T(c, V(ex + s * 0.2 * k, 0.2 * k, 0.1), V(ex - s * 0.9 * k, 0.2 * k, 0.1), 0.16));
        LG[id].lights.push(T(c, V(ex + s * 1.3 * k, -0.4 * k, 0.1), V(ex - s * 0.9 * k, -0.4 * k, 0.1), 0.12));
      }
      const mouth = [[-1.8, -2.4], [-0.9, -3.0], [0, -2.5], [0.9, -3.0], [1.8, -2.4]].map(([x, y]) => V((x * R) / 6, (y * R) / 6, 0.1));
      LG[13].lights.push(rigPolyline(rig, c, glow, mouth, 0.11, false));
      // dark face plate behind the lights
      rig.attach(c, props, trs([0, 0.6, -0.6], [0, 0, 0], [R * 1.9, R * 1.9, 0.4], m));
    }

    // ---- stars + basic event 6 haze
    owned.push(starField(root, rng(3), 700, 140, 260, { size: 0.6, color: 0x8a86a0 }));
    const haze = new SoftGlow(root, 380, 200, V(0, 12, HEAD_Z - 100), { gain: 0.25, power: 1.4 });
    owned.push(haze);

    const fx = { 18: fxGroup(1) };
    rig.update(true);
    return {
      root,
      banks: [...glow.banks, props, rings, panels, frames, fills],
      groups: { 6: [haze] },
      lightGroups: LG,
      fx,
      background: 0x040309,
      update() {
        rig.update();
      },
      dispose() {
        glow.dispose();
        for (const b of [props, rings, panels, frames, fills]) b.dispose();
        disposeAll(owned);
      },
    };
  },
};
