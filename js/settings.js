// Persistent player settings shared by the 2D page and the in-VR menu.
import { defaultSpectatorMode } from './game/Spectator.js';

const KEY = 'webxr-saber-settings-v2';
const OLD_KEY = 'webxr-saber-settings';

export const DEFAULTS = {
  noFail: false,
  autoplay: false,
  audioLatencyMs: 0, // extra audio delay (ms), positive = sound arrives later
  volume: 0.8,
  sfxVolume: 0.5,
  saberAngle: 0,
  leftColor: '#c81e1e',
  rightColor: '#2a8fe0',
  useMapColors: true,
  playerHeight: 1.8,
  spectator: null, // resolved at load time
  saberModel: 'classic', // classic | neon | katana | crystal | custom
  noteModel: 'classic', // classic | mech | neon | outline | custom
  wallStyle: 'translucent', // translucent | edges
  saberFlip: false, // reverse a custom saber model's direction
  showWalls: true, // false = maps play without walls
  showBombs: true, // false = maps play without bombs
  showDebris: true, // false = cut blocks vanish instead of splitting into halves
};

// Ranges and steps used by both UIs
export const RANGES = {
  audioLatencyMs: { min: -200, max: 400, step: 5 },
  volume: { min: 0, max: 1, step: 0.05 },
  sfxVolume: { min: 0, max: 1, step: 0.05 },
  saberAngle: { min: -60, max: 60, step: 5 },
  playerHeight: { min: 1.2, max: 2.3, step: 0.01 },
};

function read(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null');
  } catch (e) {
    return null;
  }
}

class SettingsStore {
  constructor() {
    const saved = read(KEY);
    const old = saved ? null : read(OLD_KEY);
    this.values = { ...DEFAULTS, spectator: defaultSpectatorMode() };
    if (old) {
      // v1 settings: the latency slider had the opposite sign
      const { offsetMs, ...rest } = old;
      Object.assign(this.values, rest);
      if (Number.isFinite(offsetMs)) this.values.audioLatencyMs = -offsetMs;
    }
    if (saved) Object.assign(this.values, saved);
    this.listeners = new Set();
  }

  get(key) {
    return this.values[key];
  }

  get all() {
    return { ...this.values };
  }

  set(patch, source = null) {
    let changed = false;
    for (const [k, v] of Object.entries(patch)) {
      let val = v;
      const r = RANGES[k];
      if (r && typeof val === 'number') val = Math.max(r.min, Math.min(r.max, Math.round(val / r.step) * r.step));
      if (r && r.step < 1 && typeof val === 'number') val = Number(val.toFixed(2));
      if (this.values[k] !== val) {
        this.values[k] = val;
        changed = true;
      }
    }
    if (!changed) return;
    try {
      localStorage.setItem(KEY, JSON.stringify(this.values));
    } catch (e) {
      /* storage unavailable */
    }
    for (const fn of this.listeners) fn(this.all, source);
  }

  /** Adds `delta` steps to a numeric setting. */
  step(key, dir) {
    const r = RANGES[key];
    this.set({ [key]: this.values[key] + dir * r.step });
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}

export const settings = new SettingsStore();
