import * as THREE from 'three';
import { Environment } from './Environment.js';
import { NoteManager } from './Notes.js';
import { ArcManager } from './Arcs.js';
import { Effects } from './Effects.js';
import { Hud } from './Hud.js';
import { Saber } from './Saber.js';
import { ScoreKeeper } from './Score.js';
import { GameAudio } from './Audio.js';
import { Spectator } from './Spectator.js';
import { Menu } from './Menu.js';
import { Pointers } from './ui/Pointers.js';
import { LatencyCalibrator } from './Calibration.js';
import { settings } from '../settings.js';
import { parseModel, modelStore } from './Models.js';
import { COLOR_LEFT, COLOR_RIGHT, COLOR_WALL, laneX, layerY, noteRotation, rotationToDir, setPlayerHeight } from './constants.js';

const LEAD_IN = 2.0; // seconds before the song starts
const AUTO_SWING = 0.12; // seconds for half an autoplay swing
const AUTO_CUT_Z = 0.55; // metres in front of the player where autoplay cuts
const BEST_KEY = 'webxr-saber-best';

const _m = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _ray = new THREE.Raycaster();
const _plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0.9);

const hex = (c) => (typeof c === 'string' ? parseInt(c.replace('#', ''), 16) : c);

/**
 * States: idle (2D page) · menu (in-VR menu) · loading · ready · playing · paused · finished
 */
export class Game {
  constructor(container, { library, hooks = {} }) {
    this.hooks = hooks; // { onExit(results) }
    this.library = library;
    this.settings = settings.all;

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.localClippingEnabled = true;
    renderer.xr.enabled = true;
    renderer.xr.setReferenceSpaceType('local-floor');
    renderer.xr.setFramebufferScaleFactor(1.0);
    container.appendChild(renderer.domElement);
    this.renderer = renderer;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.05, 300);
    this.camera.position.set(0, 1.7, 1.6);
    this.camera.lookAt(0, 1.15, -6);
    this.scene.add(this.camera);

    this.env = new Environment(this.scene);
    this.effects = new Effects(this.scene);
    this.score = new ScoreKeeper();
    this.audio = new GameAudio();
    this.calibrator = new LatencyCalibrator(this.audio);
    this.hud = new Hud(this.scene);
    this.hud.setVisible(false);

    this.sabers = [new Saber(COLOR_LEFT, 'left'), new Saber(COLOR_RIGHT, 'right')];
    for (const s of this.sabers) this.scene.add(s.object, s.trail);

    this.notes = new NoteManager(this.scene, this.effects, {
      onCut: (note, saber, info) => this.onCut(note, saber, info),
      onMiss: (note) => this.onMiss(note),
      onBadCut: (note, saber, reason, pos) => this.onBadCut(note, saber, reason, pos),
      onBomb: (note, saber) => this.onBomb(note, saber),
    });
    this.arcs = new ArcManager(this.scene);

