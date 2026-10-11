// v3 / v4 group lighting ("event box groups"): parsing and the load-time maths (index filters,
// beat / value distributions, transitions). Pure functions, no three.js: the runtime that plays
// the result is js/game/GroupLighting.js.
//
// Semantics (BSMG wiki map format "lightshow", the official editor documentation
// "The Group Lighting Event System", checked against real maps):
//  - A group (beat, group id) holds event boxes. Each box picks elements of the group with an
//    index filter and plays its events on them; boxes listed first win when two boxes set the
//    same element at the same time.
//  - Index filter, in this order: chunks (c > 0: the n elements are split into c equal chunks that
//    act as one element each), reverse (the order is reversed first), then
//      division (type 1): p sections of ceil(count / p) chunks, section t (0-based) is used;
//      step and offset (type 2): chunk p, then every t-th one after it (t 0 = only chunk p);
//    random (bit 2: shuffled with the seed, bit 1: keep the original order), limit
//    (l in 0..1, 0 = all: the first ceil(l x count) of the picked chunks).
//  - Beat distribution over the picked chunks (index i = 0 … N-1): wave (1): the last event of the
//    last chunk plays w beats after the group, i.e. a gap of (w - last event offset) / (N - 1);
//    step (2): w beats between chunks. N = all picked chunks, or the limited ones when the limit
//    behaviour has bit 1 (duration).
//  - Value distribution (brightness / rotation / translation / fx): added to each event's value,
//    wave: the last chunk gets +param (param x ease(i / (N - 1))), step: +param per chunk (eased the
//    same way over N - 1 steps). Not applied to the box's first event unless "affect first".
//    N uses the limited chunks when the limit behaviour has bit 2 (distribution).
//  - Transitions: instant / interpolate (from the element's previous state, over the time between
//    the two, with the event's easing) / extend (keeps the previous state until this event).

export const TR_INSTANT = 0;
export const TR_INTERP = 1;
export const TR_EXTEND = 2;

// ---------------------------------------------------------------------------
// Easings (Beat Saber's EaseType: -1 none, 0 linear, 1 InQuad … 30 InOutBounce,
// 100 … 102 Beat Saber's own InOutBack / InOutElastic / InOutBounce)

const C1 = 1.70158;
const C2 = C1 * 1.525;
const C3 = C1 + 1;
const C4 = (2 * Math.PI) / 3;
const C5 = (2 * Math.PI) / 4.5;
function outBounce(t) {
  const n = 7.5625;
  const d = 2.75;
  if (t < 1 / d) return n * t * t;
  if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75;
  if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375;
  return n * (t -= 2.625 / d) * t + 0.984375;
}
const inOutBack = (t) => (t < 0.5 ? ((2 * t) ** 2 * ((C2 + 1) * 2 * t - C2)) / 2 : ((2 * t - 2) ** 2 * ((C2 + 1) * (t * 2 - 2) + C2) + 2) / 2);
const inOutElastic = (t) => (t === 0 ? 0 : t === 1 ? 1 : t < 0.5
  ? -(2 ** (20 * t - 10) * Math.sin((20 * t - 11.125) * C5)) / 2
  : (2 ** (-20 * t + 10) * Math.sin((20 * t - 11.125) * C5)) / 2 + 1);
const inOutBounce = (t) => (t < 0.5 ? (1 - outBounce(1 - 2 * t)) / 2 : (1 + outBounce(2 * t - 1)) / 2);

