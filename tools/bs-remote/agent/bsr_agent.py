#!/usr/bin/env python3
"""BS Remote PC agent (Windows). Pulls commands from the relay and runs them on this PC.

  python bsr_agent.py --token <TOKEN>            (first run; saved to bsr_agent.json next to this file)
  python bsr_agent.py                            (later runs)

Only the commands in HANDLERS exist: screenshots / recordings of windows (ffmpeg), a virtual Xbox
controller (vgamepad, e.g. to fly LIV's gamepad camera), song time from the DataPuller mod, starting /
stopping Beat Saber and downloading BeatSaver maps into CustomLevels. Nothing is written outside
CustomLevels and the agent's own folder. Needs Python 3.8+, ffmpeg in PATH, `pip install vgamepad`.
"""
import argparse
import base64
import json
import os
import platform
import re
import shutil
import socket
import subprocess
import sys
import time
import traceback
import urllib.error
import urllib.request
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
CONFIG = os.path.join(HERE, 'bsr_agent.json')
WORK = os.path.join(HERE, 'bsr_work')
DEFAULT_RELAY = 'https://bs-remote.pages.dev/api'
VERSION = '0.2.0'
UA = 'bsr-agent/' + VERSION


# ---------------------------------------------------------------------------------------------
# config / paths

def load_config(args):
    cfg = {}
    if os.path.exists(CONFIG):
        with open(CONFIG, encoding='utf-8') as f:
            cfg = json.load(f)
    if args.token:
        cfg['token'] = args.token
    if args.relay:
        cfg['relay'] = args.relay
    if args.game_dir:
        cfg['game_dir'] = args.game_dir
    cfg.setdefault('relay', DEFAULT_RELAY)
    if not cfg.get('game_dir'):
        cfg['game_dir'] = find_game_dir()
    if not cfg.get('token'):
        sys.exit('No token: run once with --token <TOKEN>')
    with open(CONFIG, 'w', encoding='utf-8') as f:
        json.dump(cfg, f, indent=2)
    return cfg


def find_game_dir():
    """Steam library folders -> .../steamapps/common/Beat Saber."""
    candidates = []
    for base in (os.environ.get('ProgramFiles(x86)', r'C:\Program Files (x86)'), os.environ.get('ProgramFiles', r'C:\Program Files')):
        vdf = os.path.join(base, 'Steam', 'steamapps', 'libraryfolders.vdf')
        if os.path.exists(vdf):
            with open(vdf, encoding='utf-8', errors='ignore') as f:
                for m in re.finditer(r'"path"\s+"([^"]+)"', f.read()):
                    candidates.append(m.group(1).replace('\\\\', '\\'))
        candidates.append(os.path.join(base, 'Steam'))
    for c in candidates:
        d = os.path.join(c, 'steamapps', 'common', 'Beat Saber')
        if os.path.exists(os.path.join(d, 'Beat Saber.exe')):
            return d
    return None


def game_path(cfg, *parts):
    if not cfg.get('game_dir'):
        raise RuntimeError('Beat Saber folder not found; run with --game-dir "<folder with Beat Saber.exe>"')
    return os.path.join(cfg['game_dir'], *parts)


# ---------------------------------------------------------------------------------------------
# relay

class Relay:
    def __init__(self, cfg):
        self.base = cfg['relay'].rstrip('/')
        self.token = cfg['token']

    def request(self, method, path, body=None, ctype='application/json', headers=None, timeout=60):
        h = {'Authorization': 'Bearer ' + self.token, 'User-Agent': UA}
        if headers:
            h.update(headers)
        data = None
        if body is not None:
            data = body if isinstance(body, (bytes, bytearray)) else json.dumps(body).encode('utf-8')
            h['Content-Type'] = ctype
        req = urllib.request.Request(self.base + path, data=data, method=method, headers=h)
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read(), r.headers.get('content-type', '')

    def next(self, info):
        status, body, _ = self.request('GET', '/next?wait=20', headers={'X-Agent-Info': info}, timeout=40)
        return json.loads(body) if status == 200 and body else None

    def upload(self, cmd_id, name, data, ctype):
        self.request('POST', f'/result/{cmd_id}?name={name}', data, ctype=ctype, timeout=300)

    def blob(self, name):
        _, body, _ = self.request('GET', f'/blob/{name}', timeout=300)
        return body


