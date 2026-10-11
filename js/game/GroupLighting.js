// v3 group lighting runtime: plays a map's event box groups (js/lightshow3.js) on an environment
// module's `lightGroups` / `fx` (see envs/CONTRACT.md). Everything is resolved once per map
// (filters, distributions, extend, rotation direction): each element gets a time-sorted keyframe
// track in typed arrays, so a frame only advances pointers and evaluates the elements that are
// changing (a transition, a strobe, a new keyframe or a palette change). No per-frame allocation.
//
//   lightGroups { [groupId]: { lights: Light[], count?, rotation?: { x, y, z: Object3D[], mirror },
//                 translation?: { x, y, z: Object3D[], scale, mirror } } }
//   fx          { [groupId]: { count, set(elementIndex, value), initial? } }
//
// Colours: event colour 0 / 1 / 2 = the palette's left / right / white (boost colours while colour
// boost is on), × brightness (strobe: alternates between the brightness and the strobe brightness,
// optionally fading), or the event's Chroma colour (customData.color) when Chroma is on.
// Rotation: obj.rotation[axis] = rest + degToRad(angle); translation: obj.position[axis] =
// rest + value × scale; each negated only for the group's mirror[axis]. No handedness conversion:
// modules build in their own frame (see CONTRACT.md). fx: set(element, value).
// seek(t) jumps to any song time (practice mode); update(t) also follows a backwards jump.

import { buildKeyframes, easeIO, GL_EASINGS, TR_INTERP } from '../lightshow3.js';

const DEG = Math.PI / 180;
const AXES = ['x', 'y', 'z'];
const KEY_RGB = 3;
const MAX_BRIGHT = 1.5;
// Per-frame scratch. Numbers travel through typed arrays rather than as call arguments, results
// or locals that stay alive across a call: the optimizing tiers box (allocate) a double in those
// places, e.g. Maglev, which runs this code in Chrome. So the hot code below keeps intermediate
// values in typed-array slots and reads the song time from NOW where it needs it.
const NOW = new Float64Array(1); // song time of the current update
const W = new Float64Array(10); // colour work slots: 0-2 colour A, 3-5 colour B, 6 brightness, 7 progress, 8 strobe phase, 9 low
const V = new Float64Array(2); // value work slots: 0 value, 1 progress
const ROT = 0;
const POS = 1;
const FX = 2;

/** Flattens keyframe lists [element][k] into one set of typed columns. */
function flatten(lists, cols) {
  const n = lists.length;
  const start = new Int32Array(n + 1);
  let K = 0;
  for (let i = 0; i < n; i++) {
    start[i] = K;
    K += lists[i].length;
  }
  start[n] = K;
  const out = { n, start, time: new Float64Array(K), trans: new Uint8Array(K), ease: new Uint8Array(K) };
  for (const [name, Type] of cols) out[name] = new Type(K);
  return out;
}

/** Common pointer logic: cur[i] = index of the element's current keyframe (start[i] - 1 = none yet). */
class Track {
  init(lists, cols) {
    Object.assign(this, flatten(lists, cols));
    this.cur = new Int32Array(this.n);
    this.busy = new Uint8Array(this.n);
    this.dirty = new Uint8Array(this.n);
    this.lt = new Float64Array(1); // time of the last update (typed: no boxed number per frame)
    this.lt[0] = -Infinity;
    let k = 0;
    for (let i = 0; i < this.n; i++) {
      for (const kf of lists[i]) {
        this.time[k] = kf.t;
        this.trans[k] = kf.trans;
        this.ease[k] = kf.ease;
        this.fill(k, kf);
        k++;
      }
    }
    this.rewind();
  }

  rewind() {
    for (let i = 0; i < this.n; i++) {
      this.cur[i] = this.start[i] - 1;
      this.dirty[i] = 1;
      this.busy[i] = 0;
    }
    this.lt[0] = -Infinity;
  }

