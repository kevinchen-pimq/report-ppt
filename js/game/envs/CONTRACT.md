# Environment modules

One file per official Beat Saber environment: `js/game/envs/<EnvironmentName>.js`, named exactly as
`_environmentName` / `environmentName` appears in Info.dat (e.g. `TimbalandEnvironment.js`).
The game imports it dynamically when a map asks for that environment and falls back to the built-in
default environment if the file is missing or throws. These are **recreations made for this project**
(simple shapes, our own geometry) — never copy models, textures or code from the game or other projects.

```js
import { THREE, LightBank, MeshLight, GEO, tubeMatrix, trs, mergeStatic, sceneryMaterials, lightMaterial } from './kit.js';

export default {
  name: 'TimbalandEnvironment',      // Info.dat name
  label: 'Timbaland',                // shown in the UI
  // default colour scheme of the environment (hex strings), used when the map sets none
  colors: { left: '#…', right: '#…', envLeft: '#…', envRight: '#…', wall: '#…', envLeftBoost?: '#…', envRightBoost?: '#…' },
  build() {
    return {
      root,        // THREE.Object3D with all scenery + lights (the game adds it to the scene)
      banks,       // LightBank[] used (the runtime calls bank.update() once per frame)
      groups,      // { [eventType]: Light[] } — v2 basic event types with lights:
                   //   0 back lasers, 1 ring lights, 2 left lasers, 3 right lasers, 4 center lights,
                   //   6 / 7 extra left / right lights, 10 / 11 (BTS, Billie …), others if the env uses them.
                   //   ORDER MATTERS: Chroma lightID n addresses groups[type][n - 1] — follow the official
                   //   light ID order of the environment as closely as you can find out.
      rings,       // [{ type: 'small' | 'big', objects: Object3D[], step: degrees between rings,
                   //    zoom: { near: m, far: m } }] — event 8 rotates (each ring rotates around its local Z,
                   //    successive rings lag by `step`), event 9 toggles the zoom (spacing near/far along Z).
                   //    Ring lights are normally in groups[1]. Omit / [] if the environment has no rings.
      lasers,      // { left: Object3D[], right: Object3D[] } — event 12 / 13 laser speed: each object spins
                   //    around obj.userData.axis ('x' | 'y' | 'z', default 'z'); value = speed; random phase.
      update,      // optional (t, dt) => void for environment-specific idle animation (keep it cheap)
      dispose,     // () => void: free geometries / materials created in build()
    };
  },
};
```

## Coordinates
Metres. The player stands at the origin facing **-Z**; notes come from far -Z toward the player.
y = 0 is the floor. The game draws the note track, lane lines and the player platform itself
(about x ∈ [-1, 1], z ∈ [-1, +1] and the runway to z ≈ -40) — keep that area clear, don't build
another runway there, but build everything else (floor, towers, lasers, rings, logo shapes …).

## Lights
- A `Light` is something the runtime colours: `light.set(r, g, b)` (linear RGB, already × brightness;
  0,0,0 = off). Get them from `LightBank.add(matrix)` (instanced; **one draw call per bank**) or
  `new MeshLight(mesh)` for a light that must move on its own.
- Use `lightMaterial()` (additive: black = invisible) for glowing tubes / panels. A soft glow halo can
  be a second, wider bank with `lightMaterial({ opacity: 0.25 })` whose lights mirror the core lights
  (put both Light objects in the group array, or wrap them — the runtime only calls `set`).
- Static, non-light scenery: merge per material with `mergeStatic()`; materials from `sceneryMaterials()`.

## Budget (Meta Quest, 90 Hz, rendered twice for stereo)
≤ 25 draw calls and ≤ 40 k triangles per environment, no per-frame allocations, no textures larger
than 256², no real-time lights or shadows (the scene already has one hemisphere + one directional light).

## Preview
`dev/env-preview.html?env=TimbalandEnvironment` renders a module with a simple v2 lighting driver:
patterns (all on, per-group colours, light-ID chase, ring spin / zoom, laser speed) selectable with
`&pattern=` and an orbit / player camera. Use it for screenshots.
