// Monstercat (MonstercatEnvironment) — recreation with simple shapes, made for this project.
// Layout, light groups, light-ID order and sources: see ./_bxMonstercat.js (shared with Crab Rave).
//   0 bottom lasers 8 · 1 top lasers 7 · 2 left lasers 5 · 3 right lasers 5 · 4 center lights 14
//   rings: 20 small ring frames (spin only) · lasers: 12 / 13
import { buildMonstercat } from './_bxMonstercat.js';

export default {
  name: 'MonstercatEnvironment',
  label: 'Monstercat',
  // default colour scheme (same as the base game's default)
  colors: { left: '#c81414', right: '#288ed2', envLeft: '#d91616', envRight: '#30acff', wall: '#ff3030' },
  build: buildMonstercat,
};
