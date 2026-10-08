// Audio latency calibration: a metronome the player taps along to.
// The median difference between taps and the moments the clicks are heard
// (as predicted by the audio clock) is the extra latency of the output path
// (e.g. Bluetooth headphones), which feeds GameAudio.offsetMs.

export class LatencyCalibrator {
  constructor(audio) {
    this.audio = audio;
    this.running = false;
    this.deltas = [];
    this.clicks = [];
  }

  start(bpm = 100) {
    const ctx = this.audio.ensureContext();
    this.interval = 60 / bpm;
    this.next = ctx.currentTime + 0.4;
    this.beat = 0;
    this.clicks = [];
    this.deltas = [];
    this.running = true;
    this.schedule();
  }

  stop() {
    this.running = false;
  }

  /** Call every frame: keeps ~0.3 s of clicks scheduled ahead. */
  schedule() {
    if (!this.running) return;
    const ctx = this.audio.ctx;
    while (this.next < ctx.currentTime + 0.3) {
      this.audio.click(this.next, this.beat % 4 === 0);
      this.clicks.push(this.next);
      this.next += this.interval;
      this.beat++;
    }
    while (this.clicks.length > 16) this.clicks.shift();
  }

  /** Registers a tap (performance.now() ms). Returns the measured delta in ms, or null. */
  tap(perfMs = performance.now()) {
    if (!this.running || !this.clicks.length) return null;
    let best = null;
    for (const T of this.clicks) {
      const d = perfMs - this.audio.heardPerfTime(T);
      if (best === null || Math.abs(d) < Math.abs(best)) best = d;
    }
    if (best === null || Math.abs(best) > (this.interval * 1000) / 2) return null;
    this.deltas.push(best);
    if (this.deltas.length > 16) this.deltas.shift();
    return best;
  }

  get count() {
    return this.deltas.length;
  }

  /** Median measured latency in ms (rounded to 5 ms), once enough taps were collected. */
  get result() {
    if (this.deltas.length < 6) return null;
    const sorted = [...this.deltas].sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    const med = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    return Math.round(med / 5) * 5;
  }

  /**
   * 0..1 flash intensity for a visual beat indicator, using the current latency setting.
   * When the setting is right, the flash and the heard click coincide.
   */
  pulse() {
    if (!this.running || !this.audio.ctx) return 0;
    const heardNow = this.audio.ctx.currentTime - this.audio.latency;
    let last = null;
    for (const T of this.clicks) if (T <= heardNow) last = T;
    if (last === null) return 0;
    return Math.exp(-(heardNow - last) * 10);
  }
}
