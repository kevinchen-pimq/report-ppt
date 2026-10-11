// Noodle Extensions runtime: track properties, path animations, track parents and the
// player track at a song time (data from js/noodle.js).
//
// Everything is a function of the song time: each (track, property) keeps its events in time
// order with a cursor, and the value at time t comes from the latest event that started at or
// before t (Heck: a newer AnimateTrack on a property stops the older one; AssignPathAnimation
// blends from the previous path over its duration). So seeking (practice mode) is just
// evaluating at the new time; seek(t) only re-anchors the cursors.
//
// Values are evaluated lazily, once per frame, when an object / parent / the player asks.
// No allocations per frame: results go to preallocated arrays.

import * as THREE from 'three';

export const LANE = 0.6; // metres per Noodle unit (offsetPosition, definitePosition, v2 positions)

const IDENT_Q = new Float64Array([0, 0, 0, 1]);

/** out = a * b (quaternions as [x, y, z, w]; out may alias a or b). */
export function qmul(a, b, out) {
  const ax = a[0];
  const ay = a[1];
  const az = a[2];
  const aw = a[3];
  const bx = b[0];
  const by = b[1];
  const bz = b[2];
  const bw = b[3];
  out[0] = ax * bw + aw * bx + ay * bz - az * by;
  out[1] = ay * bw + aw * by + az * bx - ax * bz;
  out[2] = az * bw + aw * bz + ax * by - ay * bx;
  out[3] = aw * bw - ax * bx - ay * by - az * bz;
  return out;
}

/** out = q · v (rotate a vec3; out may alias v). */
export function qrot(q, v, out) {
  const x = v[0];
  const y = v[1];
  const z = v[2];
  const qx = q[0];
  const qy = q[1];
  const qz = q[2];
  const qw = q[3];
  const tx = 2 * (qy * z - qz * y);
  const ty = 2 * (qz * x - qx * z);
  const tz = 2 * (qx * y - qy * x);
  out[0] = x + qw * tx + qy * tz - qz * ty;
  out[1] = y + qw * ty + qz * tx - qx * tz;
  out[2] = z + qw * tz + qx * ty - qy * tx;
  return out;
}

function slerpInto(a, b, t, out) {
  let bx = b[0];
  let by = b[1];
  let bz = b[2];
  let bw = b[3];
  let cos = a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw;
  if (cos < 0) {
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
    cos = -cos;
  }
  let ka = 1 - t;
  let kb = t;
  if (cos < 0.9995) {
    const th = Math.acos(Math.min(1, cos));
    const s = Math.sin(th);
    ka = Math.sin((1 - t) * th) / s;
    kb = Math.sin(t * th) / s;
  }
  out[0] = a[0] * ka + bx * kb;
  out[1] = a[1] * ka + by * kb;
  out[2] = a[2] * ka + bz * kb;
  out[3] = a[3] * ka + bw * kb;
  const l = Math.sqrt(out[0] * out[0] + out[1] * out[1] + out[2] * out[2] + out[3] * out[3]) || 1;
  out[0] /= l;
  out[1] /= l;
  out[2] /= l;
  out[3] /= l;
  return out;
}

/** Index of the last event with t0 <= t (-1: none), starting from a cursor. */
function locate(ev, idx, t) {
  const n = ev.length;
  if (idx + 1 < n && ev[idx + 1].t0 <= t) {
    if (idx + 2 >= n || ev[idx + 2].t0 > t) return idx + 1;
  } else if (idx < 0 || ev[idx].t0 <= t) return idx;
  let lo = 0;
  let hi = n;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (ev[m].t0 <= t) lo = m + 1;
    else hi = m;
  }
  return lo - 1;
}

/** An AnimateTrack-driven property of a track. */
class PropState {
  constructor(events, size) {
    this.ev = events;
    this.idx = -1;
    this.stamp = -1;
    this.has = false;
    this.val = new Float64Array(Math.max(4, size));
  }

  eval(t) {
    const ev = this.ev;
    const i = (this.idx = locate(ev, this.idx, t));
    if (i < 0 || !ev[i].pd) {
      this.has = false;
      return;
    }
    const e = ev[i];
    const pd = e.pd;
    let f = 1;
    if (e.dur > 0 && !pd.constant) {
      const el = t - e.t0;
      if (el < e.dur * (e.repeat + 1)) f = (el % e.dur) / e.dur;
      if (e.ease) f = e.ease(f);
    }
    pd.eval(f, this.val);
    this.has = true;
  }
}

