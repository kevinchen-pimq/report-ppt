// Chroma light IDs: how many lights each basic-event light group has in the official
// environments (light IDs run 1..count). Our environment has its own, smaller set of
// lights per group, so a Chroma ID is mapped onto them proportionally (see ChromaLighting.js).
// Counts per event type 0 back lasers, 1 ring lights, 2 left lasers, 3 right lasers,
// 4 center lights (0 = the environment has no such group): the number of entries per group.
// Light counts from Heck/Chroma LightIDTables (MIT, Aeroluna).
export const ENV_LIGHT_COUNTS = {
  DefaultEnvironment: [10, 60, 11, 11, 14],
  TriangleEnvironment: [10, 60, 11, 11, 12],
  NiceEnvironment: [8, 40, 11, 11, 14],
  BigMirrorEnvironment: [10, 60, 8, 8, 16],
  KDAEnvironment: [6, 5, 7, 9, 80],
  MonstercatEnvironment: [8, 7, 5, 5, 15],
  CrabRaveEnvironment: [8, 7, 5, 5, 14],
  DragonsEnvironment: [2, 62, 5, 5, 4],
  OriginsEnvironment: [4, 60, 6, 6, 2],
  PanicEnvironment: [2, 62, 7, 7, 8],
  RocketEnvironment: [13, 4, 7, 7, 7],
  GreenDayEnvironment: [16, 60, 6, 6, 3],
  GreenDayGrenadeEnvironment: [16, 60, 6, 6, 5],
  TimbalandEnvironment: [20, 20, 10, 14, 8],
  FitBeatEnvironment: [30, 30, 8, 8, 2],
  LinkinParkEnvironment: [2, 16, 20, 20, 1],
  BTSEnvironment: [3, 20, 27, 27, 5],
  KaleidoscopeEnvironment: [40, 40, 20, 20, 80],
  InterscopeEnvironment: [3, 3, 3, 3, 3],
  SkrillexEnvironment: [8, 66, 23, 23, 66],
  BillieEnvironment: [4, 4, 4, 4, 5],
  HalloweenEnvironment: [4, 3, 18, 18, 3],
  GlassDesertEnvironment: [6, 8, 10, 10, 0],
};

/**
 * Official light counts of an environment as { [eventType]: count } (groups it lacks left out).
 * An unknown environment gives {}: the light-ID mapping then uses the highest ID the map uses.
 */
export function envLightCounts(envName) {
  const table = ENV_LIGHT_COUNTS[envName];
  const out = {};
  if (table) table.forEach((n, type) => {
    if (n > 0) out[type] = n;
  });
  return out;
}
