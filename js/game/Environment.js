import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { COLOR_LEFT, COLOR_RIGHT } from './constants.js';
import { envLightCounts } from './lightIds.js';
import { ChromaLighting } from './ChromaLighting.js';

// Light groups driven by basic beatmap events:
// 0 back lasers, 1 ring lights, 2 left lasers, 3 right lasers, 4 center lights
const GROUPS = 5;

// Individually addressable lights per group (Chroma light IDs are mapped onto these):
// 9 back beams (the horizon bar follows the brightest), 12 rings, 4 + 4 side lasers,
// 8 runway strip segments (left / right alternating, near to far)
const LIGHTS = [9, 12, 4, 4, 8];
const RUNWAY_SEGMENTS = 4; // per side

const _m = new THREE.Matrix4();

/** Bakes each mesh's transform into a copy of its geometry and merges them (static, same material). */
function mergeStatic(meshes) {
  const parts = meshes.map((m) => {
    m.updateMatrix();
    return m.geometry.clone().applyMatrix4(m.matrix);
  });
  const merged = mergeGeometries(parts, false);
  for (const g of parts) g.dispose();
  return merged;
}

/** Freezes an object's matrix (it never moves): skips recomposing it every frame. */
function freeze(o) {
  o.updateMatrix();
  o.matrixAutoUpdate = false;
  return o;
}

/** Vertex ranges [start, end) of each part once merged, in order. */
function vertexRanges(meshes) {
  const out = [];
  let v = 0;
  for (const m of meshes) {
    const n = m.geometry.attributes.position.count;
    out.push([v, v + n]);
    v += n;
  }
  return out;
}

/** White per-vertex colours (multiplied with the material colour). */
function addWhiteColors(geo) {
  const n = geo.attributes.position.count;
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
  return geo;
}

function whiteInstanceColors(mesh) {
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(mesh.count * 3).fill(1), 3);
}

class LightGroup {
  constructor() {
    this.materials = [];
    this.color = new THREE.Color(0, 0, 0);
    this.key = 'R';
    this.intensity = 0;
    this.mode = 'off';
    this.modeTime = 0;
    this.brightness = 1;
  }
}

export class Environment {
  constructor(scene) {
    this.scene = scene;
    this.root = new THREE.Group();
    scene.add(this.root);
    this.colors = {
      left: new THREE.Color(COLOR_LEFT),
      right: new THREE.Color(COLOR_RIGHT),
      leftBoost: new THREE.Color(COLOR_LEFT),
      rightBoost: new THREE.Color(COLOR_RIGHT),
      white: new THREE.Color(0xffffff),
      whiteBoost: new THREE.Color(0xffffff),
    };
    this.boost = false;
    this.groups = Array.from({ length: GROUPS }, () => new LightGroup());
    this.laserSpeed = [0, 0];
    this.ringSpin = 0;
    this.ringSpinVel = 0;
    this.ringZoom = 1;
    this.ringZoomTarget = 1;
    this.eventIdx = 0;
    this.events = [];
    this.chromaOn = false; // Chroma lighting for the current map (false: group lighting as before)

    scene.background = new THREE.Color(0x04040a);
    scene.fog = new THREE.Fog(0x04040a, 25, 110);

    // Ambient lighting for the notes
    scene.add(new THREE.HemisphereLight(0x8899ff, 0x221122, 1.4));
    const dir = new THREE.DirectionalLight(0xffffff, 1.6);
    dir.position.set(0, 4, 3);
    scene.add(dir);

    this.buildFloor();
    this.buildTrack();
    this.buildLasers();
    this.buildRings();
    this.buildBackLasers();
    this.buildStars();
    this.setIdle();
    // Chroma lighting runtime driving our lights / rings / lasers
    this.chroma = new ChromaLighting(this.buildChromaTarget(), this.colors);
  }

