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

import { buildKeyframes, easeIO, TR_INTERP } from '../lightshow3.js';

const DEG = Math.PI / 180;
const AXES = ['x', 'y', 'z'];
const KEY_RGB = 3;
const MAX_BRIGHT = 1.5;
// Per-frame scratch: numbers travel through typed arrays rather than as call arguments / results
// (a double crossing a call that is not inlined is boxed, i.e. allocated)
const NOW = new Float64Array(1); // song time of the current update
const EZ = new Float64Array(1); // easing in / out
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
    const t = NOW[0];
    if (t < this.lt[0] - 1e-6) this.seek(t);
    this.lt[0] = t;
    const time = this.time;
    const start = this.start;
    const cur = this.cur;
    for (let i = 0; i < this.n; i++) {
      let k = cur[i];
      const end = start[i + 1];
      if (k + 1 < end && time[k + 1] <= t) {
        do k++;
        while (k + 1 < end && time[k + 1] <= t);
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

  /** Colour of keyframe k into rt.tmp[o … o + 2]. */
  color(k, o) {
    const tmp = this.rt.tmp;
    const key = this.key[k];
    if (key === KEY_RGB) {
      tmp[o] = this.cr[k];
      tmp[o + 1] = this.cg[k];
      tmp[o + 2] = this.cb[k];
      return;
    }
    const p = this.rt.palette(key);
    tmp[o] = p.r;
    tmp[o + 1] = p.g;
    tmp[o + 2] = p.b;
  }

  eval(i, k, nx) {
    const L = this.lights[i];
    if (!L) return false;
    if (k < 0) {
      L.set(0, 0, 0);
      return false;
    }
    const tmp = this.rt.tmp;
    this.color(k, 0);
    let r = tmp[0];
    let g = tmp[1];
    let b = tmp[2];
    let s = this.s[k];
    let busy = false;
    let p = 0;
    const dt = NOW[0] - this.time[k];
    let dur = 0;
    if (nx >= 0) {
      dur = this.time[nx] - this.time[k];
      if (dur > 0) {
        EZ[0] = dt / dur;
        easeIO(this.ease[nx], EZ);
        p = EZ[0];
      } else p = 1;
      this.color(nx, 3);
      r += (tmp[3] - r) * p;
      g += (tmp[4] - g) * p;
      b += (tmp[5] - b) * p;
      s += (this.s[nx] - s) * p;
      busy = true;
    }
    const f0 = this.sfreq[k];
    const f1 = nx >= 0 ? this.sfreq[nx] : f0;
    if (f0 > 0 || f1 > 0) {
      // strobe: cycles since the keyframe (frequency eased linearly toward the next one)
      const cycles = dt * f0 + (nx >= 0 && dur > 0 ? ((f1 - f0) * dt * dt) / (2 * dur) : 0);
      const ph = cycles - Math.floor(cycles);
      let low = this.sb[k];
      if (nx >= 0) low += (this.sb[nx] - low) * p;
      s = this.sf[k] ? s + (low - s) * ph : ph < 0.5 ? s : low;
      busy = true;
    }
    if (s < 0) s = 0;
    else if (s > MAX_BRIGHT) s = MAX_BRIGHT;
    L.set(r * s, g * s, b * s);
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
    let v = 0;
    let busy = false;
    if (k >= 0) {
      v = this.val[k];
      if (nx >= 0) {
        const dur = this.time[nx] - this.time[k];
        let p = 1;
        if (dur > 0) {
          EZ[0] = (NOW[0] - this.time[k]) / dur;
          easeIO(this.ease[nx], EZ);
          p = EZ[0];
        }
        v += (this.val[nx] - v) * p;
        busy = true;
      }
    } else {
      v = this.before[i];
      if (v !== v) return false; // NaN: an fx element without events is never set
    }
    if (v === this.last[i]) return busy;
    this.last[i] = v;
    if (this.mode === FX) {
      this.fx.set(i, v);
      return busy;
    }
    const o = this.objs[i];
    if (!o) return busy;
    const x = this.rest[i] + v * this.k;
    const tgt = this.mode === ROT ? o.rotation : o.position;
    if (this.axis === 0) tgt.x = x;
    else if (this.axis === 1) tgt.y = x;
    else tgt.z = x;
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
    this.tmp = new Float32Array(6);
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
    for (const t of this.tracks) {
      this.stats.tracks++;
      this.stats.keyframes += t.time.length;
      this.stats.elements += t.n;
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
