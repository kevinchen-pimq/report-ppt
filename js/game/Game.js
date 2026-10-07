import * as THREE from 'three';
import { Environment } from './Environment.js';
import { NoteManager } from './Notes.js';
import { Effects } from './Effects.js';
import { Hud } from './Hud.js';
import { Saber } from './Saber.js';
import { ScoreKeeper } from './Score.js';
import { GameAudio } from './Audio.js';
import { COLOR_LEFT, COLOR_RIGHT, laneX, layerY, noteRotation, rotationToDir } from './constants.js';

const LEAD_IN = 2.0; // seconds before the song starts
const AUTO_SWING = 0.12; // seconds for half an autoplay swing
const AUTO_CUT_Z = 0.55; // metres in front of the player where autoplay cuts

const _m = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _ray = new THREE.Raycaster();
const _plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0.9);

export class Game {
  constructor(container, hooks = {}) {
    this.hooks = hooks; // { onExit(results), onStateChange(state) }
    this.settings = {
      noFail: false,
      autoplay: false,
      offsetMs: 0,
      saberAngle: 0,
      volume: 0.8,
      sfxVolume: 0.5,
      leftColor: COLOR_LEFT,
      rightColor: COLOR_RIGHT,
    };

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

    // Red vignette when the head is inside a wall
    this.wallShade = new THREE.Mesh(
      new THREE.SphereGeometry(0.25, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xff2040, transparent: true, opacity: 0, side: THREE.BackSide, depthTest: false, fog: false }),
    );
    this.wallShade.renderOrder = 100;
    this.camera.add(this.wallShade);

    this.state = 'idle';
    this.mode = 'desktop';
    this.map = null;
    this.headPos = new THREE.Vector3(0, 1.6, 0);
    this.lean = { x: 0, crouch: false };
    this.lastFrame = performance.now();

    this.setupXRControllers();
    this.setupDesktopInput();

