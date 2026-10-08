// Song playback with a sample-accurate clock plus synthesized hit sounds.

export class GameAudio {
  constructor() {
    this.ctx = null;
    this.buffer = null;
    this.source = null;
    this.playing = false;
    this.startCtxTime = 0;
    this.startSongTime = 0;
    this.pausedAt = 0;
    this.offsetMs = 0; // extra audio latency (ms): positive = sound reaches the ears later
    this.volume = 0.8;
    this.sfxVolume = 0.5;
  }

  ensureContext() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC({ latencyHint: 'interactive' });
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
      this.sfx = this.ctx.createGain();
      this.sfx.gain.value = this.sfxVolume;
      this.sfx.connect(this.ctx.destination);
      this.hitBuffer = this.makeHitBuffer(false);
      this.badBuffer = this.makeHitBuffer(true);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  async decode(bytes) {
    const ctx = this.ensureContext();
    const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    this.buffer = await ctx.decodeAudioData(copy);
    return this.buffer;
  }

  get duration() {
    return this.buffer ? this.buffer.duration : 0;
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  setSfxVolume(v) {
    this.sfxVolume = v;
    if (this.sfx) this.sfx.gain.value = v;
  }

  /** Hardware-reported output latency in seconds. */
  get baseLatency() {
    if (!this.ctx) return 0;
    return this.ctx.outputLatency || this.ctx.baseLatency || 0;
  }

  /** Total delay between scheduling a sample and hearing it. */
  get latency() {
    return this.baseLatency + this.offsetMs / 1000;
  }

  /** performance.now() (ms) at which a sample scheduled at context time T is heard (before user offset). */
  heardPerfTime(T) {
    return performance.now() + (T - this.ctx.currentTime + this.baseLatency) * 1000;
  }

  /** A short metronome click at context time `when` (accent = higher pitch). */
  click(when, accent = false) {
    const ctx = this.ensureContext();
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.frequency.value = accent ? 1760 : 1320;
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(0.6, when + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.06);
    osc.connect(g);
    g.connect(ctx.destination);
    osc.start(when);
    osc.stop(when + 0.08);
  }

  /** Current song time in seconds, as heard by the player. */
  get time() {
    if (!this.playing) return this.pausedAt;
    return this.ctx.currentTime - this.startCtxTime + this.startSongTime - this.latency;
  }

  play(fromSongTime) {
    const ctx = this.ensureContext();
    this.stopSource();
    const src = ctx.createBufferSource();
    src.buffer = this.buffer;
    src.connect(this.master);
    // A small scheduling delay keeps the start sample-accurate
    const now = ctx.currentTime + 0.05;
    const from = fromSongTime + this.latency;
    if (from < 0) src.start(now - from, 0);
    else if (from < this.buffer.duration) src.start(now, from);
    this.source = src;
    this.startCtxTime = now;
    this.startSongTime = from;
    this.playing = true;
  }

  pause() {
    if (!this.playing) return;
    this.pausedAt = this.time;
    this.stopSource();
    this.playing = false;
  }

  resume() {
    if (this.playing) return;
    this.play(this.pausedAt);
  }

  stop() {
    this.stopSource();
    this.playing = false;
    this.pausedAt = 0;
  }

  stopSource() {
    if (this.source) {
      try {
        this.source.stop();
      } catch (e) {
        /* not started */
      }
      this.source.disconnect();
      this.source = null;
    }
  }

  makeHitBuffer(bad) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * (bad ? 0.18 : 0.09));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const t = i / ctx.sampleRate;
      const env = Math.exp(-t * (bad ? 25 : 55));
      let v;
      if (bad) {
        v = Math.sin(2 * Math.PI * 90 * t) * 0.8 + (Math.random() * 2 - 1) * 0.3;
      } else {
        const white = Math.random() * 2 - 1;
        v = white - last * 0.6; // brighten
        last = white;
        v += Math.sin(2 * Math.PI * 1800 * t) * 0.25;
      }
      d[i] = v * env * 0.6;
    }
    return buf;
  }

  playHit(bad = false, pan = 0) {
    if (!this.ctx) return;
    const src = this.ctx.createBufferSource();
    src.buffer = bad ? this.badBuffer : this.hitBuffer;
    src.playbackRate.value = bad ? 1 : 0.9 + Math.random() * 0.2;
    let node = src;
    if (this.ctx.createStereoPanner) {
      const p = this.ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      src.connect(p);
      node = p;
    }
    node.connect(this.sfx);
    src.start();
  }
}
