// Parses Beat Saber difficulty files (v2, v3, v4) into a normalized,
// seconds-based representation used by the game.

const DEFAULT_NJS = { Easy: 10, Normal: 10, Hard: 10, Expert: 12, ExpertPlus: 16 };

// Cut direction -> unit vector (x, y) in the note plane
const DIR_VEC = [
  [0, 1], [0, -1], [-1, 0], [1, 0],
  [-1, 1], [1, 1], [-1, -1], [1, -1],
];

/**
 * Builds a beat -> seconds converter.
 * - bpmChanges: [{ beat, bpm }] where beats after a change are counted at the new bpm (v2/v3)
 * - audioData: v4 AudioData.dat json (bpmData regions in samples)
 */
export function makeTiming(baseBpm, bpmChanges, audioData) {
  if (audioData && Array.isArray(audioData.bpmData) && audioData.bpmData.length && audioData.songFrequency) {
    const freq = audioData.songFrequency;
    const regions = [...audioData.bpmData].sort((a, b) => a.sb - b.sb);
    return (beat) => {
      let r = regions[0];
      for (const reg of regions) {
        if (beat >= reg.sb) r = reg;
        else break;
      }
      const span = r.eb - r.sb;
      if (span <= 0) return r.si / freq;
      return (r.si + ((beat - r.sb) * (r.ei - r.si)) / span) / freq;
    };
  }
  const changes = (bpmChanges || [])
    .filter((c) => c && c.bpm > 0 && Number.isFinite(c.beat))
    .sort((a, b) => a.beat - b.beat);
  if (!changes.length) {
    const spb = 60 / baseBpm;
    return (beat) => beat * spb;
  }
  // Precompute segment start times
  const segs = [];
  let lastBeat = 0;
  let lastBpm = baseBpm;
  let lastTime = 0;
  for (const c of changes) {
    if (c.beat <= 0) {
      lastBpm = c.bpm;
      continue;
    }
    lastTime += ((c.beat - lastBeat) * 60) / lastBpm;
    segs.push({ beat: c.beat, time: lastTime, bpm: c.bpm });
    lastBeat = c.beat;
    lastBpm = c.bpm;
  }
  const firstBpm = changes[0].beat <= 0 ? changes.filter((c) => c.beat <= 0).pop().bpm : baseBpm;
  return (beat) => {
    let seg = { beat: 0, time: 0, bpm: firstBpm };
    for (const s of segs) {
      if (beat >= s.beat) seg = s;
      else break;
    }
    return seg.time + ((beat - seg.beat) * 60) / seg.bpm;
  };
}

// Mapping-extensions style precision placement for v2 maps
function v2Pos(v) {
  if (v >= 1000) return v / 1000 - 1;
  if (v <= -1000) return v / 1000 + 1;
  return v;
}

function v2Dir(d) {
  if (d >= 1000 && d <= 1360) return { d: 1, a: d - 1000, precise: true };
  return { d, a: 0, precise: false };
}

function detectVersion(json) {
  const v = String(json.version || json._version || '');
  if (v.startsWith('4')) return 4;
  if (v.startsWith('3')) return 3;
  if (v.startsWith('2')) return 2;
  if (json.colorNotes) return json.colorNotesData ? 4 : 3;
  return 2;
}