/** Easing functions by index: EASE_INDEX(type) -> index into GL_EASINGS. */
export const GL_EASINGS = [
  (t) => t, // 0 linear
  (t) => t * t, // 1 InQuad
  (t) => 1 - (1 - t) * (1 - t), // 2 OutQuad
  (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2), // 3 InOutQuad
  (t) => 1 - Math.cos((t * Math.PI) / 2), // 4 InSine
  (t) => Math.sin((t * Math.PI) / 2), // 5 OutSine
  (t) => -(Math.cos(Math.PI * t) - 1) / 2, // 6 InOutSine
  (t) => t ** 3, // 7 InCubic
  (t) => 1 - (1 - t) ** 3, // 8 OutCubic
  (t) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2), // 9 InOutCubic
  (t) => t ** 4, // 10 InQuart
  (t) => 1 - (1 - t) ** 4, // 11 OutQuart
  (t) => (t < 0.5 ? 8 * t ** 4 : 1 - (-2 * t + 2) ** 4 / 2), // 12 InOutQuart
  (t) => t ** 5, // 13 InQuint
  (t) => 1 - (1 - t) ** 5, // 14 OutQuint
  (t) => (t < 0.5 ? 16 * t ** 5 : 1 - (-2 * t + 2) ** 5 / 2), // 15 InOutQuint
  (t) => (t === 0 ? 0 : 2 ** (10 * t - 10)), // 16 InExpo
  (t) => (t === 1 ? 1 : 1 - 2 ** (-10 * t)), // 17 OutExpo
  (t) => (t === 0 ? 0 : t === 1 ? 1 : t < 0.5 ? 2 ** (20 * t - 10) / 2 : (2 - 2 ** (-20 * t + 10)) / 2), // 18 InOutExpo
  (t) => 1 - Math.sqrt(1 - t * t), // 19 InCirc
  (t) => Math.sqrt(1 - (t - 1) ** 2), // 20 OutCirc
  (t) => (t < 0.5 ? (1 - Math.sqrt(1 - (2 * t) ** 2)) / 2 : (Math.sqrt(1 - (-2 * t + 2) ** 2) + 1) / 2), // 21 InOutCirc
  (t) => C3 * t * t * t - C1 * t * t, // 22 InBack
  (t) => 1 + C3 * (t - 1) ** 3 + C1 * (t - 1) ** 2, // 23 OutBack
  inOutBack, // 24 InOutBack
  (t) => (t === 0 ? 0 : t === 1 ? 1 : -(2 ** (10 * t - 10)) * Math.sin((t * 10 - 10.75) * C4)), // 25 InElastic
  (t) => (t === 0 ? 0 : t === 1 ? 1 : 2 ** (-10 * t) * Math.sin((t * 10 - 0.75) * C4) + 1), // 26 OutElastic
  inOutElastic, // 27 InOutElastic
  (t) => 1 - outBounce(1 - t), // 28 InBounce
  outBounce, // 29 OutBounce
  inOutBounce, // 30 InOutBounce
  // 31 … 33: Beat Saber's own variants (100 … 102), approximated by the standard curves
  inOutBack,
  inOutElastic,
  inOutBounce,
];

/** Map easing type -> index into GL_EASINGS (unknown / -1 -> linear; -1 is handled as "instant" by the parser). */
export function easeIndex(type) {
  const e = Number(type) | 0;
  if (e >= 0 && e <= 30) return e;
  if (e >= 100 && e <= 102) return e - 69;
  return 0;
}

export const ease = (idx, t) => GL_EASINGS[idx](t < 0 ? 0 : t > 1 ? 1 : t);



/**
 * Same curves as GL_EASINGS, for the per-frame runtime: reads t from io[at] and writes the result
 * there (a typed array instead of number arguments / results).
 */
