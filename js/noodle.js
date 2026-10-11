// Noodle Extensions (Heck suite) and Mapping Extensions: map data.
//
// Parses the modchart parts of a v2 / v3 difficulty into plain data the game plays
// (js/game/Noodle.js runs it):
//   * per object: coordinates, world / local rotation, scale / size, own NJS / spawn offset,
//     fake / uninteractable, gravity, flip, link, its own path animation (`animation`)
//   * tracks: AnimateTrack (track properties) and AssignPathAnimation (path properties)
//     events, per track and property, sorted by time (so any song time can be evaluated)
//   * AssignTrackParent / AssignPlayerToTrack events
//   * point definitions (inline or named), with easings, splineCatmullRom, lerpHSV and
//     simple modifiers ([values…, "opAdd" | "opSub" | "opMul" | "opDiv"])
//
// Coordinates are converted from Beat Saber's (Unity, left-handed: +z away from the player)
// to the game's (three.js, right-handed: -z away from the player) once here:
//   positions (x, y, z) -> (x, y, -z)
//   Euler rotations [x, y, z] (degrees, applied z, x, y) -> quaternion of Euler(-x, -y, z, 'YXZ')
// Scales, colours and plain numbers are unchanged. Position units stay Heck's (lanes of 0.6 m
// where Heck uses them); the runtime applies them.
//
// Mapping Extensions (precision placement): line index / layer >= 1000 or <= -1000 are in
// 1/1000 lanes, cut directions 1000–1360 are angles (2000–2360: dot notes), walls can have
// precision widths / heights and the old v2 "type" height encoding.

import { CHROMA_EASINGS } from './beatmap.js';

const DEG = Math.PI / 180;

// ---------------------------------------------------------------------------
// Requirements

/** 'required' | 'suggested' | null for a mod name prefix in a difficulty's SongCore customData. */
export function modListed(cd, prefix) {
  if (!cd) return null;
  const p = prefix.toLowerCase();
  const has = (list) => Array.isArray(list) && list.some((m) => typeof m === 'string' && m.toLowerCase().startsWith(p));
  if (has(cd._requirements) || has(cd.requirements)) return 'required';
  if (has(cd._suggestions) || has(cd.suggestions)) return 'suggested';
  return null;
}

// ---------------------------------------------------------------------------
// Mapping Extensions

/** Line index -> lanes (ME precision: >= 1000 or <= -1000 are 1/1000 lanes, 1000 = lane 0). */
export function meLane(v) {
  if (v >= 1000) return v / 1000 - 1;
  if (v <= -1000) return v / 1000 + 1;
  return v;
}

/** Line layer -> layers (ME: 1000 = layer 0; negative precision layers have no +2000 shift in ME). */
export function meLayer(v) {
  if (v >= 1000 || v <= -1000) return v / 1000 - 1;
  return v;
}

/** Cut direction -> { d, a } (ME: 1000–1360 = down rotated by 1000 - value degrees, 2000–2360 = dot). */
export function meDir(d) {
  if (d >= 1000 && d <= 1360) return { d: 1, a: 1000 - d };
  if (d >= 2000 && d <= 2360) return { d: 8, a: 0 };
  return { d, a: 0 };
}

/** Precision wall width (lanes). */
export function meWidth(w) {
  if (w >= 1000) return (w - 1000) / 1000;
  if (w <= -1000) return (w + 1000) / 1000;
  return w;
}

/** Precision wall height (layers). */
export function meHeight(h) {
  if (h >= 1000) return (h - 1000) / 1000;
  if (h <= -1000) return (h + 2000) / 1000;
  return h;
}

/** v2 wall `_type` >= 1000 (old ME encoding) -> { y (layers), h (layers) }, or null. */
export function meWallType(type) {
  if (!(type >= 1000 && type <= 4005000)) return null;
  let obsHeight;
  let startHeight = 0;
  if (type >= 4001) {
    const v = type - 4001;
    obsHeight = Math.floor(v / 1000);
    startHeight = v % 1000;
  } else obsHeight = type - 1000;
  return { h: (obsHeight / 1000) * 5, y: (startHeight / 750) * 5 + 0.334 };
}