export function parseDifficulty(json, { info, diff, audioData, lightshow }) {
  const version = detectVersion(json);
  const bpm = info.bpm;
  const raw = { notes: [], bombs: [], walls: [], chains: [], arcs: [], events: [], bpmChanges: [], njs: [] };

  if (version === 2) {
    for (const n of json._notes || []) {
      const x = v2Pos(n._lineIndex ?? 0);
      const y = v2Pos(n._lineLayer ?? 0);
      if (n._type === 3) raw.bombs.push({ beat: n._time, x, y });
      else if (n._type === 0 || n._type === 1) {
        const { d, a, precise } = v2Dir(n._cutDirection ?? 8);
        raw.notes.push({ beat: n._time, x, y, c: n._type, d, a, precise });
      }
    }
    for (const o of json._obstacles || []) {
      let y = 0;
      let h = 5;
      if (o._type === 1) {
        y = 2;
        h = 3;
      } else if (o._type === 2) {
        y = o._lineLayer ?? 0;
        h = o._height ?? 5;
      } else if (o._type >= 1000) {
        // Mapping-extensions height encoding (approximation)
        const v = o._type >= 4001 ? o._type - 4001 : o._type - 1000;
        h = (o._type >= 4001 ? Math.floor(v / 1000) : v) / 1000 * 5;
        y = o._type >= 4001 ? ((v % 1000) / 750) * 5 : 0;
      }
      raw.walls.push({ beat: o._time, x: v2Pos(o._lineIndex ?? 0), y, d: o._duration, w: v2Pos(o._width ?? 1), h });
    }
    for (const e of json._events || []) {
      if (e._type === 100) raw.bpmChanges.push({ beat: e._time, bpm: e._floatValue });
      else raw.events.push({ beat: e._time, type: e._type, value: e._value, f: e._floatValue ?? 1 });
    }
    for (const a of json._sliders || []) {
      raw.arcs.push({
        beat: a._headTime, c: a._colorType ?? 0, x: a._headLineIndex ?? 0, y: a._headLineLayer ?? 0, d: a._headCutDirection ?? 8,
        mu: a._headControlPointLengthMultiplier ?? 1, tb: a._tailTime, tx: a._tailLineIndex ?? 0, ty: a._tailLineLayer ?? 0,
        tc: a._tailCutDirection ?? 8, tmu: a._tailControlPointLengthMultiplier ?? 1, m: a._sliderMidAnchorMode ?? 0,
      });
    }
    const cd = json._customData || json.customData || {};
    for (const c of cd._BPMChanges || cd._bpmChanges || []) {
      raw.bpmChanges.push({ beat: c._time ?? c.b, bpm: c._BPM ?? c._bpm ?? c.m });
    }
  } else if (version === 3) {
    for (const n of json.colorNotes || []) raw.notes.push({ beat: n.b, x: n.x ?? 0, y: n.y ?? 0, c: n.c ?? 0, d: n.d ?? 8, a: n.a ?? 0 });
    for (const n of json.bombNotes || []) raw.bombs.push({ beat: n.b, x: n.x ?? 0, y: n.y ?? 0 });
    for (const o of json.obstacles || []) raw.walls.push({ beat: o.b, x: o.x ?? 0, y: o.y ?? 0, d: o.d ?? 0, w: o.w ?? 1, h: o.h ?? 5 });
    for (const s of json.burstSliders || []) {
      raw.chains.push({ beat: s.b, x: s.x ?? 0, y: s.y ?? 0, c: s.c ?? 0, d: s.d ?? 0, tb: s.tb, tx: s.tx ?? 0, ty: s.ty ?? 0, sc: s.sc ?? 3, s: s.s ?? 1 });
    }
    for (const a of json.sliders || []) {
      raw.arcs.push({ beat: a.b, c: a.c ?? 0, x: a.x ?? 0, y: a.y ?? 0, d: a.d ?? 8, mu: a.mu ?? 1, tb: a.tb, tx: a.tx ?? 0, ty: a.ty ?? 0, tc: a.tc ?? 8, tmu: a.tmu ?? 1, m: a.m ?? 0 });
    }
    for (const e of json.basicBeatmapEvents || []) raw.events.push({ beat: e.b, type: e.et, value: e.i, f: e.f ?? 1 });
    for (const e of json.colorBoostBeatmapEvents || []) raw.events.push({ beat: e.b, type: 5, value: e.o ? 1 : 0, f: 1 });
    for (const e of json.bpmEvents || []) raw.bpmChanges.push({ beat: e.b, bpm: e.m });
  } else {
    const cnd = json.colorNotesData || [];
    for (const n of json.colorNotes || []) {
      const d = cnd[n.i ?? 0] || {};
      raw.notes.push({ beat: n.b, x: d.x ?? 0, y: d.y ?? 0, c: d.c ?? 0, d: d.d ?? 8, a: d.a ?? 0 });
    }
    const bnd = json.bombNotesData || [];
    for (const n of json.bombNotes || []) {
      const d = bnd[n.i ?? 0] || {};
      raw.bombs.push({ beat: n.b, x: d.x ?? 0, y: d.y ?? 0 });
    }
    const od = json.obstaclesData || [];
    for (const o of json.obstacles || []) {
      const d = od[o.i ?? 0] || {};
      raw.walls.push({ beat: o.b, x: d.x ?? 0, y: d.y ?? 0, d: d.d ?? 0, w: d.w ?? 1, h: d.h ?? 5 });
    }
    const chd = json.chainsData || [];
    for (const ch of json.chains || []) {
      const head = cnd[ch.i ?? 0] || {};
      const cd = chd[ch.ci ?? 0] || {};
      raw.chains.push({ beat: ch.hb, x: head.x ?? 0, y: head.y ?? 0, c: head.c ?? 0, d: head.d ?? 0, tb: ch.tb, tx: cd.tx ?? 0, ty: cd.ty ?? 0, sc: cd.c ?? 3, s: cd.s ?? 1 });
    }
    const ad = json.arcsData || [];
    for (const a of json.arcs || []) {
      const head = cnd[a.hi ?? 0] || {};
      const tail = cnd[a.ti ?? 0] || {};
      const d = ad[a.ai ?? 0] || {};
      raw.arcs.push({
        beat: a.hb, c: head.c ?? 0, x: head.x ?? 0, y: head.y ?? 0, d: head.d ?? 8, mu: d.m ?? 1,
        tb: a.tb, tx: tail.x ?? 0, ty: tail.y ?? 0, tc: tail.d ?? 8, tmu: d.tm ?? 1, m: d.a ?? 0,
      });
    }
    const nd = json.njsEventData || [];
    for (const e of json.njsEvents || []) {
      const d = nd[e.i ?? 0] || {};
      raw.njs.push({ beat: e.b, delta: d.d ?? 0, usePrevious: !!d.p, easing: d.e ?? 0 });
    }
    if (lightshow) {
      const cbd = lightshow.colorBoostEventsData || [];
      for (const e of lightshow.colorBoostEvents || []) {
        const d = cbd[e.i ?? 0] || {};
        raw.events.push({ beat: e.b, type: 5, value: d.b ? 1 : 0, f: 1 });
      }
      const bed = lightshow.basicEventsData || [];
      for (const e of lightshow.basicEvents || []) {
        const d = bed[e.i ?? 0] || {};
        raw.events.push({ beat: e.b, type: d.t ?? 0, value: d.i ?? 0, f: d.f ?? 1 });
      }
    }
  }

  const toTime = makeTiming(bpm, raw.bpmChanges, version === 4 ? audioData : null);

  // Note jump parameters (same formula as the game)
  let njs = diff.njs || DEFAULT_NJS[diff.difficulty] || 10;
  if (njs <= 0.01) njs = 10;
  const spb = 60 / bpm;
  let hjd = 4;
  while (njs * spb * hjd > 17.999) hjd /= 2;
  hjd += diff.offset || 0;
  if (hjd < 0.25) hjd = 0.25;
  const halfJump = hjd * spb; // seconds

  const notes = [];
  let id = 0;
  for (const n of raw.notes) {
    if (!Number.isFinite(n.beat)) continue;
    notes.push({ id: id++, kind: 'note', time: toTime(n.beat), beat: n.beat, x: n.x, y: n.y, color: n.c === 1 ? 1 : 0, dir: n.d, angle: n.a || 0 });
  }
  for (const b of raw.bombs) {
    if (!Number.isFinite(b.beat)) continue;
    notes.push({ id: id++, kind: 'bomb', time: toTime(b.beat), beat: b.beat, x: b.x, y: b.y, color: -1, dir: 8, angle: 0 });
  }
  for (const ch of raw.chains) {
    const links = buildChainLinks(ch);
    for (const l of links) {
      notes.push({ id: id++, kind: 'link', time: toTime(l.beat), beat: l.beat, x: l.x, y: l.y, color: ch.c === 1 ? 1 : 0, dir: 8, angle: l.angle, linkAngle: l.angle });
    }
  }
  notes.sort((a, b) => a.time - b.time || a.id - b.id);

  const walls = raw.walls
    .filter((w) => Number.isFinite(w.beat) && w.w !== 0 && w.h !== 0)
    .map((w) => ({ time: toTime(w.beat), endTime: toTime(w.beat + Math.max(0, w.d)), x: w.x, y: w.y, w: w.w, h: w.h }))
    .sort((a, b) => a.time - b.time);

  const events = raw.events
    .filter((e) => Number.isFinite(e.beat))
    .map((e) => ({ time: toTime(e.beat), type: e.type, value: e.value, f: e.f }))
    .sort((a, b) => a.time - b.time);

  const arcs = raw.arcs
    .filter((a) => Number.isFinite(a.beat) && Number.isFinite(a.tb) && a.tb > a.beat)
    .map((a) => buildArc(a, toTime))
    .sort((a, b) => a.time - b.time);

  const njsAt = makeNjsCurve(njs, raw.njs, toTime);

  const colorNotes = notes.filter((n) => n.kind === 'note').length;
  const links = notes.filter((n) => n.kind === 'link').length;
  let lastTime = 0;
  for (const n of notes) lastTime = Math.max(lastTime, n.time);
  for (const w of walls) lastTime = Math.max(lastTime, w.endTime);

  return {
    version, njs, halfJump, notes, walls, arcs, events, colorNotes, links, lastTime,
    njsEvents: raw.njs.length, njsAt, maxScore: computeMaxScore(notes),
  };
}