export function easeIO(idx, io, at = 0) {
  // every result is written straight into io[at] (no phi of numbers: a phi mixing small integer
  // constants and doubles may be boxed by the JIT)
  if (!(io[at] > 0)) io[at] = 0;
  else if (io[at] > 1) io[at] = 1;
  const t = io[at];
  if (idx === 0) return;
  const lo = t < 0.5;
  switch (idx) {
    case 1: io[at] = t * t; return;
    case 2: io[at] = 1 - (1 - t) * (1 - t); return;
    case 3:
      if (lo) io[at] = 2 * t * t;
      else io[at] = 1 - ((2 - 2 * t) * (2 - 2 * t)) / 2;
      return;
    case 4: io[at] = 1 - Math.cos((t * Math.PI) / 2); return;
    case 5: io[at] = Math.sin((t * Math.PI) / 2); return;
    case 6: io[at] = (1 - Math.cos(Math.PI * t)) / 2; return;
    case 7: io[at] = t * t * t; return;
    case 8: io[at] = 1 - (1 - t) * (1 - t) * (1 - t); return;
    case 9:
      if (lo) io[at] = 4 * t * t * t;
      else io[at] = 1 - Math.pow(2 - 2 * t, 3) / 2;
      return;
    case 10: io[at] = t * t * t * t; return;
    case 11: io[at] = 1 - Math.pow(1 - t, 4); return;
    case 12:
      if (lo) io[at] = 8 * t * t * t * t;
      else io[at] = 1 - Math.pow(2 - 2 * t, 4) / 2;
      return;
    case 13: io[at] = t * t * t * t * t; return;
    case 14: io[at] = 1 - Math.pow(1 - t, 5); return;
    case 15:
      if (lo) io[at] = 16 * Math.pow(t, 5);
      else io[at] = 1 - Math.pow(2 - 2 * t, 5) / 2;
      return;
    case 16: if (t > 0) io[at] = Math.pow(2, 10 * t - 10); return;
    case 17: if (t < 1) io[at] = 1 - Math.pow(2, -10 * t); return;
    case 18:
      if (t > 0 && t < 1) {
        if (lo) io[at] = Math.pow(2, 20 * t - 10) / 2;
        else io[at] = (2 - Math.pow(2, 10 - 20 * t)) / 2;
      }
      return;
    case 19: io[at] = 1 - Math.sqrt(1 - t * t); return;
    case 20: io[at] = Math.sqrt(1 - (t - 1) * (t - 1)); return;
    case 21:
      if (lo) io[at] = (1 - Math.sqrt(1 - 4 * t * t)) / 2;
      else io[at] = (Math.sqrt(1 - (2 - 2 * t) * (2 - 2 * t)) + 1) / 2;
      return;
    case 22: io[at] = C3 * t * t * t - C1 * t * t; return;
    case 23: io[at] = 1 + C3 * Math.pow(t - 1, 3) + C1 * (t - 1) * (t - 1); return;
    case 24: case 31:
      if (lo) io[at] = (4 * t * t * ((C2 + 1) * 2 * t - C2)) / 2;
      else io[at] = ((2 * t - 2) * (2 * t - 2) * ((C2 + 1) * (t * 2 - 2) + C2) + 2) / 2;
      return;
    case 25: if (t > 0 && t < 1) io[at] = -Math.pow(2, 10 * t - 10) * Math.sin((t * 10 - 10.75) * C4); return;
    case 26: if (t > 0 && t < 1) io[at] = Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * C4) + 1; return;
    case 27: case 32:
      if (t > 0 && t < 1) {
        if (lo) io[at] = -(Math.pow(2, 20 * t - 10) * Math.sin((20 * t - 11.125) * C5)) / 2;
        else io[at] = (Math.pow(2, 10 - 20 * t) * Math.sin((20 * t - 11.125) * C5)) / 2 + 1;
      }
      return;
    case 28: bounceIO(io, at, 1 - t); io[at] = 1 - io[at]; return;
    case 29: bounceIO(io, at, t); return;
    case 30: case 33:
      if (lo) {
        bounceIO(io, at, 1 - 2 * t);
        io[at] = (1 - io[at]) / 2;
      } else {
        bounceIO(io, at, 2 * t - 1);
        io[at] = (1 + io[at]) / 2;
      }
      return;
    default:
  }
}

/** Bounce-out of x written to io[at] (see easeIO). */
function bounceIO(io, at, x) {
  if (x < 1 / 2.75) io[at] = 7.5625 * x * x;
  else if (x < 2 / 2.75) io[at] = 7.5625 * (x - 1.5 / 2.75) * (x - 1.5 / 2.75) + 0.75;
  else if (x < 2.5 / 2.75) io[at] = 7.5625 * (x - 2.25 / 2.75) * (x - 2.25 / 2.75) + 0.9375;
  else io[at] = 7.5625 * (x - 2.625 / 2.75) * (x - 2.625 / 2.75) + 0.984375;
}

