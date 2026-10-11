// Chroma lighting runtime: plays a map's lighting events light by light (Chroma light IDs,
// colours, gradients, easings, transitions) plus ring and laser motion. It knows nothing about
// the geometry: it drives whatever it is given through a minimal interface (the same one as the
// environment modules in js/game/envs/, see CONTRACT.md there):
//
//   groups  { [eventType]: Light[] }   lights in light-ID order; a Light only has set(r, g, b)
//                                      (linear RGB already x brightness, 0,0,0 = off)
//   rings   [{ type: 'small' | 'big', objects: Object3D[], step: degrees between rings,
//              zoom: { near, far } (metres between rings) }]
//   lasers  { left: Object3D[], right: Object3D[] }  spun around userData.axis ('x'|'y'|'z',
//                                      default 'z'), or through userData.setPhase(radians) if set
//   banks   [{ update() }]             flushed once per frame after the lights were set and the
//                                      environment's own update ran (see update())
//   optional:
//   swapColors   [eventType]           groups that show the opposite colour (left <-> right);
//                                      a single light can set light.swapColor = true instead
//   customEvents [eventType] + onEvent(type, value, event, t)
//                                      environment-specific event types: handed to onEvent
//                                      instead of the default handling (rings, lasers …)
//   ring sets may set spinEvent: 9 to spin on event 9 instead of 8 (they then don't zoom)
//
// Light IDs: Chroma ID n addresses groups[type][n - 1]. When the environment is not the one the
// map was made for, `counts` (official light counts per group) maps IDs proportionally instead.
// Without Chroma (reset option chroma: false) the same runtime plays the basic events only.

// Flash / fade shapes (same as the group lighting): brightness multiplier over time
const FLASH_TIME = 0.5;
const FLASH_PEAK = 0.8;
const FADE_TIME = 1.4;
const FADE_PEAK = 1.4;
const MODE_OFF = 0;
const MODE_ON = 1;
const MODE_FLASH = 2;
const MODE_FADE = 3;
const KEY_L = 0;
const KEY_R = 1;
const KEY_W = 2;

const LEGACY_RGB = 2000000000; // Chroma 1 colour events (see beatmap.js)
const RING_TICK = 0.02; // ring rotation propagation runs at a fixed 50 Hz, like the game
const DEG = Math.PI / 180;
const LASER_DEG_PER_SPEED = 20; // degrees per second per unit of laser speed, like the game
const SEEK_STRIDE = 256; // events between seek checkpoints (practice mode)

/** Basic event types that are lights (5 boost, 8 / 9 rings, 12 / 13 laser speed are not). */
export const LIGHT_TYPES = [0, 1, 2, 3, 4, 6, 7, 10, 11];
const isLightType = (t) => t >= 0 && t <= 11 && t !== 5 && t !== 8 && t !== 9;

const _hsvA = [0, 0, 0];
const _hsvB = [0, 0, 0];
const _rgb = [0, 0, 0];

// Deterministic "random" in [0, 1) per event, so Chroma shows replay the same way
function rand(e, salt = 0) {
  const x = Math.sin(e.time * 12.9898 + e.type * 78.233 + salt * 37.719) * 43758.5453;
  return x - Math.floor(x);
}

function rgbToHsv(r, g, b, out) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d > 1e-6) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
    if (h < 0) h += 1;
  }
  out[0] = h;
  out[1] = max > 0 ? d / max : 0;
  out[2] = max;
  return out;
}

function hsvToRgb(h, s, v, out) {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  switch (((i % 6) + 6) % 6) {
    case 0: out[0] = v; out[1] = t; out[2] = p; break;
    case 1: out[0] = q; out[1] = v; out[2] = p; break;
    case 2: out[0] = p; out[1] = v; out[2] = t; break;
    case 3: out[0] = p; out[1] = q; out[2] = v; break;
    case 4: out[0] = t; out[1] = p; out[2] = v; break;
    default: out[0] = v; out[1] = p; out[2] = q;
  }
  return out;
}

const isTransition = (v) => v === 4 || v === 8 || v === 12;
const keyOf = (v) => (v >= 1 && v <= 4 ? KEY_R : v >= 5 && v <= 8 ? KEY_L : KEY_W);
const swapKey = (k) => (k === KEY_L ? KEY_R : k === KEY_R ? KEY_L : k);

