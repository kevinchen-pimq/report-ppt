// Live 3D preview of the selected saber / note / wall styles on the 2D page.
// Uses its own small WebGL renderer (one extra context), created only while the
// canvas is on screen; the render loop stops whenever it is hidden.
import * as THREE from 'three';
import { NoteStyle, buildSaberVisual, createEdgeGlowMaterial, wallStyleParams, ARROW_PLANE, arrowTexture, dotTexture } from './game/Models.js';
import { NOTE_SIZE, COLOR_WALL } from './game/constants.js';

const _white = new THREE.Color(0xffffff);

/** Disposes the meshes' materials (and geometries unless they are shared with a source model). */
function disposeTree(root, { geometries = true } = {}) {
  root.traverse((o) => {
    if (!o.isMesh && !o.isSprite) return;
    if (geometries && o.isMesh) o.geometry?.dispose();
    for (const m of [].concat(o.material)) m?.dispose();
  });
}

export class StylePreview {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{ getCustom: () => ({ saber, note }) }} opts  parsed custom glTF scenes (or null)
   */
  constructor(canvas, { getCustom }) {
    this.canvas = canvas;
    this.getCustom = getCustom;
    this.renderer = null;
    this.visible = false;
    this.running = false;
    this.settings = null;
    this.saberKey = null;
    this.noteKey = null;
    this.spin = 0;
    this.last = 0;
    this.raf = 0;
    this.frames = 0; // rendered frames (for tests)
    this.sabers = [];
    this.notes = [];
    this.noteStyle = null;

    this.io = new IntersectionObserver((list) => {
      for (const e of list) this.visible = e.isIntersecting;
      this.sync();
    });
    this.io.observe(canvas);
    this.onVisibility = () => this.sync();
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  /** Called with the full settings object whenever settings or custom models change. */
  update(s) {
    this.settings = s;
    if (this.renderer) this.rebuild();
  }

  sync() {
    const want = this.visible && document.visibilityState === 'visible' && !!this.settings;
    if (want && !this.renderer) this.init();
    if (want && !this.running) {
      this.running = true;
      this.last = performance.now();
      this.raf = requestAnimationFrame((t) => this.frame(t));
    } else if (!want && this.running) {
      this.running = false;
      cancelAnimationFrame(this.raf);
    }
  }

  init() {
    const renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'low-power' });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0x0a0c22, 1);
    this.renderer = renderer;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(32, 2, 0.1, 30);
    this.scene.add(new THREE.HemisphereLight(0x8899ff, 0x221122, 1.4));
    const dir = new THREE.DirectionalLight(0xffffff, 1.6);
    dir.position.set(1, 3, 4);
    this.scene.add(dir);

    // floor grid for depth, like the game's environment
    const grid = new THREE.GridHelper(8, 16, 0x3a4a9a, 0x1c2350);
    grid.position.y = -0.9;
    grid.material.transparent = true;
    grid.material.opacity = 0.6;
    this.scene.add(grid);
    this.grid = grid;

    this.saberRoot = new THREE.Group();
    this.noteRoot = new THREE.Group();
    this.scene.add(this.saberRoot, this.noteRoot);

    // symbols (same layout as the game's notes)
    const s = NOTE_SIZE;
    this.arrowGeo = new THREE.PlaneGeometry(s * ARROW_PLANE.w, s * ARROW_PLANE.h);
    this.arrowGeo.translate(0, s * ARROW_PLANE.centerY, s / 2 + 0.003);
    this.dotGeo = new THREE.PlaneGeometry(s * 0.55, s * 0.55);
    this.dotGeo.translate(0, 0, s / 2 + 0.003);
    const symbol = (map) => new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    this.arrowMat = symbol(arrowTexture());
    this.dotMat = symbol(dotTexture());
    this.colorArrowMats = [0, 1].map(() => symbol(arrowTexture()));
    this.colorDotMats = [0, 1].map(() => symbol(dotTexture()));

    // wall
    this.wallGeo = new THREE.BoxGeometry(1, 1, 1);
    this.wallMat = createEdgeGlowMaterial({ color: COLOR_WALL, ...wallStyleParams('translucent') });
    this.wall = new THREE.Mesh(this.wallGeo, this.wallMat);
    this.wall.scale.set(1.6, 0.4, 0.5);
    this.wall.position.set(0, -0.6, -1.0);
    this.scene.add(this.wall);

    this.saberKey = null;
    this.noteKey = null;
    this.rebuild();
  }

  rebuild() {
    const s = this.settings;
    if (!s || !this.renderer) return;
    const custom = this.getCustom?.() || {};
    const left = new THREE.Color(s.leftColor);
    const right = new THREE.Color(s.rightColor);

    // sabers
    const saberCustom = s.saberModel === 'custom' ? custom.saber || null : null;
    const saberStyle = s.saberModel === 'custom' && !saberCustom ? 'classic' : s.saberModel;
    const saberKey = `${saberStyle}|${saberCustom ? saberCustom.uuid : ''}|${!!s.saberFlip}`;
    if (saberKey !== this.saberKey) {
      for (const sb of this.sabers) {
        this.saberRoot.remove(sb.group);
        disposeTree(sb.group, { geometries: !sb.custom }); // custom models share geometry with the game
      }
      this.sabers = [0, 1].map((i) => {
        const v = buildSaberVisual(saberStyle, i ? right : left, saberCustom, !!s.saberFlip);
        const pivot = new THREE.Group();
        v.group.rotation.x = Math.PI / 2; // blade up
        pivot.add(v.group);
        pivot.position.set(i ? 1.12 : -1.12, -0.72, 0.15);
        this.saberRoot.add(pivot);
        return { group: pivot, visual: v, custom: !!saberCustom, side: i ? 1 : -1 };
      });
      this.saberKey = saberKey;
    }
    this.sabers[0].visual.setColor(left);
    this.sabers[1].visual.setColor(right);

    // notes: red arrow (up), dot, blue arrow (down)
    const noteCustom = s.noteModel === 'custom' ? custom.note || null : null;
    const noteStyle = s.noteModel === 'custom' && !noteCustom ? 'classic' : s.noteModel;
    const noteKey = `${noteStyle}|${noteCustom ? noteCustom.uuid : ''}`;
    if (noteKey !== this.noteKey) {
      for (const n of this.notes) this.noteRoot.remove(n.group);
      if (this.noteStyle) {
        if (this.noteStyle.customByColor) for (const c of this.noteStyle.customByColor) disposeTree(c.group, { geometries: false });
        this.noteStyle.dispose();
      }
      this.noteStyle = new NoteStyle(noteStyle, noteCustom);
      const colored = this.noteStyle.coloredSymbols;
      const layout = [
        { c: 0, x: -0.6, rot: Math.PI, sym: 'arrow' },
        { c: 1, x: 0, rot: 0, sym: 'dot' },
        { c: 1, x: 0.6, rot: 0, sym: 'arrow' },
      ];
      this.notes = layout.map(({ c, x, rot, sym }, i) => {
        const built = this.noteStyle.buildNote(c);
        const group = new THREE.Group();
        const inner = new THREE.Group(); // spins; outer keeps the arrow direction
        inner.add(built.group);
        const mat = sym === 'arrow' ? (colored ? this.colorArrowMats[c] : this.arrowMat) : colored ? this.colorDotMats[c] : this.dotMat;
        const symMesh = new THREE.Mesh(sym === 'arrow' ? this.arrowGeo : this.dotGeo, mat);
        symMesh.rotation.z = rot;
        built.group.rotation.z = rot;
        inner.add(symMesh);
        group.add(inner);
        group.position.set(x, 0.18, 0);
        this.noteRoot.add(group);
        return { group, inner, phase: i * 1.3 };
      });
      this.noteKey = noteKey;
    }
    this.noteStyle.setColors(left, right);
    for (let c = 0; c < 2; c++) {
      const col = c ? right : left;
      this.colorArrowMats[c].color.copy(col).lerp(_white, 0.04);
      this.colorDotMats[c].color.copy(this.colorArrowMats[c].color);
    }

    // wall
    const wp = wallStyleParams(s.wallStyle);
    const u = this.wallMat.uniforms;
    u.fill.value = wp.fill;
    u.edge.value = wp.edge;
    u.intensity.value = wp.intensity;
    if (!this.running) this.render();
  }

  resize() {
    const r = this.renderer;
    const w = Math.max(1, this.canvas.clientWidth);
    const h = Math.max(1, this.canvas.clientHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (this.size !== `${w}x${h}@${dpr}`) {
      this.size = `${w}x${h}@${dpr}`;
      r.setPixelRatio(dpr);
      r.setSize(w, h, false);
      const aspect = w / h;
      const cam = this.camera;
      cam.aspect = aspect;
      // keep ~2.9 m of width (both sabers) and ~1.8 m of height in view
      const t = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
      const dist = Math.max(0.9 / t, 1.45 / (t * aspect));
      cam.position.set(0, 0.3, dist);
      cam.lookAt(0, -0.16, 0);
      cam.updateProjectionMatrix();
    }
  }

  frame(t) {
    if (!this.running) return;
    const dt = Math.min(0.1, (t - this.last) / 1000);
    this.last = t;
    this.spin += dt;
    for (const n of this.notes) {
      n.inner.rotation.y = Math.sin(this.spin * 0.6 + n.phase) * 0.75;
      n.inner.rotation.x = Math.sin(this.spin * 0.45 + n.phase) * 0.18;
    }
    for (const sb of this.sabers) {
      sb.group.rotation.z = sb.side * (0.22 + Math.sin(this.spin * 0.8 + sb.side) * 0.12);
      sb.group.rotation.y = Math.sin(this.spin * 0.5) * 0.5 * sb.side;
    }
    this.render();
    this.raf = requestAnimationFrame((ts) => this.frame(ts));
  }

  render() {
    if (!this.renderer) return;
    this.resize();
    this.renderer.render(this.scene, this.camera);
    this.frames++;
  }

  /** Frees the WebGL context (it is created again when the preview becomes visible). */
  release() {
    if (!this.renderer) return;
    this.running = false;
    cancelAnimationFrame(this.raf);
    for (const sb of this.sabers) disposeTree(sb.group, { geometries: !sb.custom });
    if (this.noteStyle) {
      if (this.noteStyle.customByColor) for (const c of this.noteStyle.customByColor) disposeTree(c.group, { geometries: false });
      this.noteStyle.dispose();
    }
    for (const m of [this.arrowMat, this.dotMat, ...this.colorArrowMats, ...this.colorDotMats, this.wallMat, this.grid.material]) m.dispose();
    for (const g of [this.arrowGeo, this.dotGeo, this.wallGeo, this.grid.geometry]) g.dispose();
    this.sabers = [];
    this.notes = [];
    this.noteStyle = null;
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer = null;
    // a canvas whose context was lost cannot get a new one: swap in a fresh canvas
    const fresh = this.canvas.cloneNode(false);
    this.io.unobserve(this.canvas);
    this.canvas.replaceWith(fresh);
    this.canvas = fresh;
    this.io.observe(fresh);
    this.size = null;
    this.saberKey = null;
    this.noteKey = null;
  }

  dispose() {
    this.release();
    this.io.disconnect();
    document.removeEventListener('visibilitychange', this.onVisibility);
  }
}