// ---------------------------------------------------------------------------
// Parsing (v3 difficulty / v4 lightshow) -> normalized groups

const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

function parseFilter(f) {
  f = f || {};
  return {
    type: num(f.f, 1) === 2 ? 2 : 1,
    p0: Math.max(0, num(f.p) | 0),
    p1: Math.max(0, num(f.t) | 0),
    reverse: num(f.r) === 1,
    chunks: Math.max(0, num(f.c) | 0),
    random: num(f.n) | 0,
    seed: num(f.s) | 0,
    limit: Math.max(0, Math.min(1, num(f.l))),
    limitAffects: num(f.d) | 0,
  };
}

function filterKey(f) {
  return `${f.type},${f.p0},${f.p1},${f.reverse ? 1 : 0},${f.chunks},${f.random},${f.seed},${f.limit},${f.limitAffects}`;
}

/** Chroma-style colour [r, g, b, a?] -> [r, g, b, brightness] (hue kept for HDR values), or null. */
function chromaColor(cd) {
  const c = cd && typeof cd === 'object' ? cd.color ?? cd._color : null;
  if (!Array.isArray(c) || c.length < 3) return null;
  let r = Math.max(0, Number(c[0]) || 0);
  let g = Math.max(0, Number(c[1]) || 0);
  let b = Math.max(0, Number(c[2]) || 0);
  let k = c.length > 3 && Number.isFinite(Number(c[3])) ? Math.max(0, Number(c[3])) : 1;
  const max = Math.max(r, g, b);
  if (max > 1) {
    r /= max;
    g /= max;
    b /= max;
    k *= Math.min(max, 1.5);
  }
  return [r, g, b, Math.min(k, 1.5)];
}

/** v4 / v3 rotation, translation, fx transition: p 1 = extend, else transition with easing (-1 = instant). */
function trans4(p, e) {
  if (num(p) === 1) return TR_EXTEND;
  return num(e) === -1 ? TR_INSTANT : TR_INTERP;
}

const byBeat = (a, b) => a.b - b.b;

function box(filter, raw, distKey, flipKey, events) {
  events.sort(byBeat); // stable: same-beat events keep their file order
  return {
    filter,
    fkey: filterKey(filter),
    bw: num(raw.w), // beat distribution param (beats)
    bt: num(raw.d, 1) === 2 ? 2 : 1, // 1 wave, 2 step
    dv: num(raw[distKey]), // value distribution param
    dt: num(raw.t, 1) === 2 ? 2 : 1,
    de: easeIndex(raw.distEase),
    first: num(raw.b) === 1, // distribution affects the first event too
    axis: Math.max(0, Math.min(2, num(raw.a) | 0)),
    flip: num(raw[flipKey]) === 1,
    events,
  };
}

function colorEvent3(e, cd) {
  const i = num(e.i);
  return {
    b: num(e.b),
    trans: i === 1 ? TR_INTERP : i === 2 ? TR_EXTEND : TR_INSTANT,
    ease: 0,
    c: Math.max(0, Math.min(2, num(e.c) | 0)),
    s: num(e.s),
    f: Math.max(0, num(e.f)),
    sb: num(e.sb),
    sf: num(e.sf) === 1,
    rgb: cd ? chromaColor(e.customData) : null,
  };
}

function colorEvent4(b, d, cd) {
  return {
    b,
    trans: trans4(d.p, d.e),
    ease: easeIndex(d.e),
    c: Math.max(0, Math.min(2, num(d.c) | 0)),
    s: num(d.b),
    f: Math.max(0, num(d.f)),
    sb: num(d.sb),
    sf: num(d.sf) === 1,
    rgb: cd ? chromaColor(d.customData) : null,
  };
}