// events without their Chroma data (basic lighting), cached per event list
const basicCache = new WeakMap();
function basicEvents(events) {
  let out = basicCache.get(events);
  if (!out) {
    out = events.filter((e) => e.value < LEGACY_RGB).map((e) => (e.ch ? { time: e.time, type: e.type, value: e.value, f: e.f } : e));
    basicCache.set(events, out);
  }
  return out;
}
const clampF = (f) => (f === undefined || f === null ? 1 : Math.max(0, Math.min(1.5, f)));

/** Per-light state. */
class LightState {
  constructor(light) {
    this.light = light;
    this.mode = MODE_OFF;
    this.t0 = 0;
    this.k = 1; // brightness (event float value x colour alpha)
    this.f = 1; // the event's own float value (a gradient's alpha scales this)
    this.key = KEY_R; // palette colour when not explicit
    this.explicit = false;
    this.r = 1;
    this.g = 1;
    this.b = 1;
    this.ease = null;
    // transition toward the next event (v3 transition values 4 / 8 / 12)
    this.trT0 = 0;
    this.trT1 = -1;
    this.from = [0, 0, 0, 0];
    this.to = [0, 0, 0, 0];
    this.trEase = null;
    this.hsv = false;
    this.intensity = 0;
    this.dirty = true;
    this.swap = false; // shows the opposite palette colour
  }
}

/** Per-event-type state: Chroma's colour override ("colorizer") and gradient. */
class GroupState {
  constructor(lights) {
    this.lights = lights;
    this.over = [1, 1, 1, 1];
    this.hasOver = false;
    this.grad = null; // { t0, t1, start, end, ease }
    this.gradCol = [1, 1, 1, 1];
  }
}

/** One set of rings (rotation / zoom). */
class RingSet {
  constructor(def) {
    this.def = def;
    this.objects = def.objects || [];
    const n = this.objects.length;
    this.big = def.type === 'big';
    this.spinEvent = def.spinEvent === 9 ? 9 : 8;
    this.rot = new Float32Array(n);
    this.dest = new Float32Array(n);
    this.rate = new Float32Array(n);
    this.baseZ = n ? this.objects[0].position.z : 0;
    this.baseRot = this.objects.map((o) => o.rotation.z);
    this.zoomNear = def.zoom ? def.zoom.near : null;
    this.zoomFar = def.zoom ? def.zoom.far : null;
    this.effects = [];
    this.pool = Array.from({ length: 16 }, () => ({ progress: 0, angle: 0, step: 0, prop: 1, speed: 1 }));
    this.reset();
  }

  reset() {
    this.rot.fill(0);
    this.dest.fill(0);
    this.rate.fill(1);
    this.pool.push(...this.effects);
    this.effects.length = 0;
    this.spacing = this.zoomFar;
    this.spacingDest = this.zoomFar;
    this.zoomRate = 3;
    this.zoomToggle = false;
  }
}

export class ChromaLighting {
  /**
   * target: { groups, rings, lasers, banks } (see the top of this file).
   * colors: { left, right, leftBoost, rightBoost, white, whiteBoost } THREE.Colors (read live).
   */
  constructor(target, colors) {
    this.colors = colors;
    this.groups = {};
    const swapTypes = new Set((target.swapColors || []).map(Number));
    for (const [type, lights] of Object.entries(target.groups || {})) {
      if (!lights || !lights.length) continue;
      this.groups[type] = new GroupState(lights.map((l) => {
        const L = new LightState(l);
        L.swap = swapTypes.has(Number(type)) || !!l.swapColor;
        return L;
      }));
    }
    this.custom = new Set((target.customEvents || []).map(Number));
    this.onEvent = typeof target.onEvent === 'function' ? target.onEvent : null;
    this.now = 0;
    this.types = Object.keys(this.groups).map(Number).filter(isLightType).sort((a, b) => a - b);
    this.ringSets = (target.rings || []).filter((r) => r.objects && r.objects.length).map((r) => new RingSet(r));
    this.lasers = [target.lasers?.left || [], target.lasers?.right || []];
    // rest angle: the given phase, else the pivot's own rotation around its spin axis
    for (const side of this.lasers) for (const o of side) o.userData.phase0 ??= o.userData.phase ?? (o.userData.setPhase ? 0 : o.rotation[o.userData.axis || 'z']);
    this.banks = target.banks || [];
    this.laserVel = [0, 0]; // radians per second, signed
    this.boost = false;
    this.events = [];
    this.eventIdx = 0;
    this.targets = [];
    this.next = new Map();
    this.ringTickAcc = 0;
  }

