import * as THREE from 'three';
import { COLOR_LEFT, COLOR_RIGHT } from './constants.js';

// Light groups driven by basic beatmap events:
// 0 back lasers, 1 ring lights, 2 left lasers, 3 right lasers, 4 center lights
const GROUPS = 5;

class LightGroup {
  constructor() {
    this.materials = [];
    this.color = new THREE.Color(0, 0, 0);
    this.target = new THREE.Color(0, 0, 0);
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
    this.colors = { left: new THREE.Color(COLOR_LEFT), right: new THREE.Color(COLOR_RIGHT), white: new THREE.Color(0xffffff) };
    this.groups = Array.from({ length: GROUPS }, () => new LightGroup());
    this.laserSpeed = [0, 0];
    this.ringSpin = 0;
    this.ringSpinVel = 0;
    this.ringZoom = 1;
    this.ringZoomTarget = 1;
    this.eventIdx = 0;
    this.events = [];

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
  }

  mat(group) {
    const m = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
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
    this.root.add(floor);
    const grid = new THREE.GridHelper(200, 100, 0x18183a, 0x101024);
    grid.position.y = -0.01;
    this.root.add(grid);
  }

  buildTrack() {
    // Player platform
    const platform = new THREE.Mesh(
      new THREE.BoxGeometry(2.6, 0.1, 2.6),
      new THREE.MeshStandardMaterial({ color: 0x15151f, roughness: 0.4, metalness: 0.6 }),
    );
    platform.position.set(0, -0.05, 0);
    this.root.add(platform);
    const edge = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(2.6, 0.1, 2.6)),
      new THREE.LineBasicMaterial({ color: 0x5577ff }),
    );
    edge.position.copy(platform.position);
    this.root.add(edge);

    // Runway with neon edges (center lights)
    const runway = new THREE.Mesh(
      new THREE.PlaneGeometry(2.4, 140),
      new THREE.MeshStandardMaterial({ color: 0x0b0b14, roughness: 0.6, metalness: 0.4 }),
    );
    runway.rotation.x = -Math.PI / 2;
    runway.position.set(0, 0.001, -70 - 1.3);
    this.root.add(runway);
    const stripGeo = new THREE.BoxGeometry(0.04, 0.02, 140);
    for (const x of [-1.22, 1.22]) {
      const s = new THREE.Mesh(stripGeo, this.mat(4));
      s.position.set(x, 0.01, -70 - 1.3);
      this.root.add(s);
    }
    // lane separators (dim, static)
    const laneMat = new THREE.MeshBasicMaterial({ color: 0x1a1a40 });
    for (const x of [-0.6, 0, 0.6]) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.005, 140), laneMat);
      s.position.set(x, 0.005, -71.3);
      this.root.add(s);
    }
  }

  buildLasers() {
    // Left/right rotating lasers (groups 2 & 3)
    this.lasers = [[], []];
    const geo = new THREE.CylinderGeometry(0.05, 0.05, 120, 6, 1, true);
    geo.translate(0, 60, 0);
    for (let side = 0; side < 2; side++) {
      const sign = side === 0 ? -1 : 1;
      for (let i = 0; i < 4; i++) {
        const pivot = new THREE.Group();
        pivot.position.set(sign * (12 + i * 3), 0, -30 - i * 12);
        const beam = new THREE.Mesh(geo, this.mat(2 + side));
        pivot.add(beam);
        pivot.userData.phase = i * 0.7;
        pivot.userData.sign = sign;
        this.root.add(pivot);
        this.lasers[side].push(pivot);
      }
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
    for (let i = 0; i < 12; i++) {
      const ring = new THREE.Group();
      const light = new THREE.Mesh(geo, this.mat(1));
      const frame = new THREE.Mesh(frameGeo, frameMat);
      frame.scale.setScalar(1.04);
      frame.position.z = -0.05;
      ring.add(frame, light);
      ring.position.set(0, 5, -25 - i * 6);
      ring.userData.index = i;
      this.root.add(ring);
      this.rings.push(ring);
    }
  }

  buildBackLasers() {
    // Back lasers (group 0): a fan of beams behind the rings
    const geo = new THREE.CylinderGeometry(0.15, 0.15, 160, 6, 1, true);
    geo.translate(0, 80, 0);
    for (let i = 0; i < 9; i++) {
      const beam = new THREE.Mesh(geo, this.mat(0));
      beam.position.set(0, -2, -110);
      beam.rotation.z = (i - 4) * 0.22;
      beam.rotation.x = -0.25;
      this.root.add(beam);
    }
    // a horizon glow bar (also back group)
    const bar = new THREE.Mesh(new THREE.BoxGeometry(80, 0.3, 0.3), this.mat(0));
    bar.position.set(0, 0.3, -105);
    this.root.add(bar);
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
    this.root.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0x8888aa, size: 0.6, fog: false })));
  }

  setColors(left, right) {
    this.colors.left.set(left);
    this.colors.right.set(right);
  }

  /** Default lighting when no events (menu / maps without lights). */
  setIdle() {
    for (let g = 0; g < GROUPS; g++) {
      const grp = this.groups[g];
      grp.mode = 'on';
      grp.target.copy(g % 2 ? this.colors.right : this.colors.left);
      grp.brightness = g === 4 ? 1 : 0.6;
    }
    this.laserSpeed = [1, 1];
  }

  reset(events) {
    this.events = events || [];
    this.eventIdx = 0;
    this.ringSpinVel = 0;
    this.ringZoomTarget = 1;
    if (!this.events.some((e) => e.type <= 4)) this.setIdle();
    else {
      for (const g of this.groups) {
        g.mode = 'off';
        g.target.setRGB(0, 0, 0);
      }
      // keep the runway edge lit so the track is readable
      this.groups[4].mode = 'on';
      this.groups[4].target.copy(this.colors.right);
      this.groups[4].brightness = 0.6;
      this.laserSpeed = [0, 0];
    }
  }

  applyEvent(e, t) {
    if (e.type >= 0 && e.type < GROUPS) {
      const g = this.groups[e.type];
      const v = e.value;
      if (v === 0) {
        g.mode = 'off';
        return;
      }
      let color;
      if (v >= 1 && v <= 4) color = this.colors.right;
      else if (v >= 5 && v <= 8) color = this.colors.left;
      else color = this.colors.white;
      const kind = ((v - 1) % 4) + 1; // 1 on, 2 flash, 3 fade, 4 transition
      g.target.copy(color);
      g.brightness = e.f === undefined || e.f === null ? 1 : Math.max(0, Math.min(1.5, e.f));
      g.mode = kind === 2 ? 'flash' : kind === 3 ? 'fade' : 'on';
      g.modeTime = t;
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
      g.color.copy(g.target).multiplyScalar(g.intensity);
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
    // Rings
    this.ringSpinVel *= Math.exp(-dt * 1.2);
    this.ringSpin += this.ringSpinVel * dt;
    this.ringZoom += (this.ringZoomTarget - this.ringZoom) * Math.min(1, dt * 3);
    for (const r of this.rings) {
      const i = r.userData.index;
      r.rotation.z = this.ringSpin * (1 + i * 0.15);
      r.position.z = -25 - i * 6 * this.ringZoom;
    }
  }
}