const rotEvent = (b, p, e, r, dir, loops) => ({ b, trans: trans4(p, e), ease: easeIndex(e), v: num(r), dir: num(dir) | 0, loops: Math.max(0, num(loops) | 0) });
const valEvent = (b, p, e, v) => ({ b, trans: trans4(p, e), ease: easeIndex(e), v: num(v) });

function groupOf(raw, boxes) {
  return { beat: num(raw.b), g: num(raw.g) | 0, boxes };
}

function finish(list) {
  // groups in beat order (stable: same beat keeps the file order)
  return list.filter((g) => g.boxes.length).sort((a, b) => a.beat - b.beat);
}

/**
 * Parses the event box groups of a v3 difficulty (version 3) or a v4 lightshow (version 4).
 * Returns null when there are none, else { color, rotation, translation, fx, chroma, events }:
 * group lists (beats, see the top of this file), chroma = box events carrying a Chroma colour,
 * events = total box events.
 */
export function parseLightshow3(json, version) {
  if (!json || typeof json !== 'object') return null;
  const out = { color: [], rotation: [], translation: [], fx: [], chroma: 0, events: 0 };
  const cd = true;
  if (version === 3) {
    for (const g of json.lightColorEventBoxGroups || []) {
      const boxes = [];
      for (const b of g.e || []) {
        const evs = (b.e || []).map((e) => colorEvent3(e, cd));
        if (!evs.length) continue;
        boxes.push(box(parseFilter(b.f), { ...b, distEase: b.i }, 'r', 'r', evs));
      }
      out.color.push(groupOf(g, boxes));
    }
    for (const g of json.lightRotationEventBoxGroups || []) {
      const boxes = [];
      for (const b of g.e || []) {
        const evs = (b.l || []).map((e) => rotEvent(num(e.b), e.p, e.e, e.r, e.o, e.l));
        if (!evs.length) continue;
        boxes.push(box(parseFilter(b.f), { ...b, distEase: b.i }, 's', 'r', evs));
      }
      out.rotation.push(groupOf(g, boxes));
    }
    for (const g of json.lightTranslationEventBoxGroups || []) {
      const boxes = [];
      for (const b of g.e || []) {
        const evs = (b.l || []).map((e) => valEvent(num(e.b), e.p, e.e, e.t));
        if (!evs.length) continue;
        boxes.push(box(parseFilter(b.f), { ...b, distEase: b.i }, 's', 'r', evs));
      }
      out.translation.push(groupOf(g, boxes));
    }
    const fl = json._fxEventsCollection?._fl || [];
    for (const g of json.vfxEventBoxGroups || []) {
      const boxes = [];
      for (const b of g.e || []) {
        const evs = [];
        for (const idx of b.l || []) {
          const e = fl[idx];
          if (e) evs.push(valEvent(num(e.b), e.p, e.i, e.v));
        }
        if (!evs.length) continue;
        boxes.push(box(parseFilter(b.f), { ...b, distEase: b.i }, 's', 'r', evs));
      }
      out.fx.push(groupOf(g, boxes));
    }
  } else if (version === 4) {
    const filters = (json.indexFilters || []).map(parseFilter);
    const defFilter = parseFilter({});
    const tables = {
      1: [json.lightColorEventBoxes || [], json.lightColorEvents || [], 'color'],
      2: [json.lightRotationEventBoxes || [], json.lightRotationEvents || [], 'rotation'],
      3: [json.lightTranslationEventBoxes || [], json.lightTranslationEvents || [], 'translation'],
      4: [json.fxEventBoxes || [], json.floatFxEvents || [], 'fx'],
    };
    for (const g of json.eventBoxGroups || []) {
      const tb = tables[num(g.t)];
      if (!tb) continue;
      const [boxTable, evTable, kind] = tb;
      const boxes = [];
      for (const b of g.e || []) {
        const meta = boxTable[num(b.e) | 0] || {};
        const filter = filters[num(b.f) | 0] || defFilter;
        const evs = [];
        for (const ref of b.l || []) {
          const d = evTable[num(ref.i) | 0];
          if (!d) continue;
          const beat = num(ref.b);
          if (kind === 'color') evs.push(colorEvent4(beat, d, cd));
          else if (kind === 'rotation') evs.push(rotEvent(beat, d.p, d.e, d.r, d.d, d.l));
          else evs.push(valEvent(beat, d.p, d.e, kind === 'translation' ? d.t : d.v));
        }
        if (!evs.length) continue;
        boxes.push(box(filter, { ...meta, distEase: meta.e }, 's', 'f', evs));
      }
      out[kind].push(groupOf(g, boxes));
    }
  } else return null;
  for (const k of ['color', 'rotation', 'translation', 'fx']) {
    out[k] = finish(out[k]);
    for (const g of out[k]) for (const b of g.boxes) {
      out.events += b.events.length;
      if (k === 'color') for (const e of b.events) if (e.rgb) out.chroma++;
    }
  }
  return out.events ? out : null;
}

