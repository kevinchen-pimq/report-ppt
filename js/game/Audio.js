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
    this.rate = 1; // playback speed (practice mode): the song clock runs at rate x real time
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
    if (this.previewEl) this.previewEl.volume = Math.max(0, Math.min(1, v));
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

  /**
   * Current song time in seconds, as heard by the player. At a playback rate r the buffer
   * position scheduled at context time T is startSongTime + r (T - startCtxTime), and what is
   * heard now was scheduled `latency` (real seconds) ago.
   */
  get time() {
    if (!this.playing) return this.pausedAt;
    if (this.rate === 1) return this.ctx.currentTime - this.startCtxTime + this.startSongTime - this.latency;
    return this.startSongTime + this.rate * (this.ctx.currentTime - this.startCtxTime - this.latency);
  }

  /** fade: short fade-in, and the previous source fades out (seeking without clicks). */
  play(fromSongTime, fade = false) {
    const ctx = this.ensureContext();
    this.stopSource(fade);
    const src = ctx.createBufferSource();
    src.buffer = this.buffer;
    const r = this.rate;
    src.playbackRate.value = r;
    // A small scheduling delay keeps the start sample-accurate
    const now = ctx.currentTime + 0.05;
    const from = fromSongTime + this.latency * r;
    let out = src;
    if (fade) {
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, now);
      g.gain.linearRampToValueAtTime(1, now + 0.03);
      src.connect(g);
      out = g;
      this.sourceGain = g;
    }
    out.connect(this.master);
    if (from < 0) src.start(now - from / r, 0);
    else if (from < this.buffer.duration) src.start(now, from);
    this.source = src;
    this.startCtxTime = now;
    this.startSongTime = from;
    this.playing = true;
  }

  /** Playback speed (practice mode; pitch changes with it). Keeps the song position. */
  setRate(r) {
    if (r === this.rate) return;
    if (!this.playing) {
      this.rate = r;
      return;
    }
    const ctx = this.ctx;
    const now = ctx.currentTime;
    if (now < this.startCtxTime || this.startSongTime + this.rate * (now - this.startCtxTime) < 0) {
      // not started yet (lead-in): schedule again at the new rate
      const t = this.time;
      this.rate = r;
      this.play(t, true);
      return;
    }
    // re-anchor the clock where the source is now and change its rate from here on
    this.startSongTime += this.rate * (now - this.startCtxTime);
    this.startCtxTime = now;
    this.rate = r;
    this.source.playbackRate.setValueAtTime(r, now);
  }

  /** Jumps to a song time: while playing the source restarts there with a short fade. */
  seek(t) {
    if (this.playing) this.play(t, true);
    else this.pausedAt = t;
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

  /** Song preview on the song page: loops a section with short fades (uses the music volume). */
  playPreview(buffer, start, length) {
    const ctx = this.ensureContext();
    this.stopPreview(0.05);
    const s = Math.max(0, Math.min(start, buffer.duration - 2));
    const e = Math.min(buffer.duration, s + length);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    src.loopStart = s;
    src.loopEnd = e;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(1, t + 0.6);
    src.connect(g);
    g.connect(this.master);
    src.start(t, s);
    this.previewNode = { src, g };
  }

  /**
   * BeatSaver's short preview clip, before the song is downloaded. Played with an
   * <audio> element: BeatSaver doesn't allow Web Audio to read it (no CORS), and
   * plain playback doesn't need that. Resolves false if stopped while starting.
   */
  async playRemotePreview(url) {
    this.stopPreview(0.05);
    const token = this.previewToken;
    const el = new Audio();
    el.loop = true;
    el.volume = Math.max(0, Math.min(1, this.volume));
    el.src = url;
    this.previewEl = el;
    await el.play();
    return token === this.previewToken;
  }

  stopPreview(fade = 0.3) {
    this.previewToken = (this.previewToken || 0) + 1;
    const el = this.previewEl;
    if (el) {
      this.previewEl = null;
      el.pause();
      el.removeAttribute('src');
      el.load();
    }
    const p = this.previewNode;
    if (!p) return;
    this.previewNode = null;
    const t = this.ctx.currentTime;
    p.g.gain.cancelScheduledValues(t);
    p.g.gain.setValueAtTime(p.g.gain.value, t);
    p.g.gain.linearRampToValueAtTime(0, t + fade);
    try {
      p.src.stop(t + fade + 0.02);
    } catch (e) {
      /* already stopped */
    }
  }

  stopSource(fade = false) {
    const g = this.sourceGain;
    this.sourceGain = null;
    if (this.source) {
      const src = this.source;
      this.source = null;
      if (fade) {
        // fade out over a few ms, then stop (no click)
        const t = this.ctx.currentTime;
        let out = g;
        if (!out) {
          out = this.ctx.createGain();
          src.disconnect();
          src.connect(out);
          out.connect(this.master);
        }
        out.gain.cancelScheduledValues(t);
        out.gain.setValueAtTime(out.gain.value, t);
        out.gain.linearRampToValueAtTime(0, t + 0.025);
        try {
          src.stop(t + 0.03);
        } catch (e) {
          /* not started */
        }
        src.onended = () => {
          src.disconnect();
          out.disconnect();
        };
        return;
      }
      try {
        src.stop();
      } catch (e) {
        /* not started */
      }
      src.disconnect();
      g?.disconnect();
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
