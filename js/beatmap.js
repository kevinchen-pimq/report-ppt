// Parses Beat Saber difficulty files (v2, v3, v4) into a normalized,
// seconds-based representation used by the game.
import { parseLightshow3, hasLightshow3, countLightshow3Chroma, easeIndex, GL_EASINGS } from './lightshow3.js';
import { createNoodleParser, halfJumpFor, meLane, meLayer, meDir, meWidth, meHeight, meWallType } from './noodle.js';

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
  // Mapping Extensions: rotated clockwise from down (1090 = a left slice)
  if (d >= 1000 && d <= 1360) return { d: 1, a: 1000 - d, precise: true };
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

/**
 * opts.noodle: apply Noodle Extensions / Mapping Extensions to difficulties that list them
 * (the `noodle` setting); off = the plain map.
 */
export function parseDifficulty(json, { info, diff, audioData, lightshow, noodle = false }) {
  const version = detectVersion(json);
  const bpm = info.bpm;
  const raw = { notes: [], bombs: [], walls: [], chains: [], arcs: [], events: [], bpmChanges: [], njs: [] };
  // modcharts: Noodle Extensions (v2 / v3) and Mapping Extensions precision placement
  const useNE = !!(noodle && diff.noodle && (version === 2 || version === 3));
  const useME = !!(noodle && diff.me && (version === 2 || version === 3));
  let toTime = null;
  const np = useNE ? createNoodleParser(json, version, (b) => toTime(b)) : null;

  if (useNE || useME) {
    parseModded(json, version, raw, np, useME);
  } else if (version === 2) {
    for (const n of json._notes || []) {
      const x = v2Pos(n._lineIndex ?? 0);
      const y = v2Pos(n._lineLayer ?? 0);
      if (n._type === 3) raw.bombs.push({ beat: n._time, x, y, ch: objColor(n._customData) });
      else if (n._type === 0 || n._type === 1) {
        const { d, a, precise } = v2Dir(n._cutDirection ?? 8);
        raw.notes.push({ beat: n._time, x, y, c: n._type, d, a, precise, ch: objColor(n._customData) });
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
      raw.walls.push({ beat: o._time, x: v2Pos(o._lineIndex ?? 0), y, d: o._duration, w: v2Pos(o._width ?? 1), h, ch: objColor(o._customData) });
    }
    for (const e of json._events || []) {
      if (e._type === 100) raw.bpmChanges.push({ beat: e._time, bpm: e._floatValue });
      else raw.events.push({ beat: e._time, type: e._type, value: e._value, f: e._floatValue ?? 1, cd: e._customData });
    }
    for (const a of json._sliders || []) {
      raw.arcs.push({
        beat: a._headTime, c: a._colorType ?? 0, x: a._headLineIndex ?? 0, y: a._headLineLayer ?? 0, d: a._headCutDirection ?? 8,
        mu: a._headControlPointLengthMultiplier ?? 1, tb: a._tailTime, tx: a._tailLineIndex ?? 0, ty: a._tailLineLayer ?? 0,
        tc: a._tailCutDirection ?? 8, tmu: a._tailControlPointLengthMultiplier ?? 1, m: a._sliderMidAnchorMode ?? 0,
        ch: objColor(a._customData),
      });
    }
    const cd = json._customData || json.customData || {};
    for (const c of cd._BPMChanges || cd._bpmChanges || []) {
      raw.bpmChanges.push({ beat: c._time ?? c.b, bpm: c._BPM ?? c._bpm ?? c.m });
    }
  } else if (version === 3) {
    for (const n of json.colorNotes || []) raw.notes.push({ beat: n.b, x: n.x ?? 0, y: n.y ?? 0, c: n.c ?? 0, d: n.d ?? 8, a: n.a ?? 0, ch: objColor(n.customData) });
    for (const n of json.bombNotes || []) raw.bombs.push({ beat: n.b, x: n.x ?? 0, y: n.y ?? 0, ch: objColor(n.customData) });
    for (const o of json.obstacles || []) raw.walls.push({ beat: o.b, x: o.x ?? 0, y: o.y ?? 0, d: o.d ?? 0, w: o.w ?? 1, h: o.h ?? 5, ch: objColor(o.customData) });
    for (const s of json.burstSliders || []) {
      raw.chains.push({ beat: s.b, x: s.x ?? 0, y: s.y ?? 0, c: s.c ?? 0, d: s.d ?? 0, tb: s.tb, tx: s.tx ?? 0, ty: s.ty ?? 0, sc: s.sc ?? 3, s: s.s ?? 1, ch: objColor(s.customData) });
    }
    for (const a of json.sliders || []) {
      raw.arcs.push({ beat: a.b, c: a.c ?? 0, x: a.x ?? 0, y: a.y ?? 0, d: a.d ?? 8, mu: a.mu ?? 1, tb: a.tb, tx: a.tx ?? 0, ty: a.ty ?? 0, tc: a.tc ?? 8, tmu: a.tmu ?? 1, m: a.m ?? 0, ch: objColor(a.customData) });
    }
    // omitted v3 fields are 0
    for (const e of json.basicBeatmapEvents || []) raw.events.push({ beat: e.b ?? 0, type: e.et ?? 0, value: e.i ?? 0, f: e.f ?? 1, cd: e.customData });
    for (const e of json.colorBoostBeatmapEvents || []) raw.events.push({ beat: e.b ?? 0, type: 5, value: e.o ? 1 : 0, f: 1 });
    for (const e of json.bpmEvents || []) raw.bpmChanges.push({ beat: e.b ?? 0, bpm: e.m });
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
        raw.events.push({ beat: e.b ?? 0, type: 5, value: d.b ? 1 : 0, f: 1 });
      }
      const bed = lightshow.basicEventsData || [];
      for (const e of lightshow.basicEvents || []) {
        const d = bed[e.i ?? 0] || {};
        raw.events.push({ beat: e.b ?? 0, type: d.t ?? 0, value: d.i ?? 0, f: d.f ?? 1 });
      }
    }
  }

  toTime = makeTiming(bpm, raw.bpmChanges, version === 4 ? audioData : null);

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
  // modchart objects: noodle data (nd) and fake flags ride along
  const mod = (o, src) => {
    if (src.nd) o.nd = src.nd;
    if (src.fake) o.fake = true;
    return o;
  };
  for (const n of raw.notes) {
    if (!Number.isFinite(n.beat)) continue;
    notes.push(mod({ id: id++, kind: 'note', time: toTime(n.beat), beat: n.beat, x: n.x, y: n.y, color: n.c === 1 ? 1 : 0, dir: n.d, angle: n.a || 0, chroma: n.ch }, n));
  }
  for (const b of raw.bombs) {
    if (!Number.isFinite(b.beat)) continue;
    notes.push(mod({ id: id++, kind: 'bomb', time: toTime(b.beat), beat: b.beat, x: b.x, y: b.y, color: -1, dir: 8, angle: 0, chroma: b.ch }, b));
  }
  for (const ch of raw.chains) {
    const links = buildChainLinks(ch);
    for (const l of links) {
      notes.push(mod({ id: id++, kind: 'link', time: toTime(l.beat), beat: l.beat, x: l.x, y: l.y, color: ch.c === 1 ? 1 : 0, dir: 8, angle: l.angle, linkAngle: l.angle, chroma: ch.ch }, ch));
    }
  }
  notes.sort((a, b) => a.time - b.time || a.id - b.id);

  const walls = raw.walls
    .filter((w) => Number.isFinite(w.beat) && w.w !== 0 && w.h !== 0)
    .map((w) => mod({ time: toTime(w.beat), endTime: toTime(w.beat + Math.max(0, w.d)), x: w.x, y: w.y, w: w.w, h: w.h, chroma: w.ch }, w))
    .sort((a, b) => a.time - b.time);

  let chromaEvents = 0;
  const events = raw.events
    .filter((e) => Number.isFinite(e.beat))
    .map((e) => {
      const out = { time: toTime(e.beat), type: e.type, value: e.value, f: e.f };
      const ch = e.cd ? parseChromaEvent(e.cd, e.type, e.beat, toTime) : null;
      if (ch) {
        out.ch = ch;
        chromaEvents++;
      }
      return out;
    })
    .sort((a, b) => a.time - b.time);
  chromaEvents += applyLegacyChroma(events);

  // v3 / v4 group lighting (event box groups), played by js/game/GroupLighting.js: parsed on
  // first use (map.lightshow), so showing a song's details stays quick
  const lsSource = version === 3 ? json : version === 4 ? lightshow : null;
  const lsVersion = version === 3 ? 3 : 4;
  const hasBoxes = hasLightshow3(lsSource, lsVersion);
  if (hasBoxes) chromaEvents += countLightshow3Chroma(lsSource, lsVersion);
  let lightshow3;
  const getLightshow = () => {
    if (lightshow3 === undefined) {
      lightshow3 = null;
      try {
        lightshow3 = hasBoxes ? parseLightshow3(lsSource, lsVersion) : null;
      } catch (e) {
        console.warn('燈光群組資料無法讀取', e);
      }
      if (lightshow3) lightshow3.toTime = toTime;
    }
    return lightshow3;
  };

  const arcs = raw.arcs
    .filter((a) => Number.isFinite(a.beat) && Number.isFinite(a.tb) && a.tb > a.beat)
    .map((a) => buildArc(a, toTime))
    .sort((a, b) => a.time - b.time);

  const njsAt = makeNjsCurve(njs, raw.njs, toTime);

  const colorNotes = notes.filter((n) => n.kind === 'note' && !n.fake).length;
  const links = notes.filter((n) => n.kind === 'link' && !n.fake).length;
  let lastTime = 0;
  for (const n of notes) lastTime = Math.max(lastTime, n.time);
  for (const w of walls) lastTime = Math.max(lastTime, w.endTime);

  let chromaObjects = 0;
  for (const n of notes) if (n.chroma != null) chromaObjects++;
  for (const w of walls) if (w.chroma != null) chromaObjects++;
  for (const a of arcs) if (a.chroma != null) chromaObjects++;

  const result = {
    version, njs, halfJump, notes, walls, arcs, events, colorNotes, links, lastTime,
    njsEvents: raw.njs.length, njsAt, maxScore: computeMaxScore(notes),
    // Chroma data found in this difficulty (used only when the chroma setting is on)
    chroma: { events: chromaEvents, objects: chromaObjects, used: chromaEvents + chromaObjects > 0 },
    hasLightshow: hasBoxes, // v3 event box groups present
  };
  if (useNE || useME) {
    // modchart runtime data (js/game/Noodle.js): per-object jump values, tracks, custom events
    result.noodle = {
      ne: useNE,
      me: useME,
      fakes: notes.reduce((k, n) => k + (n.fake ? 1 : 0), 0) + walls.reduce((k, w) => k + (w.fake ? 1 : 0), 0),
      ...(np ? np.finish() : { v2: version === 2, tracks: [], parents: [], players: [], eventCount: 0 }),
    };
    prepareModded(notes, walls, njs, diff.offset || 0, bpm);
  }
  // map.lightshow: the parsed event box groups (js/lightshow3.js) or null
  Object.defineProperty(result, 'lightshow', { get: getLightshow, enumerable: true });
  return result;
}