// ---------------------------------------------------------------------------
// Math helpers (plain arrays, three.js conventions)

/** Beat Saber Euler angles (degrees) -> three.js quaternion [x, y, z, w] (mirrored to the game's axes). */
export function eulerToQuat(ex, ey, ez, out = new Float64Array(4)) {
  // three.js Euler(-ex, -ey, ez, 'YXZ')
  const x = -ex * DEG * 0.5;
  const y = -ey * DEG * 0.5;
  const z = ez * DEG * 0.5;
  const c1 = Math.cos(x);
  const c2 = Math.cos(y);
  const c3 = Math.cos(z);
  const s1 = Math.sin(x);
  const s2 = Math.sin(y);
  const s3 = Math.sin(z);
  out[0] = s1 * c2 * c3 + c1 * s2 * s3;
  out[1] = c1 * s2 * c3 - s1 * c2 * s3;
  out[2] = c1 * c2 * s3 - s1 * s2 * c3;
  out[3] = c1 * c2 * c3 + s1 * s2 * s3;
  return out;
}

function slerp(a, ai, b, bi, t, out) {
  let ax = a[ai];
  let ay = a[ai + 1];
  let az = a[ai + 2];
  let aw = a[ai + 3];
  const bx = b[bi];
  const by = b[bi + 1];
  const bz = b[bi + 2];
  const bw = b[bi + 3];
  let cos = ax * bx + ay * by + az * bz + aw * bw;
  if (cos < 0) {
    ax = -ax;
    ay = -ay;
    az = -az;
    aw = -aw;
    cos = -cos;
  }
  let ka;
  let kb;
  if (cos > 0.9995) {
    ka = 1 - t;
    kb = t;
  } else {
    const th = Math.acos(Math.min(1, cos));
    const s = Math.sin(th);
    ka = Math.sin((1 - t) * th) / s;
    kb = Math.sin(t * th) / s;
  }
  const x = ax * ka + bx * kb;
  const y = ay * ka + by * kb;
  const z = az * ka + bz * kb;
  const w = aw * ka + bw * kb;
  const l = Math.sqrt(x * x + y * y + z * z + w * w) || 1;
  out[0] = x / l;
  out[1] = y / l;
  out[2] = z / l;
  out[3] = w / l;
}

function rgbToHsv(r, g, b, out) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
    if (h < 0) h += 1;
  }
  out[0] = h;
  out[1] = max > 0 ? d / max : 0;
  out[2] = max;
}

function hsvToRgb(h, s, v, out) {
  h = ((h % 1) + 1) % 1;
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  const k = i % 6;
  // sector k: (v,t,p) (q,v,p) (p,v,t) (p,q,v) (t,p,v) (v,p,q)
  out[0] = k === 0 || k === 5 ? v : k === 1 ? q : k === 4 ? t : p;
  out[1] = k === 1 || k === 2 ? v : k === 0 ? t : k === 3 ? q : p;
  out[2] = k === 3 || k === 4 ? v : k === 2 ? t : k === 5 ? q : p;
}

// ---------------------------------------------------------------------------
// Point definitions

// value kinds: 'f' float · 'p' position (vec3, z mirrored) · 's' scale (vec3) · 'q' rotation
// (Euler in, quaternion out) · 'c' colour (rgba)
const IN_SIZE = { f: 1, p: 3, s: 3, q: 3, c: 4 };
const OUT_SIZE = { f: 1, p: 3, s: 3, q: 4, c: 4 };

const _hsvA = new Float64Array(3);
const _hsvB = new Float64Array(3);
const _rgb = new Float64Array(3);

/**
 * A point definition: values over a 0..1 time. eval(time, out) writes the interpolated value
 * (out: array-like of OUT_SIZE[kind]). Times outside the points clamp to the first / last value.
 * The last segment used is kept as a hint (most calls continue nearby).
 */
export class PointDef {
  constructor(kind, times, values, eases, spline, hsv) {
    this.kind = kind;
    this.size = OUT_SIZE[kind];
    this.n = times.length;
    this.t = times;
    this.v = values;
    this.ease = eases; // per point (easing into it from the previous point) or null
    this.spline = spline; // per point: Catmull-Rom into it
    this.hsv = hsv; // per point: HSV lerp into it
    this.hint = 0;
    this.constant = this.n === 1 || values.every((x, i) => x === values[i % this.size]);
  }

