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
  the defaults → the module's `colors` → the game's defaults.
- Maps without any light events show every group lit (alternating colours) with spinning lasers.

```js
import { THREE, LightBank, GlowBank, Rig, GEO, tubeMatrix, trs, mergeStatic, sceneryMaterials } from './kit.js';

export default {
  name: 'TimbalandEnvironment',      // Info.dat name
  label: 'Timbaland',                // shown in the UI
  // default colour scheme of the environment (hex strings)
  colors: { left: '#…', right: '#…', envLeft: '#…', envRight: '#…', wall: '#…', envLeftBoost?: '#…', envRightBoost?: '#…' },
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
    };
  },
};
```

Environment events in use: Billie 8 rain toggle / 9 ray mode; Lady Gaga 12 / 13 / 16–19 tower coil
heights; Linkin Park 8 laser mode; BTS 9 pillar control; Interscope 8 / 16 / 17 car hydraulics;
Skrillex's secondary rings use `spinEvent: 9`.

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
- `lightMaterial()` (additive: black = invisible) for glowing tubes / panels; `softLightMaterial()`
  with vertex colours (`glowDiscGeometry`, `fadeStripGeometry`); `SoftGlow` haze.
- Static, non-light scenery: merge per material with `mergeStatic()` / `mergeGeos()`; materials from
  `sceneryMaterials()` / `stdMat()`. Seeded randomness: `rng(seed)`. Text: `strokeText()`.

## Budget (Meta Quest, 90 Hz, rendered twice for stereo)
≤ 25 draw calls and ≤ 40 k triangles per environment, no per-frame allocations, no textures larger
than 256², no real-time lights or shadows (the scene already has one hemisphere + one directional light).

## Preview
`dev/env-preview.html?env=TimbalandEnvironment` renders a module with a simple v2 lighting driver:
patterns (all on, per-group colours, light-ID chase, ring spin / zoom, laser speed) selectable with
`&pattern=` and an orbit / player camera (`&cam=`, or `&pos=x,y,z&look=x,y,z`). Use it for screenshots.