/** An AssignPathAnimation-driven path property of a track. */
class PathState {
  constructor(events, size) {
    this.ev = events;
    this.idx = -1;
    this.stamp = -1;
    this.base = null;
    this.prev = null;
    this.mix = 1;
    this.size = size;
    this.tmp = new Float64Array(4);
  }

  eval(t) {
    const ev = this.ev;
    const i = (this.idx = locate(ev, this.idx, t));
    if (i < 0) {
      this.base = null;
      return;
    }
    const e = ev[i];
    this.base = e.pd;
    this.prev = i > 0 ? ev[i - 1].pd : null;
    this.mix = 1;
    if (this.prev && e.dur > 0 && t - e.t0 < e.dur) {
      const f = (t - e.t0) / e.dur;
      this.mix = e.ease ? e.ease(f) : f;
    }
  }

  /** Value at an object's path time into out; false when the track has no such path. */
  sample(time, out) {
    const base = this.base;
    if (!base) return false;
    if (!this.prev || this.mix >= 1) {
      base.eval(time, out);
      return true;
    }
    const a = this.prev.eval(time, this.tmp);
    base.eval(time, out);
    const m = this.mix;
    if (base.kind === 'q') slerpInto(a, out, m, out);
    else for (let k = 0; k < this.size; k++) out[k] = a[k] + (out[k] - a[k]) * m;
    return true;
  }
}

const SIZE = { offsetPosition: 3, position: 3, localPosition: 3, definitePosition: 3, scale: 3, offsetWorldRotation: 4, localRotation: 4, rotation: 4, color: 4, dissolve: 1, dissolveArrow: 1, interactable: 1, time: 1 };

/** Per-frame combined animation of an object (Heck's AnimationHelper.GetObjectOffset). */
export class ObjectState {
  constructor() {
    this.pos = new Float64Array(3); // offset in metres (already x 0.6)
    this.rot = new Float64Array(4);
    this.scale = new Float64Array(3);
    this.lrot = new Float64Array(4);
    this.color = new Float64Array(4);
    this.def = new Float64Array(3); // definite position in metres
    this.hasPos = false;
    this.hasRot = false;
    this.hasScale = false;
    this.hasLRot = false;
    this.hasDis = false;
    this.hasDisA = false;
    this.hasInt = false;
    this.hasColor = false;
    this.hasDef = false;
    this.dis = 1;
    this.disA = 1;
    this.int = 1;
  }

  clear() {
    this.hasPos = this.hasRot = this.hasScale = this.hasLRot = false;
    this.hasDis = this.hasDisA = this.hasInt = this.hasColor = this.hasDef = false;
  }
}

const _a = new Float64Array(4);
const _b = new Float64Array(4);
const _q = new Float64Array(4);
const _v = new Float64Array(3);

/**
 * The modchart state of a run. root: the group objects live in (world space of the playfield).
 */
export class NoodleRuntime {
  constructor(data, root) {
    this.data = data;
    this.v2 = data.v2;
    this.root = root;
    this.t = 0;
    this.frame = 0;
    // per track: { anim: { prop: PropState }, path: { prop: PathState }, pIdx }
    this.tr = [];
    for (const tr of data.tracks) {
      const rt = { anim: {}, path: {}, pIdx: -1, pStamp: -1, parent: null };
      for (const [k, ev] of Object.entries(tr.anim)) rt.anim[k] = new PropState(ev, SIZE[k] || 4);
      for (const [k, ev] of Object.entries(tr.path)) rt.path[k] = new PathState(ev, SIZE[k] || 4);
      this.tr[tr.id] = rt;
    }
    // track parents: one group per AssignTrackParent event (attached when first used)
    this.parents = data.parents.map((ev) => {
      const group = new THREE.Group();
      group.name = `noodle-parent-${ev.parent.name}`;
      group.matrixAutoUpdate = false;
      return { ev, group, stamp: -1, depth: 0 };
    });
    this.players = data.players;
    this.playerIdx = -1;
    this.f = 0.5; // pathFloat result (a field: no allocation per call)
  }

  /** Sets the song time for this frame (values are evaluated when asked). */
  update(t) {
    if (t === this.t && this.frame > 0) return; // same frame (the rig asked first)
    this.t = t;
    this.frame++;
  }

