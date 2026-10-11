// Practice mode (like Beat Saber's): start anywhere in the song, change the speed, jump
// around while playing. Practice runs never fail and their scores are not saved.
//
// Speed: the song plays at `rate` (pitch changes with it) and the song clock (GameAudio.time)
// runs at rate x real time, so everything that follows the clock (notes, walls, arcs, lights,
// HUD) slows down / speeds up with the music.
//
// Seeking (seekTo): every subsystem is put into the state it has at the new song time:
//   notes / bombs / chains / walls   NoteManager.seek (spawn pointers by binary search)
//   arcs                             ArcManager.seek
//   lighting / environment           Environment.seek -> each lighting runtime's seek(t)
//   score                            kept (never saved), the streak starts over
//   audio                            the source restarts at the new position with a short fade
// A jump usually starts the clock a little earlier (lead) with the objects from the target on,
// so the first notes fly in instead of appearing next to the player.

import { rankFor } from './constants.js';

export const RATE_MIN = 0.5;
export const RATE_MAX = 2;
export const RATE_STEP = 0.05;
const JUMP = 5; // seconds per arrow key press
const PREVIEW_EVERY = 120; // ms between live seeks while a timeline is dragged

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** 83.4 -> '1:23' */
export function fmtTime(s) {
  s = Math.max(0, Math.floor(s || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export const fmtRate = (r) => `${Math.round(r * 100)}%`;

export class Practice {
  constructor(game) {
    this.game = game;
    this.enabled = false; // 練習模式 chosen for the next runs (this session)
    this.rate = 1; // speed of practice runs
    this.starts = new Map(); // song key -> start position (s) last used, this session
    this.run = null; // the current run's practice ({ start }), null = a normal run
    this.baseStart = 0; // where a normal run starts (lead-in before the first objects)
    this.from = -Infinity; // the last jump's target: objects before it were left out
    this.pending = null; // pause timeline position, applied by 從這裡繼續
    this.previewDue = 0; // when the dragged position is shown next (ms, 0 = nothing to do)
    this.previewFn = null;
    this.listeners = new Set();
  }

  /** The current run is a practice run. */
  get active() {
    return !!this.run;
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit() {
    this.game.menu?.panel.invalidate();
    for (const fn of this.listeners) fn(this);
  }

  // ---------------------------------------------------------------------------
  // Options (web song tab, VR song page / ready screen / pause menu)

  setEnabled(on) {
    this.enabled = !!on;
    this.emit();
  }

  setRate(r) {
    r = clamp(Math.round(r / RATE_STEP) * RATE_STEP, RATE_MIN, RATE_MAX);
    r = Math.round(r * 100) / 100;
    if (r === this.rate) return;
    this.rate = r;
    if (this.run) {
      this.game.audio.setRate(r);
      this.game.hud.setTag(this.tagText());
    }
    this.emit();
  }

  stepRate(dir) {
    this.setRate(this.rate + dir * RATE_STEP);
  }

  tagText() {
    return this.rate === 1 ? '練習' : `練習 · ${fmtRate(this.rate)}`;
  }

  /** Start position of a song (library entry key), 0 = from the beginning. */
  startFor(key) {
    return (key && this.starts.get(key)) || 0;
  }

  /** Sets a song's start position; on the ready screen of that song the run moves there. */
  setStart(key, s, apply = true) {
    if (!key) return;
    s = Math.max(0, Math.round(s));
    this.starts.set(key, s);
    if (this.run && this.game.state === 'ready' && key === this.songKey()) {
      this.run.start = s;
      if (apply) this.applyStart();
      else this.schedulePreview(() => this.applyStart());
    }
    this.emit();
  }

  songKey() {
    return this.game.current?.entry?.key ?? null;
  }

  /** Song length shown on the timelines (seconds). */
  get duration() {
    const g = this.game;
    return g.audio.duration || g.map?.lastTime || 0;
  }

  /** Latest start position worth choosing: the last object. */
  get maxStart() {
    return Math.max(0, Math.floor(this.game.map?.lastTime || this.duration));
  }

  /** Song seconds the clock starts before a jump target (the first notes fly in). */
  lead() {
    return Math.max(1.5, (this.game.notes.spawnLead || 0) + 0.25);
  }

  // ---------------------------------------------------------------------------
  // Game hooks

  /** End of Game.prepareRun(): practice settings for the new run. */
  onPrepare() {
    const g = this.game;
    this.pending = null;
    this.previewDue = 0;
    this.from = -Infinity;
    this.run = this.enabled ? { start: this.startFor(this.songKey()) } : null;
    g.audio.setRate(this.run ? this.rate : 1);
    g.hud.setTag(this.run ? this.tagText() : null);
    this.baseStart = g.startTime;
    if (this.run && this.run.start > 0) this.applyStart();
    else if (this.run) g.env.seek(g.startTime); // same state; prepares the lighting's seek checkpoints now
    this.emit();
  }

  /** Ready screen: the run starts a little before the start position. */
  applyStart() {
    const g = this.game;
    const s = clamp(this.run.start, 0, this.maxStart);
    const t0 = s > 0 ? Math.max(this.baseStart, s - this.lead()) : this.baseStart;
    g.startTime = t0;
    this.seekTo(t0, s > 0 ? s : t0);
  }

  /** Game.resume(): a position chosen on the pause timeline is applied first. */
  onResume() {
    if (this.pending === null) return;
    const s = this.pending;
    this.pending = null;
    this.previewDue = 0;
    this.seekTo(Math.max(this.baseStart, s - this.lead()), s);
  }

  /** Practice runs: a result that isn't saved, accuracy over the notes played. */
  adjustResults(r) {
    const sc = this.game.score;
    r.practice = true;
    r.rate = this.rate;
    r.percent = sc.ratio * 100;
    r.rank = rankFor(sc.ratio);
    r.failed = false;
  }

  /** Per frame: the live position while a timeline is dragged (throttled). */
  update() {
    if (this.previewDue && performance.now() >= this.previewDue) {
      this.previewDue = 0;
      const fn = this.previewFn;
      this.previewFn = null;
      fn?.();
    }
  }

  schedulePreview(fn) {
    this.previewFn = fn;
    if (!this.previewDue) this.previewDue = performance.now() + PREVIEW_EVERY;
  }

  // ---------------------------------------------------------------------------
  // Seeking

  /**
   * Puts the run into its state at song time t: objects from `from` (>= t) on, nothing skipped
   * is scored. Everything is cleared and rebuilt (may allocate; not per frame).
   */
  seekTo(t, from = t) {
    const g = this.game;
    g.score.restartStreak();
    g.notes.seek(t, from);
    g.arcs.seek(t, from, g.notes.halfJump);
    g.env.seek(t);
    g.effects.clear();
    g.hud.clearPopups();
    g.inWall = false;
    this.seekAutoplay(from);
    g.audio.seek(t);
    this.from = from;
  }

  /** Autoplay sabers: aim at the first notes from `from` on. */
  seekAutoplay(from) {
    const g = this.game;
    if (!g.autoNotes) return;
    for (let c = 0; c < 2; c++) {
      const list = g.autoNotes[c];
      let lo = 0;
      let hi = list.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (list[mid].t < from - 0.2) lo = mid + 1;
        else hi = mid;
      }
      g.autoIdx[c] = lo;
    }
  }

  /** Where the song is for the timelines: a pending pause position, else the clock (or the jump target during its lead). */
  get position() {
    if (this.pending !== null) return this.pending;
    const t = this.game.audio.time;
    return t < this.from ? this.from : Math.max(0, t);
  }

  clampTarget(s) {
    return clamp(s, 0, Math.max(0, this.duration - 0.5));
  }

  /** While playing: jump to song time s (the clock starts a little before it). */
  jumpTo(s) {
    if (!this.run) return;
    const g = this.game;
    s = this.clampTarget(s);
    if (g.state === 'paused') {
      this.scrub(s, true);
      return;
    }
    if (g.state !== 'playing') return;
    this.seekTo(Math.max(this.baseStart, s - this.lead()), s);
    this.emit();
  }

  jumpBy(d) {
    this.jumpTo(this.position + d);
  }

  /** Pause timeline: chooses where 從這裡繼續 continues; the lights follow (throttled). */
  scrub(s, now = false) {
    if (!this.run || this.game.state !== 'paused') return;
    s = this.clampTarget(s);
    this.pending = s;
    const show = () => {
      if (this.pending !== null && this.game.state === 'paused') this.seekTo(this.pending, this.pending);
    };
    if (now) show();
    else this.schedulePreview(show);
    this.emit();
  }

  /** Desktop keys while playing / paused: ← / → jump 5 s, [ / ] change the speed. */
  onKey(e) {
    const g = this.game;
    if (!this.run || g.mode !== 'desktop' || (g.state !== 'playing' && g.state !== 'paused')) return false;
    const k = e.key;
    if (k === 'ArrowLeft' || k === 'ArrowRight') {
      e.preventDefault();
      if (!e.repeat || g.state === 'paused') this.jumpBy(k === 'ArrowLeft' ? -JUMP : JUMP);
      return true;
    }
    if (k === '[' || k === ']') {
      e.preventDefault();
      this.stepRate(k === '[' ? -1 : 1);
      return true;
    }
    return false;
  }
}
