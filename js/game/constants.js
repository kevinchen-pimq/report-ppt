export const LANE_W = 0.6;
export const LAYER_H = 0.5;
export const BASE_Y = 0.85;
export const NOTE_SIZE = 0.45;
export const BLADE_LEN = 1.0;
export const WALL_UNIT = 0.6;

export const COLOR_LEFT = 0xc81e1e;
export const COLOR_RIGHT = 0x2a8fe0;
export const COLOR_WALL = 0xff3050;

// Lane / layer -> world coordinates
export const laneX = (x) => (x - 1.5) * LANE_W;

// Player height shifts notes and walls like the original game (default height 1.8 m)
let heightOffset = 0;
export function setPlayerHeight(h) {
  heightOffset = Math.max(-0.2, Math.min(0.6, ((Number(h) || 1.8) - 1.8) * 0.5));
}
export const getHeightOffset = () => heightOffset;
export const layerY = (y) => BASE_Y + heightOffset + y * LAYER_H;

const DIR_BASE = [
  [0, 1], [0, -1], [-1, 0], [1, 0],
  [-1, 1], [1, 1], [-1, -1], [1, -1],
];

/** Rotation (radians around +Z) so that the arrow (local -Y) points along the cut direction. */
export function noteRotation(dir, angleOffsetDeg) {
  let base = 0;
  const v = DIR_BASE[dir];
  if (v) base = Math.atan2(v[0], -v[1]);
  return base + ((angleOffsetDeg || 0) * Math.PI) / 180;
}

/** Unit cut direction in world XY for a rotation (local -Y rotated). */
export function rotationToDir(rot) {
  return [Math.sin(rot), -Math.cos(rot)];
}

export const RANKS = [
  [0.9, 'SS'],
  [0.8, 'S'],
  [0.65, 'A'],
  [0.5, 'B'],
  [0.35, 'C'],
  [0.2, 'D'],
  [0, 'E'],
];

export function rankFor(ratio) {
  for (const [min, r] of RANKS) if (ratio >= min) return r;
  return 'E';
}