// ---------------------------------------------------------------------------
// Modcharts (Noodle Extensions / Mapping Extensions): raw objects with their noodle data

function parseModded(json, version, raw, np, me) {
  const v2 = version === 2;
  const lane = me ? meLane : v2 ? v2Pos : (v) => v;
  const layer = me ? meLayer : v2 ? v2Pos : (v) => v;
  const dirOf = (d, a = 0) => {
    if (me) {
      const r = meDir(d);
      return { d: r.d, a: r.a + a };
    }
    if (v2) return v2Dir(d);
    return { d, a };
  };
  const data = (cd, kind) => (np ? np.objData(cd, kind) : null);
  const has = (v) => v !== null && v !== undefined;
  // coordinates [x, y] replace the grid position (x 0 = the lane left of the centre)
  const place = (o, nd) => {
    const c = nd?.coords;
    if (c) {
      if (has(c[0])) o.x = c[0] + 2;
      if (has(c[1])) o.y = c[1];
    }
    const tc = nd?.tailCoords;
    if (tc) {
      if (has(tc[0])) o.tx = tc[0] + 2;
      if (has(tc[1])) o.ty = tc[1];
    }
    return o;
  };
  const note = (beat, x, y, c, d, a, cd, fake) => {
    const nd = data(cd, c === 3 ? 'bomb' : 'note');
    const o = { beat, x: lane(x ?? 0), y: layer(y ?? 0), ch: objColor(cd), nd, fake: !!(fake || nd?.fake) };
    place(o, nd);
    if (c === 3) {
      raw.bombs.push(o);
      return;
    }
    let dir = dirOf(d ?? 8, a ?? 0);
    if (nd && nd.cutAngle !== null) {
      // v2 Noodle `_cutDirection`: an angle (0 = down); dot notes stay dots
      dir = { d: dir.d === 8 ? 8 : 1, a: nd.cutAngle };
    }
    o.c = c;
    o.d = dir.d;
    o.a = dir.a;
    raw.notes.push(o);
  };
  const wall = (beat, x, y, d, w, h, cd, fake) => {
    const nd = data(cd, 'wall');
    const o = { beat, x, y, d, w, h, ch: objColor(cd), nd, fake: !!(fake || nd?.fake) };
    place(o, nd);
    if (nd?.size) {
      if (has(nd.size[0])) o.w = nd.size[0];
      if (has(nd.size[1])) o.h = nd.size[1];
    }
    raw.walls.push(o);
  };
  const chain = (s, fake) => {
    const nd = data(s.customData, 'chain');
    const o = {
      beat: s.b, x: lane(s.x ?? 0), y: layer(s.y ?? 0), c: s.c ?? 0, d: dirOf(s.d ?? 0).d, tb: s.tb, tx: lane(s.tx ?? 0), ty: layer(s.ty ?? 0),
      sc: s.sc ?? 3, s: s.s ?? 1, ch: objColor(s.customData), nd, fake: !!(fake || nd?.fake),
    };
    raw.chains.push(place(o, nd));
  };
  const arc = (a, cd) => {
    const nd = data(cd, 'arc');
    const o = { ...a, x: lane(a.x), y: layer(a.y), tx: lane(a.tx), ty: layer(a.ty), d: dirOf(a.d).d, tc: dirOf(a.tc).d, ch: objColor(cd) };
    raw.arcs.push(place(o, nd));
  };

  if (v2) {
    for (const n of json._notes || []) {
      if (n._type === 0 || n._type === 1 || n._type === 3) note(n._time, n._lineIndex, n._lineLayer, n._type, n._cutDirection, 0, n._customData, false);
    }
    for (const o of json._obstacles || []) {
      let y = 0;
      let h = 5;
      if (o._type === 1) {
        y = 2;
        h = 3;
      } else if (o._type === 2) {
        y = layer(o._lineLayer ?? 0);
        h = me ? meHeight(o._height ?? 5) : o._height ?? 5;
      } else if (o._type >= 1000) {
        const t = meWallType(o._type);
        if (t) {
          y = t.y;
          h = t.h;
        }
      }
      wall(o._time, lane(o._lineIndex ?? 0), y, o._duration, me ? meWidth(o._width ?? 1) : v2Pos(o._width ?? 1), h, o._customData, false);
    }
    for (const e of json._events || []) {
      if (e._type === 100) raw.bpmChanges.push({ beat: e._time, bpm: e._floatValue });
      else raw.events.push({ beat: e._time, type: e._type, value: e._value, f: e._floatValue ?? 1, cd: e._customData });
    }
    for (const a of json._sliders || []) {
      arc({
        beat: a._headTime, c: a._colorType ?? 0, x: a._headLineIndex ?? 0, y: a._headLineLayer ?? 0, d: a._headCutDirection ?? 8,
        mu: a._headControlPointLengthMultiplier ?? 1, tb: a._tailTime, tx: a._tailLineIndex ?? 0, ty: a._tailLineLayer ?? 0,
        tc: a._tailCutDirection ?? 8, tmu: a._tailControlPointLengthMultiplier ?? 1, m: a._sliderMidAnchorMode ?? 0,
      }, a._customData);
    }
    const cd = json._customData || json.customData || {};
    for (const c of cd._BPMChanges || cd._bpmChanges || []) {
      raw.bpmChanges.push({ beat: c._time ?? c.b, bpm: c._BPM ?? c._bpm ?? c.m });
    }
    return;
  }
  // v3: fake objects live in customData's fake* arrays (Noodle only)
  const cd = json.customData || {};
  const list = (k) => (Array.isArray(json[k]) ? json[k] : []);
  const fakes = (k) => (np && Array.isArray(cd[k]) ? cd[k] : []);
  for (const [arr, fake] of [[list('colorNotes'), false], [fakes('fakeColorNotes'), true]]) {
    for (const n of arr) note(n.b, n.x, n.y, n.c === 1 ? 1 : 0, n.d ?? 8, n.a ?? 0, n.customData, fake);
  }
  for (const [arr, fake] of [[list('bombNotes'), false], [fakes('fakeBombNotes'), true]]) {
    for (const n of arr) note(n.b, n.x, n.y, 3, 8, 0, n.customData, fake);
  }
  for (const [arr, fake] of [[list('obstacles'), false], [fakes('fakeObstacles'), true]]) {
    for (const o of arr) {
      wall(o.b, lane(o.x ?? 0), layer(o.y ?? 0), o.d ?? 0, me ? meWidth(o.w ?? 1) : o.w ?? 1, me ? meHeight(o.h ?? 5) : o.h ?? 5, o.customData, fake);
    }
  }
  for (const [arr, fake] of [[list('burstSliders'), false], [fakes('fakeBurstSliders'), true]]) {
    for (const s of arr) chain(s, fake);
  }
  for (const a of list('sliders')) {
    arc({ beat: a.b, c: a.c ?? 0, x: a.x ?? 0, y: a.y ?? 0, d: a.d ?? 8, mu: a.mu ?? 1, tb: a.tb, tx: a.tx ?? 0, ty: a.ty ?? 0, tc: a.tc ?? 8, tmu: a.tmu ?? 1, m: a.m ?? 0 }, a.customData);
  }
  for (const e of list('basicBeatmapEvents')) raw.events.push({ beat: e.b ?? 0, type: e.et ?? 0, value: e.i ?? 0, f: e.f ?? 1, cd: e.customData });
  for (const e of list('colorBoostBeatmapEvents')) raw.events.push({ beat: e.b ?? 0, type: 5, value: e.o ? 1 : 0, f: 1 });
  for (const e of list('bpmEvents')) raw.bpmChanges.push({ beat: e.b ?? 0, bpm: e.m });
}

