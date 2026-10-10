// Frame-rate counter drawn inside the 3D view (so it also shows in the headset).
// Attached to the camera, lower left; redraws its small texture twice a second.
import * as THREE from 'three';

const W = 320;
const H = 112;
const WINDOW_MS = 500;

export class FpsMeter {
  constructor(camera) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = W;
    this.canvas.height = H;
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.generateMipmaps = false;
    this.texture.minFilter = THREE.LinearFilter;
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.25, (0.25 * H) / W),
      new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, depthTest: false, depthWrite: false, toneMapped: false }),
    );
    this.mesh.position.set(-0.32, -0.26, -1);
    this.mesh.renderOrder = 1000; // on top of everything
    this.mesh.visible = false;
    camera.add(this.mesh);
    this.enabled = false;
    this.target = 60; // refresh rate the colours are judged against
    this.reset(performance.now());
  }

  setEnabled(on) {
    this.enabled = !!on;
    this.mesh.visible = this.enabled;
    if (this.enabled) this.reset(performance.now());
  }

  /** Refresh rate to compare against (the headset's frame rate in VR). */
  setTarget(hz) {
    if (hz > 0) this.target = hz;
  }

  reset(now) {
    this.start = now;
    this.last = now;
    this.frames = 0;
    this.worst = 0;
  }

  /** Call once per rendered frame. */
  tick(now) {
    if (!this.enabled) return;
    const dt = now - this.last;
    this.last = now;
    this.frames++;
    if (dt > this.worst) this.worst = dt;
    const elapsed = now - this.start;
    if (elapsed < WINDOW_MS) return;
    this.draw((this.frames * 1000) / elapsed, this.worst);
    this.reset(now);
  }

  draw(fps, worstMs) {
    const { ctx } = this;
    const ratio = fps / this.target;
    const color = ratio >= 0.95 ? '#5ff0a0' : ratio >= 0.8 ? '#ffd166' : '#ff4d5e';
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(8, 10, 24, 0.72)';
    ctx.beginPath();
    ctx.roundRect(2, 2, W - 4, H - 4, 18);
    ctx.fill();
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = color;
    ctx.font = '800 54px system-ui, sans-serif';
    ctx.fillText(String(Math.round(fps)), 18, 62);
    const numW = ctx.measureText(String(Math.round(fps))).width;
    ctx.font = '700 26px system-ui, sans-serif';
    ctx.fillText('FPS', 26 + numW, 62);
    ctx.fillStyle = '#c8cde8';
    ctx.font = '600 22px system-ui, "Noto Sans TC", sans-serif';
    ctx.fillText(`最慢 ${worstMs.toFixed(1)} ms · 目標 ${Math.round(this.target)}`, 18, 96);
    this.texture.needsUpdate = true;
  }
}