  /**
   * New run. counts: official light count per event type ({ [type]: n }) to map light IDs
   * proportionally onto our lights; omit for direct IDs (environment made for the map).
   * startOn: { [type]: brightness } groups lit before the first event; startLeft: { [type]: true }
   * those of them that start in the left colour; laserSpeed: lasers already spinning (idle).
   * chroma: false plays the basic events only (the events' Chroma data is ignored).
   */
  reset(events, opts = {}) {
    const { counts = null, startOn = {}, startLeft = {}, laserSpeed = 0, chroma = true } = opts;
    this.resetArgs = [events, opts]; // seek() starts over from here
    this.events = chroma ? events || [] : basicEvents(events || []);
    this.eventIdx = 0;
    this.now = -Infinity;
    this.boost = false;
    this.ringTickAcc = 0;
    // the event -> light tables only depend on the events and the ID mapping
    if (this.preparedFor !== this.events || this.preparedCounts !== counts) this.prepare(counts);
    this.preparedFor = this.events;
    this.preparedCounts = counts;
    for (const type of this.types) {
      const grp = this.groups[type];
      grp.hasOver = false;
      grp.grad = null;
      for (const L of grp.lights) {
        L.mode = startOn[type] ? MODE_ON : MODE_OFF;
        L.k = startOn[type] || 1;
        L.f = L.k;
        L.key = startLeft[type] ? KEY_L : KEY_R;
        L.explicit = false;
        L.ease = null;
        L.trT1 = -1;
        L.intensity = 0;
        L.dirty = true;
      }
    }
    for (const rs of this.ringSets) rs.reset();
    this.laserVel[0] = 0;
    this.laserVel[1] = 0;
    for (const side of this.lasers) for (const o of side) this.setLaserPhase(o, o.userData.phase0);
    if (laserSpeed > 0) {
      // idle: both sides spinning from spread-out angles (deterministic)
      for (let side = 0; side < 2; side++) {
        this.laserVel[side] = (side ? -1 : 1) * laserSpeed * LASER_DEG_PER_SPEED * DEG;
        this.lasers[side].forEach((o, i) => this.setLaserPhase(o, o.userData.phase0 + ((i * 2.399) % (Math.PI * 2))));
      }
    }
  }

  /** Which lights each event addresses, and the transitions coming after each event. */
  prepare(counts) {
    const events = this.events;
    const maxIds = {};
    for (const e of events) {
      if (e.ch && e.ch.ids && this.groups[e.type]) for (const id of e.ch.ids) maxIds[e.type] = Math.max(maxIds[e.type] || 0, id);
    }
    // Chroma ID (1..count) -> range of our lights (wrapping IDs beyond the count)
    const idRange = (type, id, out) => {
      const n = this.groups[type].lights.length;
      const c = Math.max(1, (counts && counts[type]) || (counts ? maxIds[type] : n) || n);
      const k = (((id - 1) % c) + c) % c; // 0-based
      const lo = Math.floor((k * n) / c);
      out[0] = lo;
      out[1] = Math.min(n, Math.max(lo + 1, Math.floor(((k + 1) * n) / c)));
      return out;
    };
    const range = [0, 0];
    const targets = new Array(events.length).fill(null); // Int16Array of light indices, null = all
    const stamp = new Map();
    const buf = [];
    const next = new Map(); // event index -> [light, next event index, …] for upcoming transitions
    const last = {};
    for (const type of this.types) last[type] = new Int32Array(this.groups[type].lights.length).fill(-1);
    for (let j = 0; j < events.length; j++) {
      const e = events[j];
      const grp = this.groups[e.type];
      if (!grp || !isLightType(e.type) || e.value >= LEGACY_RGB) continue;
      if (e.ch && e.ch.ids) {
        buf.length = 0;
        for (const id of e.ch.ids) {
          idRange(e.type, id, range);
          for (let i = range[0]; i < range[1]; i++) {
            if (stamp.get(i) === j) continue;
            stamp.set(i, j);
            buf.push(i);
          }
        }
        targets[j] = Int16Array.from(buf);
      }
      const trans = isTransition(e.value);
      const list = targets[j];
      const lastOf = last[e.type];
      const n = list ? list.length : grp.lights.length;
      for (let q = 0; q < n; q++) {
        const i = list ? list[q] : q;
        const prev = lastOf[i];
        if (trans && prev >= 0) {
          let arr = next.get(prev);
          if (!arr) next.set(prev, (arr = []));
          arr.push(i, j);
        }
        lastOf[i] = j;
      }
    }
    this.targets = targets;
    this.next = next;
  }

  markAllDirty() {
    for (const type of this.types) for (const L of this.groups[type].lights) L.dirty = true;
  }

