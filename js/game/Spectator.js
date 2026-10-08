import * as THREE from 'three';

// Renders a spectator view of the VR session onto the 2D page (PC monitor),
// using a second renderer on its own canvas so the headset view is untouched.

const MODES = ['third', 'first', 'off'];
const MODE_LABELS = { third: '第三人稱', first: '第一人稱', off: '關閉' };
const MIN_FRAME = 0.012; // cap spectator rendering at roughly half the headset rate on 90Hz+

const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _euler = new THREE.Euler();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

/** Spectator mode default: off on standalone headsets (no monitor to show it on). */
export function defaultSpectatorMode() {
  return /OculusBrowser|Quest|Pico|Wolvic|MobileVR/i.test(navigator.userAgent) ? 'off' : 'third';
}

export class Spectator {
  constructor(scene) {
    this.scene = scene;
    this.mode = defaultSpectatorMode();
    this.active = false;
    this.renderer = null;
    this.lastRender = 0;

    this.canvas = document.createElement('canvas');
    this.canvas.id = 'spectator';
    this.canvas.hidden = true;
    document.body.appendChild(this.canvas);

    this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.05, 300);
    this.smoothPos = new THREE.Vector3(0, 1.6, 0);
    this.smoothQuat = new THREE.Quaternion();

    this.avatar = this.buildAvatar();
    this.avatar.visible = false;
    scene.add(this.avatar);

    this.buildOverlay();
    window.addEventListener('resize', () => this.onResize());
    window.addEventListener('keydown', (e) => {
      if (!this.active || e.key.toLowerCase() !== 'v') return;
      this.setMode(MODES[(MODES.indexOf(this.mode) + 1) % MODES.length]);
      this.onModeChange?.(this.mode);
    });
  }

  buildOverlay() {
    const bar = document.createElement('div');
    bar.id = 'spectator-bar';
    bar.hidden = true;
    const label = document.createElement('span');
    label.textContent = 'VR 進行中 · 觀戰視角';
    bar.append(label);
    this.buttons = {};
    for (const m of MODES) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = MODE_LABELS[m];
      b.addEventListener('click', () => {
        this.setMode(m);
        this.onModeChange?.(m);
      });
      this.buttons[m] = b;
      bar.append(b);
    }
    const hint = document.createElement('span');
    hint.className = 'hint';
    hint.textContent = '（V 鍵切換）';
    bar.append(hint);
    document.body.appendChild(bar);
    this.bar = bar;
  }

  buildAvatar() {
    const g = new THREE.Group();
    const suit = new THREE.MeshStandardMaterial({ color: 0x5a6078, roughness: 0.5, metalness: 0.2, emissive: 0x1a2040 });
    const glow = new THREE.MeshBasicMaterial({ color: 0x66e0ff });

    this.head = new THREE.Group();
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.11, 20, 14), suit);
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.06, 0.05), glow);
    visor.position.set(0, 0.01, -0.09);
    this.head.add(skull, visor);

    this.torso = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.15, 0.4, 6, 14), suit);
    body.position.y = -0.2;
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.3, 0.02), glow);
    stripe.position.set(0, -0.15, -0.15);
    this.torso.add(body, stripe);

    const armGeo = new THREE.CylinderGeometry(0.035, 0.03, 1, 8);
    armGeo.translate(0, 0.5, 0);
    this.arms = [new THREE.Mesh(armGeo, suit), new THREE.Mesh(armGeo, suit)];

    g.add(this.head, this.torso, ...this.arms);
    return g;
  }

  setMode(mode) {
    if (!MODES.includes(mode)) mode = defaultSpectatorMode();
    this.mode = mode;
    for (const [m, b] of Object.entries(this.buttons)) b.classList.toggle('active', m === mode);
    this.canvas.hidden = !this.active || mode === 'off';
    if (mode === 'off' && this.renderer) {
      // Free the extra GPU context while unused
      this.renderer.dispose();
      this.renderer.forceContextLoss();
      this.renderer = null;
      this.canvas.remove();
      this.canvas = document.createElement('canvas');
      this.canvas.id = 'spectator';
      this.canvas.hidden = true;
      document.body.insertBefore(this.canvas, this.bar);
    }
  }

  ensureRenderer() {
    if (this.renderer) return;
    const r = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    r.setSize(window.innerWidth, window.innerHeight);
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.localClippingEnabled = true;
    this.renderer = r;
  }

  start() {
    this.active = true;
    this.bar.hidden = false;
    this.setMode(this.mode);
    this.smoothInit = false;
  }

  stop() {
    this.active = false;
    this.bar.hidden = true;
    this.canvas.hidden = true;
    this.avatar.visible = false;
  }

  onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    if (this.renderer) this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  updateAvatar(headPos, headQuat, sabers) {
    this.head.position.copy(headPos);
    this.head.quaternion.copy(headQuat);
    _euler.setFromQuaternion(headQuat, 'YXZ');
    const yaw = _euler.y;
    // torso hangs below the head, slightly behind, turning only around Y
    this.torso.position.set(headPos.x + Math.sin(yaw) * 0.06, headPos.y - 0.2, headPos.z + Math.cos(yaw) * 0.06);
    this.torso.rotation.set(0, yaw, 0);
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? -1 : 1;
      const arm = this.arms[i];
      const saber = sabers[i];
      _a.set(side * 0.2, -0.08, 0).applyAxisAngle(_up, yaw).add(this.torso.position);
      const show = saber && saber.object.visible;
      arm.visible = !!show;
      if (!show) continue;
      saber.object.matrix.decompose(_b, _quat, _scale);
      const len = _a.distanceTo(_b);
      arm.position.copy(_a);
      arm.scale.set(1, Math.max(0.01, len), 1);
      arm.quaternion.setFromUnitVectors(_up, _b.sub(_a).normalize());
    }
  }

  /**
   * Called each XR frame after the headset view has been rendered.
   * xrCamera: renderer.xr.getCamera(); hidden: objects that must not show in the spectator view.
   */
  render(xrCamera, sabers, hidden, dt) {
    if (!this.active || this.mode === 'off') return;
    const now = performance.now() / 1000;
    if (now - this.lastRender < MIN_FRAME) return;
    this.lastRender = now;
    this.ensureRenderer();

    xrCamera.matrixWorld.decompose(_pos, _quat, _scale);
    const cam = this.camera;
    if (this.mode === 'first') {
      // Smoothed head camera with a wider field of view (less shaky than the raw headset view)
      if (!this.smoothInit) {
        this.smoothPos.copy(_pos);
        this.smoothQuat.copy(_quat);
        this.smoothInit = true;
      }
      const k = 1 - Math.exp(-dt * 10);
      this.smoothPos.lerp(_pos, k);
      this.smoothQuat.slerp(_quat, 1 - Math.exp(-dt * 6));
      cam.position.copy(this.smoothPos);
      cam.quaternion.copy(this.smoothQuat);
      if (cam.fov !== 80) {
        cam.fov = 80;
        cam.updateProjectionMatrix();
      }
      this.avatar.visible = false;
    } else {
      cam.position.set(_pos.x * 0.5, 2.6, 2.9);
      cam.lookAt(0, 1.1, -4);
      if (cam.fov !== 60) {
        cam.fov = 60;
        cam.updateProjectionMatrix();
      }
      this.updateAvatar(_pos, _quat, sabers);
      this.avatar.visible = true;
    }

    const prev = hidden.map((o) => o.visible);
    for (const o of hidden) o.visible = false;
    this.renderer.render(this.scene, cam);
    hidden.forEach((o, i) => (o.visible = prev[i]));
    this.avatar.visible = false;
  }
}
