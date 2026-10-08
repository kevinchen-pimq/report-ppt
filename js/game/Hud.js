import * as THREE from 'three';

class CanvasPanel {
  constructor(widthM, heightM, pxPerM = 400) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.round(widthM * pxPerM);
    this.canvas.height = Math.round(heightM * pxPerM);
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(widthM, heightM),
      new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, depthWrite: false, fog: false }),
    );
    this.mesh.renderOrder = 10;
  }

  draw(fn) {
    const { ctx, canvas } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    fn(ctx, canvas.width, canvas.height);
    this.texture.needsUpdate = true;
  }
}

const FONT = '"Segoe UI", "Noto Sans TC", "PingFang TC", "Microsoft JhengHei", system-ui, sans-serif';

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export class Hud {
  constructor(scene) {
    this.root = new THREE.Group();
    scene.add(this.root);

    this.left = new CanvasPanel(1.0, 0.8);
    this.left.mesh.position.set(-2.1, 1.0, -3.6);
    this.left.mesh.rotation.y = 0.35;
    this.right = new CanvasPanel(1.0, 0.8);
    this.right.mesh.position.set(2.1, 1.0, -3.6);
    this.right.mesh.rotation.y = -0.35;
    this.bottom = new CanvasPanel(2.0, 0.24);
    this.bottom.mesh.position.set(0, 0.25, -3.2);
    this.bottom.mesh.rotation.x = -0.5;
    this.root.add(this.left.mesh, this.right.mesh, this.bottom.mesh);

    // Hit score popups
    this.popups = [];
    for (let i = 0; i < 12; i++) {
      const p = new CanvasPanel(0.6, 0.3, 256);
      p.mesh.visible = false;
      p.mesh.renderOrder = 15;
      scene.add(p.mesh);
      this.popups.push({ panel: p, life: 0, vel: new THREE.Vector3() });
    }
    this.popupNext = 0;
    this.lastKey = '';
  }

  setVisible(v) {
    this.root.visible = v;
  }

  update(score, progress, songTime, duration, dt) {
    const key = [score.score, score.combo, score.multiplier, score.progress, score.energy.toFixed(3), Math.floor(songTime), score.rank].join('|');
    if (key !== this.lastKey) {
      this.lastKey = key;
      this.drawLeft(score);
      this.drawRight(score);
      this.drawBottom(score, songTime, duration);
    }
    for (const p of this.popups) {
      if (p.life <= 0) continue;
      p.life -= dt;
      p.panel.mesh.position.addScaledVector(p.vel, dt);
      p.panel.mesh.material.opacity = Math.min(1, p.life * 2);
      if (p.life <= 0) p.panel.mesh.visible = false;
    }
  }

  drawLeft(s) {
    this.left.draw((ctx, w, h) => {
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.font = `600 48px ${FONT}`;
      ctx.fillText('COMBO', w / 2, 70);
      ctx.fillStyle = '#fff';
      ctx.font = `700 150px ${FONT}`;
      ctx.fillText(String(s.combo), w / 2, 210);
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.fillRect(w * 0.2, 240, w * 0.6, 3);
      ctx.font = `500 36px ${FONT}`;
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.fillText(`MISS ${s.misses + s.badCuts}`, w / 2, 295);
    });
  }

  drawRight(s) {
    this.right.draw((ctx, w, h) => {
      ctx.textAlign = 'center';
      // multiplier ring
      const cx = w / 2;
      const cy = 105;
      ctx.lineWidth = 12;
      ctx.strokeStyle = 'rgba(255,255,255,0.18)';
      ctx.beginPath();
      ctx.arc(cx, cy, 70, 0, Math.PI * 2);
      ctx.stroke();
      const need = s.multiplier * 2;
      const frac = s.multiplier >= 8 ? 1 : s.progress / need;
      ctx.strokeStyle = '#fff';
      ctx.beginPath();
      ctx.arc(cx, cy, 70, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.font = `700 72px ${FONT}`;
      ctx.fillText(`x${s.multiplier}`, cx, cy + 25);
      ctx.font = `700 76px ${FONT}`;
      ctx.fillText(s.score.toLocaleString('en-US'), cx, 260);
      ctx.font = `600 40px ${FONT}`;
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.fillText(`${(s.ratio * 100).toFixed(1)}%  ${s.rank}`, cx, 310);
    });
  }

  drawBottom(s, t, duration) {
    this.bottom.draw((ctx, w, h) => {
      // energy bar
      const bw = w * 0.9;
      const x = (w - bw) / 2;
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      roundRect(ctx, x, 10, bw, 36, 8);
      ctx.fill();
      const e = s.energy;
      ctx.fillStyle = e < 0.2 ? '#ff3040' : e < 0.5 ? '#ffc040' : '#ffffff';
      roundRect(ctx, x + 4, 14, Math.max(0, (bw - 8) * e), 28, 6);
      ctx.fill();
      // progress
      const p = duration > 0 ? Math.max(0, Math.min(1, t / duration)) : 0;
      ctx.fillStyle = 'rgba(255,255,255,0.2)';
      ctx.fillRect(x, 62, bw, 6);
      ctx.fillStyle = 'rgba(120,180,255,0.9)';
      ctx.fillRect(x, 62, bw * p, 6);
      ctx.font = `500 22px ${FONT}`;
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.textAlign = 'left';
      ctx.fillText(fmt(Math.max(0, t)), x, 92);
      ctx.textAlign = 'right';
      ctx.fillText(fmt(duration), x + bw, 92);
    });
  }

  popup(position, text, color) {
    const p = this.popups[this.popupNext];
    this.popupNext = (this.popupNext + 1) % this.popups.length;
    p.panel.draw((ctx, w, h) => {
      ctx.textAlign = 'center';
      ctx.font = `800 96px ${FONT}`;
      ctx.lineWidth = 8;
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.strokeText(text, w / 2, 105);
      ctx.fillStyle = color;
      ctx.fillText(text, w / 2, 105);
    });
    p.panel.mesh.position.set(position.x, position.y + 0.25, Math.min(position.z, -1.2) - 0.6);
    p.panel.mesh.material.opacity = 1;
    p.panel.mesh.visible = true;
    p.vel.set(0, 0.5, -1.5);
    p.life = 0.7;
  }

  clearPopups() {
    for (const p of this.popups) {
      p.life = 0;
      p.panel.mesh.visible = false;
    }
  }
}

function fmt(t) {
  t = Math.max(0, Math.floor(t));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}