  /** A light's palette colour (its key, swapped for lights that show the opposite colour). */
  paletteOf(L) {
    return this.palette(L.swap ? swapKey(L.key) : L.key);
  }

  /** KEY_L | KEY_R | KEY_W -> current palette colour (with colour boost) */
  palette(key) {
    const c = this.colors;
    if (key === KEY_L) return this.boost ? c.leftBoost : c.left;
    if (key === KEY_R) return this.boost ? c.rightBoost : c.right;
    return this.boost ? c.whiteBoost || c.white : c.white;
  }

  // ---------------------------------------------------------------------------
  // Events

  applyEvent(e, j) {
    const type = e.type;
    if (e.value >= LEGACY_RGB) return; // Chroma 1 colour event: already folded into the later events
    if (this.custom.has(type)) {
      // environment-specific event (rain, tower heights, car hydraulics …)
      this.onEvent?.(type, e.value, e, this.now);
      return;
    }
    if (this.groups[type] && isLightType(type)) {
      this.applyLight(e, j);
      return;
    }
    const ch = e.ch;
    if (type === 5) {
      this.boost = e.value === 1;
      this.markAllDirty();
    } else if (type === 8) {
      this.ringRotation(e, ch, 8);
    } else if (type === 9) {
      this.ringRotation(e, ch, 9);
      for (const rs of this.ringSets) {
        if (rs.zoomFar === null || rs.spinEvent === 9) continue;
        // ring zoom: spacing between rings, game units (max step 2 = the set's far spacing)
        rs.zoomToggle = !rs.zoomToggle;
        const scale = rs.zoomFar / 2;
        const dest = ch && ch.step != null ? ch.step * scale : rs.zoomToggle ? rs.zoomNear : rs.zoomFar;
        rs.spacingDest = Math.max(-rs.zoomFar * 0.6, Math.min(rs.zoomFar * 2.5, dest));
        rs.zoomRate = Math.max(0.05, ch?.speed ?? 3);
      }
    } else if (type === 12 || type === 13) {
      const side = type - 12;
      const speed = Math.max(0, ch?.speed ?? e.value);
      // direction 0: left lasers counter-clockwise, 1: clockwise (right side mirrored)
      let dir;
      if (ch && ch.dir != null) dir = (ch.dir === 1 ? 1 : -1) * (side === 0 ? 1 : -1);
      else dir = rand(e) < 0.5 ? 1 : -1;
      const lock = !!ch?.lock;
      const objs = this.lasers[side];
      if (e.value === 0) {
        this.laserVel[side] = 0;
        if (!lock) for (const o of objs) this.setLaserPhase(o, o.userData.phase0);
      } else {
        this.laserVel[side] = dir * speed * LASER_DEG_PER_SPEED * DEG;
        if (!lock) objs.forEach((o, i) => this.setLaserPhase(o, o.userData.phase0 + rand(e, 2 + i) * Math.PI * 2));
      }
    }
  }

  ringRotation(e, ch, type) {
    const right = ch && ch.dir != null ? ch.dir === 1 : rand(e) < 0.5;
    const filter = ch && typeof ch.nameFilter === 'string' ? ch.nameFilter.toLowerCase() : null;
    for (const rs of this.ringSets) {
      if (rs.spinEvent !== type) continue;
      if (filter && !(filter.includes('big') ? rs.big : filter.includes('small') ? !rs.big : true)) continue;
      let rotation = ch?.rotation ?? 90;
      let step = ch?.step ?? rs.def.step ?? 5;
      let prop = ch?.prop ?? 1;
      let speed = ch?.speed ?? 1;
      if (ch?.reset) {
        step = 0;
        prop = 50;
        speed = 50;
      } else if (ch) {
        step *= ch.stepMult ?? 1;
        prop *= ch.propMult ?? 1;
        speed *= ch.speedMult ?? 1;
      }
      // counter spin: the small rings turn the other way
      const r = ch?.counterSpin && !rs.big ? !right : right;
      if (!Number.isFinite(rotation)) rotation = 90;
      const fx = rs.pool.pop() || {};
      fx.progress = 0;
      fx.angle = rs.dest[0] + rotation * (r ? -1 : 1);
      fx.step = step;
      fx.prop = Math.max(0.01, prop);
      fx.speed = Math.max(0, speed);
      rs.effects.push(fx);
    }
  }