# ---------------------------------------------------------------------------------------------
# helpers

def game_running():
    if platform.system() != 'Windows':
        return False
    out = subprocess.run(['tasklist', '/FI', 'IMAGENAME eq Beat Saber.exe', '/NH'], capture_output=True, text=True).stdout
    return 'Beat Saber.exe' in out


def safe_name(s):
    return re.sub(r'[^\w.\-() ]', '_', s or '')[:100]


def io_bytes(b):
    import io
    return io.BytesIO(b)


def windows():
    """Visible top-level windows: [{title, rect: [l, t, r, b]}] (Windows only)."""
    if platform.system() != 'Windows':
        return []
    import ctypes
    from ctypes import wintypes
    user32 = ctypes.windll.user32
    found = []

    @ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    def cb(hwnd, _):
        if not user32.IsWindowVisible(hwnd):
            return True
        n = user32.GetWindowTextLengthW(hwnd)
        if n == 0:
            return True
        buf = ctypes.create_unicode_buffer(n + 1)
        user32.GetWindowTextW(hwnd, buf, n + 1)
        r = wintypes.RECT()
        user32.GetWindowRect(hwnd, ctypes.byref(r))
        if r.right - r.left > 50 and r.bottom - r.top > 50:
            found.append({'title': buf.value, 'rect': [r.left, r.top, r.right, r.bottom]})
        return True

    user32.EnumWindows(cb, 0)
    return found


def ffmpeg():
    ff = shutil.which('ffmpeg')
    if not ff:
        raise RuntimeError('ffmpeg not found in PATH (winget install Gyan.FFmpeg, then open a new terminal)')
    return ff


