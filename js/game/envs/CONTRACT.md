# Environment modules

One file per official Beat Saber environment: `js/game/envs/<EnvironmentName>.js`, named exactly as
`_environmentName` / `environmentName` appears in Info.dat (e.g. `TimbalandEnvironment.js`), listed
in `list.js` (entries marked `'v3'` have no module). These are **recreations made for this project**
(simple shapes, our own geometry) — never copy models, textures or code from the game or other projects.

## How the game uses a module
- The setting `environment` picks it: `'auto'` = the map's own environment (Info.dat / difficulty),
  `'default'` = always our own scenery, or an environment name to force one on every map.
- While a song loads (state `loading`) the game imports the module (dynamic `import()`, cached),
  calls `build()` and compiles its shaders, so nothing is built mid-song. The built module is kept
  for the next run of the same environment and disposed when another one (or none) is needed.
- If the map's environment has no module, `build()` throws, or the setting says `'default'`, our own
  default scenery is used exactly as before.
- While a module is shown, our own scenery (floor, grid, lasers, rings, back lasers, stars) is
  hidden. The game keeps its runway (the edge strips follow the brightest of the module's
  center lights, event 4), lane lines, player platform, notes, HUD, background colour and fog —
  unless the module gives its own `background` / `fog`.
- Lighting: the module's lights are always driven by the lighting runtime (`js/game/ChromaLighting.js`):
  basic events (on / off / flash / fade / transitions, colour boost 5, rings 8 / 9, laser speed 12 / 13)
  for every map, plus the map's Chroma data (light IDs, colours, gradients …) when the Chroma setting
  is on and the map has it. Light IDs address the module's lights directly (ID n → `groups[type][n - 1]`)
  when the map was made for this environment, otherwise they are mapped proportionally from the
  map's environment (official counts in `js/game/lightIds.js`).
- Colours: the module's `colors` are the environment's default scheme. Per colour, the first one set
  wins: the map's colours (setting "use map colours") → the player's own colours, when changed from
  the defaults → the module's `colors` → the game's defaults. White lights (v3 colour 2, Chroma
  white): the map's white (with the Chroma setting on) → the module's `envWhite` / `envWhiteBoost`
  → white.
- Maps without any light events show every group lit (alternating colours) with spinning lasers.

```js
import { THREE, LightBank, GlowBank, Rig, GEO, tubeMatrix, trs, mergeStatic, sceneryMaterials } from './kit.js';

export default {
  name: 'TimbalandEnvironment',      // Info.dat name
  label: 'Timbaland',                // shown in the UI
  // default colour scheme of the environment (hex strings)
  colors: { left: '#…', right: '#…', envLeft: '#…', envRight: '#…', wall: '#…', envLeftBoost?: '#…', envRightBoost?: '#…',
            envWhite?: '#…', envWhiteBoost?: '#…' },
  build() {
    return {
      root,        // THREE.Object3D with all scenery + lights (the game adds it to the scene)
      banks,       // LightBank[] / PropBank[] used: the runtime calls bank.update() once per frame,
                   //   AFTER update() below
      groups,      // { [eventType]: Light[] } — v2 basic event types with lights:
                   //   0 back lasers, 1 ring lights, 2 left lasers, 3 right lasers, 4 center lights,
                   //   6 / 7 extra left / right lights, 10 / 11 (BTS, Billie …), others if the env uses them.
                   //   ORDER MATTERS: Chroma lightID n addresses groups[type][n - 1]. Use the official
                   //   light count per group (js/game/lightIds.js) and its ID order as far as known.
      rings,       // [{ type: 'small' | 'big', objects: Object3D[], step: degrees between rings,
                   //    zoom: { near: m, far: m }, spinEvent?: 8 | 9 }] — the spin event (default 8)
                   //    rotates each ring around its local Z (successive rings lag by `step`; only
                   //    rotation.z is written, so a ring may carry its own rotation.x / y), event 9 toggles
                   //    the zoom (spacing near/far along Z; ring sets with spinEvent 9 spin instead).
                   //    Ring lights are normally in groups[1]. Omit / [] if the environment has no rings.
      lasers,      // { left: Object3D[], right: Object3D[] } — event 12 / 13 laser speed: each object spins
                   //    around obj.userData.axis ('x' | 'y' | 'z', default 'z'); value = speed; random phase;
                   //    speed 0 returns it to its rest angle (its rotation when the runtime starts).
      update,      // optional (t, dt) => void, every frame BEFORE the banks are uploaded (copy pivot
                   //    transforms into bank instances here, e.g. rig.update()); keep it cheap, no allocations
      dispose,     // () => void: free geometries / materials created in build()

      // optional extensions
      swapColors,   // [eventType]: groups whose lights show the opposite colour (left ↔ right), e.g.
                    //    Dragons' back lasers. A single light can set `light.swapColor = true` instead.
      customEvents, // [eventType]: environment-specific event types (rain, tower heights, car hydraulics …).
                    //    Events of these types go to onEvent instead of the default handling, so a type
                    //    listed here (e.g. 8 / 9 in an environment without rings) no longer spins / zooms.
      onEvent,      // (type, value, event, t) => void for those events (event.f = float value,
                    //    t = song time in seconds). Called during the frame, before update().
      reset,        // () => void, at the start of every run (put custom state back: rain on …)
      background,   // optional hex colour for the scene background while this environment is shown
      fog,          // optional { color, near, far } scene fog while shown (default: the game's fog)
      atmosphere,   // optional: false = no lit atmosphere for this environment, or gains
                    //    { fog, sky, surface, air } (default 1 each), see "Lit atmosphere" below
    };
  },
};
```