  /** Colour (and brightness) a light takes from event e: [r, g, b, k] into out (base palette for white). */
  eventColor(e, out, swap = false) {
    const key = swap ? swapKey(keyOf(e.value)) : keyOf(e.value);
    const f = clampF(e.f);
    if (key !== KEY_W && e.ch && e.ch.color) {
      const c = e.ch.color;
      out[0] = c[0];
      out[1] = c[1];
      out[2] = c[2];
      out[3] = f * c[3];
    } else {
      const p = this.palette(key);
      out[0] = p.r;
      out[1] = p.g;
      out[2] = p.b;
      out[3] = f;
    }
    return out;
  }

  applyLight(e, j) {
    const grp = this.groups[e.type];
    const ch = e.ch;
    // colour override for the lights this event touches (Chroma's per-group "colorizer")
    if (ch && ch.grad) {
      const gr = ch.grad;
      grp.grad = { t0: e.time, t1: e.time + gr.dur, start: gr.start, end: gr.end, ease: gr.ease };
      for (let c = 0; c < 4; c++) grp.over[c] = gr.start[c];
      grp.hasOver = true;
    }
    if (ch && ch.color) {
      for (let c = 0; c < 4; c++) grp.over[c] = ch.color[c];
      grp.hasOver = true;
      grp.grad = null;
    } else if (!(ch && ch.grad) && !grp.grad) grp.hasOver = false;

    const v = e.value;
    const key = keyOf(v);
    const kind = v === 0 ? 0 : ((v - 1) % 4) + 1; // 0 off, 1 on, 2 flash, 3 fade, 4 transition
    const mode = kind === 0 ? MODE_OFF : kind === 2 ? MODE_FLASH : kind === 3 ? MODE_FADE : MODE_ON;
    const f = clampF(e.f);
    const list = this.targets[j];
    const lights = grp.lights;
    const n = list ? list.length : lights.length;
    for (let q = 0; q < n; q++) {
      const L = lights[list ? list[q] : q];
      L.mode = mode;
      L.t0 = e.time;
      L.ease = ch?.ease ?? null;
      L.hsv = !!ch?.hsv;
      L.trT1 = -1;
      L.dirty = true;
      if (kind === 0) continue;
      L.key = key;
      L.f = f;
      if (key !== KEY_W && grp.hasOver) {
        L.explicit = true;
        L.r = grp.over[0];
        L.g = grp.over[1];
        L.b = grp.over[2];
        L.k = f * grp.over[3];
      } else {
        L.explicit = false;
        L.k = f;
      }
    }
    if (grp.grad && grp.grad.t1 <= e.time) this.endGradient(grp);
    // upcoming transitions (value 4 / 8 / 12) from this event's state to the next one's
    if (mode === MODE_FLASH || mode === MODE_FADE) return;
    const nx = this.next.get(j);
    if (!nx) return;
    for (let q = 0; q < nx.length; q += 2) {
      const L = lights[nx[q]];
      const ne = this.events[nx[q + 1]];
      if (ne.time <= e.time) continue;
      this.eventColor(ne, L.to, L.swap);
      if (mode === MODE_OFF) {
        L.from[0] = L.to[0];
        L.from[1] = L.to[1];
        L.from[2] = L.to[2];
        L.from[3] = 0;
      } else {
        const p = L.explicit ? null : this.paletteOf(L);
        L.from[0] = p ? p.r : L.r;
        L.from[1] = p ? p.g : L.g;
        L.from[2] = p ? p.b : L.b;
        L.from[3] = L.k;
      }
      L.trT0 = e.time;
      L.trT1 = ne.time;
      L.trEase = ch?.ease ?? null;
    }
  }

  endGradient(grp) {
    const end = grp.grad.end;
    for (let c = 0; c < 4; c++) grp.over[c] = end[c];
    grp.hasOver = true;
    grp.grad = null;
    // lit lights keep the gradient's last colour
    for (const L of grp.lights) {
      if (L.key === KEY_W || L.mode === MODE_OFF) continue;
      // the gradient's alpha is the light's brightness (fading to alpha 0 turns it off)
      L.k = L.f * end[3];
      L.explicit = true;
      L.r = end[0];
      L.g = end[1];
      L.b = end[2];
      L.dirty = true;
    }
  }

  // ---------------------------------------------------------------------------
  // Per frame