  /** Practice mode jump: the state at song time t (cursors re-anchor by binary search). */
  seek(t) {
    for (const rt of this.tr) {
      if (!rt) continue;
      for (const s of Object.values(rt.anim)) s.idx = -1;
      for (const s of Object.values(rt.path)) s.idx = -1;
      rt.pIdx = -1;
    }
    this.playerIdx = -1;
    for (const p of this.parents) p.group.removeFromParent();
    this.t = t;
    this.frame++;
  }

  dispose() {
    for (const p of this.parents) p.group.removeFromParent();
  }

  /** AnimateTrack value of a track property at the current time, or null. */
  prop(track, name) {
    const rt = this.tr[track.id];
    const s = rt && rt.anim[name];
    if (!s) return null;
    if (s.stamp !== this.frame) {
      s.stamp = this.frame;
      s.eval(this.t);
    }
    return s.has ? s.val : null;
  }

  /** Path property state of a track (current time), or null. */
  path(track, name) {
    const rt = this.tr[track.id];
    const s = rt && rt.path[name];
    if (!s) return null;
    if (s.stamp !== this.frame) {
      s.stamp = this.frame;
      s.eval(this.t);
    }
    return s.base ? s : null;
  }

  /** The `time` track property of an object's tracks (first one set), or null. */
  timeOf(nd) {
    const trs = nd.tracks;
    if (!trs) return null;
    for (let i = 0; i < trs.length; i++) {
      const v = this.prop(trs[i], 'time');
      if (v) return v[0];
    }
    return null;
  }

  /**
   * Combined animation of an object at its path time (0 = jump start, 0.5 = at the player,
   * 1 = despawn): the object's own `animation` replaces its tracks' path animation per
   * property; track properties add (position) or multiply (the rest) on top. Also the
   * definite position (positions in metres).
   */
  objectState(nd, time, S) {
    S.clear();
    const anim = nd.anim;
    const trs = nd.tracks;
    // path values
    S.hasPos = this.pathVec(anim && anim.pos, trs, 'offsetPosition', time, S.pos, true);
    S.hasRot = this.pathQuat(anim && anim.rot, trs, 'offsetWorldRotation', time, S.rot);
    S.hasScale = this.pathVec(anim && anim.scale, trs, 'scale', time, S.scale, false);
    S.hasLRot = this.pathQuat(anim && anim.lrot, trs, 'localRotation', time, S.lrot);
    S.hasDis = this.pathFloat(anim && anim.dis, trs, 'dissolve', time);
    S.dis = this.f;
    S.hasDisA = this.pathFloat(anim && anim.disA, trs, 'dissolveArrow', time);
    S.disA = this.f;
    S.hasInt = this.pathFloat(anim && anim.int, trs, 'interactable', time);
    S.int = this.f;
    S.hasColor = this.pathColor(anim && anim.color, trs, time, S.color);
    // definite position (uses the path offset before the track offset is added)
    S.hasDef = this.pathVec(anim && anim.def, trs, 'definitePosition', time, S.def, true);
    if (S.hasDef) {
      if (S.hasPos) for (let k = 0; k < 3; k++) S.def[k] += S.pos[k];
    }
    // track values
    if (trs) {
      for (let i = 0; i < trs.length; i++) {
        const tr = trs[i];
        let v = this.prop(tr, 'offsetPosition');
        if (v) {
          if (!S.hasPos) S.pos[0] = S.pos[1] = S.pos[2] = 0;
          S.pos[0] += v[0];
          S.pos[1] += v[1];
          S.pos[2] += v[2];
          S.hasPos = true;
          if (S.hasDef) {
            S.def[0] += v[0];
            S.def[1] += v[1];
            S.def[2] += v[2];
          }
        }
        v = this.prop(tr, 'offsetWorldRotation');
        if (v) {
          // track rotation * path rotation
          if (S.hasRot) qmul(v, S.rot, S.rot);
          else S.rot.set(v);
          S.hasRot = true;
        }
        v = this.prop(tr, 'scale');
        if (v) {
          if (S.hasScale) for (let k = 0; k < 3; k++) S.scale[k] *= v[k];
          else for (let k = 0; k < 3; k++) S.scale[k] = v[k];
          S.hasScale = true;
        }
        v = this.prop(tr, 'localRotation');
        if (v) {
          if (S.hasLRot) qmul(v, S.lrot, S.lrot);
          else S.lrot.set(v);
          S.hasLRot = true;
        }
        v = this.prop(tr, 'dissolve');
        if (v) {
          S.dis = S.hasDis ? S.dis * v[0] : v[0];
          S.hasDis = true;
        }
        v = this.prop(tr, 'dissolveArrow');
        if (v) {
          S.disA = S.hasDisA ? S.disA * v[0] : v[0];
          S.hasDisA = true;
        }
        v = this.prop(tr, 'interactable');
        if (v) {
          S.int = S.hasInt ? S.int * v[0] : v[0];
          S.hasInt = true;
        }
        v = this.prop(tr, 'color');
        if (v) {
          if (S.hasColor) for (let k = 0; k < 4; k++) S.color[k] *= v[k];
          else for (let k = 0; k < 4; k++) S.color[k] = v[k];
          S.hasColor = true;
        }
      }
    }
    if (S.hasPos) for (let k = 0; k < 3; k++) S.pos[k] *= LANE;
    if (S.hasDef) for (let k = 0; k < 3; k++) S.def[k] *= LANE;
    return S;
  }