  copyPoint(k, out) {
    const s = this.size;
    for (let i = 0; i < s; i++) out[i] = this.v[k * s + i];
  }

  eval(time, out) {
    const n = this.n;
    const t = this.t;
    if (this.constant || !(time > t[0])) {
      this.copyPoint(0, out);
      return out;
    }
    if (time >= t[n - 1]) {
      this.copyPoint(n - 1, out);
      return out;
    }
    let l = this.hint;
    if (!(l + 1 < n && t[l] < time && time <= t[l + 1])) {
      l = 0;
      let r = n;
      while (l < r - 1) {
        const m = (l + r) >> 1;
        if (t[m] < time) l = m;
        else r = m;
      }
      this.hint = l;
    }
    const r = l + 1;
    const span = t[r] - t[l];
    let f = span !== 0 ? (time - t[l]) / span : 0;
    const e = this.ease[r];
    if (e) f = e(f);
    const s = this.size;
    const v = this.v;
    if (this.kind === 'q') {
      slerp(v, l * 4, v, r * 4, f, out);
    } else if (this.spline && this.spline[r]) {
      // Catmull-Rom through the neighbouring points
      const p0 = Math.max(0, l - 1) * s;
      const p3 = Math.min(n - 1, r + 1) * s;
      const tt = f * f;
      const ttt = tt * f;
      const q0 = -ttt + 2 * tt - f;
      const q1 = 3 * ttt - 5 * tt + 2;
      const q2 = -3 * ttt + 4 * tt + f;
      const q3 = ttt - tt;
      for (let i = 0; i < s; i++) out[i] = 0.5 * (v[p0 + i] * q0 + v[l * s + i] * q1 + v[r * s + i] * q2 + v[p3 + i] * q3);
    } else if (this.hsv && this.hsv[r]) {
      rgbToHsv(v[l * 4], v[l * 4 + 1], v[l * 4 + 2], _hsvA);
      rgbToHsv(v[r * 4], v[r * 4 + 1], v[r * 4 + 2], _hsvB);
      hsvToRgb(_hsvA[0] + (_hsvB[0] - _hsvA[0]) * f, _hsvA[1] + (_hsvB[1] - _hsvA[1]) * f, _hsvA[2] + (_hsvB[2] - _hsvA[2]) * f, _rgb);
      out[0] = _rgb[0];
      out[1] = _rgb[1];
      out[2] = _rgb[2];
      out[3] = v[l * 4 + 3] + (v[r * 4 + 3] - v[l * 4 + 3]) * f;
    } else {
      for (let i = 0; i < s; i++) out[i] = v[l * s + i] + (v[r * s + i] - v[l * s + i]) * f;
    }
    return out;
  }
}

const OPS = {
  opAdd: (a, b) => a + b,
  opSub: (a, b) => a - b,
  opMul: (a, b) => a * b,
  opDiv: (a, b) => a / b,
};

class Unsupported extends Error {}

/** Splits a raw point (or modifier) into numbers, flags and modifiers. Throws Unsupported on bases. */
function splitPoint(raw) {
  const nums = [];
  const flags = [];
  const mods = [];
  for (const x of raw) {
    if (typeof x === 'number') nums.push(x);
    else if (typeof x === 'string') {
      if (x.startsWith('base')) throw new Unsupported(x); // player / score bases: not supported
      flags.push(x);
    } else if (Array.isArray(x)) mods.push(x);
    else if (x === null) nums.push(0);
  }
  return { nums, flags, mods };
}

/** Applies modifiers ([values…, op, nested modifiers…]) to `vals` (component-wise). */
function applyModifiers(vals, mods, size) {
  for (const m of mods) {
    const { nums, flags, mods: inner } = splitPoint(m);
    const op = OPS[flags.find((f) => OPS[f])];
    if (!op) continue;
    const mv = nums.slice(0, size);
    while (mv.length < size) mv.push(mv.length ? mv[mv.length - 1] : 0);
    applyModifiers(mv, inner, size);
    for (let i = 0; i < size; i++) vals[i] = op(vals[i], mv[i]);
  }
}