  /**
   * Plays the events up to t, sets the lights, moves rings / lasers, then runs `envUpdate(t, dt)`
   * (the environment's own update: it may copy pivot transforms into its banks) and finally
   * flushes the banks once.
   */
  update(t, dt, envUpdate = null) {
    this.now = t;
    const events = this.events;
    while (this.eventIdx < events.length && events[this.eventIdx].time <= t) {
      const j = this.eventIdx++;
      this.applyEvent(events[j], j);
    }
    const smooth = Math.min(1, dt * 25);
    for (let ti = 0; ti < this.types.length; ti++) {
      const grp = this.groups[this.types[ti]];
      let gradActive = false;
      if (grp.grad) {
        const gr = grp.grad;
        if (t >= gr.t1) this.endGradient(grp);
        else {
          const p = gr.ease(Math.max(0, Math.min(1, (t - gr.t0) / (gr.t1 - gr.t0))));
          for (let c = 0; c < 4; c++) grp.gradCol[c] = gr.start[c] + (gr.end[c] - gr.start[c]) * p;
          gradActive = true;
        }
      }
      const lights = grp.lights;
      for (let i = 0; i < lights.length; i++) {
        const L = lights[i];
        // only lights that are changing are evaluated
        if (!L.dirty && !(gradActive && L.mode !== MODE_OFF && L.key !== KEY_W)) continue;
        this.evalLight(L, grp, gradActive, t, smooth);
      }
    }
    this.updateMotion(dt);
    if (envUpdate) envUpdate(t, dt);
    for (let i = 0; i < this.banks.length; i++) this.banks[i].update();
  }

  evalLight(L, grp, gradActive, t, smooth) {
    let r;
    let g;
    let b;
    let k;
    let busy = false; // still changing on its own
    if (L.trT1 > L.trT0 && t >= L.trT0 && t < L.trT1) {
      const u = (t - L.trT0) / (L.trT1 - L.trT0);
      const p = L.trEase ? L.trEase(u) : u;
      const A = L.from;
      const B = L.to;
      if (L.hsv) {
        rgbToHsv(A[0], A[1], A[2], _hsvA);
        rgbToHsv(B[0], B[1], B[2], _hsvB);
        let dh = _hsvB[0] - _hsvA[0];
        if (dh > 0.5) dh -= 1;
        else if (dh < -0.5) dh += 1;
        let h = _hsvA[0] + dh * p;
        h -= Math.floor(h);
        hsvToRgb(h, _hsvA[1] + (_hsvB[1] - _hsvA[1]) * p, _hsvA[2] + (_hsvB[2] - _hsvA[2]) * p, _rgb);
        r = _rgb[0];
        g = _rgb[1];
        b = _rgb[2];
      } else {
        r = A[0] + (B[0] - A[0]) * p;
        g = A[1] + (B[1] - A[1]) * p;
        b = A[2] + (B[2] - A[2]) * p;
      }
      k = A[3] + (B[3] - A[3]) * p;
      busy = true;
    } else {
      let kk = L.k;
      if (gradActive && L.key !== KEY_W) {
        r = grp.gradCol[0];
        g = grp.gradCol[1];
        b = grp.gradCol[2];
        kk = L.f * grp.gradCol[3];
        busy = true;
      } else if (L.explicit) {
        r = L.r;
        g = L.g;
        b = L.b;
      } else {
        const p = this.paletteOf(L);
        r = p.r;
        g = p.g;
        b = p.b;
      }
      let m = 0;
      const age = t - L.t0;
      if (L.mode === MODE_ON) m = 1;
      else if (L.mode === MODE_FLASH) {
        const u = Math.max(0, Math.min(1, age / FLASH_TIME));
        m = 1 + FLASH_PEAK * (1 - (L.ease ? L.ease(u) : u));
        if (u < 1) busy = true;
      } else if (L.mode === MODE_FADE) {
        const u = Math.max(0, Math.min(1, age / FADE_TIME));
        m = FADE_PEAK * (1 - (L.ease ? L.ease(u) : u));
        if (u < 1) busy = true;
      }
      k = m * kk;
    }
    L.intensity += (k - L.intensity) * smooth;
    if (!busy && Math.abs(k - L.intensity) < 1e-3) {
      L.intensity = k;
      L.dirty = false;
    }
    const s = L.intensity;
    L.light.set(r * s, g * s, b * s);
  }

  setLaserPhase(o, phase) {
    const ud = o.userData;
    ud.phase = phase;
    if (ud.setPhase) ud.setPhase(phase);
    else o.rotation[ud.axis || 'z'] = phase;
  }

