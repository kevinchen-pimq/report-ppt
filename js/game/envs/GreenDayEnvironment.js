// Green Day environment — our own recreation from simple shapes (no game assets); shared builder in
// _greenDay.js. Look: a night-time city street: stages with stacks of guitar-amp speaker cabinets
// right beside the player, their outlines glowing on the floor; dark buildings down both sides and a
// bridge far ahead; a raised fist holding the heart-shaped grenade left of the runway; the GREEN DAY
// logo over the far runway between two bundles of vertical beams; laser fans raking down from high up
// at the back; square rings with solid light bars down the far end of the runway.
//
// Event groups (v2 basic events) and light counts — ID order: approximate. No official light-ID
// table was found; groups follow the BSMG wiki description ("bottom lights, ring lights, left & right
// lasers, center lights"; ring spin + zoom; laser speed) and the light layout of the community editor
// ChroMapper (reference only: which group drives what, rough positions and per-group order).
//   0  bottom lights 16  stage outlines: 1-4 left upper level (near, outer, far, inner edge),
//                        5-8 left lower level, 9-12 right upper (near, inner, far, outer), 13-16 right lower
//   1  ring lights   60  ring k (front → back): 6k+1..6k+3 top bar segments (left → right),
//                        6k+4..6k+6 bottom bar segments
//   2  left lasers    6  laser fan high up on the left, inner → outer
//   3  right lasers   6  same on the right
//   4  center lights  3  1 GREEN DAY logo, 2 both vertical beam bundles, 3 heart grenade + its drips
// (counts per Heck's light-ID table; which object has which ID: approximate)
// rings: big × 10 (spin + zoom). lasers: 6 + 6 (spin around Z at their emitters).
import { buildGreenDay, GREEN_DAY_COLORS } from './_greenDay.js';

export default {
  name: 'GreenDayEnvironment',
  label: 'Green Day',
  colors: { ...GREEN_DAY_COLORS },
  build() {
    return buildGreenDay({ rings: true });
  },
};
