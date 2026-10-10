// Parts shared by The First / Triangle / Nice / Big Mirror (they are the same family of environments).
// Positions are written in "Unity-style" coordinates through U(x, y, z) (z = distance ahead of the
// player) and converted to our frame (player looks down -Z). Our own simple shapes.
import { THREE } from './kit.js';
import { U, DEG, squareFrame } from './_classicShared.js';

/** Big diamond rings with 4 light bars each (ring lights, event 1). Ring-local light order per ring:
 *  [upper-right, lower-left, lower-right, upper-left] (as the official IDs 1..4 of each ring). */
export function bigRings(kit, { count = 15, y = 3, z0 = 12, dz = 14 } = {}) {
  const body = squareFrame(56.5, 5, 1.4).rotateZ(45 * DEG);
  const W = 2.2;
  const segs = [
    [new THREE.Vector3(42.6, 30.2, 0), new THREE.Vector3(30.2, 42.6, 0), W],
    [new THREE.Vector3(-30.2, -42.6, 0), new THREE.Vector3(-42.6, -30.2, 0), W],
    [new THREE.Vector3(42.6, -30.2, 0), new THREE.Vector3(30.2, -42.6, 0), W],
    [new THREE.Vector3(-30.2, 42.6, 0), new THREE.Vector3(-42.6, 30.2, 0), W],
  ];
  return kit.rings({ count, y, z0, dz, bodyGeo: body, bodyMat: 'metal', lightSegs: segs });
}

/** Small diamond rings (no lights), event 8 spin / event 9 zoom. */
export function smallRings(kit, { count = 30, y = 3, z0 = 21, dz = 5, rotStep = 5 } = {}) {
  const body = squareFrame(10.5, 1.0, 0.8, { gapTopBottom: 6 }).rotateZ(-45 * DEG);
  return kit.rings({ count, y, z0, dz, bodyGeo: body, bodyMat: 'dark', rotStep });
}

/** "^" logo at the end of the track: two bars (left, right), each its own light. */
export function chevron(kit, { y = 5, z = 65, width = 0.9 } = {}) {
  const c = U(0, y, z);
  const l = kit.line(new THREE.Vector3(-0.02, 0.92, 0).add(c), new THREE.Vector3(-2.64, -0.92, 0).add(c), width);
  const r = kit.line(new THREE.Vector3(0.02, 0.92, 0).add(c), new THREE.Vector3(2.64, -0.92, 0).add(c), width);
  return [l, r];
}

/**
 * Pairs of track lasers every dz from z0. The "left" beam starts at (emitX, y0, z) with direction dir
 * (Unity-style axes, z = away from the player); the "right" beam is its mirror image (x negated).
 * Returns lights in official order: [L1, R1, L2, R2, …] when leftFirst, else [R1, L1, …].
 */
export function trackLasers(kit, { n = 5, emitX, y0 = -2, z0 = 63.6, dz = 20, dir, len = 300, width = 1.0, leftFirst = true, mirror = true }) {
  const out = [];
  const d = new THREE.Vector3(dir[0], dir[1], dir[2]).normalize().multiplyScalar(len);
  for (let i = 0; i < n; i++) {
    const z = z0 + i * dz;
    const pair = [];
    for (const s of [1, -1]) {
      // s = 1: the left beam as given, s = -1: its mirror (right)
      const a = U(s * emitX, y0, z);
      const b = U(s * (emitX + d.x), y0 + d.y, z + d.z);
      pair.push(kit.line(a, b, width, { mirror }));
    }
    out.push(...(leftFirst ? pair : [pair[1], pair[0]]));
  }
  return out;
}

/**
 * Rotating side lasers: per side `n` pivots at (±x, y, z0 + i dz) spinning around Y, each with one beam
 * tilted `tilt` degrees from vertical toward the track centre. Returns { left: {pivots, lights}, right }.
 */
export function rotatingLasers(kit, { n = 4, x = 20, y = 3.5, z0 = 54, dz = 8, tilt = 60, up = 260, down = 60, width = 1.0, mirror = true }) {
  const res = {};
  for (const [name, s] of [['left', -1], ['right', 1]]) {
    const pivots = [];
    const lights = [];
    const t = tilt * DEG;
    const dx = -s * Math.sin(t);
    const dy = Math.cos(t);
    for (let i = 0; i < n; i++) {
      const { pivot, lights: l } = kit.pivot(
        U(s * x, y, z0 + i * dz),
        [[new THREE.Vector3(-dx * down, -dy * down, 0), new THREE.Vector3(dx * up, dy * up, 0)]],
        width,
        { mirror },
      );
      pivots.push(pivot);
      lights.push(l[0]);
    }
    res[name] = { pivots, lights };
  }
  return res;
}
