# BS Remote

Remote screenshots / recordings of the real Beat Saber (PC) to compare our environment lighting
against, without any game mod of our own: the camera is LIV's virtual camera in its "Gamepad"
mode, flown with a virtual Xbox controller.

| Part | Where | What |
|---|---|---|
| `relay/` | Cloudflare Pages `bs-remote` + R2 bucket `bs-remote` | command queue and result files, token protected (`TOKEN` secret) |
| `agent/bsr_agent.py` | the PC with Beat Saber + LIV | polls the relay, runs a fixed set of commands, uploads results |
| `bsr.py` | controller CLI (`BSR_TOKEN` / `BSR_TOKEN_FILE`) | queue a command, wait, download its files |

Setup steps for the PC are on https://bs-remote.pages.dev/. `./deploy.sh` publishes the relay
(with the agent script as a download) and uploads the agent for `agent_update`.

## Agent commands

| type | args | does |
|---|---|---|
| `ping` | | agent / game / ffmpeg / vgamepad / DataPuller status |
| `windows` | | visible window titles and rectangles (to find LIV's output window) |
| `screenshot` | `title` (default desktop), `count`, `interval` | PNG via ffmpeg gdigrab |
| `pad` | `steps: [{lx, ly, rx, ry, lt, rt, buttons, ms}]`, `shot_title` / `shot` | virtual Xbox 360 pad (vgamepad / ViGEmBus); sticks −1..1, triggers 0..1; released after the steps |
| `song_time` | | one LiveData message from DataPuller (ws://127.0.0.1:2946) |
| `shoot_at` | `times`, `title`, `timeout` | while a song plays, captures at each song time (DataPuller TimeElapsed) |
| `record` | `seconds`, `fps`, `title` | H.264 recording via ffmpeg |
| `game_start` / `game_stop` | `fpfc`, `extra_args` | |
| `map_download` | `id` (BeatSaver key) | into CustomLevels; returns the hash |
| `log` | `lines`, `grep` | tail of `Logs/_latest.log` |
| `agent_update` | `blob` | replaces the agent script and restarts it |