    window.addEventListener('resize', () => this.onResize());
    renderer.setAnimationLoop((ts, frame) => this.loop(ts, frame));
  }

  // ---------------------------------------------------------------------------
  // Settings
  applySettings(s) {
    Object.assign(this.settings, s);
    this.audio.offsetMs = this.settings.offsetMs;
    this.audio.setVolume(this.settings.volume);
    this.audio.setSfxVolume(this.settings.sfxVolume);
    this.sabers[0].setColor(this.settings.leftColor);
    this.sabers[1].setColor(this.settings.rightColor);
    this.notes.setColors(this.settings.leftColor, this.settings.rightColor);
    this.env.setColors(this.settings.leftColor, this.settings.rightColor);
  }

  // ---------------------------------------------------------------------------
  // Loading
  async loadSong(songBytes) {
    await this.audio.decode(songBytes);
  }

  setMap(map, meta) {
    this.map = map;
    this.meta = meta; // { title, subTitle, artist, mapper, difficulty, characteristic, coverImage }
    this.oneSaber = meta.characteristic === 'OneSaber';
    this.autoNotes = [0, 1].map((c) =>
      map.notes
        .filter((n) => n.kind === 'note' && n.color === c)
        .map((n) => {
          const rot = noteRotation(n.dir, n.angle);
          const d = n.dir === 8 ? [0, -1] : rotationToDir(rot);
          return { t: n.time - AUTO_CUT_Z / map.njs, x: laneX(n.x), y: layerY(n.y), dx: d[0], dy: d[1] };
        }),
    );
  }

  // ---------------------------------------------------------------------------
  // Sessions
  async startVR() {
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
    this.enterReady();
  }

  startDesktop() {
    this.audio.ensureContext();
    this.mode = 'desktop';
    this.enterReady();
  }

  resetDesktopCamera() {
    this.camera.position.set(0, 1.7, 1.6);
    this.camera.quaternion.identity();
    this.camera.lookAt(0, 1.15, -6);
    this.onResize();
  }

  onSessionEnd() {
    this.xrSession = null;
    this.mode = 'desktop';
    this.resetDesktopCamera();
    if (this.state !== 'idle') this.exitToMenu();
  }

  exitToMenu() {
    const results = this.state === 'finished' ? this.lastResults : null;
    this.audio.stop();
    this.state = 'idle';
    this.notes.reset(null);
    this.effects.clear();
    this.hud.setVisible(false);
    this.hud.hideBoard();
    this.hud.clearPopups();
    this.env.reset([]);
    if (this.xrSession) {
      const s = this.xrSession;
      this.xrSession = null;
      s.end().catch(() => {});
    }
    this.hooks.onExit?.(results);
  }

  enterReady() {
    this.prepareRun();
    this.state = 'ready';
    const m = this.meta;
    const startHint = this.mode === 'vr' ? '扣下扳機開始' : '點擊畫面或按空白鍵開始';
    this.hud.showBoard(
      [
        { text: m.title, size: 64, weight: 800 },
        { text: m.subTitle || '', size: 36, color: '#aab' },
        { text: m.artist, size: 40, color: '#ccd' },
        { text: `${m.characteristic} · ${m.difficultyName}`, size: 40, color: '#8cf' },
        { text: `譜師 ${m.mapper || '-'}`, size: 32, color: '#99a', gap: 30 },
        { text: startHint, size: 58, weight: 800, color: '#fff', full: true },
        { text: this.mode === 'vr' ? 'B / Y 鍵：暫停' : '空白鍵：暫停 · Esc：離開 · 滑鼠：揮劍（按住左鍵換紅劍）', size: 30, color: '#99a', full: true },
      ],
      m.coverImage,
    );
  }

  prepareRun() {
    this.audio.stop();
    this.notes.reset(this.map);
    this.env.reset(this.map.events);
    this.score.reset(this.map.maxScore);
    this.effects.clear();
    this.hud.clearPopups();
    this.hud.setVisible(true);
    this.autoIdx = [0, 0];
    const firstObj = Math.min(
      this.map.notes.length ? this.map.notes[0].time : Infinity,
      this.map.walls.length ? this.map.walls[0].time : Infinity,
    );
    this.startTime = Math.min(-LEAD_IN, firstObj - this.notes.spawnLead - 0.5);
    this.audio.pausedAt = this.startTime;
    this.endTime = Math.max(this.audio.duration, this.map.lastTime + 1) + 0.5;
    this.sabers[0].setVisible(!this.oneSaber);
    this.sabers[1].setVisible(true);
    this.inWall = false;
  }

  beginPlay() {
    this.hud.hideBoard();
    this.state = 'playing';
    this.audio.play(this.startTime);
    this.hooks.onStateChange?.(this.state);
  }

  pause() {
    if (this.state !== 'playing') return;
    this.audio.pause();
    this.state = 'paused';
    this.hud.showBoard([
      { text: '暫停', size: 90, weight: 800 },
      { text: this.mode === 'vr' ? '扳機：繼續' : '空白鍵 / 點擊：繼續', size: 48, gap: 10 },
      { text: this.mode === 'vr' ? 'A / X：重新開始' : 'R：重新開始', size: 48 },
      { text: this.mode === 'vr' ? 'B / Y：回到選單' : 'Esc：回到選單', size: 48 },
    ]);
  }

  resume() {
    if (this.state !== 'paused') return;
    this.hud.hideBoard();
    this.state = 'playing';
    this.audio.resume();
  }

  restart() {
    this.prepareRun();
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
    this.lastResults = r;
    this.hud.showBoard(
      [
        { text: failed ? 'LEVEL FAILED' : 'LEVEL CLEARED', size: 76, weight: 900, color: failed ? '#ff4060' : '#60ffa0' },
        { text: `${this.meta.title} · ${this.meta.difficultyName}`, size: 38, color: '#ccd' },
        { text: `${r.rank}   ${r.percent.toFixed(2)}%`, size: 88, weight: 900 },
        { text: `分數 ${r.score.toLocaleString('en-US')}   最大連擊 ${r.maxCombo}`, size: 40 },
        { text: `命中 ${r.hits}   Miss ${r.misses}   壞切 ${r.badCuts}   炸彈 ${r.bombHits}`, size: 36, color: '#aab', gap: 16 },
        { text: this.mode === 'vr' ? '扳機：再玩一次 · B / Y：回到選單' : '空白鍵：再玩一次 · Esc：回到選單', size: 40, color: '#8cf' },
      ],
      null,
    );
    this.hooks.onStateChange?.(this.state);
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
      ray.addEventListener('selectstart', () => this.onTrigger());
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

  onTrigger() {
    if (this.state === 'ready') this.beginPlay();
    else if (this.state === 'paused') this.resume();
    else if (this.state === 'finished') this.restart();
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
        else if (this.state === 'paused' || this.state === 'finished' || this.state === 'ready') this.exitToMenu();
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
      if (this.state === 'ready') this.beginPlay();
      else if (this.state === 'paused') this.resume();
      else if (e.button === 0) this.mouseLeft = true;
    });
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

    if (xr) {
      this.pollXRButtons();
      this.updateXRSabers();
      const cam = this.renderer.xr.getCamera();
      this.headPos.setFromMatrixPosition(cam.matrixWorld);
    } else {
      this.updateDesktopSabers();
      this.headPos.set(this.camera.position.x, this.lean.crouch ? 1.1 : 1.6, 0);
    }
    if (this.settings.autoplay && (this.state === 'playing' || this.state === 'paused' || this.state === 'ready')) {
      this.updateAutoSabers(this.state === 'ready' ? this.startTime : t);
    }

    const now = performance.now() / 1000;
    for (const s of this.sabers) s.update(now);

    if (this.state === 'playing') {
      this.notes.update(t, dt, this.sabers, this.settings.autoplay);
      this.score.update(now);
      // walls
      const inWall = this.notes.headInWall(this.headPos);
      if (inWall) this.score.wall(dt);
      this.inWall = inWall;
      this.env.update(t, dt);
      if (this.score.failed && !this.settings.noFail) this.finish(true);
      else if (t >= this.endTime) this.finish(false);
    } else if (this.state === 'idle') {
      this.env.update(-1, dt);
    } else {
      this.env.update(this.state === 'ready' ? this.startTime : t, dt);
    }
    this.wallShade.material.opacity += ((this.inWall && this.state === 'playing' ? 0.35 : 0) - this.wallShade.material.opacity) * 0.3;
    this.wallShade.visible = this.wallShade.material.opacity > 0.01;

    if (this.state !== 'idle') this.hud.update(this.score, 0, Math.max(0, t), this.audio.duration, dt);
    this.effects.update(dt);
    this.renderer.render(this.scene, this.camera);
  }

  onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }
}
