// Crab Rave (CrabRaveEnvironment) — recreation with simple shapes, made for this project.
// Same stage and lights as Monstercat with a green / blue default colour scheme.
// Layout, light groups, light-ID order and sources: see ./_bxMonstercat.js.
//   0 bottom lasers 8 · 1 top lasers 7 · 2 left lasers 5 · 3 right lasers 5 · 4 center lights 14
//   rings: 20 small ring frames (spin only) · lasers: 12 / 13
import { buildMonstercat } from './_bxMonstercat.js';

export default {
  name: 'CrabRaveEnvironment',
  label: 'Crab Rave',
  colors: { left: '#00b614', right: '#0c81bb', envLeft: '#22c128', envRight: '#0e9ee6', wall: '#00cf17' },
  build: buildMonstercat,
};