// Expands a chain (burst slider) into link pieces following the game's quadratic curve
function buildChainLinks(ch) {
  const count = Math.max(2, Math.round(ch.sc));
  const vec = DIR_VEC[ch.d] || [0, -1];
  const p0 = { x: ch.x, y: ch.y };
  const p2 = { x: ch.tx, y: ch.ty };
  const dist = Math.hypot(p2.x - p0.x, p2.y - p0.y);
  const len = Math.hypot(vec[0], vec[1]) || 1;
  const p1 = { x: p0.x + (vec[0] / len) * dist * 0.5, y: p0.y + (vec[1] / len) * dist * 0.5 };
  const squish = ch.s > 0 ? ch.s : 1;
  const links = [];
  for (let i = 1; i < count; i++) {
    const t = (i / (count - 1)) * squish;
    const u = 1 - t;
    const x = u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x;
    const y = u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y;
    // tangent
    const tx = 2 * u * (p1.x - p0.x) + 2 * t * (p2.x - p1.x);
    const ty = 2 * u * (p1.y - p0.y) + 2 * t * (p2.y - p1.y);
    // rotation so that local -Y points along the tangent (in lane units, y scaled for spacing)
    const angleDeg = (Math.atan2(tx * 0.6, -ty * 0.5) * 180) / Math.PI;
    links.push({ beat: ch.beat + (ch.tb - ch.beat) * t, x, y, angle: angleDeg });
  }
  return links;
}

