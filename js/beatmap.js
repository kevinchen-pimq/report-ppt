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
  const raw = { notes: [], bombs: [], walls: [], chains: [], events: [], bpmChanges: [] };

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
    for (const e of json.basicBeatmapEvents || []) raw.events.push({ beat: e.b, type: e.et, value: e.i, f: e.f ?? 1 });
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
    if (lightshow) {
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

  const colorNotes = notes.filter((n) => n.kind === 'note').length;
  const links = notes.filter((n) => n.kind === 'link').length;
  const lastTime = Math.max(0, ...notes.map((n) => n.time), ...walls.map((w) => w.endTime));

  return { version, njs, halfJump, notes, walls, events, colorNotes, links, lastTime, maxScore: computeMaxScore(notes) };
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