const V3_KEYS = ['lightColorEventBoxGroups', 'lightRotationEventBoxGroups', 'lightTranslationEventBoxGroups', 'vfxEventBoxGroups'];

/** Whether a v3 difficulty / v4 lightshow has any event box groups (cheap, no parsing). */
export function hasLightshow3(json, version) {
  if (!json || typeof json !== 'object') return false;
  if (version === 4) return Array.isArray(json.eventBoxGroups) && json.eventBoxGroups.length > 0;
  return V3_KEYS.some((k) => Array.isArray(json[k]) && json[k].length > 0);
}

/** Number of colour box events with a Chroma colour (cheap scan). */
export function countLightshow3Chroma(json, version) {
  let n = 0;
  const has = (e) => e && e.customData && Array.isArray(e.customData.color ?? e.customData._color);
  if (version === 4) {
    for (const e of json.lightColorEvents || []) if (has(e)) n++;
  } else {
    for (const g of json.lightColorEventBoxGroups || []) for (const b of g.e || []) for (const e of b.e || []) if (has(e)) n++;
  }
  return n;
}

// ---------------------------------------------------------------------------
// Index filters

/** .NET System.Random (seeded, subtractive generator) so seeded shuffles are deterministic. */
export class DotNetRandom {
  constructor(seed) {
    const MBIG = 2147483647;
    const MSEED = 161803398;
    this.seedArray = new Int32Array(56);
    const subtraction = seed === -2147483648 ? 2147483647 : Math.abs(seed | 0);
    // int arithmetic wraps like C#'s (| 0)
    let mj = (MSEED - subtraction) | 0;
    this.seedArray[55] = mj;
    let mk = 1;
    for (let i = 1; i < 55; i++) {
      const ii = (21 * i) % 55;
      this.seedArray[ii] = mk;
      mk = (mj - mk) | 0;
      if (mk < 0) mk += MBIG;
      mj = this.seedArray[ii];
    }
    for (let k = 1; k < 5; k++) {
      for (let i = 1; i < 56; i++) {
        let v = (this.seedArray[i] - this.seedArray[1 + ((i + 30) % 55)]) | 0;
        if (v < 0) v += MBIG;
        this.seedArray[i] = v;
      }
    }
    this.inext = 0;
    this.inextp = 21;
  }

  internalSample() {
    let a = this.inext + 1;
    if (a >= 56) a = 1;
    let b = this.inextp + 1;
    if (b >= 56) b = 1;
    let ret = (this.seedArray[a] - this.seedArray[b]) | 0;
    if (ret === 2147483647) ret--;
    if (ret < 0) ret += 2147483647;
    this.seedArray[a] = ret;
    this.inext = a;
    this.inextp = b;
    return ret;
  }

  /** Integer in [min, max) */
  next(min, max) {
    return min + Math.floor((this.internalSample() * (1 / 2147483647)) * (max - min));
  }
}

/**
 * Resolves an index filter on a group of n elements. Returns { steps, total }: steps = the picked
 * chunks in distribution order, each an array of element indices; total = picked chunks before
 * the limit (used by the distributions unless the limit behaviour says otherwise).
 */