def grab_png(title=None):
    """One PNG frame of a window (by exact title) or of the whole desktop, via ffmpeg gdigrab."""
    src = f'title={title}' if title else 'desktop'
    proc = subprocess.run([ffmpeg(), '-loglevel', 'error', '-f', 'gdigrab', '-i', src, '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'png', '-'],
                          capture_output=True, timeout=30)
    if proc.returncode != 0 or not proc.stdout:
        raise RuntimeError('capture failed: ' + proc.stderr.decode('utf-8', 'replace')[-500:])
    return proc.stdout


# ---------------------------------------------------------------------------------------------
# virtual Xbox controller (vgamepad -> ViGEmBus), e.g. for LIV's "Gamepad" camera mode

_pad = None


def pad():
    global _pad
    if _pad is None:
        try:
            import vgamepad
        except ImportError:
            raise RuntimeError('vgamepad missing: pip install vgamepad (installs the ViGEmBus driver)')
        _pad = vgamepad.VX360Gamepad()
        time.sleep(0.5)  # let Windows / the app see the new controller
    return _pad


BUTTONS = ['A', 'B', 'X', 'Y', 'START', 'BACK', 'GUIDE', 'LEFT_SHOULDER', 'RIGHT_SHOULDER', 'LEFT_THUMB', 'RIGHT_THUMB',
           'DPAD_UP', 'DPAD_DOWN', 'DPAD_LEFT', 'DPAD_RIGHT']


def pad_state(p, step):
    import vgamepad
    p.reset()
    p.left_joystick_float(float(step.get('lx', 0)), float(step.get('ly', 0)))
    p.right_joystick_float(float(step.get('rx', 0)), float(step.get('ry', 0)))
    p.left_trigger_float(float(step.get('lt', 0)))
    p.right_trigger_float(float(step.get('rt', 0)))
    for b in step.get('buttons', []):
        b = b.upper()
        if b not in BUTTONS:
            raise ValueError(f'unknown button {b}')
        p.press_button(getattr(vgamepad.XUSB_BUTTON, 'XUSB_GAMEPAD_' + b))
    p.update()


# ---------------------------------------------------------------------------------------------
# song time from the DataPuller mod (optional): ws://127.0.0.1:2946/BSDataPuller/LiveData

class WS:
    """Minimal websocket client (text frames from the server), standard library only."""

    def __init__(self, host, port, path, timeout=5):
        self.s = socket.create_connection((host, port), timeout=timeout)
        key = base64.b64encode(os.urandom(16)).decode()
        self.s.sendall((f'GET {path} HTTP/1.1\r\nHost: {host}:{port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n'
                        f'Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n').encode())
        resp = b''
        while b'\r\n\r\n' not in resp:
            chunk = self.s.recv(1024)
            if not chunk:
                raise ConnectionError('websocket handshake failed')
            resp += chunk
        if b' 101 ' not in resp.split(b'\r\n')[0]:
            raise ConnectionError(resp.split(b'\r\n')[0].decode())
        self.buf = resp.split(b'\r\n\r\n', 1)[1]

    def _read(self, n):
        while len(self.buf) < n:
            chunk = self.s.recv(65536)
            if not chunk:
                raise ConnectionError('closed')
            self.buf += chunk
        out, self.buf = self.buf[:n], self.buf[n:]
        return out

    def recv(self):
        while True:
            b1, b2 = self._read(2)
            op, n = b1 & 0x0F, b2 & 0x7F
            if n == 126:
                n = int.from_bytes(self._read(2), 'big')
            elif n == 127:
                n = int.from_bytes(self._read(8), 'big')
            mask = self._read(4) if b2 & 0x80 else None
            data = self._read(n)
            if mask:
                data = bytes(c ^ mask[i % 4] for i, c in enumerate(data))
            if op == 1:
                return data.decode('utf-8', 'replace')
            if op == 8:
                raise ConnectionError('closed by server')

    def close(self):
        try:
            self.s.close()
        except Exception:
            pass


def live_data(timeout=5):
    ws = WS('127.0.0.1', 2946, '/BSDataPuller/LiveData', timeout=timeout)
    try:
        return json.loads(ws.recv())
    finally:
        ws.close()


# ---------------------------------------------------------------------------------------------
# commands: each returns (result dict, [(file name, bytes, content type)])

def cmd_ping(cfg, a):
    try:
        import vgamepad  # noqa: F401
        has_pad = True
    except Exception:
        has_pad = False
    try:
        live_data(timeout=1)
        datapuller = True
    except Exception:
        datapuller = False
    return {'ok': True, 'agent': VERSION, 'host': socket.gethostname(), 'game_dir': cfg.get('game_dir'),
            'game_running': game_running(), 'ffmpeg': bool(shutil.which('ffmpeg')), 'vgamepad': has_pad,
            'datapuller': datapuller, 'python': sys.version.split()[0]}, []


def cmd_windows(cfg, a):
    return {'ok': True, 'windows': windows()}, []


def cmd_screenshot(cfg, a):
    """PNG of a window ({title}) or the desktop; {count, interval} for a burst."""
    files = []
    for i in range(int(a.get('count', 1))):
        if i:
            time.sleep(float(a.get('interval', 0.5)))
        files.append((f'shot_{i:02d}.png', grab_png(a.get('title')), 'image/png'))
    return {'ok': True, 'count': len(files)}, files


def cmd_pad(cfg, a):
    """Virtual Xbox controller steps: [{lx, ly, rx, ry (-1..1), lt, rt (0..1), buttons: [...], ms}], then release.
    {shot_title / shot: true} takes a screenshot after the steps (window title or desktop)."""
    p = pad()
    for step in a.get('steps', []):
        pad_state(p, step)
        time.sleep(float(step.get('ms', 100)) / 1000)
    p.reset()
    p.update()
    files = []
    if a.get('shot') or a.get('shot_title'):
        time.sleep(float(a.get('settle', 0.3)))
        files.append(('shot.png', grab_png(a.get('shot_title')), 'image/png'))
    return {'ok': True, 'steps': len(a.get('steps', []))}, files


def cmd_song_time(cfg, a):
    d = live_data()
    return {'ok': True, 'live': d}, []


def cmd_shoot_at(cfg, a):
    """While a song plays (played, replayed or autoplayed), capture a window at song times (seconds).
    Needs DataPuller (LiveData.TimeElapsed counts whole seconds; the capture is taken right when it
    reaches floor(t), plus the fraction). {times: [...], title, timeout}"""
    times = sorted(float(t) for t in a['times'])
    title = a.get('title')
    deadline = time.time() + float(a.get('timeout', 600))
    ws = WS('127.0.0.1', 2946, '/BSDataPuller/LiveData', timeout=10)
    files, taken, last = [], [], None
    try:
        i = 0
        while i < len(times) and time.time() < deadline:
            d = json.loads(ws.recv())
            el = d.get('TimeElapsed')
            if el is None or el == last:
                continue
            last = el
            t = times[i]
            if el > t + 1:  # already past it (song started late): skip
                taken.append({'time': t, 'skipped': True, 'elapsed': el})
                i += 1
                continue
            if el == int(t):
                time.sleep(t - int(t))
                files.append((f'at_{t:07.2f}.png', grab_png(title), 'image/png'))
                taken.append({'time': t, 'elapsed': el})
                i += 1
    finally:
        ws.close()
    return {'ok': True, 'taken': taken}, files


def cmd_game_start(cfg, a):
    if game_running():
        return {'ok': True, 'already_running': True}, []
    exe = game_path(cfg, 'Beat Saber.exe')
    args = [exe] + (['fpfc'] if a.get('fpfc') else []) + list(a.get('extra_args', []))
    subprocess.Popen(args, cwd=cfg['game_dir'])
    t0 = time.time()
    while time.time() - t0 < a.get('timeout', 120):
        if any(w['title'] == 'Beat Saber' for w in windows()):
            return {'ok': True, 'seconds': round(time.time() - t0, 1)}, []
        time.sleep(2)
    return {'ok': game_running(), 'note': 'no "Beat Saber" window seen yet'}, []


def cmd_game_stop(cfg, a):
    subprocess.run(['taskkill', '/IM', 'Beat Saber.exe', '/F'], capture_output=True)
    t0 = time.time()
    while game_running() and time.time() - t0 < 30:
        time.sleep(1)
    return {'ok': not game_running()}, []


def cmd_map_download(cfg, a):
    """BeatSaver key -> CustomLevels/<key> (<name>). Returns the hash."""
    key = re.sub(r'[^0-9a-fA-F]', '', a['id'])
    req = urllib.request.Request(f'https://api.beatsaver.com/maps/id/{key}', headers={'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        info = json.loads(r.read())
    ver = info['versions'][0]
    name = safe_name(f"{key} ({info['metadata']['songName']} - {info['metadata']['levelAuthorName']})")
    dest = game_path(cfg, 'Beat Saber_Data', 'CustomLevels', name)
    if not os.path.isdir(dest):
        req = urllib.request.Request(ver['downloadURL'], headers={'User-Agent': UA})
        with urllib.request.urlopen(req, timeout=120) as r:
            data = r.read()
        tmp = dest + '.part'
        shutil.rmtree(tmp, ignore_errors=True)
        os.makedirs(tmp, exist_ok=True)
        with zipfile.ZipFile(io_bytes(data)) as z:
            for m in z.namelist():
                if m.endswith('/') or '..' in m or os.path.isabs(m):
                    continue
                with open(os.path.join(tmp, os.path.basename(m)), 'wb') as f:
                    f.write(z.read(m))
        os.replace(tmp, dest)
    diffs = [f"{d['characteristic']}/{d['difficulty']}" for d in ver.get('diffs', [])]
    return {'ok': True, 'hash': ver['hash'].upper(), 'folder': dest, 'name': info['name'], 'difficulties': diffs}, []


def cmd_record(cfg, a):
    """Record a window ({title}, default the desktop) with ffmpeg for N seconds."""
    out = os.path.join(WORK, 'record.mp4')
    os.makedirs(WORK, exist_ok=True)
    secs = float(a.get('seconds', 10))
    src = f"title={a['title']}" if a.get('title') else 'desktop'
    cmd = [ffmpeg(), '-y', '-loglevel', 'error', '-f', 'gdigrab', '-framerate', str(a.get('fps', 30)), '-i', src,
           '-t', str(secs), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', str(a.get('crf', 23)), '-pix_fmt', 'yuv420p', out]
    proc = subprocess.run(cmd, capture_output=True, timeout=secs + 120)
    if proc.returncode != 0:
        return {'ok': False, 'error': proc.stderr.decode('utf-8', 'replace')[-3000:]}, []
    with open(out, 'rb') as f:
        data = f.read()
    return {'ok': True, 'bytes': len(data)}, [('record.mp4', data, 'video/mp4')]


def log_tail(cfg, n=200):
    try:
        with open(game_path(cfg, 'Logs', '_latest.log'), encoding='utf-8', errors='replace') as f:
            return ''.join(f.readlines()[-n:])
    except Exception as e:
        return f'(no log: {e})'


def cmd_log(cfg, a):
    text = log_tail(cfg, int(a.get('lines', 200)))
    if a.get('grep'):
        text = '\n'.join(l for l in text.splitlines() if a['grep'].lower() in l.lower())
    return {'ok': True}, [('log.txt', text.encode('utf-8'), 'text/plain')]


def cmd_agent_update(cfg, a):
    """Replace this script with a new version from the relay and restart."""
    data = Relay(cfg).blob(a.get('blob', 'bsr_agent.py'))
    compile(data, 'bsr_agent.py', 'exec')  # refuse a broken file
    me = os.path.abspath(__file__)
    with open(me + '.new', 'wb') as f:
        f.write(data)
    os.replace(me + '.new', me)
    return {'ok': True, 'restarting': True}, []


HANDLERS = {
    'ping': cmd_ping,
    'windows': cmd_windows,
    'screenshot': cmd_screenshot,
    'pad': cmd_pad,
    'song_time': cmd_song_time,
    'shoot_at': cmd_shoot_at,
    'game_start': cmd_game_start,
    'game_stop': cmd_game_stop,
    'map_download': cmd_map_download,
    'record': cmd_record,
    'log': cmd_log,
    'agent_update': cmd_agent_update,
}


# ---------------------------------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--token')
    ap.add_argument('--relay')
    ap.add_argument('--game-dir')
    args = ap.parse_args()
    cfg = load_config(args)
    relay = Relay(cfg)
    print(f'BS Remote agent {VERSION}  relay={cfg["relay"]}  game={cfg.get("game_dir")}')
    print('Waiting for commands (Ctrl+C to stop)…')
    while True:
        try:
            info = f'{socket.gethostname()} v{VERSION} game={int(game_running())}'
            cmd = relay.next(info)
        except Exception as e:
            print('relay error:', e)
            time.sleep(5)
            continue
        if not cmd:
            continue
        t0 = time.time()
        print(time.strftime('%H:%M:%S'), cmd['type'], json.dumps(cmd.get('args', {}))[:160])
        files = []
        try:
            handler = HANDLERS.get(cmd['type'])
            if not handler:
                result = {'ok': False, 'error': f"unknown command {cmd['type']}"}
            else:
                result, files = handler(cfg, cmd.get('args') or {})
        except Exception as e:
            result = {'ok': False, 'error': repr(e), 'trace': traceback.format_exc()[-3000:]}
        result['seconds'] = round(time.time() - t0, 2)
        try:
            for name, data, ctype in files:
                relay.upload(cmd['id'], name, data, ctype)
            relay.upload(cmd['id'], 'result.json', json.dumps(result).encode('utf-8'), 'application/json')
        except Exception as e:
            print('upload error:', e)
        print('   ->', 'ok' if result.get('ok') else 'FAILED', result.get('error', '')[:200] if isinstance(result.get('error'), str) else '')
        if cmd['type'] == 'agent_update' and result.get('ok'):
            os.execv(sys.executable, [sys.executable, os.path.abspath(__file__)])


if __name__ == '__main__':
    main()