Environment events in use: Billie 8 rain toggle / 9 ray mode; Lady Gaga 12 / 13 / 16–19 tower coil
heights; Linkin Park 8 laser mode; BTS 9 pillar control; Interscope 8 / 16 / 17 car hydraulics;
Skrillex's secondary rings use `spinEvent: 9`.

## v3 environments: group lighting (`lightGroups`)
Newer environments (Weave, Pyro, EDM, The Second, Lizzo, The Weeknd, Rock Mixtape, Dragons 2, Panic 2,
Queen, Linkin Park 2, Rolling Stones, Lattice, Daft Punk, Hip Hop, Collider, Britney, Monstercat 2,
Metallica …) are driven by v3 **event box groups** (`lightColorEventBoxGroups`,
`lightRotationEventBoxGroups`, `lightTranslationEventBoxGroups`, `vfxEventBoxGroups`; v4 Lightshow.dat
equivalents). Each official *light group* has an id and a fixed number of *elements*; event boxes pick
elements by index (filters: divide into sections / step & offset / chunks / random / limit, reverse)
and set colour / brightness, rotation or translation per element, with beat and value distribution
across the picked elements. A module for such an environment returns, in addition to (or instead of)
`groups`:

```js
lightGroups: {
  [groupId]: {                      // official group id (Info.dat / the map's eventBoxGroups use it)
    lights: Light[],                // one entry per ELEMENT, in official element order (index 0 … n-1).
                                    //   An element made of several shapes = one MultiLight. A group that
                                    //   only rotates / translates (no light) may have lights: [].
    count,                          // number of elements (defaults to lights.length; set it when the
                                    //   group has no lights)
    rotation: {                     // optional: per-element pivots for lightRotationEventBoxGroups
      x: Object3D[], y: Object3D[], z: Object3D[],   // any subset of axes; arrays indexed by element.
                                    //   The runtime writes obj.rotation[axis] = rest + angle (degrees →
                                    //   radians; rest = the rotation when the run starts).
      mirror: { x?: bool, y?: bool, z?: bool },      // optional: negate the angle (left/right mirrored halves)
    },
    translation: {                  // optional: per-element objects for lightTranslationEventBoxGroups
      x: Object3D[], y: Object3D[], z: Object3D[],
      scale: 1,                     // metres per map unit (default 1)
      mirror: { x?: bool, y?: bool, z?: bool },
    },
  },
},
fx: {                               // optional: vfx event box groups (e.g. fire, fog, particles)
  [groupId]: { count, set(elementIndex, value), initial? },  // value as distributed by the event box
                                    //   (float); initial = value before the first event
},
```

Rules: element order must follow the official element order (light ID n in Chroma v3 = element n-1);
keep rotation/translation pivots separate per element (or use a Rig that copies pivot transforms into
bank instances in `update()`); the runtime never allocates per element per frame, so pivots and lights
must exist up front. Basic events (`groups`, rings, lasers) still work in v3 environments if the
environment also has them (some do, e.g. colour boost and a few classic groups).

How the runtime (`js/game/GroupLighting.js`, parsing and maths in `js/lightshow3.js`) plays them:
- `count` is what the index filters divide (sections, step / offset, chunks, limit), so give the
  official element count even when fewer lights are drawn (elements without a light are skipped).
  Without `count`: the number of lights (or pivots).