  mat(group, vertexColors = false) {
    const m = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, vertexColors });
    this.groups[group].materials.push(m);
    return m;
  }

  buildFloor() {
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(400, 400),
      new THREE.MeshStandardMaterial({ color: 0x07070d, roughness: 0.9, metalness: 0.1 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.02;
    this.root.add(freeze(floor));
    const grid = new THREE.GridHelper(200, 100, 0x18183a, 0x101024);
    grid.position.y = -0.01;
    this.root.add(freeze(grid));
  }

  buildTrack() {
    // Player platform
    const platform = new THREE.Mesh(
      new THREE.BoxGeometry(2.6, 0.1, 2.6),
      new THREE.MeshStandardMaterial({ color: 0x15151f, roughness: 0.4, metalness: 0.6 }),
    );
    platform.position.set(0, -0.05, 0);
    this.root.add(freeze(platform));
    const edge = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(2.6, 0.1, 2.6)),
      new THREE.LineBasicMaterial({ color: 0x5577ff }),
    );
    edge.position.copy(platform.position);
    this.root.add(freeze(edge));

    // Runway with neon edges (center lights)
    const runway = new THREE.Mesh(
      new THREE.PlaneGeometry(2.4, 140),
      new THREE.MeshStandardMaterial({ color: 0x0b0b14, roughness: 0.6, metalness: 0.4 }),
    );
    runway.rotation.x = -Math.PI / 2;
    runway.position.set(0, 0.001, -70 - 1.3);
    this.root.add(freeze(runway));
    // runway edge strips: static, so merged into one mesh (one draw call)
    const stripGeo = new THREE.BoxGeometry(0.04, 0.02, 140);
    const plain = [-1.22, 1.22].map((x) => {
      const s = new THREE.Mesh(stripGeo);
      s.position.set(x, 0.01, -70 - 1.3);
      return s;
    });
    this.runwayPlain = addWhiteColors(mergeStatic(plain));
    stripGeo.dispose();
    // Chroma lights the strips segment by segment: a second geometry with each strip made of
    // segments (without the inner end caps, so it still looks like one long strip)
    const segLen = 140 / RUNWAY_SEGMENTS;
    const strips = [];
    for (let i = 0; i < LIGHTS[4]; i++) {
      const side = i % 2;
      const seg = i >> 1; // 0 = nearest
      const geo = new THREE.BoxGeometry(0.04, 0.02, segLen);
      // BoxGeometry faces: +x, -x, +y, -y, +z (near end), -z (far end); 6 indices each
      const idx = Array.from(geo.index.array);
      const keep = [];
      for (let f = 0; f < 6; f++) {
        if (f === 4 && seg > 0) continue;
        if (f === 5 && seg < RUNWAY_SEGMENTS - 1) continue;
        keep.push(...idx.slice(f * 6, f * 6 + 6));
      }
      geo.setIndex(keep);
      const s = new THREE.Mesh(geo);
      s.position.set(side === 0 ? -1.22 : 1.22, 0.01, -1.3 - segLen * (seg + 0.5));
      strips.push(s);
    }
    this.runwayRanges = vertexRanges(strips);
    this.runwaySegments = addWhiteColors(mergeStatic(strips));
    for (const s of strips) s.geometry.dispose();
    this.runwayMesh = freeze(new THREE.Mesh(this.runwayPlain, this.mat(4, true)));
    this.root.add(this.runwayMesh);
    // lane separators (dim, static, merged)
    const laneMat = new THREE.MeshBasicMaterial({ color: 0x1a1a40 });
    const laneGeo = new THREE.BoxGeometry(0.01, 0.005, 140);
    const lanes = [-0.6, 0, 0.6].map((x) => {
      const s = new THREE.Mesh(laneGeo);
      s.position.set(x, 0.005, -71.3);
      return s;
    });
    this.root.add(freeze(new THREE.Mesh(mergeStatic(lanes), laneMat)));
    laneGeo.dispose();
  }

  buildLasers() {
    // Left/right rotating lasers (groups 2 & 3): one instanced mesh per side.
    // `pivot` objects only hold each beam's transform (they are not in the scene).
    this.lasers = [[], []];
    this.laserMeshes = [];
    const geo = new THREE.CylinderGeometry(0.05, 0.05, 120, 6, 1, true);
    geo.translate(0, 60, 0);
    for (let side = 0; side < 2; side++) {
      const sign = side === 0 ? -1 : 1;
      const mesh = new THREE.InstancedMesh(geo, this.mat(2 + side), LIGHTS[2 + side]);
      mesh.frustumCulled = false; // beams sweep around; always roughly in view
      whiteInstanceColors(mesh);
      for (let i = 0; i < mesh.count; i++) {
        const pivot = new THREE.Object3D();
        pivot.position.set(sign * (12 + i * 3), 0, -30 - i * 12);
        pivot.userData.phase = i * 0.7;
        pivot.userData.sign = sign;
        this.lasers[side].push(pivot);
      }
      this.laserMeshes.push(mesh);
      this.root.add(mesh);
    }
    this.syncLasers();
  }

  syncLasers() {
    for (let side = 0; side < 2; side++) {
      const mesh = this.laserMeshes[side];
      const pivots = this.lasers[side];
      for (let i = 0; i < pivots.length; i++) {
        pivots[i].updateMatrix();
        mesh.setMatrixAt(i, pivots[i].matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  buildRings() {
    // Square rings around the runway (group 1)
    this.rings = [];
    const t = 0.12;
    const size = 14;
    const shape = new THREE.Shape();
    shape.moveTo(-size / 2, -size / 2);
    shape.lineTo(size / 2, -size / 2);
    shape.lineTo(size / 2, size / 2);
    shape.lineTo(-size / 2, size / 2);
    shape.closePath();
    const hole = new THREE.Path();
    const s2 = size / 2 - t;
    hole.moveTo(-s2, -s2);
    hole.lineTo(-s2, s2);
    hole.lineTo(s2, s2);
    hole.lineTo(s2, -s2);
    hole.closePath();
    shape.holes.push(hole);
    const geo = new THREE.ShapeGeometry(shape);
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x111118, metalness: 0.8, roughness: 0.3, side: THREE.DoubleSide });
    const frameGeo = new THREE.ShapeGeometry(shape);
    const n = LIGHTS[1];
    // 12 rings = 2 instanced meshes (frames + lights) instead of 24 meshes.
    // `ring` objects only hold each ring's transform (they are not in the scene).
    this.ringFrames = new THREE.InstancedMesh(frameGeo, frameMat, n);
    this.ringLights = new THREE.InstancedMesh(geo, this.mat(1), n);
    whiteInstanceColors(this.ringLights);
    this.ringFrames.frustumCulled = false;
    this.ringLights.frustumCulled = false;
    // the frame sits slightly behind and larger than its light (ring-local transform)
    this.frameLocal = new THREE.Matrix4().compose(new THREE.Vector3(0, 0, -0.05), new THREE.Quaternion(), new THREE.Vector3(1.04, 1.04, 1.04));
    for (let i = 0; i < n; i++) {
      const ring = new THREE.Object3D();
      ring.position.set(0, 5, -25 - i * 6);
      ring.userData.index = i;
      this.rings.push(ring);
    }
    this.root.add(this.ringFrames, this.ringLights);
    this.syncRings();
  }

  syncRings() {
    for (let i = 0; i < this.rings.length; i++) {
      const r = this.rings[i];
      r.updateMatrix();
      this.ringLights.setMatrixAt(i, r.matrix);
      this.ringFrames.setMatrixAt(i, _m.multiplyMatrices(r.matrix, this.frameLocal));
    }
    this.ringLights.instanceMatrix.needsUpdate = true;
    this.ringFrames.instanceMatrix.needsUpdate = true;
  }

  buildBackLasers() {
    // Back lasers (group 0): a fan of beams behind the rings, plus a horizon glow bar.
    // All static with the same material: merged into one mesh (one draw call).
    const geo = new THREE.CylinderGeometry(0.15, 0.15, 160, 6, 1, true);
    geo.translate(0, 80, 0);
    const parts = [];
    for (let i = 0; i < LIGHTS[0]; i++) {
      const beam = new THREE.Mesh(geo);
      beam.position.set(0, -2, -110);
      beam.rotation.z = (i - 4) * 0.22;
      beam.rotation.x = -0.25;
      parts.push(beam);
    }
    const barGeo = new THREE.BoxGeometry(80, 0.3, 0.3);
    const bar = new THREE.Mesh(barGeo);
    bar.position.set(0, 0.3, -105);
    parts.push(bar);
    this.backRanges = vertexRanges(parts); // the last one is the bar
    this.backMesh = freeze(new THREE.Mesh(addWhiteColors(mergeStatic(parts)), this.mat(0, true)));
    this.root.add(this.backMesh);
    geo.dispose();
    barGeo.dispose();
  }

  buildStars() {
    const n = 800;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI * 0.45;
      const r = 150;
      pos[i * 3] = Math.cos(theta) * Math.sin(phi) * r;
      pos[i * 3 + 1] = Math.cos(phi) * r * 0.7 + 10;
      pos[i * 3 + 2] = Math.sin(theta) * Math.sin(phi) * r;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.root.add(freeze(new THREE.Points(g, new THREE.PointsMaterial({ color: 0x8888aa, size: 0.6, fog: false }))));
  }

  setColors(left, right, leftBoost = left, rightBoost = right, white = 0xffffff, whiteBoost = white) {
    this.colors.left.set(left);
    this.colors.right.set(right);
    this.colors.leftBoost.set(leftBoost ?? left);
    this.colors.rightBoost.set(rightBoost ?? right);
    this.colors.white.set(white ?? 0xffffff);
    this.colors.whiteBoost.set(whiteBoost ?? white ?? 0xffffff);
    this.chroma?.markAllDirty();
  }

  /** 'L' | 'R' | 'W' -> current colour, honouring colour boost */
  palette(key) {
    if (key === 'L') return this.boost ? this.colors.leftBoost : this.colors.left;
    if (key === 'R') return this.boost ? this.colors.rightBoost : this.colors.right;
    return this.colors.white;
  }

  /** Default lighting when no events (menu / maps without lights). */
  setIdle() {
    for (let g = 0; g < GROUPS; g++) {
      const grp = this.groups[g];
      grp.mode = 'on';
      grp.key = g % 2 ? 'R' : 'L';
      grp.brightness = g === 4 ? 1 : 0.6;
    }
    this.laserSpeed = [1, 1];
  }

  /**
   * New run. chroma: { environment } to light the map with its Chroma data (per-light
   * IDs, colours, gradients, ring / laser motion); null for the group lighting.
   */
  reset(events, chroma = null) {
    this.events = events || [];
    this.eventIdx = 0;
    this.ringSpinVel = 0;
    this.ringZoomTarget = 1;
    this.boost = false;
    this.setChromaMode(!!chroma);
    if (!this.events.some((e) => e.type <= 4)) this.setIdle();
    else {
      for (const g of this.groups) {
        g.mode = 'off';
        g.key = 'R';
      }
      // keep the runway edge lit so the track is readable
      this.groups[4].mode = 'on';
      this.groups[4].key = 'R';
      this.groups[4].brightness = 0.6;
      this.laserSpeed = [0, 0];
    }
    // light IDs: mapped proportionally from the map's environment onto our lights
    if (chroma) this.chroma.reset(this.events, { counts: envLightCounts(chroma.environment), startOn: { 4: 0.6 } });
  }

  // ---------------------------------------------------------------------------
  // Group lighting (maps without Chroma, or Chroma switched off)

  applyEvent(e, t) {
    if (e.type >= 0 && e.type < GROUPS) {
      const g = this.groups[e.type];
      const v = e.value;
      if (v === 0) {
        g.mode = 'off';
        return;
      }
      if (v >= 1 && v <= 4) g.key = 'R';
      else if (v >= 5 && v <= 8) g.key = 'L';
      else g.key = 'W';
      const kind = ((v - 1) % 4) + 1; // 1 on, 2 flash, 3 fade, 4 transition
      g.brightness = e.f === undefined || e.f === null ? 1 : Math.max(0, Math.min(1.5, e.f));
      g.mode = kind === 2 ? 'flash' : kind === 3 ? 'fade' : 'on';
      g.modeTime = t;
    } else if (e.type === 5) {
      this.boost = e.value === 1;
    } else if (e.type === 8) {
      this.ringSpinVel += (Math.random() < 0.5 ? -1 : 1) * 2.5;
    } else if (e.type === 9) {
      this.ringZoomTarget = this.ringZoomTarget === 1 ? 0.55 : 1;
    } else if (e.type === 12) {
      this.laserSpeed[0] = e.value;
    } else if (e.type === 13) {
      this.laserSpeed[1] = e.value;
    }
  }

  update(t, dt) {
    if (this.chromaOn) {
      this.updateChroma(t, dt);
      return;
    }
    while (this.eventIdx < this.events.length && this.events[this.eventIdx].time <= t) {
      this.applyEvent(this.events[this.eventIdx++], t);
    }
    for (const g of this.groups) {
      let k = 0;
      const age = t - g.modeTime;
      if (g.mode === 'on') k = 1;
      else if (g.mode === 'flash') k = 1 + Math.max(0, 0.8 - age * 1.6);
      else if (g.mode === 'fade') k = Math.max(0, 1.4 - age * 1.0);
      const target = k * g.brightness;
      g.intensity += (target - g.intensity) * Math.min(1, dt * 25);
      g.color.copy(this.palette(g.key)).multiplyScalar(g.intensity);
      for (const m of g.materials) m.color.copy(g.color);
    }
    // Lasers sweep
    for (let side = 0; side < 2; side++) {
      const speed = this.laserSpeed[side];
      for (const p of this.lasers[side]) {
        p.userData.phase += dt * (0.3 + speed * 0.35);
        p.rotation.z = p.userData.sign * (0.35 + Math.sin(p.userData.phase) * 0.45);
        p.rotation.x = -0.2 + Math.cos(p.userData.phase * 0.7) * 0.15;
      }
    }
    this.syncLasers();
    // Rings
    this.ringSpinVel *= Math.exp(-dt * 1.2);
    this.ringSpin += this.ringSpinVel * dt;
    this.ringZoom += (this.ringZoomTarget - this.ringZoom) * Math.min(1, dt * 3);
    for (const r of this.rings) {
      const i = r.userData.index;
      r.rotation.z = this.ringSpin * (1 + i * 0.15);
      r.position.z = -25 - i * 6 * this.ringZoom;
    }
    this.syncRings();
  }

  // ---------------------------------------------------------------------------
  // Chroma lighting

  /**
   * The Chroma runtime's view of this environment: our lights per event group (in the order
   * Chroma IDs are mapped onto them), rings and lasers. An environment module can hand the
   * runtime its own set instead (same interface, see ChromaLighting.js).
   */
  buildChromaTarget() {
    const ringSink = new ColorSink(this.ringLights.instanceColor);
    const laserSinks = this.laserMeshes.map((m) => new ColorSink(m.instanceColor));
    const backSink = new ColorSink(this.backMesh.geometry.attributes.color);
    const runwaySink = new ColorSink(this.runwaySegments.attributes.color);
    const backLights = this.backRanges.slice(0, LIGHTS[0]).map(([a, b]) => new RangeLight(backSink, a, b));
    // the horizon bar follows the brightest back beam
    backSink.follow = { lights: backLights, range: this.backRanges[LIGHTS[0]] };
    for (let side = 0; side < 2; side++) {
      for (const p of this.lasers[side]) {
        const sign = p.userData.sign;
        // our side lasers sweep: the runtime's laser angle drives the sweep phase
        p.userData.setPhase = (phase) => {
          p.rotation.z = sign * (0.35 + Math.sin(phase) * 0.45);
          p.rotation.x = -0.2 + Math.cos(phase * 0.7) * 0.15;
        };
      }
    }
    return {
      groups: {
        0: backLights,
        1: this.rings.map((_, i) => new InstanceLight(ringSink, i)),
        2: this.lasers[0].map((_, i) => new InstanceLight(laserSinks[0], i)),
        3: this.lasers[1].map((_, i) => new InstanceLight(laserSinks[1], i)),
        4: this.runwayRanges.map(([a, b]) => new RangeLight(runwaySink, a, b)),
      },
      rings: [{ type: 'big', objects: this.rings, step: 5, zoom: { near: 3.3, far: 6 } }],
      lasers: { left: this.lasers[0], right: this.lasers[1] },
      banks: [backSink, ringSink, ...laserSinks, runwaySink],
    };
  }

  setChromaMode(on) {
    this.chromaOn = on;
    const white = (attr) => {
      attr.array.fill(1);
      attr.needsUpdate = true;
    };
    if (!on) {
      // group lighting: every light follows its group's material colour
      white(this.backMesh.geometry.attributes.color);
      white(this.runwaySegments.attributes.color);
      this.runwayMesh.geometry = this.runwayPlain;
      white(this.ringLights.instanceColor);
      for (const m of this.laserMeshes) white(m.instanceColor);
      return;
    }
    // per-light colours carry everything; the materials stay white
    this.runwayMesh.geometry = this.runwaySegments;
    for (const g of this.groups) for (const m of g.materials) m.color.setRGB(1, 1, 1);
  }

  updateChroma(t, dt) {
    this.chroma.update(t, dt);
    this.syncLasers();
    this.syncRings();
  }
}

/** Per-light colours of one mesh (instance or vertex colours); flushed once per frame. */
class ColorSink {
  constructor(attr) {
    this.attr = attr;
    this.dirty = false;
    this.follow = null; // { lights, range }: a vertex range that copies the brightest light
  }

  update() {
    if (!this.dirty) return;
    if (this.follow) {
      let best = null;
      let bestSum = -1;
      for (const L of this.follow.lights) {
        const sum = L.r + L.g + L.b;
        if (sum > bestSum) {
          bestSum = sum;
          best = L;
        }
      }
      fillRange(this.attr.array, this.follow.range[0], this.follow.range[1], best.r, best.g, best.b);
    }
    this.attr.needsUpdate = true;
    this.dirty = false;
  }
}

/** A light that is one instance of an instanced mesh. */
class InstanceLight {
  constructor(sink, index) {
    this.sink = sink;
    this.index = index;
    this.r = this.g = this.b = -1;
  }

  set(r, g, b) {
    if (r === this.r && g === this.g && b === this.b) return;
    this.r = r;
    this.g = g;
    this.b = b;
    const a = this.sink.attr.array;
    const i = this.index * 3;
    a[i] = r;
    a[i + 1] = g;
    a[i + 2] = b;
    this.sink.dirty = true;
  }
}

/** A light that is a vertex range of a merged mesh. */
class RangeLight {
  constructor(sink, start, end) {
    this.sink = sink;
    this.start = start;
    this.end = end;
    this.r = this.g = this.b = -1;
  }

  set(r, g, b) {
    if (r === this.r && g === this.g && b === this.b) return;
    this.r = r;
    this.g = g;
    this.b = b;
    fillRange(this.sink.attr.array, this.start, this.end, r, g, b);
    this.sink.dirty = true;
  }
}

function fillRange(a, start, end, r, g, b) {
  for (let v = start; v < end; v++) {
    a[v * 3] = r;
    a[v * 3 + 1] = g;
    a[v * 3 + 2] = b;
  }
}