  updateMotion(dt) {
    // Lasers: speed / direction / locked position from the laser speed events
    for (let side = 0; side < 2; side++) {
      const vel = this.laserVel[side];
      if (vel === 0) continue;
      const objs = this.lasers[side];
      for (let i = 0; i < objs.length; i++) this.setLaserPhase(objs[i], objs[i].userData.phase + vel * dt);
    }
    // Rings: rotation effects propagate ring by ring (prop rings per 50 Hz tick)
    if (!this.ringSets.length) return;
    this.ringTickAcc = Math.min(this.ringTickAcc + dt, 0.25);
    while (this.ringTickAcc >= RING_TICK) {
      this.ringTickAcc -= RING_TICK;
      for (const rs of this.ringSets) {
        const n = rs.objects.length;
        for (let k = rs.effects.length - 1; k >= 0; k--) {
          const fx = rs.effects[k];
          let i = Math.floor(fx.progress);
          fx.progress += fx.prop;
          while (i < fx.progress && i < n) {
            rs.dest[i] = fx.angle + i * fx.step;
            rs.rate[i] = fx.speed;
            i++;
          }
          if (fx.progress >= n) {
            rs.pool.push(fx);
            rs.effects.splice(k, 1);
          }
        }
      }
    }
    for (const rs of this.ringSets) {
      const zoom = rs.zoomFar !== null;
      if (zoom) rs.spacing += (rs.spacingDest - rs.spacing) * (1 - Math.exp(-rs.zoomRate * dt));
      for (let i = 0; i < rs.objects.length; i++) {
        rs.rot[i] += (rs.dest[i] - rs.rot[i]) * (1 - Math.exp(-rs.rate[i] * dt));
        const o = rs.objects[i];
        o.rotation.z = rs.baseRot[i] + rs.rot[i] * DEG;
        if (zoom) o.position.z = rs.baseZ - i * rs.spacing;
      }
    }
  }
  // ---------------------------------------------------------------------------
  // Seeking (practice mode)