  /** Re-positions every pointer for time t (binary search; any direction) and marks all for evaluation. */
  seek(t) {
    this.lt[0] = t;
    for (let i = 0; i < this.n; i++) {
      let lo = this.start[i];
      let hi = this.start[i + 1] - 1;
      let at = lo - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (this.time[mid] <= t) {
          at = mid;
          lo = mid + 1;
        } else hi = mid - 1;
      }
      this.cur[i] = at;
      this.dirty[i] = 1;
    }
  }

  /** Advances to NOW[0] and evaluates the elements that changed or are changing. */
  update() {
    if (NOW[0] < this.lt[0] - 1e-6) this.seek(NOW[0]);
    this.lt[0] = NOW[0];
    const time = this.time;
    const start = this.start;
    const cur = this.cur;
    for (let i = 0; i < this.n; i++) {
      let k = cur[i];
      const end = start[i + 1];
      if (k + 1 < end && time[k + 1] <= NOW[0]) {
        do k++;
        while (k + 1 < end && time[k + 1] <= NOW[0]);
        cur[i] = k;
        this.dirty[i] = 1;
      }
      if (!this.dirty[i] && !this.busy[i]) continue;
      this.dirty[i] = 0;
      // the next keyframe, when it interpolates from this one
      const nx = k >= start[i] && k + 1 < end && this.trans[k + 1] === TR_INTERP ? k + 1 : -1;
      this.busy[i] = this.eval(i, k >= start[i] ? k : -1, nx) ? 1 : 0;
    }
  }

  markDirty() {
    this.dirty.fill(1);
  }
}

class ColorTrack extends Track {
  constructor(lights, lists, rt) {
    super();
    this.lights = lights;
    this.rt = rt; // palette / boost
    this.init(lists, [['key', Int8Array], ['cr', Float32Array], ['cg', Float32Array], ['cb', Float32Array], ['s', Float32Array], ['sfreq', Float32Array], ['sb', Float32Array], ['sf', Uint8Array]]);
  }

  fill(k, kf) {
    if (kf.rgb) {
      this.key[k] = KEY_RGB;
      this.cr[k] = kf.rgb[0];
      this.cg[k] = kf.rgb[1];
      this.cb[k] = kf.rgb[2];
    } else this.key[k] = kf.c;
    this.s[k] = kf.s;
    this.sfreq[k] = kf.sfreq;
    this.sb[k] = kf.sb;
    this.sf[k] = kf.sf ? 1 : 0;
  }

  /** Colour of keyframe k into W[o … o + 2] (palette colour, boost aware, or the Chroma colour). */
  color(k, o) {
    const key = this.key[k];
    if (key === KEY_RGB) {
      W[o] = this.cr[k];
      W[o + 1] = this.cg[k];
      W[o + 2] = this.cb[k];
      return;
    }
    const c = this.rt.colors;
    const boost = this.rt.boost;
    const p = key === 0 ? (boost ? c.leftBoost : c.left) : key === 1 ? (boost ? c.rightBoost : c.right) : boost ? c.whiteBoost || c.white : c.white;
    W[o] = p.r;
    W[o + 1] = p.g;
    W[o + 2] = p.b;
  }

  eval(i, k, nx) {
    const L = this.lights[i];
    if (!L) return false;
    if (k < 0) {
      L.set(0, 0, 0);
      return false;
    }
    let busy = false;
    this.color(k, 0);
    W[6] = this.s[k];
    W[7] = 0;
    if (nx >= 0) {
      this.color(nx, 3);
      const dur = this.time[nx] - this.time[k];
      if (dur > 0) {
        W[7] = (NOW[0] - this.time[k]) / dur;
        easeIO(this.ease[nx], W, 7);
      } else W[7] = 1;
      W[0] += (W[3] - W[0]) * W[7];
      W[1] += (W[4] - W[1]) * W[7];
      W[2] += (W[5] - W[2]) * W[7];
      W[6] += (this.s[nx] - W[6]) * W[7];
      busy = true;
    }
    if (this.sfreq[k] > 0 || (nx >= 0 && this.sfreq[nx] > 0)) {
      // strobe: cycles since the keyframe (frequency eased linearly toward the next one)
      const dt = NOW[0] - this.time[k];
      W[8] = dt * this.sfreq[k];
      W[9] = this.sb[k];
      if (nx >= 0) {
        const dur = this.time[nx] - this.time[k];
        if (dur > 0) W[8] += ((this.sfreq[nx] - this.sfreq[k]) * dt * dt) / (2 * dur);
        W[9] += (this.sb[nx] - W[9]) * W[7];
      }
      W[8] -= Math.floor(W[8]);
      if (this.sf[k]) W[6] += (W[9] - W[6]) * W[8];
      else if (W[8] >= 0.5) W[6] = W[9];
      busy = true;
    }
    W[6] = Math.min(MAX_BRIGHT, Math.max(0, W[6]));
    L.set(W[0] * W[6], W[1] * W[6], W[2] * W[6]);
    return busy;
  }
}

