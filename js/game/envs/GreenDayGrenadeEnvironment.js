// Green Day Grenade environment — our own recreation from simple shapes (no game assets); shared builder
// in _cGreenDay.js. Same street as Green Day (speaker stages, city, bridge, heart-grenade fist, logo,
// beam bundles, laser fans) but without the rings: event 1 drives the "ambiance" instead, here window
// bands on the buildings closest to the runway. No ring spin / zoom.
//
// Event groups (v2 basic events) and light counts — ID order: approximate. No official light-ID
// table was found; groups follow the BSMG wiki description ("bottom lights, ambiance, left & right
// lasers, center lights"; no triggers; laser speed) and the light layout of the community editor
// ChroMapper (reference only).
//   0  bottom lights 16  stage outlines: 1-4 left upper level (near, outer, far, inner edge),
//                        5-8 left lower level, 9-12 right upper (near, inner, far, outer), 13-16 right lower
//   1  ambiance       2  1 left building windows, 2 right building windows
//   2  left lasers    6  laser fan high up on the left, inner → outer
//   3  right lasers   6  same on the right
//   4  center lights  5  1 GREEN DAY logo, 2 / 3 vertical beam bundles L / R, 4 heart grenade, 5 its drips
// rings: none. lasers: 6 + 6 (spin around Z at their emitters).
import { buildGreenDay, GREEN_DAY_COLORS } from './_cGreenDay.js';

export default {
  name: 'GreenDayGrenadeEnvironment',
  label: 'Green Day Grenade',
  colors: { ...GREEN_DAY_COLORS },
  build() {
    return buildGreenDay({ rings: false });
  },
};