- Colour: event colour 0 / 1 / 2 = the scheme's left / right / white environment colour (boost colours
  while colour boost, basic event 5, is on) × brightness, `light.set(r, g, b)`; strobes alternate with
  the strobe brightness. An element is off (0, 0, 0) until its first event. With the Chroma setting on,
  `customData.color` on a box event replaces the colour.
- Rotation / translation are applied exactly as written above, with no handedness conversion by
  the runtime: `obj.rotation[axis] = rest + degToRad(angle)` and `obj.position[axis] = rest + value ×
  scale` (value in map units, `scale` metres per unit, default 1), each negated only when the group's
  `mirror[axis]` is set. Converting Beat Saber's left-handed frame is the module's job (e.g. build
  inside a child group with scale.z = -1, or negated mount axes). The event box's own "invert axis"
  flag (map data) negates the value before that. The angle is unwrapped (auto = shortest way,
  clockwise = increasing angle, plus 360° per loop), so `rest + angle` never jumps. Pivots go back
  to rest at every new run; `rest` is read when the module is built.
- fx: `set(element, value)` whenever the value changes. Before an element's first event it gets the
  optional `fx[groupId].initial` (else the value of its first event); elements without events are
  never set.
- Seeking (practice mode): the runtime can jump to any song time, forward or backward, and every
  element then shows exactly its state at that time; modules need nothing for it.
- Order per frame: basic events / rings / lasers → group lighting → the module's `update()` → banks.
- The environment is enabled automatically when its file exists (`envs/<Name>.js`, checked when the
  app starts); the `'v3'` mark in `list.js` only says it is a group-lighting environment.
- Maps without event box groups still light a v3 module: its light groups (in id order) are spread
  over the map's basic light event types. A v3 map shown where there are no light groups (our
  scenery, an environment without `lightGroups`) looks as before; `Environment.approximateV3 = true`
  would instead spread its colour box groups over the basic lights (off by default).