  pathVec(own, trs, name, time, out, sum) {
    if (own) {
      own.eval(time, out);
      return true;
    }
    if (!trs) return false;
    let has = false;
    for (let i = 0; i < trs.length; i++) {
      const s = this.path(trs[i], name);
      if (!s || !s.sample(time, _a)) continue;
      if (!has) {
        out[0] = _a[0];
        out[1] = _a[1];
        out[2] = _a[2];
      } else if (sum) {
        out[0] += _a[0];
        out[1] += _a[1];
        out[2] += _a[2];
      } else {
        out[0] *= _a[0];
        out[1] *= _a[1];
        out[2] *= _a[2];
      }
      has = true;
    }
    return has;
  }

  pathQuat(own, trs, name, time, out) {
    if (own) {
      own.eval(time, out);
      return true;
    }
    if (!trs) return false;
    let has = false;
    for (let i = 0; i < trs.length; i++) {
      const s = this.path(trs[i], name);
      if (!s || !s.sample(time, _a)) continue;
      if (!has) out.set(_a);
      else qmul(out, _a, out);
      has = true;
    }
    return has;
  }

  pathFloat(own, trs, name, time) {
    if (own) {
      own.eval(time, _b);
      this.f = _b[0];
      return true;
    }
    this.f = 1;
    if (!trs) return false;
    let has = false;
    for (let i = 0; i < trs.length; i++) {
      const s = this.path(trs[i], name);
      if (!s || !s.sample(time, _a)) continue;
      this.f = has ? this.f * _a[0] : _a[0];
      has = true;
    }
    return has;
  }

  pathColor(own, trs, time, out) {
    if (own) {
      own.eval(time, out);
      return true;
    }
    if (!trs) return false;
    let has = false;
    for (let i = 0; i < trs.length; i++) {
      const s = this.path(trs[i], 'color');
      if (!s || !s.sample(time, _a)) continue;
      if (!has) out.set(_a);
      else for (let k = 0; k < 4; k++) out[k] *= _a[k];
      has = true;
    }
    return has;
  }

  // ---------------------------------------------------------------------------
  // Track parents (AssignTrackParent)

  /** The parent group an object on these tracks hangs under now (updated this frame), or null. */
  parentFor(tracks, depth = 0) {
    if (!tracks || depth > 8) return null;
    for (let i = 0; i < tracks.length; i++) {
      const tr = tracks[i];
      if (!tr.parents.length) continue;
      const rt = this.tr[tr.id];
      if (rt.pStamp !== this.frame) {
        rt.pStamp = this.frame;
        rt.pIdx = locate(tr.parents, rt.pIdx, this.t);
        rt.parent = rt.pIdx >= 0 ? this.parents[tr.parents[rt.pIdx].index] : null;
        if (rt.parent) this.updateParent(rt.parent, depth);
      }
      if (rt.parent) return rt.parent.group;
    }
    return null;
  }