// Maximum achievable score with the game's multiplier progression
export function computeMaxScore(notes) {
  let score = 0;
  let mult = 1;
  let progress = 0;
  for (const n of notes) {
    if (n.kind === 'bomb') continue;
    score += (n.kind === 'link' ? 20 : 115) * mult;
    if (mult < 8) {
      progress++;
      if (progress >= mult * 2) {
        mult *= 2;
        progress = 0;
      }
    }
  }
  return score;
}

export { DIR_VEC };

// ---------------------------------------------------------------------------
// Arcs (sliders): cubic bezier from head to tail, sampled with per-sample times

const ARC_SAMPLES = 28;

function dirVec(d) {
  const v = DIR_VEC[d];
  if (!v) return [0, 0];
  const l = Math.hypot(v[0], v[1]);
  return [v[0] / l, v[1] / l];
}

function buildArc(a, toTime) {
  // positions in lane units: x lane (0.6 m), y layer (0.5 m); convert to "metres-ish" for directions
  const hx = a.x * 0.6;
  const hy = a.y * 0.5;
  const tx = a.tx * 0.6;
  const ty = a.ty * 0.5;
  const hd = dirVec(a.d);
  const td = dirVec(a.tc);
  const len = 0.6 + 0.25 * Math.hypot(tx - hx, ty - hy);
  const p1x = hx + hd[0] * a.mu * len;
  const p1y = hy + hd[1] * a.mu * len;
  const p2x = tx - td[0] * a.tmu * len;
  const p2y = ty - td[1] * a.tmu * len;
  const samples = [];
  for (let i = 0; i <= ARC_SAMPLES; i++) {
    const u = i / ARC_SAMPLES;
    const v = 1 - u;
    const b0 = v * v * v;
    const b1 = 3 * v * v * u;
    const b2 = 3 * v * u * u;
    const b3 = u * u * u;
    const mx = b0 * hx + b1 * p1x + b2 * p2x + b3 * tx;
    const my = b0 * hy + b1 * p1y + b2 * p2y + b3 * ty;
    // back to lane / layer units so the game can apply its lane mapping
    samples.push({ x: mx / 0.6, y: my / 0.5, time: toTime(a.beat + (a.tb - a.beat) * u) });
  }
  return { time: samples[0].time, endTime: samples[samples.length - 1].time, color: a.c === 1 ? 1 : 0, samples };
}