  /**
   * Puts everything into the state it has at song time t, as if the song had played up to t:
   * starts over (reset() with the same arguments, without rebuilding the light tables) from the
   * nearest checkpoint before t, replays the events from there (lights only take their state,
   * nothing is drawn), fast-forwards the ring / laser motion between the motion events and sets
   * the lights at once (no fade-in). Checkpoints (the whole state every SEEK_STRIDE events) are
   * made by the first seek, so later seeks replay a few hundred events at most.
   */
  seek(t) {
    if (!this.resetArgs) return;
    this.reset(this.resetArgs[0], this.resetArgs[1]);
    const events = this.events;
    // checkpoints belong to one run (its events and reset options)
    const fresh = this.checkpointsFor === events && this.checkpointsOpts === this.resetArgs[1];
    if (events.length > SEEK_STRIDE && !fresh) this.buildCheckpoints();
    let j = 0;
    let motionT = null; // time the ring / laser motion has been simulated to
    const cps = this.checkpointsFor === events && this.checkpointsOpts === this.resetArgs[1] ? this.checkpoints : null;
    if (cps) {
      let lo = 0;
      let hi = cps.length - 1;
      let best = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (cps[mid].last <= t) {
          best = mid;
          lo = mid + 1;
        } else hi = mid - 1;
      }
      if (best >= 0) {
        this.restoreCheckpoint(cps[best]);
        j = cps[best].j;
        motionT = cps[best].motionT;
      }
    }
    motionT = this.replay(j, t, motionT);
    this.now = t;
    if (motionT !== null) this.fastForwardMotion(t - motionT);
    // environment-specific events: handed over in order (their state is the environment's own)
    if (this.onEvent) {
      for (let k = 0; k < events.length && events[k].time <= t; k++) {
        const e = events[k];
        if (this.custom.has(e.type) && e.value < LEGACY_RGB) this.onEvent(e.type, e.value, e, e.time);
      }
    }
    for (let ti = 0; ti < this.types.length; ti++) {
      const grp = this.groups[this.types[ti]];
      let gradActive = false;
      if (grp.grad) {
        const gr = grp.grad;
        if (t >= gr.t1) this.endGradient(grp);
        else {
          const p = gr.ease(Math.max(0, Math.min(1, (t - gr.t0) / (gr.t1 - gr.t0))));
          for (let c = 0; c < 4; c++) grp.gradCol[c] = gr.start[c] + (gr.end[c] - gr.start[c]) * p;
          gradActive = true;
        }
      }
      for (const L of grp.lights) {
        L.dirty = true;
        this.evalLight(L, grp, gradActive, t, 1);
      }
    }
  }

  /**
   * Applies events from index j while their time is <= t (environment-specific ones are left
   * to seek()); onCheckpoint(j, motionT) is called before every SEEK_STRIDE-th event. Returns
   * the time the motion was simulated to.
   */
  replay(j, t, motionT, onCheckpoint = null) {
    const events = this.events;
    for (; j < events.length; j++) {
      const e = events[j];
      if (e.time > t) break;
      if (onCheckpoint && j > 0 && j % SEEK_STRIDE === 0) onCheckpoint(j, motionT);
      const type = e.type;
      if (this.custom.has(type)) continue;
      this.now = e.time;
      if (type === 8 || type === 9 || type === 12 || type === 13) {
        if (motionT !== null) this.fastForwardMotion(e.time - motionT);
        motionT = e.time;
      } else {
        // a gradient that ended before this event ended in an earlier frame
        const grp = this.groups[type];
        if (grp && grp.grad && grp.grad.t1 < e.time) this.endGradient(grp);
      }
      this.applyEvent(e, j);
    }
    this.eventIdx = j;
    return motionT;
  }

  /** One replay of the whole event list, keeping the state every SEEK_STRIDE events. */
  buildCheckpoints() {
    const events = this.events;
    const cps = [];
    this.replay(0, Infinity, null, (j, motionT) => {
      const cp = this.saveCheckpoint();
      cp.j = j;
      cp.last = events[j - 1].time; // valid for seeks at or after this time
      cp.motionT = motionT;
      cps.push(cp);
    });
    this.checkpoints = cps;
    this.checkpointsFor = events;
    this.checkpointsOpts = this.resetArgs[1];
    this.reset(this.resetArgs[0], this.resetArgs[1]);
  }

  saveCheckpoint() {
    const lights = [];
    const groups = [];
    for (const type of this.types) {
      const grp = this.groups[type];
      groups.push([grp.over.slice(), grp.hasOver, grp.grad]);
      for (const L of grp.lights) {
        lights.push([L.mode, L.t0, L.k, L.key, L.explicit, L.r, L.g, L.b, L.ease, L.trT0, L.trT1, L.from.slice(), L.to.slice(), L.trEase, L.hsv, L.f]);
      }
    }
    return {
      lights,
      groups,
      boost: this.boost,
      laserVel: this.laserVel.slice(),
      phases: this.lasers.map((side) => side.map((o) => o.userData.phase)),
      rings: this.ringSets.map((rs) => ({
        rot: rs.rot.slice(), dest: rs.dest.slice(), rate: rs.rate.slice(),
        effects: rs.effects.map((fx) => ({ ...fx })),
        spacing: rs.spacing, spacingDest: rs.spacingDest, zoomRate: rs.zoomRate, zoomToggle: rs.zoomToggle,
      })),
      ringTickAcc: this.ringTickAcc,
    };
  }

  restoreCheckpoint(cp) {
    let li = 0;
    this.types.forEach((type, gi) => {
      const grp = this.groups[type];
      const g = cp.groups[gi];
      for (let c = 0; c < 4; c++) grp.over[c] = g[0][c];
      grp.hasOver = g[1];
      grp.grad = g[2];
      for (const L of grp.lights) {
        const s = cp.lights[li++];
        [L.mode, L.t0, L.k, L.key, L.explicit, L.r, L.g, L.b, L.ease, L.trT0, L.trT1] = s;
        for (let c = 0; c < 4; c++) {
          L.from[c] = s[11][c];
          L.to[c] = s[12][c];
        }
        L.trEase = s[13];
        L.hsv = s[14];
        L.f = s[15];
      }
    });
    this.boost = cp.boost;
    this.laserVel[0] = cp.laserVel[0];
    this.laserVel[1] = cp.laserVel[1];
    this.lasers.forEach((side, k) => side.forEach((o, i) => this.setLaserPhase(o, cp.phases[k][i])));
    this.ringSets.forEach((rs, k) => {
      const r = cp.rings[k];
      rs.rot.set(r.rot);
      rs.dest.set(r.dest);
      rs.rate.set(r.rate);
      rs.pool.push(...rs.effects);
      rs.effects.length = 0;
      for (const fx of r.effects) rs.effects.push({ ...fx });
      rs.spacing = r.spacing;
      rs.spacingDest = r.spacingDest;
      rs.zoomRate = r.zoomRate;
      rs.zoomToggle = r.zoomToggle;
    });
    this.ringTickAcc = cp.ringTickAcc;
  }

  ringsBusy() {
    for (const rs of this.ringSets) if (rs.effects.length) return true;
    return false;
  }

  /** Ring / laser motion over `span` seconds: ring steps tick by tick while they spread, then one step. */
  fastForwardMotion(span) {
    if (!(span > 0)) return;
    let left = span;
    while (left > RING_TICK && this.ringsBusy()) {
      this.updateMotion(RING_TICK);
      left -= RING_TICK;
    }
    if (left > 0) this.updateMotion(left);
  }
}