  updateParent(p, depth) {
    if (p.stamp === this.frame) return;
    p.stamp = this.frame;
    const ev = p.ev;
    const tr = ev.parent;
    const g = p.group;
    // its own parent: the parent track may itself be a child of another parent
    _tracks1[0] = tr;
    let up = this.parentFor(_tracks1, depth + 1) || this.root;
    if (g.parent !== up) {
      // never hang a group under its own descendant (parent loops in a map)
      for (let o = up; o; o = o.parent) {
        if (o === g) {
          up = this.root;
          break;
        }
      }
      up.add(g);
    }
    if (ev.v2) {
      // Heck ParentObject (v2): start transform, then the track's offset position / rotation
      const startRot = ev.rot || IDENT_Q;
      const rot = this.prop(tr, 'offsetWorldRotation');
      const pos = this.prop(tr, 'offsetPosition');
      _q.set(startRot);
      _v[0] = ev.pos ? ev.pos[0] : 0;
      _v[1] = ev.pos ? ev.pos[1] : 0;
      _v[2] = ev.pos ? ev.pos[2] : 0;
      if (rot || pos) {
        if (rot) qmul(_q, rot, _q);
        if (pos) {
          _v[0] += pos[0];
          _v[1] += pos[1];
          _v[2] += pos[2];
        }
      }
      _v[0] *= LANE;
      _v[1] *= LANE;
      _v[2] *= LANE;
      qrot(_q, _v, _v);
      // start local rotation (Heck: start rotation, times the local one when given)
      if (ev.rot) qmul(_q, ev.rot, _q);
      if (ev.localRot) qmul(_q, ev.localRot, _q);
      const lr = this.prop(tr, 'localRotation');
      if (lr) qmul(_q, lr, _q);
      const sc = this.prop(tr, 'scale');
      const s0 = ev.scale;
      g.position.set(_v[0], _v[1], _v[2]);
      g.quaternion.set(_q[0], _q[1], _q[2], _q[3]);
      g.scale.set((s0 ? s0[0] : 1) * (sc ? sc[0] : 1), (s0 ? s0[1] : 1) * (sc ? sc[1] : 1), (s0 ? s0[2] : 1) * (sc ? sc[2] : 1));
    } else {
      // v3: TransformData from the event, then the track's transform properties
      const pos = this.prop(tr, 'localPosition') || this.prop(tr, 'position') || ev.localPos || ev.pos;
      const rot = this.prop(tr, 'localRotation') || this.prop(tr, 'rotation') || ev.localRot || ev.rot;
      const sc = this.prop(tr, 'scale') || ev.scale;
      if (pos) g.position.set(pos[0], pos[1], pos[2]);
      else g.position.set(0, 0, 0);
      if (rot) g.quaternion.set(rot[0], rot[1], rot[2], rot[3]);
      else g.quaternion.identity();
      if (sc) g.scale.set(sc[0], sc[1], sc[2]);
      else g.scale.set(1, 1, 1);
    }
    g.updateMatrix();
    g.updateWorldMatrix(false, false);
  }

  // ---------------------------------------------------------------------------
  // Player track (AssignPlayerToTrack): where the player's play space is

  /** Writes the player rig's position / quaternion (THREE objects); false = not moved. */
  playerTransform(pos, quat) {
    const list = this.players;
    if (!list.length) return false;
    this.playerIdx = locate(list, this.playerIdx, this.t);
    if (this.playerIdx < 0) return false;
    // the latest Root / Head assignment (hands are not moved)
    let i = this.playerIdx;
    while (i >= 0 && list[i].target !== 'Root' && list[i].target !== 'Head') i--;
    if (i < 0) return false;
    const tr = list[i].track;
    if (this.v2) {
      const rot = this.prop(tr, 'offsetWorldRotation');
      const p = this.prop(tr, 'offsetPosition');
      _q.set(rot ? rot : IDENT_Q);
      _v[0] = p ? p[0] * LANE : 0;
      _v[1] = p ? p[1] * LANE : 0;
      _v[2] = p ? p[2] * LANE : 0;
      qrot(_q, _v, _v);
      const lr = this.prop(tr, 'localRotation');
      if (lr) qmul(_q, lr, _q);
    } else {
      const p = this.prop(tr, 'localPosition') || this.prop(tr, 'position');
      const r = this.prop(tr, 'localRotation') || this.prop(tr, 'rotation');
      _v[0] = p ? p[0] : 0;
      _v[1] = p ? p[1] : 0;
      _v[2] = p ? p[2] : 0;
      _q.set(r ? r : IDENT_Q);
    }
    pos.set(_v[0], _v[1], _v[2]);
    quat.set(_q[0], _q[1], _q[2], _q[3]);
    return true;
  }
}

const _tracks1 = [null];

export { IDENT_Q };