export function filterSteps(f, n) {
  if (n <= 0) return { steps: [], total: 0 };
  const chunks = f.chunks > 0 ? Math.min(f.chunks, n) : n;
  // chunk order (reversed first)
  const order = [];
  for (let i = 0; i < chunks; i++) order.push(f.reverse ? chunks - 1 - i : i);
  let picked = [];
  if (f.type === 1) {
    const sections = Math.max(1, f.p0);
    const size = Math.ceil(chunks / sections);
    const start = size * f.p1;
    for (let i = start; i < Math.min(start + size, chunks); i++) picked.push(order[i]);
  } else {
    const step = f.p1;
    if (f.p0 < chunks) {
      if (step <= 0) picked.push(order[f.p0]);
      else for (let i = f.p0; i < chunks; i += step) picked.push(order[i]);
    }
  }
  const total = picked.length;
  if (f.random & 2 && picked.length > 1) {
    // seeded Fisher–Yates shuffle
    const rnd = new DotNetRandom(f.seed);
    for (let i = picked.length - 1; i > 0; i--) {
      const j = Math.min(i, rnd.next(0, i + 1));
      const t = picked[i];
      picked[i] = picked[j];
      picked[j] = t;
    }
  }
  if (f.limit > 0 && f.limit < 1) {
    const keep = Math.max(1, Math.ceil(picked.length * f.limit - 1e-6));
    picked = picked.slice(0, keep);
    if (f.random & 1) {
      // keep order: the randomly picked chunks play in their original order
      const pos = new Map(order.map((c, i) => [c, i]));
      picked.sort((a, b) => pos.get(a) - pos.get(b));
    }
  }
  const steps = picked.map((c) => {
    const lo = Math.floor((c * n) / chunks);
    const hi = Math.floor(((c + 1) * n) / chunks);
    const els = [];
    for (let e = lo; e < hi; e++) els.push(e);
    return els;
  });
  return { steps, total };
}

/** Value added by a distribution for chunk i of count (wave: last = param; step: param per chunk). */
export function distValue(type, param, easeIdx, i, count) {
  if (!param || count <= 1 || i <= 0) return 0;
  const total = type === 2 ? param * (count - 1) : param;
  return total * ease(easeIdx, i / (count - 1));
}

/** Beat gap between successive chunks (wave: the last event of the last chunk ends at w). */
export function beatGap(type, w, lastOffset, count) {
  if (type === 2) return w;
  if (count <= 1) return 0;
  return Math.max(0, w - lastOffset) / (count - 1);
}

// ---------------------------------------------------------------------------
// Keyframes per element

/**
 * Builds the time-sorted keyframes of every element of one kind ('color' | 'rotation' |
 * 'translation' | 'fx'). groupInfo(g) -> { n, axes?: [x, y, z] booleans } or null (group not
 * in the environment). toTime(beat) -> seconds. Returns Map<groupId, tracks>, tracks =
 * channel arrays (colour / fx: [elements]; rotation / translation: [axis][elements]) of keyframe
 * lists { t, trans, ease, …values } with extend resolved and (rotation) the angle unwrapped.
 * chroma: false ignores the Chroma colours on box events.
 */