/**
 * Parses a raw point definition (array of points, a single point, or a name in `named`).
 * kind: see IN_SIZE. Returns a PointDef or null (empty / malformed / unsupported).
 */
export function parsePointDef(raw, kind, named, cache) {
  if (raw == null) return null;
  if (typeof raw === 'string') {
    const key = `${raw}\u0000${kind}`;
    if (cache && cache.has(key)) return cache.get(key);
    const pd = named && named[raw] !== undefined ? parsePointDef(named[raw], kind, null, null) : null;
    if (cache) cache.set(key, pd);
    return pd;
  }
  if (!Array.isArray(raw) || !raw.length) return null;
  const list = Array.isArray(raw[0]) ? raw : [[...raw, 0]];
  const inSize = IN_SIZE[kind];
  const outSize = OUT_SIZE[kind];
  const times = [];
  const values = [];
  const eases = [];
  const spline = [];
  const hsv = [];
  try {
    for (const p of list) {
      if (!Array.isArray(p)) continue;
      const { nums, flags, mods } = splitPoint(p);
      let comps;
      let time;
      if (nums.length >= inSize + 1) {
        comps = nums.slice(0, inSize);
        time = nums[inSize];
      } else if (kind === 'c' && nums.length === 4) {
        comps = [nums[0], nums[1], nums[2], 1]; // rgb + time
        time = nums[3];
      } else if (nums.length === inSize && list.length === 1) {
        comps = nums.slice(); // a lone point without time
        time = 0;
      } else continue;
      applyModifiers(comps, mods, inSize);
      if (!comps.every(Number.isFinite) || !Number.isFinite(time)) continue;
      times.push(time);
      if (kind === 'q') {
        const q = eulerToQuat(comps[0], comps[1], comps[2]);
        values.push(q[0], q[1], q[2], q[3]);
      } else if (kind === 'p') values.push(comps[0], comps[1], -comps[2]);
      else values.push(...comps);
      let ease = null;
      for (const f of flags) if (f.startsWith('ease') && CHROMA_EASINGS[f]) ease = CHROMA_EASINGS[f];
      eases.push(ease === CHROMA_EASINGS.easeLinear ? null : ease);
      spline.push(flags.includes('splineCatmullRom') ? 1 : 0);
      hsv.push(flags.includes('lerpHSV') ? 1 : 0);
    }
  } catch (e) {
    if (e instanceof Unsupported) return null;
    throw e;
  }
  if (!times.length) return null;
  // points must be in time order (Heck expects it; keep the file's order for equal times)
  const order = times.map((_, i) => i).sort((a, b) => times[a] - times[b] || a - b);
  const sorted = (arr, size) => {
    const out = new Float64Array(order.length * size);
    order.forEach((k, i) => {
      for (let j = 0; j < size; j++) out[i * size + j] = arr[k * size + j];
    });
    return out;
  };
  return new PointDef(
    kind,
    sorted(times, 1),
    sorted(values, outSize),
    order.map((k) => eases[k]),
    spline.some(Boolean) && kind !== 'q' && kind !== 'c' && kind !== 'f' ? Uint8Array.from(order.map((k) => spline[k])) : null,
    kind === 'c' && hsv.some(Boolean) ? Uint8Array.from(order.map((k) => hsv[k])) : null,
  );
}

// ---------------------------------------------------------------------------
// Property names

// AnimateTrack (track properties): v3 name -> kind
export const TRACK_PROPS = {
  offsetPosition: 'p',
  offsetWorldRotation: 'q',
  localRotation: 'q',
  scale: 's',
  dissolve: 'f',
  dissolveArrow: 'f',
  interactable: 'f',
  time: 'f',
  color: 'c',
  position: 'p',
  localPosition: 'p',
  rotation: 'q',
};
// v2 names -> the v3 properties they set (v2 _position / _rotation drive both object offsets and transforms)
const TRACK_V2 = {
  _position: ['offsetPosition', 'position'],
  _rotation: ['offsetWorldRotation', 'rotation'],
  _localRotation: ['localRotation'],
  _localPosition: ['localPosition'],
  _scale: ['scale'],
  _dissolve: ['dissolve'],
  _dissolveArrow: ['dissolveArrow'],
  _interactable: ['interactable'],
  _time: ['time'],
  _color: ['color'],
};

