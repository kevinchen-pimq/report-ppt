# BS Remote

Remote screenshots / recordings of the real Beat Saber (PC, 1.29) to compare our environment
lighting against. Three parts:

| Part | Where | What |
|---|---|---|
| `relay/` | Cloudflare Pages `bs-remote` + R2 bucket `bs-remote` | command queue and result files, token protected (`TOKEN` secret) |
| `agent/bsr_agent.py` | the PC with Beat Saber | polls the relay, runs a fixed set of commands, uploads results |
| `mod/` (BSRemote) | `Beat Saber/Plugins/BSRemote.dll` | HTTP on `127.0.0.1:6557` inside the game: Camera2 pose override, start a level at a song time, freeze, capture |

`bsr.py` is the controller CLI (`BSR_TOKEN` / `BSR_TOKEN_FILE`). Setup steps for the PC are on
https://bs-remote.pages.dev/. `./deploy.sh` publishes the relay (with the agent script as a
download) and uploads the mod source for the agent's `mod_build` command.

## Agent commands

| type | args | does |
|---|---|---|
| `ping` | | agent / game / mod / tool status |
| `game_start` | `fpfc` (default true), `extra_args` | starts Beat Saber, waits until the mod answers |
| `game_stop` | | kills Beat Saber |
| `map_download` | `id` (BeatSaver key) | into CustomLevels; returns the hash |
| `camera_file` | `name`, `config` (default: full-window positionable "Remote" cam), `read_only` | Camera2 camera JSON (read at game start) |
| `mod_build` | `blob`, `install` | dotnet build of the uploaded source, copies the dll into Plugins (game closed) |
| `mod` | `method`, `path`, `args` | forwards to the mod (below); PNG / base64 images come back as files |
| `record` | `seconds`, `fps`, `resume` | ffmpeg gdigrab of the game window |
| `log` | `lines`, `grep` | tail of `Logs/_latest.log` |
| `agent_update` | `blob` | replaces the agent script and restarts it |

## Mod endpoints

| path | args | |
|---|---|---|
| `/state` | | scenes, song time, frozen, Camera2 cameras |
| `/environments` | | EnvironmentInfoSO names |
| `/settings` | | player settings (e.g. effects filter presets that dim lights) |
| `/play` | `hash` or `levelId`, `characteristic`, `difficulty`, `start`, `speed`, `environment`, `noFail` | starts the level through MenuTransitionsHelper with practice settings |
| `/freeze` | `at` | waits for the song time, then pauses audio and sets Time.timeScale = 0 |
| `/resume` | | undoes /freeze |
| `/camera` | `cam`, `pos`, `rot`, `fov`, `hide{notes,walls,ui,debris,particles,avatar,sabers}` | Camera2 OverrideToken |
| `/camera/release` | `cam` | |
| `/screenshot` | `superSize` | PNG of the game window |
| `/shots` | `at`, `cam`, `hide`, `poses[]`, `superSize` | freeze + one capture per pose (base64 PNGs) |
| `/menu` | | back to the menu |
| `/refresh-songs` | | SongCore reload (after map_download) |

Coordinates are Unity's (x right, y up, z forward; Euler degrees). In our three.js scenes z is
negated: Unity (x, y, z) = ours (x, y, -z).