class ValueTrack extends Track {
  /**
   * mode ROT: objs[i].rotation[axis] = rest[i] + value × k; POS: objs[i].position[axis] =
   * rest[i] + value × k; FX: fx.set(i, value). Only written when the value changed.
   */
  constructor(lists, mode, { objs = null, axis = 0, k = 1, rest = null, fx = null } = {}) {
    super();
    this.mode = mode;
    this.objs = objs;
    this.axis = axis;
    this.k = k;
    this.fx = fx;
    this.init(lists, [['val', Float64Array]]);
    this.rest = new Float64Array(this.n);
    if (rest) for (let i = 0; i < this.n; i++) this.rest[i] = rest(i);
    this.last = new Float64Array(this.n).fill(NaN);
    this.before = new Float64Array(this.n); // value before the element's first keyframe
  }

  fill(k, kf) {
    this.val[k] = kf.v;
  }

  rewind() {
    super.rewind();
    this.last?.fill(NaN);
  }

  eval(i, k, nx) {
    let busy = false;
    if (k >= 0) {
      V[0] = this.val[k];
      if (nx >= 0) {
        const dur = this.time[nx] - this.time[k];
        V[1] = 1;
        if (dur > 0) {
          V[1] = (NOW[0] - this.time[k]) / dur;
          easeIO(this.ease[nx], V, 1);
        }
        V[0] += (this.val[nx] - V[0]) * V[1];
        busy = true;
      }
    } else {
      V[0] = this.before[i];
      if (V[0] !== V[0]) return false; // NaN: an fx element without events is never set
    }
    if (V[0] === this.last[i]) return busy;
    this.last[i] = V[0];
    if (this.mode === FX) {
      this.fx.set(i, V[0]);
      return busy;
    }
    const o = this.objs[i];
    if (!o) return busy;
    const tgt = this.mode === ROT ? o.rotation : o.position;
    if (this.axis === 0) tgt.x = this.rest[i] + V[0] * this.k;
    else if (this.axis === 1) tgt.y = this.rest[i] + V[0] * this.k;
    else tgt.z = this.rest[i] + V[0] * this.k;
    return busy;
  }
}

export class GroupLighting {
  /**
   * target: { lightGroups, fx } (module format, see the top of this file).
   * colors: { left, right, white, leftBoost, rightBoost, whiteBoost } THREE.Colors (read live).
   */
  constructor(target, colors) {
    this.colors = colors;
    this.lightGroups = target.lightGroups || {};
    this.fxGroups = target.fx || {};
    this.boost = false;
    this.tracks = [];
    this.colorTracks = [];
    this.source = null;
    // rest transforms (the pivots' state when the runtime starts)
    this.rest = new Map();
    for (const grp of Object.values(this.lightGroups)) {
      for (const kind of ['rotation', 'translation']) {
        const def = grp?.[kind];
        if (!def) continue;
        for (const a of AXES) {
          for (const o of def[a] || []) {
            if (!o) continue;
            let r = this.rest.get(o);
            if (!r) this.rest.set(o, (r = { rot: [o.rotation.x, o.rotation.y, o.rotation.z], pos: [o.position.x, o.position.y, o.position.z] }));
          }
        }
      }
    }
  }

  get empty() {
    return !Object.keys(this.lightGroups).length && !Object.keys(this.fxGroups).length;
  }

  palette(key) {
    const c = this.colors;
    if (key === 0) return this.boost ? c.leftBoost : c.left;
    if (key === 1) return this.boost ? c.rightBoost : c.right;
    return this.boost ? c.whiteBoost || c.white : c.white;
  }

  /** Group element count (official count; defaults to the number of lights / pivots). */
  static countOf(grp) {
    if (!grp) return 0;
    if (grp.count > 0) return grp.count;
    let n = grp.lights?.length || 0;
    for (const kind of ['rotation', 'translation']) for (const a of AXES) n = Math.max(n, grp[kind]?.[a]?.length || 0);
    return n;
  }

  /**
   * New run. lightshow: parsed box groups (lightshow3.js parseLightshow3, with toTime) or null.
   * chroma: use the Chroma colours on box events. Built tracks are kept for the same lightshow.
   */
  reset(lightshow, { chroma = false } = {}) {
    // pivots back to rest
    for (const [o, r] of this.rest) {
      o.rotation.set(r.rot[0], r.rot[1], r.rot[2]);
      o.position.set(r.pos[0], r.pos[1], r.pos[2]);
    }
    this.boost = false;
    const key = lightshow ? lightshow : null;
    if (this.source !== key || this.sourceChroma !== chroma) {
      this.source = key;
      this.sourceChroma = chroma;
      this.build(lightshow, chroma);
    }
    for (const tr of this.tracks) tr.rewind();
  }