    // Red vignette when the head is inside a wall
    this.wallShade = new THREE.Mesh(
      new THREE.SphereGeometry(0.25, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xff2040, transparent: true, opacity: 0, side: THREE.BackSide, depthTest: false, fog: false }),
    );
    this.wallShade.renderOrder = 100;
    this.camera.add(this.wallShade);

    // Third-person / smoothed view on the PC monitor while in VR
    this.spectator = new Spectator(this.scene);
    this.spectator.onModeChange = (mode) => settings.set({ spectator: mode });

    this.state = 'idle';
    this.mode = 'desktop';
    this.map = null;
    this.meta = null;
    this.headPos = new THREE.Vector3(0, 1.6, 0);
    this.lean = { x: 0, crouch: false };
    this.lastFrame = performance.now();

    this.setupXRControllers();
    this.menu = new Menu(this);
    this.pointers = new Pointers(this);
    this.setupDesktopInput();

    this.customModels = { saber: null, note: null, names: { saber: null, note: null } };
    this.applySettings(settings.all);
    settings.subscribe((s) => this.applySettings(s));
    this.loadCustomModels();

    window.addEventListener('resize', () => this.onResize());
    renderer.setAnimationLoop((ts, frame) => this.loop(ts, frame));
  }

  // ---------------------------------------------------------------------------
  // Settings & colours
  applySettings(s) {
    this.settings = s;
    this.audio.offsetMs = s.audioLatencyMs;
    this.audio.setVolume(s.volume);
    this.audio.setSfxVolume(s.sfxVolume);
    this.spectator.setMode(s.spectator);
    this.menu.placeForHeight(s.playerHeight);
    if (this.state !== 'playing') {
      setPlayerHeight(s.playerHeight);
      this.applyColors();
    }
    this.applyAppearance();
  }

  // ---------------------------------------------------------------------------
  // Appearance: saber / note models and wall style
  applyAppearance(force = false) {
    const s = this.settings;
    this.notes.setWallStyle(s.wallStyle);
    if (!force && (this.state === 'playing' || this.state === 'paused')) return; // applied at the next run
    const saberCustom = s.saberModel === 'custom' ? this.customModels.saber : null;
    const saberStyle = s.saberModel === 'custom' && !saberCustom ? 'classic' : s.saberModel;
    for (const sb of this.sabers) sb.setStyle(saberStyle, saberCustom, s.saberFlip);
    const noteCustom = s.noteModel === 'custom' ? this.customModels.note : null;
    this.notes.setNoteStyle(s.noteModel === 'custom' && !noteCustom ? 'classic' : s.noteModel, noteCustom);
    this.applyColors();
    this.menu?.refreshPreview();
  }

  async loadCustomModels() {
    for (const kind of ['saber', 'note']) {
      const rec = await modelStore.get(kind);
      if (!rec) continue;
      try {
        this.customModels[kind] = await parseModel(rec.data);
        this.customModels.names[kind] = rec.name;
      } catch (e) {
        console.warn(`無法載入自訂${kind}模型`, e);
      }
    }
    this.applyAppearance();
    this.hooks.onModelsChanged?.(this.customModels.names);
  }

  /** Stores and activates an uploaded .glb model ('saber' | 'note'). */
  async setCustomModel(kind, buffer, name) {
    const scene = await parseModel(buffer);
    await modelStore.put(kind, name, buffer);
    this.customModels[kind] = scene;
    this.customModels.names[kind] = name;
    const key = kind === 'saber' ? 'saberModel' : 'noteModel';
    if (settings.get(key) === 'custom') this.applyAppearance();
    else settings.set({ [key]: 'custom' });
    this.hooks.onModelsChanged?.(this.customModels.names);
  }

  async removeCustomModel(kind) {
    await modelStore.remove(kind);
    this.customModels[kind] = null;
    this.customModels.names[kind] = null;
    const key = kind === 'saber' ? 'saberModel' : 'noteModel';
    if (settings.get(key) === 'custom') settings.set({ [key]: 'classic' });
    else this.applyAppearance();
    this.hooks.onModelsChanged?.(this.customModels.names);
  }

  /** Saber / note / light / wall colours: map colour scheme (if enabled) over the player's colours. */
  applyColors() {
    const s = this.settings;
    const mc = s.useMapColors && this.meta?.colors ? this.meta.colors : {};
    const left = mc.left ?? hex(s.leftColor);
    const right = mc.right ?? hex(s.rightColor);
    const envLeft = mc.envLeft ?? left;
    const envRight = mc.envRight ?? right;
    this.sabers[0].setColor(left);
    this.sabers[1].setColor(right);
    this.notes.setColors(left, right, mc.obstacle ?? COLOR_WALL);
    this.arcs.setColors(left, right);
    this.env.setColors(envLeft, envRight, mc.envLeftBoost ?? envLeft, mc.envRightBoost ?? envRight);
  }

  // ---------------------------------------------------------------------------
  // Loading & sessions
  setMap(map, meta) {
    this.map = map;
    this.meta = meta; // { title, subTitle, artist, mapper, characteristic, difficultyName, coverImage, colors }
    this.oneSaber = meta.characteristic === 'OneSaber';
  }

  /** Loads a library entry's difficulty and goes to the ready screen. */
  async playEntry(entry, setIdx, diffIdx) {
    const prevState = this.state;
    this.state = 'loading';
    this.showPanel('loading');
    try {
      await this.library.load(entry);
      const buffer = await this.library.audioFor(entry, this.audio);
      this.audio.buffer = buffer;
      const { map, meta } = this.library.loadDifficulty(entry, setIdx, diffIdx);
      this.current = { entry, setIdx, diffIdx };
      this.setMap(map, meta);
      this.enterReady();
    } catch (e) {
      console.error(e);
      this.state = prevState === 'loading' ? 'menu' : prevState;
      if (this.mode === 'vr') {
        this.showMenu('song');
        this.menu.setStatus(`載入失敗：${e.message}`);
      } else {
        this.exitToMenu();
        this.hooks.onError?.(e);
      }
    }
  }

  showPanel(page) {
    this.menu.open(page);
  }

  async startVR(pending) {
    if (!navigator.xr) throw new Error('此瀏覽器不支援 WebXR');
    this.audio.ensureContext();
    const session = await navigator.xr.requestSession('immersive-vr', {
      optionalFeatures: ['local-floor', 'bounded-floor'],
    });
    this.mode = 'vr';
    session.addEventListener('end', () => this.onSessionEnd());
    session.addEventListener('visibilitychange', () => {
      if (session.visibilityState !== 'visible' && this.state === 'playing') this.pause();
    });
    await this.renderer.xr.setSession(session);
    this.xrSession = session;
    this.spectator.start();
    if (pending) this.playEntry(pending.entry, pending.setIdx, pending.diffIdx);
    else this.showMenu(this.library.entries.length ? 'library' : 'browse');
  }

  startDesktop(entry, setIdx, diffIdx) {
    this.audio.ensureContext();
    this.mode = 'desktop';
    return this.playEntry(entry, setIdx, diffIdx);
  }

  exitVR() {
    if (this.xrSession) this.xrSession.end().catch(() => {});
  }

  resetDesktopCamera() {
    this.camera.position.set(0, 1.7, 1.6);
    this.camera.quaternion.identity();
    this.camera.lookAt(0, 1.15, -6);
    this.onResize();
  }

  onSessionEnd() {
    this.xrSession = null;
    this.spectator.stop();
    this.mode = 'desktop';
    this.resetDesktopCamera();
    this.pointers.hideAll(this.menu.panels);
    this.stopGameplay();
    this.menu.hide();
    const results = this.state === 'finished' ? this.lastResults : null;
    this.state = 'idle';
    this.hooks.onExit?.(results);
  }

  stopGameplay() {
    this.audio.stop();
    this.notes.reset(null);
    this.arcs.reset(null);
    this.effects.clear();
    this.hud.setVisible(false);
    this.hud.clearPopups();
    this.env.reset([]);
    this.inWall = false;
  }

  /** In-VR menu (song library etc). */
  showMenu(page) {
    this.stopGameplay();
    this.state = 'menu';
    this.applyColors();
    this.menu.open(page);
  }

  /** "Back to menu": the VR menu inside VR, the web page otherwise. */
  exitToMenu() {
    if (this.mode === 'vr') {
      if (this.current) this.menu.openSong(this.current.entry, this.current.setIdx, this.current.diffIdx);
      this.showMenu(this.current ? 'song' : 'library');
      return;
    }
    const results = this.state === 'finished' ? this.lastResults : null;
    this.stopGameplay();
    this.menu.hide();
    this.state = 'idle';
    this.hooks.onExit?.(results);
  }

  enterReady() {
    this.prepareRun();
    this.state = 'ready';
    this.showPanel('ready');
  }

  prepareRun() {
    setPlayerHeight(this.settings.playerHeight);
    this.applyAppearance(true);
    this.audio.stop();
    this.notes.reset(this.map);
    this.arcs.reset(this.map);
    this.env.reset(this.map.events);
    this.score.reset(this.map.maxScore);
    this.effects.clear();
    this.hud.clearPopups();
    this.hud.setVisible(true);
    this.setPlayfieldVisible(true);
    this.autoIdx = [0, 0];
    this.autoNotes = [0, 1].map((c) =>
      this.map.notes
        .filter((n) => n.kind === 'note' && n.color === c)
        .map((n) => {
          const rot = noteRotation(n.dir, n.angle);
          const d = n.dir === 8 ? [0, -1] : rotationToDir(rot);
          return { t: n.time - AUTO_CUT_Z / this.map.njs, x: laneX(n.x), y: layerY(n.y), dx: d[0], dy: d[1] };
        }),
    );
    const firstObj = Math.min(
      this.map.notes.length ? this.map.notes[0].time : Infinity,
      this.map.walls.length ? this.map.walls[0].time : Infinity,
      this.map.arcs.length ? this.map.arcs[0].time : Infinity,
    );
    this.startTime = Math.min(-LEAD_IN, firstObj - this.notes.spawnLead - 0.5);
    this.audio.pausedAt = this.startTime;
    this.endTime = Math.max(this.audio.duration, this.map.lastTime + 1) + 0.5;
    this.inWall = false;
  }

  beginPlay() {
    if (this.state !== 'ready') return;
    this.menu.hide();
    this.state = 'playing';
    this.audio.play(this.startTime);
  }

  pause() {
    if (this.state !== 'playing') return;
    this.audio.pause();
    this.state = 'paused';
    this.setPlayfieldVisible(false);
    this.showPanel('pause');
  }

  resume() {
    if (this.state !== 'paused') return;
    this.menu.hide();
    this.setPlayfieldVisible(true);
    this.state = 'playing';
    this.audio.resume();
  }

  setPlayfieldVisible(v) {
    this.notes.root.visible = v;
    this.arcs.root.visible = v;
  }

  restart() {
    if (!this.map) return;
    this.menu.hide();
    this.prepareRun();
    this.state = 'ready';
    this.beginPlay();
  }

  finish(failed) {
    this.score.flushPending();
    this.state = 'finished';
    if (failed) this.audio.stop();
    const r = this.score.summary();
    r.failed = !!failed;
    r.title = this.meta.title;
    r.difficulty = this.meta.difficultyName;
    r.characteristic = this.meta.characteristic;
    if (!failed && !this.settings.autoplay) r.best = this.recordBest(r);
    this.lastResults = r;
    this.showPanel('results');
  }

  recordBest(r) {
    if (!this.current) return null;
    const key = `${this.current.entry.key}|${r.characteristic}|${r.difficulty}`;
    let all = {};
    try {
      all = JSON.parse(localStorage.getItem(BEST_KEY) || '{}');
    } catch (e) {
      /* ignore */
    }
    const prev = all[key];
    const isNew = !prev || r.score > prev.score;
    if (isNew) {
      all[key] = { score: r.score, percent: r.percent, rank: r.rank, date: Date.now() };
      try {
        localStorage.setItem(BEST_KEY, JSON.stringify(all));
      } catch (e) {
        /* ignore */
      }
    }
    return { ...(isNew ? all[key] : prev), isNew };
  }

  // ---------------------------------------------------------------------------
  // Gameplay callbacks
  onCut(note, saber, info) {
    this.score.cut(note, saber, info, performance.now() / 1000);
    this.audio.playHit(false, info.position.x);
    this.haptic(saber, 0.6, 40);
  }

  onMiss(note) {
    this.score.miss(note);
    const p = new THREE.Vector3(laneX(note.x), layerY(note.y), -1.5);
    this.hud.popup(p, 'MISS', '#ff5060');
  }

  onBadCut(note, saber, reason, pos) {
    this.score.badCut(note);
    this.audio.playHit(true, pos.x);
    this.hud.popup(pos, '✕', '#ff5060');
    this.haptic(saber, 1.0, 120);
  }

  onBomb(note, saber) {
    this.score.bomb();
    this.audio.playHit(true, 0);
    this.haptic(saber, 1.0, 200);
  }

  haptic(saber, intensity, ms) {
    if (this.mode !== 'vr') return;
    const input = this.inputFor(saber.hand);
    const gp = input?.gamepad;
    if (!gp) return;
    try {
      if (gp.hapticActuators && gp.hapticActuators[0]) gp.hapticActuators[0].pulse(intensity, ms);
      else if (gp.vibrationActuator) gp.vibrationActuator.playEffect('dual-rumble', { duration: ms, strongMagnitude: intensity, weakMagnitude: intensity });
    } catch (e) {
      /* ignore */
    }
  }

  // ---------------------------------------------------------------------------
  // Input: XR controllers
  setupXRControllers() {
    this.xrInputs = [null, null];
    this.grips = [];
    this.prevButtons = [{}, {}];
    for (let i = 0; i < 2; i++) {
      const ray = this.renderer.xr.getController(i);
      const grip = this.renderer.xr.getControllerGrip(i);
      this.scene.add(ray, grip);
      this.grips.push(grip);
      ray.addEventListener('connected', (e) => {
        this.xrInputs[i] = e.data;
      });
      ray.addEventListener('disconnected', () => {
        this.xrInputs[i] = null;
      });
      ray.addEventListener('selectstart', () => this.onSelect(i));
    }
  }

  inputFor(hand) {
    for (const s of this.xrInputs) if (s && s.handedness === hand) return s;
    return null;
  }

  gripFor(hand) {
    for (let i = 0; i < 2; i++) if (this.xrInputs[i] && this.xrInputs[i].handedness === hand) return this.grips[i];
    return null;
  }

  get pointersActive() {
    return this.menu.visible && this.state !== 'playing';
  }

  onSelect(i) {
    if (!this.pointersActive) return;
    if (this.pointers.click(i)) return;
    this.menu.onFreeTrigger();
  }

  pollXRButtons() {
    for (let i = 0; i < 2; i++) {
      const src = this.xrInputs[i];
      const gp = src?.gamepad;
      if (!gp) continue;
      const prev = this.prevButtons[i];
      const pressed = (idx) => gp.buttons[idx]?.pressed && !prev[idx];
      const a = pressed(4);
      const b = pressed(5);
      prev[4] = gp.buttons[4]?.pressed;
      prev[5] = gp.buttons[5]?.pressed;
      if (b) {
        if (this.state === 'playing') this.pause();
        else if (['paused', 'finished', 'ready'].includes(this.state)) this.exitToMenu();
        else if (this.state === 'menu' && this.menu.page === 'song') this.menu.open('library');
      } else if (a) {
        if (this.state === 'paused') this.restart();
      }
    }
  }

  updateXRSabers() {
    const angle = THREE.MathUtils.degToRad(this.settings.saberAngle);
    _m2.makeRotationX(angle);
    for (const saber of this.sabers) {
      const grip = this.gripFor(saber.hand);
      if (grip && grip.visible) {
        _m.multiplyMatrices(grip.matrixWorld, _m2);
        saber.setMatrix(_m);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Input: desktop mouse / keyboard
  setupDesktopInput() {
    this.mouse = new THREE.Vector2(0.3, -0.2);
    this.mouseLeft = false;
    const el = this.renderer.domElement;
    el.addEventListener('pointermove', (e) => {
      this.mouse.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
    });
    el.addEventListener('pointerdown', (e) => {
      if (this.mode !== 'desktop') return;
      if (this.pointersActive) {
        this.pointers.updateMouse(this.menu.panels, this.mouse, this.camera);
        if (this.pointers.click(2)) return;
        if (this.state === 'paused') this.resume();
        return;
      }
      if (e.button === 0) this.mouseLeft = true;
    });
    el.addEventListener('wheel', (e) => {
      if (this.mode === 'desktop' && this.pointersActive) this.pointers.scroll(2, e.deltaY > 0 ? 1 : -1);
    }, { passive: true });
    window.addEventListener('pointerup', () => {
      this.mouseLeft = false;
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', (e) => {
      if (this.mode !== 'desktop' || this.state === 'idle') return;
      const k = e.key.toLowerCase();
      if (k === ' ' || k === 'p') {
        e.preventDefault();
        if (this.state === 'ready') this.beginPlay();
        else if (this.state === 'playing') this.pause();
        else if (this.state === 'paused') this.resume();
        else if (this.state === 'finished') this.restart();
      } else if (k === 'escape') {
        this.exitToMenu();
      } else if (k === 'r') {
        this.restart();
      } else if (k === 'a' || k === 'arrowleft') this.lean.x = -0.6;
      else if (k === 'd' || k === 'arrowright') this.lean.x = 0.6;
      else if (k === 's' || k === 'arrowdown') this.lean.crouch = true;
    });
    window.addEventListener('keyup', (e) => {
      const k = e.key.toLowerCase();
      if (['a', 'd', 'arrowleft', 'arrowright'].includes(k)) this.lean.x = 0;
      if (k === 's' || k === 'arrowdown') this.lean.crouch = false;
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'playing' && this.mode === 'desktop') this.pause();
    });
  }

  updateDesktopSabers() {
    // Camera follows lean / crouch
    this.camera.position.x += (this.lean.x - this.camera.position.x) * 0.2;
    const camY = this.lean.crouch ? 1.15 : 1.7;
    this.camera.position.y += (camY - this.camera.position.y) * 0.2;
    this.camera.updateMatrixWorld();

    _ray.setFromCamera(this.mouse, this.camera);
    const target = _ray.ray.intersectPlane(_plane, _v) || _v.set(0, 1.2, -0.9);
    const activeIdx = this.mouseLeft ? 0 : 1;
    for (let i = 0; i < 2; i++) {
      const saber = this.sabers[i];
      const side = i === 0 ? -1 : 1;
      if (i === activeIdx) {
        const handle = _v2.set(target.x * 0.35 + side * 0.12, 0.95 + (target.y - 1.2) * 0.3, 0.15);
        _m.lookAt(handle, target, _up);
        _m.setPosition(handle);
      } else {
        const handle = _v2.set(side * 0.4, 0.95, 0.25);
        _m.lookAt(handle, _v.set(side * 0.55, 0.2, -0.6), _up);
        _m.setPosition(handle);
        _ray.ray.intersectPlane(_plane, _v); // restore target
      }
      saber.setMatrix(_m);
    }
  }

  // Autoplay: sabers sweep through each note's cut direction
  updateAutoSabers(t) {
    for (let c = 0; c < 2; c++) {
      const saber = this.sabers[c];
      const list = this.autoNotes[c];
      let k = this.autoIdx[c];
      while (k < list.length && list[k].t + AUTO_SWING < t) k++;
      this.autoIdx[c] = k;
      const side = c === 0 ? -1 : 1;
      const rest = _v.set(side * 0.45, 1.0, -AUTO_CUT_Z);
      const next = list[k];
      const prev = list[k - 1];
      let tip;
      if (next && t >= next.t - AUTO_SWING) {
        const ph = (t - next.t) / AUTO_SWING; // -1..1
        tip = _v.set(next.x + next.dx * ph * 0.5, next.y + next.dy * ph * 0.5, -AUTO_CUT_Z);
      } else {
        const from = prev
          ? new THREE.Vector3(prev.x + prev.dx * 0.5, prev.y + prev.dy * 0.5, -AUTO_CUT_Z)
          : rest.clone();
        const fromT = prev ? prev.t + AUTO_SWING : t - 1;
        if (next && next.t - AUTO_SWING - fromT < 1.5) {
          const to = new THREE.Vector3(next.x - next.dx * 0.5, next.y - next.dy * 0.5, -AUTO_CUT_Z);
          let f = (t - fromT) / Math.max(0.01, next.t - AUTO_SWING - fromT);
          f = Math.max(0, Math.min(1, f));
          f = f * f * (3 - 2 * f);
          tip = from.lerp(to, f);
        } else {
          const restV = new THREE.Vector3(side * 0.45, 1.0, -AUTO_CUT_Z);
          const f = Math.max(0, Math.min(1, (t - fromT) / 0.4));
          tip = from.lerp(restV, f * f * (3 - 2 * f));
        }
      }
      const handle = _v2.set(tip.x * 0.45 + side * 0.15, 0.85 + (tip.y - 1.0) * 0.4, 0.15);
      _m.lookAt(handle, tip, _up);
      _m.setPosition(handle);
      saber.setMatrix(_m);
    }
  }

  // ---------------------------------------------------------------------------
  loop() {
    const nowMs = performance.now();
    const dt = Math.min(0.05, (nowMs - this.lastFrame) / 1000);
    this.lastFrame = nowMs;
    const xr = this.renderer.xr.isPresenting;
    const t = this.audio.time;
    const inGame = ['ready', 'playing', 'paused', 'finished'].includes(this.state);

    if (xr) {
      this.pollXRButtons();
      this.updateXRSabers();
      const cam = this.renderer.xr.getCamera();
      this.headPos.setFromMatrixPosition(cam.matrixWorld);
      if (this.pointersActive) this.pointers.updateXR(this.menu.panels);
      else this.pointers.hideAll(this.menu.panels);
    } else {
      this.updateDesktopSabers();
      this.headPos.set(this.camera.position.x, this.lean.crouch ? 1.1 : 1.6, 0);
      if (this.pointersActive) this.pointers.updateMouse(this.menu.panels, this.mouse, this.camera);
    }
    if (this.settings.autoplay && (this.state === 'playing' || this.state === 'paused' || this.state === 'ready')) {
      this.updateAutoSabers(this.state === 'ready' ? this.startTime : t);
    }

    // Sabers: in VR only while playing (menus use laser pointers); on desktop during a run
    const showSabers = xr ? this.state === 'playing' : inGame;
    this.sabers[0].setVisible(showSabers && !this.oneSaber);
    this.sabers[1].setVisible(showSabers);

    const now = performance.now() / 1000;
    for (const s of this.sabers) s.update(now);

    if (this.state === 'playing') {
      this.notes.update(t, dt, this.sabers, this.settings.autoplay);
      this.arcs.update(t, this.notes.njs, this.notes.halfJump, this.sabers, this.settings.autoplay ? null : (s, k, ms) => this.haptic(s, k, ms));
      this.score.update(now);
      const inWall = this.notes.headInWall(this.headPos);
      if (inWall) this.score.wall(dt);
      this.inWall = inWall;
      this.env.update(t, dt);
      if (this.score.failed && !this.settings.noFail) this.finish(true);
      else if (t >= this.endTime) this.finish(false);
    } else if (inGame) {
      this.env.update(this.state === 'ready' ? this.startTime : t, dt);
    } else {
      this.env.update(-1, dt);
    }
    this.wallShade.material.opacity += ((this.inWall && this.state === 'playing' ? 0.35 : 0) - this.wallShade.material.opacity) * 0.3;
    this.wallShade.visible = this.wallShade.material.opacity > 0.01;

    if (inGame) this.hud.update(this.score, 0, Math.max(0, t), this.audio.duration, dt);
    if (this.calibrator.running) this.calibrator.schedule();
    this.menu.update(dt);
    this.effects.update(dt);
    this.renderer.render(this.scene, this.camera);
    if (xr) this.spectator.render(this.renderer.xr.getCamera(), this.sabers, [this.wallShade], dt);
  }

  onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }
}
