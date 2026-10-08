import * as THREE from 'three';
import { UIPanel, THEME, roundRect } from './ui/UIPanel.js';
import { settings, RANGES } from '../settings.js';
import { searchMaps, latestVersion } from '../beatsaver.js';
import { diffName, defaultSetIndex, mapStats } from '../library.js';
import { DIFF_NAMES } from '../mapLoader.js';

const DIFF_COLORS = { Easy: '#4cdf8f', Normal: '#59b0f4', Hard: '#ff9d3a', Expert: '#ff4d5e', ExpertPlus: '#c46cff' };
const SORTS = [
  ['Rating', '高評分'],
  ['Latest', '最新'],
  ['Curated', '精選'],
];
const KEY_ROWS = ['1234567890', 'QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM'];
const ROWS = 5;

const CX = 290; // content area left
const CW = 985; // content area width

function fmtDuration(s) {
  s = Math.max(0, Math.round(s || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * In-VR menus: song library, BeatSaver browser, song details, settings,
 * calibration, plus the ready / pause / results screens (also used on desktop).
 */
export class Menu {
  constructor(game) {
    this.game = game;
    this.library = game.library;
    this.panel = new UIPanel(2.6, 1.6, 500);
    this.panel.mesh.position.set(0, 1.45, -2.0);
    game.scene.add(this.panel.mesh);

    this.page = 'library';
    this.status = '';
    this.libScroll = 0;
    this.browse = { sort: 'Rating', query: '', page: 0, scroll: 0, results: [], loading: false, error: '', keyboard: false, loaded: false };
    this.song = { entry: null, setIdx: 0, diffIdx: 0, preview: null };
    this.covers = new Map();
    this.headReadout = 0;

    // Calibration beat indicator (a 3D ring so it can flash every frame cheaply)
    this.pulse = new THREE.Mesh(
      new THREE.RingGeometry(0.08, 0.13, 48),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, fog: false }),
    );
    this.pulse.renderOrder = 35;
    this.pulse.visible = false;
    this.panel.mesh.add(this.pulse);

    settings.subscribe(() => this.panel.invalidate());
    this.library.subscribe(() => this.panel.invalidate());
  }

  get panels() {
    return [this.panel];
  }

  get visible() {
    return this.panel.mesh.visible;
  }

  open(page) {
    if (page) this.page = page;
    if (this.page !== 'calibrate') this.stopCalibration();
    this.panel.show((p) => this.render(p));
  }

  hide() {
    this.stopCalibration();
    this.panel.hide();
    this.pulse.visible = false;
  }

  /** Bottom status line; clears itself after a few seconds unless sticky. */
  setStatus(text, sticky = false) {
    this.status = text;
    clearTimeout(this.statusTimer);
    if (text && !sticky) {
      this.statusTimer = setTimeout(() => {
        this.status = '';
        this.panel.invalidate();
      }, 4000);
    }
    this.panel.invalidate();
  }

  placeForHeight(h) {
    this.panel.mesh.position.y = Math.max(1.0, Math.min(1.9, h - 0.35));
  }

  /** Per-frame work (calibration pulse, live readouts). */
  update(dt) {
    const cal = this.game.calibrator;
    if (this.visible && this.page === 'calibrate') {
      cal.schedule();
      this.pulse.visible = cal.running;
      if (cal.running) {
        const k = cal.pulse();
        this.pulse.material.opacity = 0.15 + 0.85 * k;
        this.pulse.scale.setScalar(1 + 0.35 * k);
      }
      this.headTimer = (this.headTimer || 0) + dt;
      if (this.headTimer > 0.25) {
        this.headTimer = 0;
        const y = Math.round(this.game.headPos.y * 100) / 100;
        if (y !== this.headReadout) {
          this.headReadout = y;
          this.panel.invalidate();
        }
      }
    } else this.pulse.visible = false;
    this.panel.update();
  }

  /** Trigger pressed while not pointing at a widget. */
  onFreeTrigger() {
    if (this.visible && this.page === 'calibrate' && this.game.calibrator.running) {
      this.game.calibrator.tap();
      this.panel.invalidate();
      return true;
    }
    return false;
  }

  stopCalibration() {
    if (this.game?.calibrator?.running) this.game.calibrator.stop();
  }

  cover(url) {
    if (!url) return null;
    let img = this.covers.get(url);
    if (!img) {
      img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => this.panel.invalidate();
      img.src = url;
      this.covers.set(url, img);
      if (this.covers.size > 80) this.covers.delete(this.covers.keys().next().value);
    }
    return img;
  }

  // ---------------------------------------------------------------------------
  render(p) {
    p.background();
    const full = { ready: this.renderReady, pause: this.renderPause, results: this.renderResults, loading: this.renderLoading }[this.page];
    if (full) full.call(this, p);
    else {
      this.renderSidebar(p);
      const fn = { library: this.renderLibrary, browse: this.renderBrowse, song: this.renderSong, settings: this.renderSettings, calibrate: this.renderCalibrate }[this.page];
      fn?.call(this, p);
    }
    if (this.status) {
      const { ctx } = p;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      roundRect(ctx, 300, p.height - 62, p.width - 330, 44, 12);
      ctx.fill();
      p.text(this.status, 320, p.height - 32, { size: 24, color: THEME.accent, maxWidth: p.width - 370 });
    }
  }

  renderSidebar(p) {
    p.text('WebXR', 30, 68, { size: 34, weight: 900, color: '#ff4d5e' });
    p.text('Saber', 136, 68, { size: 34, weight: 900, color: '#59b0f4' });
    const items = [
      ['library', `歌曲庫 (${this.library.entries.length})`],
      ['browse', 'BeatSaver'],
      ['settings', '設定'],
      ['calibrate', '身高 / 延遲校正'],
    ];
    items.forEach(([page, label], i) => {
      const active = this.page === page || (page === 'library' && this.page === 'song');
      p.button(`nav-${page}`, 24, 110 + i * 92, 240, 76, label, { active, size: 28, onClick: () => this.open(page) });
    });
    if (this.game.mode === 'vr') {
      p.button('nav-exit', 24, 110 + 4 * 92 + 40, 240, 70, '離開 VR', { size: 26, color: THEME.red, onClick: () => this.game.exitVR() });
    }
  }

  rowBg(p, id, x, y, w, h, onClick) {
    const { ctx } = p;
    const hover = p.isHovered(id);
    ctx.fillStyle = hover ? 'rgba(124,156,255,0.3)' : 'rgba(255,255,255,0.04)';
    roundRect(ctx, x, y, w, h, 12);
    ctx.fill();
    if (hover) {
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 3;
      ctx.stroke();
    }
    p.area(id, x, y, w, h, { onClick });
  }

  scrollButtons(p, id, x, y, h, pos, max, setPos) {
    if (max <= 0) return;
    p.button(`${id}-up`, x, y, 70, 70, '▲', { disabled: pos <= 0, onClick: () => setPos(Math.max(0, pos - ROWS)) });
    p.button(`${id}-down`, x, y + h - 70, 70, 70, '▼', { disabled: pos >= max, onClick: () => setPos(Math.min(max, pos + ROWS)) });
    p.text(`${Math.min(pos + ROWS, max + ROWS)}/${max + ROWS}`, x + 35, y + h / 2 + 10, { size: 22, color: THEME.muted, align: 'center' });
  }

  // ----- library --------------------------------------------------------------
  renderLibrary(p) {
    const list = this.library.entries;
    p.text('歌曲庫', CX, 75, { size: 44, weight: 800 });
    p.text('最近載入的譜面（網頁上載入的也會出現在這裡）', CX + 170, 75, { size: 24, color: THEME.muted });
    if (!list.length) {
      p.text('還沒有歌曲', CX + CW / 2, 300, { size: 40, align: 'center', color: THEME.muted });
      p.text('到「BeatSaver」頁搜尋下載，或在網頁上載入 .zip / 資料夾', CX + CW / 2, 360, { size: 28, align: 'center', color: THEME.muted });
      p.button('lib-go-browse', CX + CW / 2 - 180, 420, 360, 80, '前往 BeatSaver', { onClick: () => this.open('browse') });
      return;
    }
    const max = Math.max(0, list.length - ROWS);
    this.libScroll = Math.min(this.libScroll, max);
    const rowW = CW - 100;
    p.area('lib-list', CX, 105, rowW, ROWS * 124, { onScroll: (d) => (this.libScroll = Math.max(0, Math.min(max, this.libScroll + d))) });
    for (let i = 0; i < ROWS; i++) {
      const e = list[this.libScroll + i];
      if (!e) break;
      const y = 105 + i * 124;
      this.rowBg(p, `lib-${e.key}`, CX, y, rowW, 112, () => this.openSong(e));
      p.image(e.coverImage, CX + 8, y + 8, 96, 96);
      p.text(e.info.title, CX + 124, y + 48, { size: 34, weight: 700, maxWidth: rowW - 140 });
      p.text(`${e.info.artist} · 譜師 ${e.info.mapper || '-'}`, CX + 124, y + 88, { size: 24, color: THEME.muted, maxWidth: rowW - 140 });
    }
    this.scrollButtons(p, 'lib', CX + rowW + 20, 105, ROWS * 124 - 12, this.libScroll, max, (v) => (this.libScroll = v));
  }

  // ----- BeatSaver --------------------------------------------------------------
  async loadBrowse() {
    const b = this.browse;
    b.loading = true;
    b.error = '';
    b.loaded = true;
    this.panel.invalidate();
    const token = (this.browseToken = {});
    try {
      const docs = await searchMaps(b.query, b.page, b.query ? 'Relevance' : b.sort);
      if (token !== this.browseToken) return;
      b.results = docs;
      b.scroll = 0;
    } catch (e) {
      b.error = e.message;
      b.results = [];
    }
    b.loading = false;
    this.panel.invalidate();
  }

  renderBrowse(p) {
    const b = this.browse;
    if (!b.loaded && !b.loading) this.loadBrowse();
    p.text('BeatSaver', CX, 75, { size: 44, weight: 800 });
    SORTS.forEach(([key, label], i) => {
      p.button(`sort-${key}`, CX + i * 170, 100, 156, 60, label, {
        size: 26,
        active: !b.query && b.sort === key,
        onClick: () => {
          b.sort = key;
          b.query = '';
          b.page = 0;
          this.loadBrowse();
        },
      });
    });
    p.button('search-open', CX + 3 * 170, 100, CW - 3 * 170, 60, b.query ? `🔍 ${b.query}` : '🔍 搜尋（英數）…', {
      size: 26,
      active: !!b.query,
      align: 'left',
      onClick: () => {
        b.keyboard = true;
        b.draft = b.query;
      },
    });
    if (b.keyboard) {
      this.renderKeyboard(p);
      return;
    }
    const top = 180;
    if (b.loading) p.text('讀取中…', CX + CW / 2, 400, { size: 34, align: 'center', color: THEME.muted });
    else if (b.error) p.text(b.error, CX + CW / 2, 400, { size: 30, align: 'center', color: THEME.red });
    else if (!b.results.length) p.text('沒有結果', CX + CW / 2, 400, { size: 34, align: 'center', color: THEME.muted });
    const rowW = CW - 100;
    const max = Math.max(0, b.results.length - ROWS);
    b.scroll = Math.min(b.scroll, max);
    p.area('bs-list', CX, top, rowW, ROWS * 96, { onScroll: (d) => (b.scroll = Math.max(0, Math.min(max, b.scroll + d))) });
    if (!b.loading) {
      for (let i = 0; i < ROWS; i++) {
        const doc = b.results[b.scroll + i];
        if (!doc) break;
        const v = latestVersion(doc);
        const y = top + i * 96;
        this.rowBg(p, `bs-${doc.id}`, CX, y, rowW, 88, () => this.downloadMap(doc));
        p.image(this.cover(v?.coverURL), CX + 8, y + 8, 72, 72, 10);
        p.text(doc.name, CX + 96, y + 38, { size: 30, weight: 700, maxWidth: rowW - 120 });
        const diffs = [...new Set((v?.diffs || []).map((d) => DIFF_NAMES[d.difficulty] || d.difficulty))].join(' / ');
        const md = doc.metadata || {};
        const rating = doc.stats?.score ? ` · ${Math.round(doc.stats.score * 100)}%` : '';
        p.text(`${md.songAuthorName || ''} · ${md.levelAuthorName || ''} · ${fmtDuration(md.duration)}${rating} · ${diffs}`, CX + 96, y + 72, { size: 22, color: THEME.muted, maxWidth: rowW - 120 });
      }
    }
    this.scrollButtons(p, 'bs', CX + rowW + 20, top, ROWS * 96 - 8, b.scroll, max, (val) => (b.scroll = val));
    // API pages
    const py = top + ROWS * 96 + 8;
    p.button('bs-prev', CX, py, 220, 52, '◀ 上一頁', { size: 24, disabled: b.page === 0 || b.loading, onClick: () => { b.page--; this.loadBrowse(); } });
    p.text(`第 ${b.page + 1} 頁`, CX + 330, py + 36, { size: 26, color: THEME.muted, align: 'center' });
    p.button('bs-next', CX + 440, py, 220, 52, '下一頁 ▶', { size: 24, disabled: b.results.length < 20 || b.loading, onClick: () => { b.page++; this.loadBrowse(); } });
  }

  renderKeyboard(p) {
    const b = this.browse;
    const { ctx } = p;
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    roundRect(ctx, CX, 180, CW, 92, 14);
    ctx.fill();
    p.text(`${b.draft || ''}▏`, CX + 24, 240, { size: 40, weight: 700, maxWidth: CW - 48 });
    const kw = 88;
    const kh = 76;
    KEY_ROWS.forEach((row, r) => {
      const x0 = CX + (CW - row.length * (kw + 8)) / 2;
      [...row].forEach((ch, i) => {
        p.button(`key-${ch}`, x0 + i * (kw + 8), 292 + r * (kh + 8), kw, kh, ch, { size: 32, onClick: () => (b.draft = (b.draft || '') + ch.toLowerCase()) });
      });
    });
    const y = 292 + 4 * (kh + 8);
    p.button('key-space', CX + 60, y, 300, kh, '空白', { size: 28, onClick: () => (b.draft = `${b.draft || ''} `) });
    p.button('key-back', CX + 375, y, 170, kh, '⌫', { size: 32, onClick: () => (b.draft = (b.draft || '').slice(0, -1)) });
    p.button('key-clear', CX + 560, y, 140, kh, '清除', { size: 26, onClick: () => (b.draft = '') });
    p.button('key-cancel', CX + 715, y, 120, kh, '取消', { size: 26, onClick: () => (b.keyboard = false) });
    p.button('key-go', CX + 850, y, 135, kh, '搜尋', {
      size: 28,
      active: true,
      onClick: () => {
        b.query = (b.draft || '').trim();
        b.keyboard = false;
        b.page = 0;
        this.loadBrowse();
      },
    });
  }

  async downloadMap(doc) {
    if (this.downloading) return;
    this.downloading = true;
    let last = 0;
    try {
      this.setStatus(`下載中：${doc.name}…`, true);
      const entry = await this.library.addBeatSaver(doc, (f) => {
        const now = performance.now();
        if (now - last > 200) {
          last = now;
          this.setStatus(`下載中：${doc.name} ${Math.round(f * 100)}%`, true);
        }
      });
      this.setStatus('');
      this.openSong(entry);
    } catch (e) {
      console.error(e);
      this.setStatus(`下載失敗：${e.message}`);
    }
    this.downloading = false;
  }

  // ----- song details -------------------------------------------------------------
  openSong(entry, setIdx, diffIdx) {
    const s = this.song;
    s.entry = entry;
    s.setIdx = setIdx ?? defaultSetIndex(entry.info);
    s.diffIdx = diffIdx ?? entry.info.sets[s.setIdx].diffs.length - 1;
    this.previewDiff();
    this.open('song');
  }

  previewDiff() {
    const s = this.song;
    try {
      s.preview = this.library.loadDifficulty(s.entry, s.setIdx, s.diffIdx);
      s.error = '';
    } catch (e) {
      s.preview = null;
      s.error = e.message;
    }
  }

  renderSong(p) {
    const s = this.song;
    const e = s.entry;
    if (!e) return this.renderLibrary(p);
    const info = e.info;
    p.image(e.coverImage, CX, 40, 220, 220, 16);
    const tx = CX + 250;
    p.text(info.title, tx, 95, { size: 46, weight: 800, maxWidth: CW - 260 });
    p.text(info.subTitle, tx, 140, { size: 28, color: THEME.muted, maxWidth: CW - 260 });
    p.text(info.artist, tx, 185, { size: 32, maxWidth: CW - 260 });
    p.text(`譜師 ${info.mapper || '-'} · BPM ${Math.round(info.bpm * 100) / 100}`, tx, 230, { size: 26, color: THEME.muted, maxWidth: CW - 260 });

    info.sets.forEach((set, i) => {
      p.button(`char-${i}`, CX + i * 196, 285, 184, 56, set.characteristic, {
        size: 24,
        active: i === s.setIdx,
        onClick: () => {
          s.setIdx = i;
          s.diffIdx = info.sets[i].diffs.length - 1;
          this.previewDiff();
        },
      });
    });
    const set = info.sets[s.setIdx];
    set.diffs.forEach((d, i) => {
      p.button(`diff-${i}`, CX + i * 196, 356, 184, 72, diffName(d), {
        size: 28,
        color: DIFF_COLORS[d.difficulty],
        active: i === s.diffIdx,
        onClick: () => {
          s.diffIdx = i;
          this.previewDiff();
        },
      });
    });
    if (s.preview) {
      const m = s.preview.map;
      const st = mapStats(m);
      p.text(`方塊 ${m.colorNotes} · 鏈 ${m.links} · 弧線 ${m.arcs.length} · 炸彈 ${st.bombs} · 牆 ${m.walls.length}`, CX, 480, { size: 26, color: THEME.muted });
      const extra = [];
      if (m.njsEvents) extra.push(`NJS 變速事件 ${m.njsEvents}`);
      if (s.preview.meta.colors) extra.push(settings.get('useMapColors') ? '使用譜面自訂顏色' : '譜面有自訂顏色（已停用）');
      p.text(`NJS ${m.njs} · NPS ${st.nps} · 譜面格式 v${m.version}${extra.length ? ` · ${extra.join(' · ')}` : ''}`, CX, 518, { size: 26, color: THEME.muted, maxWidth: CW });
      if (s.preview.meta.colors) this.colorSwatches(p, s.preview.meta.colors, CX, 545);
    } else if (s.error) p.text(`難度解析失敗：${s.error}`, CX, 500, { size: 26, color: THEME.red });
    p.button('song-play', CX, 610, 460, 110, '▶ 開始遊玩', {
      size: 42,
      active: true,
      disabled: !s.preview,
      onClick: () => this.game.playEntry(e, s.setIdx, s.diffIdx),
    });
    p.button('song-back', CX + 490, 610, 260, 110, '返回歌曲庫', { size: 28, onClick: () => this.open('library') });
  }

  colorSwatches(p, colors, x, y) {
    const keys = [['left', '左'], ['right', '右'], ['envLeft', '燈L'], ['envRight', '燈R'], ['obstacle', '牆']];
    let cx = x;
    for (const [k, label] of keys) {
      if (colors[k] == null) continue;
      const { ctx } = p;
      ctx.fillStyle = `#${colors[k].toString(16).padStart(6, '0')}`;
      roundRect(ctx, cx, y + 8, 34, 34, 8);
      ctx.fill();
      p.text(label, cx + 42, y + 34, { size: 22, color: THEME.muted });
      cx += 110;
    }
  }

  // ----- settings ---------------------------------------------------------------
  toggleRow(p, id, x, y, label, key) {
    const on = !!settings.get(key);
    p.text(label, x, y + 44, { size: 30 });
    p.button(id, x + 300, y + 8, 150, 60, on ? '開' : '關', { size: 28, active: on, onClick: () => settings.set({ [key]: !on }) });
  }

  stepperRow(p, id, x, y, label, key, fmt, w = 470) {
    p.text(label, x, y + 44, { size: 30 });
    const bx = x + w - 290;
    p.button(`${id}-minus`, bx, y + 8, 70, 60, '−', { size: 34, onClick: () => settings.step(key, -1), disabled: settings.get(key) <= RANGES[key].min });
    p.text(fmt(settings.get(key)), bx + 145, y + 48, { size: 30, align: 'center', weight: 700 });
    p.button(`${id}-plus`, bx + 220, y + 8, 70, 60, '+', { size: 34, onClick: () => settings.step(key, 1), disabled: settings.get(key) >= RANGES[key].max });
  }

  renderSettings(p) {
    p.text('設定', CX, 75, { size: 44, weight: 800 });
    const L = CX;
    const R = CX + 510;
    this.toggleRow(p, 'set-nofail', L, 110, '不會失敗', 'noFail');
    this.toggleRow(p, 'set-auto', L, 200, '自動遊玩', 'autoplay');
    this.toggleRow(p, 'set-mapcolors', L, 290, '譜面自訂顏色', 'useMapColors');
    p.text('電腦螢幕觀戰', L, 424, { size: 30 });
    [['third', '第三人稱'], ['first', '第一人稱'], ['off', '關閉']].forEach(([m, label], i) => {
      p.button(`set-spec-${m}`, L + i * 152, 450, 142, 60, label, { size: 24, active: settings.get('spectator') === m, onClick: () => settings.set({ spectator: m }) });
    });
    p.text('光劍顏色可在網頁設定中更改', L, 570, { size: 22, color: THEME.muted });

    const pct = (v) => `${Math.round(v * 100)}%`;
    this.stepperRow(p, 'set-vol', R, 110, '音樂音量', 'volume', pct);
    this.stepperRow(p, 'set-sfx', R, 200, '打擊音效', 'sfxVolume', pct);
    this.stepperRow(p, 'set-angle', R, 290, '光劍角度', 'saberAngle', (v) => `${v}°`);
    this.stepperRow(p, 'set-latency', R, 380, '音訊延遲', 'audioLatencyMs', (v) => `${v > 0 ? '+' : ''}${v} ms`);
    this.stepperRow(p, 'set-height', R, 470, '身高', 'playerHeight', (v) => `${v.toFixed(2)} m`);
    p.button('set-go-cal', R, 575, 470, 70, '前往身高 / 延遲校正', { size: 26, onClick: () => this.open('calibrate') });
  }

  // ----- calibration ------------------------------------------------------------
  renderCalibrate(p) {
    const cal = this.game.calibrator;
    p.text('校正', CX, 75, { size: 44, weight: 800 });
    const { ctx } = p;
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(CX + 480, 110);
    ctx.lineTo(CX + 480, 720);
    ctx.stroke();

    // Height
    const L = CX;
    p.text('身高', L, 140, { size: 34, weight: 800 });
    p.text(`${settings.get('playerHeight').toFixed(2)} m`, L, 220, { size: 64, weight: 900, color: THEME.accent });
    p.text('方塊與牆壁的高度會依身高調整', L, 270, { size: 24, color: THEME.muted });
    if (this.game.mode === 'vr') {
      p.text(`目前頭部高度 ${this.headReadout.toFixed(2)} m`, L, 310, { size: 24, color: THEME.muted });
      p.text('站直、看向前方，再按「測量」', L, 350, { size: 26 });
      p.button('cal-measure', L, 380, 440, 90, '測量身高', {
        size: 34,
        active: true,
        onClick: () => {
          const h = Math.round((this.game.headPos.y + 0.1) * 100) / 100;
          settings.set({ playerHeight: h });
          this.setStatus(`已設定身高 ${settings.get('playerHeight').toFixed(2)} m（頭部高度 + 10 cm）`);
        },
      });
    }
    p.button('cal-h-m', L, 500, 140, 70, '−1 cm', { size: 26, onClick: () => settings.step('playerHeight', -1) });
    p.button('cal-h-p', L + 150, 500, 140, 70, '+1 cm', { size: 26, onClick: () => settings.step('playerHeight', 1) });
    p.button('cal-h-reset', L + 300, 500, 140, 70, '預設', { size: 26, onClick: () => settings.set({ playerHeight: 1.8 }) });

    // Audio latency
    const R = CX + 520;
    const lat = settings.get('audioLatencyMs');
    p.text('音訊延遲', R, 140, { size: 34, weight: 800 });
    p.text(`${lat > 0 ? '+' : ''}${lat} ms`, R, 220, { size: 64, weight: 900, color: THEME.accent });
    p.button('cal-test', R, 245, 440, 80, cal.running ? '停止節拍測試' : '開始節拍測試', {
      size: 30,
      active: !cal.running,
      onClick: () => (cal.running ? cal.stop() : cal.start(100)),
    });
    if (cal.running) {
      p.text('聽到「嗒」聲的同時扣扳機', R, 365, { size: 26 });
      p.text('（瞄準面板空白處或任何地方都可以）', R, 398, { size: 22, color: THEME.muted });
      const res = cal.result;
      p.text(`已敲 ${cal.count} 次${res !== null ? ` · 測得 ${res > 0 ? '+' : ''}${res} ms` : '（至少 6 次）'}`, R, 440, { size: 26, color: res !== null ? THEME.green : THEME.muted });
      p.button('cal-apply', R, 460, 440, 66, res !== null ? `套用 ${res} ms` : '套用測得值', {
        size: 26,
        disabled: res === null,
        onClick: () => {
          settings.set({ audioLatencyMs: res });
          this.setStatus(`已套用音訊延遲 ${settings.get('audioLatencyMs')} ms`);
        },
      });
      p.text('微調：讓光圈閃爍和聲音同時發生', R, 560, { size: 22, color: THEME.muted });
    } else {
      p.text('戴藍牙耳機或覺得節奏不準時使用', R, 365, { size: 24, color: THEME.muted });
      p.text('正值 = 聲音比畫面晚到', R, 400, { size: 24, color: THEME.muted });
    }
    p.button('cal-l-m', R, 580, 140, 70, '−5 ms', { size: 26, onClick: () => settings.step('audioLatencyMs', -1) });
    p.button('cal-l-p', R + 150, 580, 140, 70, '+5 ms', { size: 26, onClick: () => settings.step('audioLatencyMs', 1) });
    p.button('cal-l-reset', R + 300, 580, 140, 70, '歸零', { size: 26, onClick: () => settings.set({ audioLatencyMs: 0 }) });
    // beat indicator position
    const local = p.toLocal(R + 380, 145);
    this.pulse.position.set(local.x, local.y, 0.01);
  }

  // ----- in-game screens ----------------------------------------------------------
  renderLoading(p) {
    p.text('載入中…', p.width / 2, p.height / 2, { size: 56, weight: 800, align: 'center' });
  }

  songCard(p, y = 60) {
    const m = this.game.meta;
    if (!m) return;
    p.image(m.coverImage, 80, y, 240, 240, 18);
    p.text(m.title, 360, y + 70, { size: 54, weight: 800, maxWidth: p.width - 420 });
    p.text(m.subTitle, 360, y + 115, { size: 28, color: THEME.muted, maxWidth: p.width - 420 });
    p.text(m.artist, 360, y + 165, { size: 34, maxWidth: p.width - 420 });
    p.text(`${m.characteristic} · ${m.difficultyName} · 譜師 ${m.mapper || '-'}`, 360, y + 215, { size: 30, color: THEME.accent, maxWidth: p.width - 420 });
  }

  renderReady(p) {
    const g = this.game;
    this.songCard(p);
    const hint = g.mode === 'vr' ? 'B / Y：暫停 · 用雷射指向按鈕並扣扳機' : '空白鍵：開始 / 暫停 · Esc：離開 · 滑鼠：揮劍（按住左鍵換紅劍）';
    p.text(hint, p.width / 2, 400, { size: 28, color: THEME.muted, align: 'center' });
    p.button('ready-start', p.width / 2 - 330, 460, 420, 130, '▶ 開始', { size: 54, active: true, onClick: () => g.beginPlay() });
    p.button('ready-back', p.width / 2 + 110, 460, 220, 130, '返回', { size: 34, onClick: () => g.exitToMenu() });
    if (g.mode === 'vr') {
      p.button('ready-settings', p.width / 2 - 330, 615, 660, 70, `身高 ${settings.get('playerHeight').toFixed(2)} m · 延遲 ${settings.get('audioLatencyMs')} ms · 修改設定`, {
        size: 24,
        onClick: () => g.showMenu('settings'),
      });
    }
  }

  renderPause(p) {
    const g = this.game;
    p.text('暫停', p.width / 2, 130, { size: 96, weight: 900, align: 'center' });
    p.text(`${g.meta?.title || ''} · ${g.meta?.difficultyName || ''}`, p.width / 2, 190, { size: 30, color: THEME.muted, align: 'center', maxWidth: p.width - 100 });
    const bw = 340;
    const x0 = (p.width - bw * 3 - 40) / 2;
    p.button('pause-resume', x0, 240, bw, 120, '▶ 繼續', { size: 44, active: true, onClick: () => g.resume() });
    p.button('pause-restart', x0 + bw + 20, 240, bw, 120, '重新開始', { size: 40, onClick: () => g.restart() });
    p.button('pause-menu', x0 + 2 * (bw + 20), 240, bw, 120, '回到選單', { size: 40, onClick: () => g.exitToMenu() });
    const sx = (p.width - 1000) / 2;
    this.stepperRow(p, 'pause-lat', sx, 420, '音訊延遲', 'audioLatencyMs', (v) => `${v > 0 ? '+' : ''}${v} ms`, 480);
    this.stepperRow(p, 'pause-vol', sx + 520, 420, '音樂音量', 'volume', (v) => `${Math.round(v * 100)}%`, 480);
    this.stepperRow(p, 'pause-sfx', sx, 510, '打擊音效', 'sfxVolume', (v) => `${Math.round(v * 100)}%`, 480);
    this.stepperRow(p, 'pause-angle', sx + 520, 510, '光劍角度', 'saberAngle', (v) => `${v}°`, 480);
    const hint = g.mode === 'vr' ? 'A / X：重新開始 · B / Y：回到選單' : '空白鍵：繼續 · R：重新開始 · Esc：回到選單';
    p.text(hint, p.width / 2, 680, { size: 26, color: THEME.muted, align: 'center' });
  }

  renderResults(p) {
    const g = this.game;
    const r = g.lastResults;
    if (!r) return;
    p.text(r.failed ? 'LEVEL FAILED' : 'LEVEL CLEARED', p.width / 2, 110, { size: 80, weight: 900, align: 'center', color: r.failed ? THEME.red : THEME.green });
    p.text(`${r.title} · ${r.characteristic} ${r.difficulty}`, p.width / 2, 165, { size: 32, color: THEME.muted, align: 'center', maxWidth: p.width - 100 });
    p.text(`${r.rank}`, p.width / 2 - 40, 310, { size: 140, weight: 900, align: 'right' });
    p.text(`${r.percent.toFixed(2)}%`, p.width / 2 + 10, 300, { size: 80, weight: 800 });
    if (r.best) p.text(r.best.isNew ? '新紀錄！' : `最佳 ${r.best.score.toLocaleString('en-US')} (${r.best.percent.toFixed(2)}%)`, p.width / 2 + 10, 345, { size: 28, color: r.best.isNew ? THEME.green : THEME.muted });
    p.text(`分數 ${r.score.toLocaleString('en-US')}    最大連擊 ${r.maxCombo}`, p.width / 2, 420, { size: 38, align: 'center' });
    p.text(`命中 ${r.hits}    Miss ${r.misses}    壞切 ${r.badCuts}    炸彈 ${r.bombHits}`, p.width / 2, 470, { size: 32, color: THEME.muted, align: 'center' });
    p.button('res-again', p.width / 2 - 360, 540, 340, 120, '再玩一次', { size: 42, active: true, onClick: () => g.restart() });
    p.button('res-menu', p.width / 2 + 20, 540, 340, 120, '回到選單', { size: 42, onClick: () => g.exitToMenu() });
  }
}