  build(ls, chroma) {
    this.tracks = [];
    this.colorTracks = [];
    this.stats = { tracks: 0, keyframes: 0, elements: 0 };
    if (!ls || !ls.toTime) return;
    const lg = this.lightGroups;
    const toTime = ls.toTime;
    // colour
    const cInfo = (g) => (lg[g]?.lights?.length ? { n: GroupLighting.countOf(lg[g]) } : null);
    for (const [g, tr] of buildKeyframes(ls.color, 'color', cInfo, toTime, chroma)) {
      const t = new ColorTrack(lg[g].lights, tr[0], this);
      this.colorTracks.push(t);
      this.tracks.push(t);
    }
    // rotation / translation
    for (const kind of ['rotation', 'translation']) {
      const info = (g) => {
        const def = lg[g]?.[kind];
        if (!def) return null;
        return { n: GroupLighting.countOf(lg[g]), axes: AXES.map((a) => !!def[a]?.length) };
      };
      for (const [g, tr] of buildKeyframes(ls[kind], kind, info, toTime)) {
        const def = lg[g][kind];
        for (let a = 0; a < 3; a++) {
          if (!tr[a]) continue;
          const axis = AXES[a];
          const objs = def[axis];
          const sign = def.mirror?.[axis] ? -1 : 1;
          const rot = kind === 'rotation';
          const k = rot ? sign * DEG : sign * (def.scale ?? 1);
          const rest = (i) => {
            const r = objs[i] && this.rest.get(objs[i]);
            return r ? (rot ? r.rot[a] : r.pos[a]) : 0;
          };
          this.tracks.push(new ValueTrack(tr[a], rot ? ROT : POS, { objs, axis: a, k, rest }));
        }
      }
    }
    // fx
    const fx = this.fxGroups;
    const fInfo = (g) => (fx[g] && typeof fx[g].set === 'function' ? { n: fx[g].count > 0 ? fx[g].count : 1 } : null);
    for (const [g, tr] of buildKeyframes(ls.fx, 'fx', fInfo, toTime)) {
      const def = fx[g];
      const t = new ValueTrack(tr[0], FX, { fx: def });
      // before its first event an fx element shows `initial` (module default) or its first value
      for (let i = 0; i < t.n; i++) t.before[i] = t.start[i] === t.start[i + 1] ? NaN : Number.isFinite(def.initial) ? def.initial : t.val[t.start[i]];
      this.tracks.push(t);
    }
    let end = 0;
    for (const t of this.tracks) {
      this.stats.tracks++;
      this.stats.keyframes += t.time.length;
      this.stats.elements += t.n;
      if (t.time.length) end = Math.max(end, t.time[t.time.length - 1]);
    }
    this.warmUp(end);
  }

  /**
   * Runs every code path once at load (all easings, then the tracks at a few song times), so the
   * JIT has type feedback for all branches and doesn't deoptimise (and box numbers) in the song.
   * The state it leaves is overwritten: reset() rewinds every track afterwards.
   */
  warmUp(end) {
    for (let e = 0; e < GL_EASINGS.length; e++) {
      for (let q = 0; q <= 8; q++) {
        W[7] = q / 8;
        easeIO(e, W, 7);
      }
    }
    if (!(end > 0)) return;
    for (let q = 0; q < 24; q++) {
      NOW[0] = (end * q) / 23;
      for (let i = 0; i < this.tracks.length; i++) {
        this.tracks[i].seek(NOW[0]);
        this.tracks[i].update();
      }
    }
  }

  markAllDirty() {
    for (const t of this.colorTracks) t.markDirty();
  }

  /**
   * Jumps to song time t (seconds, forward or backward; e.g. practice mode): every element takes
   * exactly the state it has at t (colour / brightness, rotation, translation, fx). Binary search
   * on the precomputed keyframes, no allocation. boost: colour boost state at t (default: as is).
   */
  seek(t, boost = this.boost) {
    for (let i = 0; i < this.tracks.length; i++) this.tracks[i].seek(t);
    this.update(t, boost);
  }

  /** Per frame: t = song time (seconds), boost = colour boost on. Going backwards seeks by itself. */
  update(t, boost = false) {
    if (boost !== this.boost) {
      this.boost = boost;
      this.markAllDirty();
    }
    NOW[0] = t;
    const tracks = this.tracks;
    for (let i = 0; i < tracks.length; i++) tracks[i].update();
  }
}
