import * as THREE from 'three';

export const FONT = '"Segoe UI", "Noto Sans TC", "Noto Sans CJK TC", "PingFang TC", "Microsoft JhengHei", system-ui, sans-serif';

export const THEME = {
  bg: 'rgba(10,12,28,0.92)',
  border: 'rgba(120,150,255,0.65)',
  btn: 'rgba(124,156,255,0.16)',
  btnHover: 'rgba(124,156,255,0.42)',
  btnActive: 'rgba(124,156,255,0.7)',
  btnBorder: 'rgba(140,170,255,0.6)',
  text: '#eef0ff',
  muted: '#9aa0c0',
  accent: '#8cb4ff',
  red: '#ff4d5e',
  green: '#60ffa0',
};

export function roundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/**
 * A flat, pointer-interactive panel drawn with Canvas 2D.
 * Content is drawn by a render function (immediate-mode): widgets register
 * their hit rectangles while drawing, so hit-testing always matches the picture.
 */
export class UIPanel {
  constructor(widthM, heightM, ppm = 500) {
    this.width = Math.round(widthM * ppm);
    this.height = Math.round(heightM * ppm);
    this.ppm = ppm;
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.width;
    this.canvas.height = this.height;
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    this.texture.generateMipmaps = true;
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(widthM, heightM),
      new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, fog: false, depthWrite: false }),
    );
    this.mesh.renderOrder = 30;
    this.mesh.visible = false;
    this.mesh.userData.panel = this;
    this.renderFn = null;
    this.hits = [];
    this.hover = new Map();
    this.dirty = false;
  }

  show(renderFn) {
    if (renderFn) this.renderFn = renderFn;
    this.mesh.visible = true;
    this.invalidate();
  }

  hide() {
    this.mesh.visible = false;
    this.hover.clear();
  }

  invalidate() {
    this.dirty = true;
  }

  update() {
    if (!this.dirty || !this.mesh.visible || !this.renderFn) return;
    this.dirty = false;
    const { ctx } = this;
    ctx.clearRect(0, 0, this.width, this.height);
    this.hits = [];
    this.renderFn(this, ctx);
    this.texture.needsUpdate = true;
  }

  /** Panel-local metres -> canvas pixels and back */
  toLocal(px, py) {
    return new THREE.Vector3(px / this.ppm - this.width / this.ppm / 2, this.height / this.ppm / 2 - py / this.ppm, 0);
  }

  hitAt(uv) {
    const x = uv.x * this.width;
    const y = (1 - uv.y) * this.height;
    for (let i = this.hits.length - 1; i >= 0; i--) {
      const h = this.hits[i];
      if (x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h) return h;
    }
    return null;
  }

  setHover(pointerId, id) {
    const prev = this.hover.get(pointerId) ?? null;
    if (prev === id) return;
    if (id === null) this.hover.delete(pointerId);
    else this.hover.set(pointerId, id);
    this.invalidate();
  }

  isHovered(id) {
    for (const v of this.hover.values()) if (v === id) return true;
    return false;
  }

  /** Returns true when a clickable widget handled the click. */
  click(uv) {
    const h = this.hitAt(uv);
    if (h && h.onClick && !h.disabled) {
      h.onClick();
      this.invalidate();
      return true;
    }
    return false;
  }

  /** The draggable widget (onDrag) at a point, or null. */
  dragAt(uv) {
    const h = this.hitAt(uv);
    return h && h.onDrag && !h.disabled ? h : null;
  }

  /**
   * Drags widget `id` to a point (uv on the panel, may lie outside the widget): calls its
   * onDrag(u, v) with the point inside the widget's rectangle (0..1, clamped), and on the
   * last call (end) its onDragEnd(u, v). Hit rectangles are looked up by id each time, as
   * the panel redraws while dragging.
   */
  drag(id, uv, end = false) {
    let h = null;
    for (let i = this.hits.length - 1; i >= 0; i--) {
      if (this.hits[i].id === id) {
        h = this.hits[i];
        break;
      }
    }
    if (!h || !h.onDrag || h.disabled) return false;
    const x = uv.x * this.width;
    const y = (1 - uv.y) * this.height;
    const u = Math.max(0, Math.min(1, (x - h.x) / h.w));
    const v = Math.max(0, Math.min(1, (y - h.y) / h.h));
    h.onDrag(u, v);
    if (end) h.onDragEnd?.(u, v);
    this.invalidate();
    return true;
  }

  scroll(uv, dir) {
    const x = uv.x * this.width;
    const y = (1 - uv.y) * this.height;
    for (let i = this.hits.length - 1; i >= 0; i--) {
      const h = this.hits[i];
      if (h.onScroll && x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h) {
        h.onScroll(dir);
        this.invalidate();
        return true;
      }
    }
    return false;
  }

  // ----- drawing helpers ------------------------------------------------------
  background(r = 40) {
    const { ctx } = this;
    ctx.fillStyle = THEME.bg;
    roundRect(ctx, 4, 4, this.width - 8, this.height - 8, r);
    ctx.fill();
    ctx.strokeStyle = THEME.border;
    ctx.lineWidth = 4;
    ctx.stroke();
  }

  text(str, x, y, { size = 32, color = THEME.text, weight = 600, align = 'left', maxWidth, baseline = 'alphabetic' } = {}) {
    const { ctx } = this;
    ctx.font = `${weight} ${size}px ${FONT}`;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.textBaseline = baseline;
    let s = String(str ?? '');
    if (maxWidth && ctx.measureText(s).width > maxWidth) {
      while (s.length > 1 && ctx.measureText(`${s}…`).width > maxWidth) s = s.slice(0, -1);
      s += '…';
    }
    ctx.fillText(s, x, y);
    return ctx.measureText(s).width;
  }

  area(id, x, y, w, h, opts = {}) {
    this.hits.push({ id, x, y, w, h, ...opts });
  }

  button(id, x, y, w, h, label, { onClick, active = false, disabled = false, size = 30, color, radius = 14, align = 'center', sub } = {}) {
    const { ctx } = this;
    const hover = !disabled && this.isHovered(id);
    ctx.fillStyle = active ? THEME.btnActive : hover ? THEME.btnHover : THEME.btn;
    roundRect(ctx, x, y, w, h, radius);
    ctx.fill();
    ctx.strokeStyle = hover || active ? '#ffffff' : THEME.btnBorder;
    ctx.lineWidth = hover ? 4 : 2;
    ctx.stroke();
    ctx.globalAlpha = disabled ? 0.4 : 1;
    const tx = align === 'center' ? x + w / 2 : x + 20;
    if (sub) {
      this.text(label, tx, y + h / 2 - 4, { size, color: color || THEME.text, align, weight: 700, maxWidth: w - 24 });
      this.text(sub, tx, y + h / 2 + size * 0.8, { size: size * 0.6, color: THEME.muted, align, maxWidth: w - 24 });
    } else {
      this.text(label, tx, y + h / 2, { size, color: color || THEME.text, align, weight: 700, baseline: 'middle', maxWidth: w - 24 });
    }
    ctx.globalAlpha = 1;
    this.area(id, x, y, w, h, { onClick, disabled });
  }

  image(img, x, y, w, h, r = 12) {
    const { ctx } = this;
    ctx.save();
    roundRect(ctx, x, y, w, h, r);
    ctx.clip();
    if (img && img.complete !== false && (img.naturalWidth || img.width)) {
      try {
        ctx.drawImage(img, x, y, w, h);
      } catch (e) {
        ctx.fillStyle = '#223';
        ctx.fillRect(x, y, w, h);
      }
    } else {
      ctx.fillStyle = '#1c1e30';
      ctx.fillRect(x, y, w, h);
    }
    ctx.restore();
  }

  /**
   * A horizontal slider (track, filled part and knob) at frac 0..1. Pressing anywhere on it
   * jumps there, holding and moving drags it: onDrag(u) with u 0..1 along the track; the touch
   * area reaches `pad` pixels above and below the track.
   */
  slider(id, x, y, w, h, frac, { onDrag, onDragEnd, disabled = false, color = THEME.accent, pad = 26 } = {}) {
    const { ctx } = this;
    const f = Math.max(0, Math.min(1, frac || 0));
    const hover = !disabled && this.isHovered(id);
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    roundRect(ctx, x, y, w, h, h / 2);
    ctx.fill();
    ctx.fillStyle = color;
    roundRect(ctx, x, y, Math.max(h, w * f), h, h / 2);
    ctx.fill();
    const r = h * 0.9 + (hover ? 4 : 0);
    ctx.beginPath();
    ctx.arc(x + w * f, y + h / 2, r, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = color;
    ctx.stroke();
    this.area(id, x, y - pad, w, h + pad * 2, { disabled, onDrag, onDragEnd });
  }

  bar(x, y, w, h, frac, color = THEME.accent) {
    const { ctx } = this;
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    roundRect(ctx, x, y, w, h, h / 2);
    ctx.fill();
    ctx.fillStyle = color;
    roundRect(ctx, x, y, Math.max(h, w * Math.max(0, Math.min(1, frac))), h, h / 2);
    ctx.fill();
  }
}