/**
 * Per-object jump values for the modchart runtime (nd.njsV / nd.hj: the object's NJS and
 * half jump duration in seconds) and each note's start layer (`sl`: its index from the bottom
 * among the notes in its column at the same beat, where its jump starts; Heck's
 * startNoteLineLayer).
 */
function prepareModded(notes, walls, njs, offset, bpm) {
  const base = halfJumpFor(njs, offset, bpm);
  const jump = (o) => {
    const nd = o.nd;
    if (!nd) return;
    nd.njsV = nd.njs ?? njs;
    nd.hj = nd.njs == null && nd.offset == null ? base : halfJumpFor(nd.njsV, nd.offset ?? offset, bpm);
  };
  let i = 0;
  while (i < notes.length) {
    let k = i;
    while (k < notes.length && notes[k].beat === notes[i].beat) k++;
    const cols = new Map();
    for (let j = i; j < k; j++) {
      const n = notes[j];
      jump(n);
      if (!cols.has(n.x)) cols.set(n.x, []);
      cols.get(n.x).push(n);
    }
    for (const col of cols.values()) {
      col.sort((a, b) => a.y - b.y);
      col.forEach((n, idx) => {
        n.sl = idx;
      });
    }
    i = k;
  }
  for (const w of walls) jump(w);
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
    if (n.kind === 'bomb' || n.fake) continue; // fake notes (modcharts) are never scored
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
  return { time: samples[0].time, endTime: samples[samples.length - 1].time, color: a.c === 1 ? 1 : 0, samples, chroma: a.ch };
}