// AssignPathAnimation / object `animation` (path properties)
export const PATH_PROPS = {
  offsetPosition: 'p',
  offsetWorldRotation: 'q',
  localRotation: 'q',
  scale: 's',
  definitePosition: 'p',
  dissolve: 'f',
  dissolveArrow: 'f',
  interactable: 'f',
  color: 'c',
};
const PATH_V2 = {
  _position: 'offsetPosition',
  _rotation: 'offsetWorldRotation',
  _localRotation: 'localRotation',
  _scale: 'scale',
  _definitePosition: 'definitePosition',
  _dissolve: 'dissolve',
  _dissolveArrow: 'dissolveArrow',
  _interactable: 'interactable',
  _color: 'color',
};

// object animation keys (short names used by the runtime)
export const ANIM_KEYS = {
  offsetPosition: 'pos',
  offsetWorldRotation: 'rot',
  localRotation: 'lrot',
  scale: 'scale',
  definitePosition: 'def',
  dissolve: 'dis',
  dissolveArrow: 'disA',
  interactable: 'int',
  color: 'color',
};

// ---------------------------------------------------------------------------
// Tracks

export class TrackData {
  constructor(name, id) {
    this.name = name;
    this.id = id;
    this.anim = {}; // property -> [{ t0, dur, ease, repeat, pd }] (AnimateTrack)
    this.path = {}; // property -> [{ t0, dur, ease, pd }] (AssignPathAnimation)
    this.parents = []; // AssignTrackParent events with this track among the children (time order)
    this.used = false; // has objects, or parents / moves something that does
  }
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const bool = (v) => (typeof v === 'boolean' ? v : null);

function vec3(v, kind) {
  if (!Array.isArray(v) || v.length < 3 || !v.slice(0, 3).every((x) => typeof x === 'number' && Number.isFinite(x))) return null;
  if (kind === 'q') return eulerToQuat(v[0], v[1], v[2]);
  if (kind === 'p') return [v[0], v[1], -v[2]];
  return [v[0], v[1], v[2]];
}

function rotationValue(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return eulerToQuat(0, v, 0);
  return vec3(v, 'q');
}

/** [a, b, c] with nulls allowed -> array of numbers / nulls, or null. */
function nullableFloats(v) {
  if (!Array.isArray(v)) return null;
  return v.map((x) => (typeof x === 'number' && Number.isFinite(x) ? x : null));
}

/**
 * Builds the Noodle data of a difficulty.
 * json: the difficulty; version: 2 | 3; toTime(beat) -> seconds.
 * Returns { ctx, objData(cd, kind) } where objData parses an object's customData (call it for
 * every note / bomb / wall / chain / arc first) and ctx.finish() builds tracks and events.
 */
export function createNoodleParser(json, version, toTime) {
  const v2 = version === 2;
  const root = (v2 ? json._customData : json.customData) || json.customData || json._customData || {};
  // named point definitions
  const named = {};
  const pdRaw = v2 ? root._pointDefinitions : root.pointDefinitions;
  if (Array.isArray(pdRaw)) {
    for (const p of pdRaw) if (p && typeof p._name === 'string') named[p._name] = p._points;
  } else if (pdRaw && typeof pdRaw === 'object') Object.assign(named, pdRaw);
  const cache = new Map();
  const tracks = new Map();
  const track = (name) => {
    let tr = tracks.get(name);
    if (!tr) {
      tr = new TrackData(name, tracks.size);
      tracks.set(name, tr);
    }
    return tr;
  };
  const trackList = (v) => {
    if (typeof v === 'string') return [track(v)];
    if (Array.isArray(v)) {
      if (v.length === 1 && typeof v[0] === 'string') return [track(v[0])];
      const out = [];
      const seen = new Set();
      for (const n of v) {
        if (typeof n !== 'string' || seen.has(n)) continue;
        seen.add(n);
        out.push(track(n));
      }
      return out.length ? out : null;
    }
    return null;
  };
  const pick = (cd, k2, k3) => (v2 ? cd[k2] : cd[k3]);

  /** Noodle data of one object (null when it has none). kind: note | bomb | wall | chain | arc. */
  function objData(cd, kind) {
    if (!cd || typeof cd !== 'object') return null;
    const nd = {
      tracks: trackList(pick(cd, '_track', 'track')),
      anim: null,
      worldRot: null,
      localRot: null,
      scale: null,
      njs: num(pick(cd, '_noteJumpMovementSpeed', 'noteJumpMovementSpeed')),
      offset: num(pick(cd, '_noteJumpStartBeatOffset', 'noteJumpStartBeatOffset')),
      coords: nullableFloats(pick(cd, '_position', 'coordinates')),
      tailCoords: nullableFloats(cd.tailCoordinates),
      size: null,
      fake: v2 ? cd._fake === true : false,
      uninteractable: v2 ? cd._interactable === false : cd.uninteractable === true,
      noGravity: pick(cd, '_disableNoteGravity', 'disableNoteGravity') === true,
      noLook: pick(cd, '_disableNoteLook', 'disableNoteLook') === true,
      flip: nullableFloats(pick(cd, '_flip', 'flip')),
      link: !v2 && typeof cd.link === 'string' ? cd.link : null,
      noBadDir: !v2 && cd.disableBadCutDirection === true,
      noBadSpeed: !v2 && cd.disableBadCutSpeed === true,
      noBadSaber: !v2 && cd.disableBadCutSaberType === true,
      cutAngle: v2 ? num(cd._cutDirection) : null,
    };
    if (nd.tracks) for (const t of nd.tracks) t.used = true;
    const rot = pick(cd, '_rotation', 'worldRotation');
    if (rot != null) nd.worldRot = rotationValue(rot);
    const lrot = pick(cd, '_localRotation', 'localRotation');
    if (lrot != null) nd.localRot = vec3(lrot, 'q');
    if (!v2) {
      const s = nullableFloats(cd.scale);
      if (s && s.some((x) => x !== null)) nd.scale = [s[0] ?? 1, s[1] ?? 1, s[2] ?? 1];
    }
    if (kind === 'wall') {
      const sz = nullableFloats(pick(cd, '_scale', 'size'));
      if (sz) nd.size = [sz[0] ?? null, sz[1] ?? null, sz[2] ?? null];
    }
    const anim = pick(cd, '_animation', 'animation');
    if (anim && typeof anim === 'object') {
      const a = {};
      let any = false;
      for (const [k, v] of Object.entries(anim)) {
        const prop = v2 ? PATH_V2[k] : PATH_PROPS[k] ? k : null;
        if (!prop) continue;
        const pd = parsePointDef(v, PATH_PROPS[prop], named, cache);
        if (pd) {
          a[ANIM_KEYS[prop]] = pd;
          any = true;
        }
      }
      if (any) nd.anim = a;
    }
    return nd;
  }

  const parents = [];
  const players = [];

  /** Reads the custom events (tracks must be marked used by objData first). */
  function finish() {
    const raw = (v2 ? root._customEvents : root.customEvents) || [];
    const events = [];
    raw.forEach((e, i) => {
      if (!e || typeof e !== 'object') return;
      const beat = num(v2 ? e._time : e.b) ?? 0;
      const type = v2 ? e._type : e.t;
      const d = (v2 ? e._data : e.d) || {};
      events.push({ beat, t0: toTime(beat), type, d, i });
    });
    events.sort((a, b) => a.beat - b.beat || a.i - b.i);
    const dur = (e) => {
      const b = Math.max(0, num(pick(e.d, '_duration', 'duration')) ?? 0);
      return b > 0 ? Math.max(0, toTime(e.beat + b) - e.t0) : 0;
    };
    const easing = (e) => {
      const n = pick(e.d, '_easing', 'easing');
      const f = typeof n === 'string' ? CHROMA_EASINGS[n] : null;
      return f && f !== CHROMA_EASINGS.easeLinear ? f : null;
    };

    // which tracks matter: ones with objects, their parents (transitively) and the player's
    for (const e of events) {
      if (e.type === 'AssignPlayerToTrack') {
        const tr = trackList(pick(e.d, '_track', 'track'));
        if (tr) tr[0].used = true;
      }
    }
    const parentEvents = [];
    for (const e of events) {
      if (e.type !== 'AssignTrackParent') continue;
      e.p = trackList(pick(e.d, '_parentTrack', 'parentTrack'));
      e.kids = trackList(pick(e.d, '_childrenTracks', 'childrenTracks'));
      if (e.p && e.kids) parentEvents.push(e);
    }
    let changed = true;
    while (changed) {
      changed = false;
      for (const e of parentEvents) {
        const p = e.p;
        if (!p[0].used && e.kids.some((k) => k.used)) {
          p[0].used = true;
          changed = true;
        }
      }
    }

    for (const e of events) {
      const d = e.d;
      if (e.type === 'AnimateTrack' || e.type === 'AssignPathAnimation') {
        const trs = (trackList(pick(d, '_track', 'track')) || []).filter((t) => t.used);
        if (!trs.length) continue;
        const path = e.type === 'AssignPathAnimation';
        const t0 = e.t0;
        const dd = dur(e);
        const ease = easing(e);
        const repeat = path ? 0 : Math.max(0, Math.floor(num(pick(d, '_repeat', 'repeat')) ?? 0));
        for (const [k, v] of Object.entries(d)) {
          let props;
          if (path) props = v2 ? (PATH_V2[k] ? [PATH_V2[k]] : null) : PATH_PROPS[k] ? [k] : null;
          else props = v2 ? TRACK_V2[k] : TRACK_PROPS[k] ? [k] : null;
          if (!props) continue;
          for (const prop of props) {
            const kind = (path ? PATH_PROPS : TRACK_PROPS)[prop];
            const pd = v === null ? null : parsePointDef(v, kind, named, cache);
            if (v !== null && !pd) continue; // malformed / unsupported: ignored
            const ev = { t0, dur: dd, ease, repeat, pd };
            for (const tr of trs) {
              const list = path ? tr.path : tr.anim;
              (list[prop] ||= []).push(ev);
            }
          }
        }
      } else if (e.type === 'AssignTrackParent') {
        const p = e.p;
        const kids = e.kids;
        if (!p || !kids || !p[0].used) continue;
        const children = kids.filter((k) => k !== p[0]);
        const ev = {
          t0: e.t0,
          index: parents.length,
          parent: p[0],
          children,
          v2,
          worldPositionStays: pick(d, '_worldPositionStays', 'worldPositionStays') === true,
          // v2: start transform (_position in lanes, _rotation, _localRotation, _scale)
          // v3: TransformData (position / localPosition in metres, rotation / localRotation, scale)
          pos: vec3(pick(d, '_position', 'position'), 'p'),
          localPos: v2 ? null : vec3(d.localPosition, 'p'),
          rot: vec3(pick(d, '_rotation', 'rotation'), 'q'),
          localRot: vec3(pick(d, '_localRotation', 'localRotation'), 'q'),
          scale: vec3(pick(d, '_scale', 'scale'), 's'),
        };
        parents.push(ev);
        for (const k of children) k.parents.push(ev);
      } else if (e.type === 'AssignPlayerToTrack') {
        const tr = trackList(pick(d, '_track', 'track'));
        if (!tr) continue;
        const target = pick(d, '_target', 'target');
        players.push({ t0: e.t0, track: tr[0], target: typeof target === 'string' ? target : 'Root' });
      }
    }
    const used = [...tracks.values()].filter((t) => t.used);
    return { v2, tracks: used, parents, players, eventCount: events.length };
  }

  return { objData, finish, tracks };
}

/** Half jump duration (seconds) for an NJS and spawn offset (beats), like the game. */
export function halfJumpFor(njs, offset, bpm) {
  const spb = 60 / bpm;
  let hjd = 4;
  while (njs * spb * hjd > 17.999) hjd /= 2;
  hjd += offset || 0;
  if (hjd < 0.25) hjd = 0.25;
  return hjd * spb;
}