export function buildKeyframes(groups, kind, groupInfo, toTime, chroma = true) {
  const out = new Map();
  const cache = new Map();
  const axial = kind === 'rotation' || kind === 'translation';
  let seq = 0;
  for (const G of groups) {
    const info = groupInfo(G.g);
    if (!info || !(info.n > 0)) continue;
    const n = info.n;
    let tr = out.get(G.g);
    if (!tr) {
      const mk = () => Array.from({ length: n }, () => []);
      tr = axial ? [info.axes?.[0] ? mk() : null, info.axes?.[1] ? mk() : null, info.axes?.[2] ? mk() : null] : [mk()];
      out.set(G.g, tr);
    }
    // later boxes first: the box listed first wins at equal times (sorted stably below)
    for (let bi = G.boxes.length - 1; bi >= 0; bi--) {
      const B = G.boxes[bi];
      const lists = axial ? tr[B.axis] : tr[0];
      if (!lists) continue;
      const key = `${B.fkey}|${n}`;
      let fs = cache.get(key);
      if (!fs) cache.set(key, (fs = filterSteps(B.filter, n)));
      const L = fs.steps.length;
      if (!L) continue;
      const lim = B.filter.limit > 0 && B.filter.limit < 1;
      const nb = lim && B.filter.limitAffects & 1 ? L : fs.total;
      const nv = lim && B.filter.limitAffects & 2 ? L : fs.total;
      const evs = B.events;
      const gap = beatGap(B.bt, B.bw, evs[evs.length - 1].b, nb);
      for (let i = 0; i < L; i++) {
        const off = gap * i;
        const dv = distValue(B.dt, B.dv, B.de, i, nv);
        const els = fs.steps[i];
        for (let j = 0; j < evs.length; j++) {
          const e = evs[j];
          const d = j > 0 || B.first ? dv : 0;
          const beat = G.beat + e.b + off;
          for (let q = 0; q < els.length; q++) {
            lists[els[q]].push({ beat, seq: seq++, e, d, flip: B.flip });
          }
        }
      }
    }
  }
  // sort, drop the earlier of same-time keyframes, resolve values
  const byTime = (a, b) => a.beat - b.beat || a.seq - b.seq;
  for (const tr of out.values()) {
    for (let a = 0; a < tr.length; a++) {
      const lists = tr[a];
      if (!lists) continue;
      for (let el = 0; el < lists.length; el++) {
        const raw = lists[el];
        if (!raw.length) continue;
        raw.sort(byTime);
        const res = [];
        let prev = null;
        for (let k = 0; k < raw.length; k++) {
          if (k + 1 < raw.length && raw[k + 1].beat === raw[k].beat) continue;
          const r = raw[k];
          const kf = resolve(kind, r, prev, toTime, chroma);
          res.push(kf);
          prev = kf;
        }
        lists[el] = res;
      }
    }
  }
  return out;
}

function resolve(kind, r, prev, toTime, chroma) {
  const e = r.e;
  const t = toTime(r.beat);
  if (kind === 'color') {
    if (e.trans === TR_EXTEND) {
      if (!prev) return { t, trans: TR_INSTANT, ease: 0, c: 0, rgb: null, s: 0, sfreq: 0, sb: 0, sf: false };
      return { ...prev, t, trans: TR_INSTANT, ease: 0 };
    }
    const rgb = chroma ? e.rgb : null;
    let s = Math.max(0, e.s + r.d);
    if (rgb) s *= rgb[3];
    // strobe: e.f flashes per beat -> per second at this point of the song
    const sfreq = e.f > 0 ? 1 / Math.max(1e-4, toTime(r.beat + 1 / e.f) - t) : 0;
    return { t, trans: e.trans, ease: e.ease, c: e.c, rgb, s, sfreq, sb: Math.max(0, e.sb), sf: e.sf };
  }
  const pv = prev ? prev.v : 0;
  if (e.trans === TR_EXTEND) return { t, trans: TR_INSTANT, ease: 0, v: pv };
  if (kind === 'rotation') {
    let target = e.v + r.d;
    let dir = e.dir;
    if (r.flip) {
      target = -target;
      dir = dir === 1 ? 2 : dir === 2 ? 1 : 0;
    }
    // angle reached from the previous one: shortest way (auto), clockwise (+) or counter-clockwise (-)
    const m = (((target - pv) % 360) + 360) % 360; // 0 … 360
    let delta;
    if (dir === 1) delta = m;
    else if (dir === 2) delta = m === 0 ? 0 : m - 360;
    else delta = m > 180 ? m - 360 : m;
    const sign = dir === 2 || (dir === 0 && delta < 0) ? -1 : 1;
    return { t, trans: e.trans, ease: e.ease, v: pv + delta + sign * 360 * e.loops };
  }
  const v = (e.v + r.d) * (r.flip ? -1 : 1);
  return { t, trans: e.trans, ease: e.ease, v };
}
