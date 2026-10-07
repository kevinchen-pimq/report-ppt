import { rankFor } from './constants.js';

const POST_WINDOW = 0.4; // seconds of post-swing tracking

export class ScoreKeeper {
  constructor() {
    this.reset(1);
  }

  reset(maxScore) {
    this.maxScore = maxScore || 1;
    this.score = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.multiplier = 1;
    this.progress = 0;
    this.energy = 0.5;
    this.hits = 0;
    this.misses = 0;
    this.badCuts = 0;
    this.bombHits = 0;
    this.wallHits = 0;
    this.notesPassed = 0;
    this.possibleSoFar = 0; // max score for notes resolved so far
    this.possibleMult = 1;
    this.possibleProgress = 0;
    this.pending = []; // cuts awaiting post-swing rating
    this.failed = false;
    this.changed = true;
    this.lastCutScore = null;
  }

  addPossible(kind) {
    this.possibleSoFar += (kind === 'link' ? 20 : 115) * this.possibleMult;
    if (this.possibleMult < 8) {
      this.possibleProgress++;
      if (this.possibleProgress >= this.possibleMult * 2) {
        this.possibleMult *= 2;
        this.possibleProgress = 0;
      }
    }
  }

  bumpMultiplier() {
    if (this.multiplier >= 8) return;
    this.progress++;
    if (this.progress >= this.multiplier * 2) {
      this.multiplier *= 2;
      this.progress = 0;
    }
  }

  dropMultiplier() {
    if (this.multiplier > 1) this.multiplier /= 2;
    this.progress = 0;
  }

  addEnergy(v) {
    this.energy = Math.max(0, Math.min(1, this.energy + v));
    if (this.energy <= 0) this.failed = true;
  }

  /**
   * A good cut. Pre-swing and accuracy are known now; post-swing is measured over the next frames.
   */
  cut(note, saber, { distance, autoplay }, now) {
    this.hits++;
    this.notesPassed++;
    this.combo++;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    const mult = this.multiplier;
    this.bumpMultiplier();
    this.addEnergy(0.01);
    this.addPossible(note.kind);
    this.changed = true;

    if (note.kind === 'link') {
      this.score += 20 * mult;
      return;
    }
    const acc = autoplay ? 15 : Math.round(15 * Math.max(0, 1 - distance / 0.3));
    const preAngle = autoplay ? 100 : saber.swingAngleBefore(0.35);
    const pre = Math.round(70 * Math.min(1, preAngle / 100));
    const entry = {
      note, saber, mult, acc, pre, post: autoplay ? 30 : 0,
      startDir: saber.dir.clone(), start: now, autoplay,
    };
    if (autoplay) this.finalize(entry);
    else this.pending.push(entry);
  }

  finalize(e) {
    const total = e.pre + e.post + e.acc;
    this.score += total * e.mult;
    this.lastCutScore = { total, pre: e.pre, post: e.post, acc: e.acc, note: e.note };
    this.changed = true;
  }

  /** Called every frame to measure post-swing for pending cuts. */
  update(now) {
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const e = this.pending[i];
      const angle = (e.saber.dir.angleTo(e.startDir) * 180) / Math.PI;
      e.post = Math.max(e.post, Math.round(30 * Math.min(1, angle / 60)));
      if (now - e.start > POST_WINDOW || e.post >= 30) {
        this.finalize(e);
        this.pending.splice(i, 1);
      }
    }
  }

  flushPending() {
    for (const e of this.pending) this.finalize(e);
    this.pending = [];
  }

  miss(note) {
    this.misses++;
    this.notesPassed++;
    this.breakCombo();
    this.addEnergy(-0.15);
    this.addPossible(note.kind);
  }

  badCut(note) {
    this.badCuts++;
    this.notesPassed++;
    this.breakCombo();
    this.addEnergy(-0.1);
    this.addPossible(note.kind);
  }

  bomb() {
    this.bombHits++;
    this.breakCombo();
    this.addEnergy(-0.15);
  }

  wall(dt) {
    if (this.combo > 0 || this.multiplier > 1) {
      this.breakCombo();
      this.wallHits++;
    }
    this.addEnergy(-1.3 * dt);
  }

  breakCombo() {
    this.combo = 0;
    this.dropMultiplier();
    this.changed = true;
  }

  get ratio() {
    return this.possibleSoFar > 0 ? this.score / this.possibleSoFar : 1;
  }

  get finalRatio() {
    return this.score / this.maxScore;
  }

  get rank() {
    return rankFor(this.ratio);
  }

  summary() {
    return {
      score: this.score,
      maxScore: this.maxScore,
      percent: this.finalRatio * 100,
      rank: rankFor(this.finalRatio),
      maxCombo: this.maxCombo,
      hits: this.hits,
      misses: this.misses,
      badCuts: this.badCuts,
      bombHits: this.bombHits,
      wallHits: this.wallHits,
      failed: this.failed,
    };
  }
}