## Handedness (rotation / translation directions)
Beat Saber turns each rotation transform by `Quaternion.AngleAxis(±angle, axis)` in its parent's
frame (left-handed, x right, y up, +z away from the player; minus for the group's mirror flag) and
moves translation transforms to `lerp(limits, (±value + 1) / 2)` along the parent's axis. The game's
own frames for every group (positions, nesting, mirror flags, translation limits) are in the
environment exports ChroMapper uses (UGEcko, `Assets/__Scenes/Environments/Data/<Env>.json`, dev
branch). For the same look, a module's pivot must turn about the same world axis in the same sense
(and move the same way) for a +1 event as the game's element does:
- Converted frame by frame (z flipped), x and y rotations change sign, z rotations keep it; z
  translations change sign, x and y keep it. `_v3b.js` builds in a scale.z = -1 frame so the official
  flags apply unchanged when the pivots nest like the game's (child pivots with identity rest).
- A pivot with several axes on one Object3D composes them as Euler angles (`XYZ`: x turns about the
  parent's axis, z about its own), so its rest rotation must be identity on the axes in use; put a
  fixed mount (an extra chain member) in front instead, as the game does (e.g. the circular lasers of
  Queen / Linkin Park 2 / Monstercat 2: mount with x = tangent, y = along the runway).
- Translation moves along the parent's axes: a pivot that must slide along its own (rotated) axis
  needs a mount in front.
- Whatever the frames, `mirror` flags fix the sense per group and axis; the modules without a Unity
  frame list them in a `MIRROR` table (`applyMirrors(lightGroups, { id: 'xyZ' })`, kit.js: lower case
  = rotation, upper case = translation).
Real maps send the same values to both groups of most left / right pairs (the official editor
duplicates them), which then mirror because the game's frames / flags do. To check a module, play a
+1 event on one group with the runtime and compare each element's world rotation axis / translation
direction with the game's (from the export); a synthetic left / right symmetry test is not enough,
since several official pairs are deliberately not mirrored.

## Coordinates
Metres. The player stands at the origin facing **-Z**; notes come from far -Z toward the player.
y = 0 is the floor. The game draws the note track, lane lines and the player platform itself
(about x ∈ [-1.3, 1.3], z ∈ [-141, +1.3]) — keep that area clear, don't build another runway there,
but build everything else (floor, towers, lasers, rings, logo shapes …).

## Lights and helpers (kit.js)
- A `Light` is something the runtime colours: `light.set(r, g, b)` (linear RGB, already × brightness;
  0,0,0 = off). Get them from `LightBank.add(matrix)` (instanced; **one draw call per bank**) or
  `new MeshLight(mesh)` for a light that must move on its own. Every light object exposes `r, g, b`.
- `MultiLight(parts, gains)`: one light ID driving several parts (core + halo, a bundle of strands).
- `GlowBank(parent, geometry, max, { haloScale, haloOpacity, … })`: core + faint halo bank pair
  (2 draw calls); `.tube(a, b, r)`, `.add(m, mHalo)`, `.light(bars, opts)` return one light each.
- `Rig`: bank instances that follow moving pivots (rings, laser pivots) without one draw call per
  object: `rig.track(obj)`, `rig.proxy(x, y, z, …)`, `rig.light(pivot, bank, local)`,
  `rig.attach(pivot, propBank, local)`, `rig.tube(pivot, glowBank, a, b, r)`; call `rig.update()`
  from the module's `update()`. `PropBank`: instanced non-light scenery that can move (pass
  `{ ownMaterial: true }` when its material is also used by ordinary meshes — a material shared by
  instanced and non-instanced meshes makes three.js re-check the shader every frame).
- The lit atmosphere (fog, scenery tint, air glow) is added by the game for every module, see
  "Lit atmosphere" above; `wash()` is only needed for a module-specific bounce.
- `lightMaterial()` (additive: black = invisible) for glowing tubes / panels; `softLightMaterial()`
  with vertex colours (`glowDiscGeometry`, `fadeStripGeometry`); `SoftGlow` haze.
- Static, non-light scenery: merge per material with `mergeStatic()` / `mergeGeos()`; materials from
  `sceneryMaterials()` / `stdMat()`. Seeded randomness: `rng(seed)`. Text: `strokeText()`.

## Lit atmosphere (`js/game/Atmosphere.js`)
Like Beat Saber's "bloom fog", the lights light the air and the scenery around them. This is generic:
a module gets it without any work, from the lights it already returns (`groups` and
`lightGroups[id].lights`). The setting `atmosphere` ('off' | 'fog' | 'full', default 'full') picks
how much:
- **fog / sky** ('fog' and up): every frame an ambient colour is taken from the lit lights (each
  weighted by its size, divided by the environment's total, compressed so a few lights already
  show) and added to the fog colour (the module's `fog` or the game's), the background colour and
  sky domes (`skyDome()`, or any `MeshBasicMaterial` with `side: BackSide, fog: false`, toward the
  horizon). Lights off = exactly the base colours again.
- **regions** ('fog' and up): scenery materials (MeshStandard / Basic / Lambert / Phong and
  LineBasic materials that are not additive and not `toneMapped: false`) get a tint from four
  "virtual lights" — the average colour of the lights on the left, right, centre and far away —
  blended by world position in the shader (a few ALU ops per pixel, compiled with the module).
- **air glow** ('full'): one extra instanced draw call per environment — a soft, camera-facing
  ribbon around the longest bars of every light (halo banks are skipped), following the lights'
  instances when they move. Dark lights draw nothing.
- 'off' = nothing: no patched shaders, no extra mesh, no per-frame work.

Rules for modules: emissive shapes must use additive materials (`lightMaterial()` etc.) or
`toneMapped: false`, otherwise they get tinted like scenery; give `material.userData.atmo = false`
to keep a scenery material out, `light.atmo = false` to leave a light out (e.g. a light that is only
a duplicate of another), `atmosphere: { fog: 0.5 }` etc. to tune the gains, `atmosphere: false` to
switch it off. Lights the analysis cannot place (no bank instance / mesh, e.g. `AmbientLight` of
_v3lg.js) count for every region. `wash()` (a module's own bounce light) still works and adds up.

## Budget (Meta Quest, 90 Hz, rendered twice for stereo)
≤ 25 draw calls and ≤ 40 k triangles per environment, no per-frame allocations, no textures larger
than 256², no real-time lights or shadows (the scene already has one hemisphere + one directional light).

## Preview
`dev/env-preview.html?env=TimbalandEnvironment` renders a module with a simple v2 lighting driver:
patterns (all on, per-group colours, light-ID chase, ring spin / zoom, laser speed; for `lightGroups`
also `vgroups` = one light group at a time, `vchase` = element chase in every group, `vrotate` /
`vtranslate` = sweep every group's rotation / translation axes) selectable with
`&pattern=` and an orbit / player camera (`&cam=`, or `&pos=x,y,z&look=x,y,z`). Use it for screenshots.