// ---------------------------------------------------------------------------
// NJS events (v4): NJS = base + delta, eased from the previous event

const EASINGS = [
  (t) => t, // 0 linear
  (t) => 1 - Math.cos((t * Math.PI) / 2), // InSine
  (t) => Math.sin((t * Math.PI) / 2), // OutSine
  (t) => -(Math.cos(Math.PI * t) - 1) / 2, // InOutSine
  (t) => t * t, // InQuad
  (t) => 1 - (1 - t) * (1 - t), // OutQuad
  (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2), // InOutQuad
  (t) => t ** 3, // InCubic
  (t) => 1 - (1 - t) ** 3, // OutCubic
  (t) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2), // InOutCubic
  (t) => t ** 4, // InQuart
  (t) => 1 - (1 - t) ** 4, // OutQuart
  (t) => (t < 0.5 ? 8 * t ** 4 : 1 - (-2 * t + 2) ** 4 / 2), // InOutQuart
  (t) => t ** 5, // InQuint
  (t) => 1 - (1 - t) ** 5, // OutQuint
  (t) => (t < 0.5 ? 16 * t ** 5 : 1 - (-2 * t + 2) ** 5 / 2), // InOutQuint
  (t) => (t === 0 ? 0 : 2 ** (10 * t - 10)), // InExpo
  (t) => (t === 1 ? 1 : 1 - 2 ** (-10 * t)), // OutExpo
  (t) => (t === 0 ? 0 : t === 1 ? 1 : t < 0.5 ? 2 ** (20 * t - 10) / 2 : (2 - 2 ** (-20 * t + 10)) / 2), // InOutExpo
  (t) => 1 - Math.sqrt(1 - t * t), // InCirc
  (t) => Math.sqrt(1 - (t - 1) ** 2), // OutCirc
  (t) => (t < 0.5 ? (1 - Math.sqrt(1 - (2 * t) ** 2)) / 2 : (Math.sqrt(1 - (-2 * t + 2) ** 2) + 1) / 2), // InOutCirc
];

export function ease(type, t) {
  if (type === -1) return t >= 1 ? 1 : 0; // "none": jump at the event
  const f = EASINGS[type] || EASINGS[0];
  return f(Math.max(0, Math.min(1, t)));
}

/** Returns njsAt(seconds) for a map; constant when there are no NJS events. */
export function makeNjsCurve(base, events, toTime) {
  if (!events.length) return () => base;
  const list = events
    .filter((e) => Number.isFinite(e.beat))
    .sort((a, b) => a.beat - b.beat)
    .map((e) => ({ time: toTime(e.beat), delta: e.delta, usePrevious: e.usePrevious, easing: e.easing }));
  let prev = base;
  for (const e of list) {
    e.value = Math.max(1, e.usePrevious ? prev : base + e.delta);
    prev = e.value;
  }
  return (t) => {
    if (t < list[0].time) {
      const first = list[0];
      // ease from the base speed into the first event
      if (first.easing === -1 || first.time <= 0) return base;
      return base + (first.value - base) * ease(first.easing, t / first.time);
    }
    let k = 0;
    // binary search for the last event at or before t
    let lo = 0;
    let hi = list.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid].time <= t) {
        k = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    const cur = list[k];
    const next = list[k + 1];
    if (!next || next.easing === -1 || next.usePrevious) return cur.value;
    const span = next.time - cur.time;
    if (span <= 0) return next.value;
    return cur.value + (next.value - cur.value) * ease(next.easing, (t - cur.time) / span);
  };
}