// ---------------------------------------------------------------------------
// NJS events (v4): NJS = base + delta, eased from the previous event

// Standard curves, used by the Chroma easing names below (NJS events use lightshow3's
// EaseType-ordered table instead).
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

/** NJS event easing by Beat Saber's EaseType index (-1 none, 0 linear, 1 InQuad, 4 InSine … 30, 100–102). */
export function ease(type, t) {
  if (type === -1) return t >= 1 ? 1 : 0; // "none": jump at the event
  return GL_EASINGS[easeIndex(type)](Math.max(0, Math.min(1, t)));
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

// ---------------------------------------------------------------------------
// Chroma (lighting / colour mod): v2 keys have a leading underscore (`_color`),
// v3 keys don't (`color`). Unknown keys are ignored.

const BACK_C1 = 1.70158;
const BACK_C2 = BACK_C1 * 1.525;
const BACK_C3 = BACK_C1 + 1;
const ELASTIC_C4 = (2 * Math.PI) / 3;
const ELASTIC_C5 = (2 * Math.PI) / 4.5;
function bounceOut(t) {
  const n = 7.5625;
  const d = 2.75;
  if (t < 1 / d) return n * t * t;
  if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75;
  if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375;
  return n * (t -= 2.625 / d) * t + 0.984375;
}

/** Chroma / Heck easings (easings.net names plus easeLinear and easeStep), t in 0..1. */
export const CHROMA_EASINGS = {
  easeLinear: (t) => t,
  easeStep: (t) => (t >= 1 ? 1 : 0),
  easeInQuad: EASINGS[4],
  easeOutQuad: EASINGS[5],
  easeInOutQuad: EASINGS[6],
  easeInCubic: EASINGS[7],
  easeOutCubic: EASINGS[8],
  easeInOutCubic: EASINGS[9],
  easeInQuart: EASINGS[10],
  easeOutQuart: EASINGS[11],
  easeInOutQuart: EASINGS[12],
  easeInQuint: EASINGS[13],
  easeOutQuint: EASINGS[14],
  easeInOutQuint: EASINGS[15],
  easeInSine: EASINGS[1],
  easeOutSine: EASINGS[2],
  easeInOutSine: EASINGS[3],
  easeInCirc: EASINGS[19],
  easeOutCirc: EASINGS[20],
  easeInOutCirc: EASINGS[21],
  easeInExpo: EASINGS[16],
  easeOutExpo: EASINGS[17],
  easeInOutExpo: EASINGS[18],
  easeInElastic: (t) => (t === 0 ? 0 : t === 1 ? 1 : -(2 ** (10 * t - 10)) * Math.sin((t * 10 - 10.75) * ELASTIC_C4)),
  easeOutElastic: (t) => (t === 0 ? 0 : t === 1 ? 1 : 2 ** (-10 * t) * Math.sin((t * 10 - 0.75) * ELASTIC_C4) + 1),
  easeInOutElastic: (t) => (t === 0 ? 0 : t === 1 ? 1 : t < 0.5
    ? -(2 ** (20 * t - 10) * Math.sin((20 * t - 11.125) * ELASTIC_C5)) / 2
    : (2 ** (-20 * t + 10) * Math.sin((20 * t - 11.125) * ELASTIC_C5)) / 2 + 1),
  easeInBack: (t) => BACK_C3 * t * t * t - BACK_C1 * t * t,
  easeOutBack: (t) => 1 + BACK_C3 * (t - 1) ** 3 + BACK_C1 * (t - 1) ** 2,
  easeInOutBack: (t) => (t < 0.5
    ? ((2 * t) ** 2 * ((BACK_C2 + 1) * 2 * t - BACK_C2)) / 2
    : ((2 * t - 2) ** 2 * ((BACK_C2 + 1) * (t * 2 - 2) + BACK_C2) + 2) / 2),
  easeInBounce: (t) => 1 - bounceOut(1 - t),
  easeOutBounce: bounceOut,
  easeInOutBounce: (t) => (t < 0.5 ? (1 - bounceOut(1 - 2 * t)) / 2 : (1 + bounceOut(2 * t - 1)) / 2),
};

function chromaEasing(name) {
  return (typeof name === 'string' && CHROMA_EASINGS[name]) || null;
}

/** [r, g, b, a?] (0..1, may be HDR) -> [r, g, b, brightness] with the hue kept and channels in 0..1. */
function lightColor(c) {
  if (!Array.isArray(c) || c.length < 3) return null;
  let r = Math.max(0, Number(c[0]) || 0);
  let g = Math.max(0, Number(c[1]) || 0);
  let b = Math.max(0, Number(c[2]) || 0);
  let k = c.length > 3 && Number.isFinite(Number(c[3])) ? Math.max(0, Number(c[3])) : 1;
  const max = Math.max(r, g, b);
  if (max > 1) {
    // HDR colour: keep the hue, turn the extra into (limited) brightness
    r /= max;
    g /= max;
    b /= max;
    k *= Math.min(max, 1.5);
  }
  return [r, g, b, Math.min(k, 1.5)];
}

/** Note / bomb / wall / arc colour from its customData -> 0xRRGGBB (hue kept for HDR values), or null. */
function objColor(cd) {
  if (!cd || typeof cd !== 'object') return null;
  const c = lightColor(cd._color ?? cd.color);
  if (!c) return null;
  return (Math.round(c[0] * 255) << 16) | (Math.round(c[1] * 255) << 8) | Math.round(c[2] * 255);
}

// Chroma 1 "RGB events": a light event whose value is 2000000000 + 0xRRGGBB sets the colour of
// the later events of that type (it doesn't switch lights itself). Returns how many were found.
export const LEGACY_RGB = 2000000000;
function applyLegacyChroma(events) {
  const colors = new Map();
  let found = 0;
  for (const e of events) {
    if (e.value >= LEGACY_RGB) {
      const v = e.value - LEGACY_RGB;
      colors.set(e.type, [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255, 1]);
      found++;
      continue;
    }
    const c = colors.get(e.type);
    if (!c || e.value === 0) continue;
    if (!e.ch) e.ch = { color: c };
    else if (!e.ch.color) e.ch.color = c;
  }
  return found;
}

const num = (v) => (Number.isFinite(Number(v)) && v !== null && v !== '' && typeof v !== 'boolean' ? Number(v) : null);

/** Normalised Chroma data of a basic event, or null when it has none we use. */
function parseChromaEvent(cd, type, beat, toTime) {
  if (!cd || typeof cd !== 'object') return null;
  const pick = (v2, v3) => (cd[v2] !== undefined ? cd[v2] : cd[v3]);
  const ch = {};
  let any = false;
  if (type <= 4 || (type >= 6 && type <= 7) || (type >= 10 && type <= 11)) {
    // light events
    let ids = pick('_lightID', 'lightID');
    if (typeof ids === 'number') ids = [ids];
    if (Array.isArray(ids)) {
      ids = ids.map(Number).filter((n) => Number.isInteger(n) && n >= 0);
      if (ids.length) {
        ch.ids = ids;
        any = true;
      }
    }
    const color = lightColor(pick('_color', 'color'));
    if (color) {
      ch.color = color;
      any = true;
    }
    const g = cd._lightGradient;
    if (g && typeof g === 'object') {
      const durBeats = Math.max(0, num(g._duration) ?? 0);
      ch.grad = {
        dur: Math.max(0, toTime(beat + durBeats) - toTime(beat)),
        start: lightColor(g._startColor) || [1, 1, 1, 1],
        end: lightColor(g._endColor) || [1, 1, 1, 1],
        ease: chromaEasing(g._easing) || CHROMA_EASINGS.easeLinear,
      };
      any = true;
    }
    const ease = chromaEasing(pick('_easing', 'easing'));
    if (ease) {
      ch.ease = ease;
      any = true;
    }
    const lerp = pick('_lerpType', 'lerpType');
    if (typeof lerp === 'string' && lerp.toUpperCase() === 'HSV') {
      ch.hsv = true;
      any = true;
    }
  } else if (type === 8) {
    // ring rotation
    for (const [k2, k3, key] of [['_rotation', 'rotation', 'rotation'], ['_step', 'step', 'step'], ['_prop', 'prop', 'prop'], ['_speed', 'speed', 'speed']]) {
      const v = num(pick(k2, k3));
      if (v !== null) {
        ch[key] = v;
        any = true;
      }
    }
    const dir = num(pick('_direction', 'direction'));
    if (dir !== null) {
      ch.dir = dir;
      any = true;
    }
    for (const [k, key] of [['_stepMult', 'stepMult'], ['_propMult', 'propMult'], ['_speedMult', 'speedMult']]) {
      const v = num(cd[k]);
      if (v !== null) {
        ch[key] = v;
        any = true;
      }
    }
    const filter = pick('_nameFilter', 'nameFilter');
    if (typeof filter === 'string') {
      ch.nameFilter = filter;
      any = true;
    }
    if (cd._counterSpin === true) {
      ch.counterSpin = true;
      any = true;
    }
    if (cd._reset === true) {
      ch.reset = true;
      any = true;
    }
  } else if (type === 9) {
    // ring zoom
    const step = num(pick('_step', 'step'));
    const speed = num(pick('_speed', 'speed'));
    if (step !== null) ch.step = step;
    if (speed !== null) ch.speed = speed;
    any = step !== null || speed !== null;
  } else if (type === 12 || type === 13) {
    // laser speed
    const lock = pick('_lockPosition', 'lockRotation') ?? cd.lockPosition;
    if (lock === true) {
      ch.lock = true;
      any = true;
    }
    const speed = num(cd._preciseSpeed ?? pick('_speed', 'speed'));
    if (speed !== null) {
      ch.speed = speed;
      any = true;
    }
    const dir = num(pick('_direction', 'direction'));
    if (dir !== null) {
      ch.dir = dir;
      any = true;
    }
  }
  return any ? ch : null;
}
