#!/usr/bin/env python3
"""BS Remote PC agent (Windows). Pulls commands from the relay and runs them on this PC.

  python bsr_agent.py --token <TOKEN>            (first run; saved to bsr_agent.json next to this file)
  python bsr_agent.py                            (later runs)

Only the commands in HANDLERS exist. Files are written only inside the Beat Saber folder
(CustomLevels, UserData/Camera2/Cameras, Plugins/BSRemote.dll) and the agent's own work folder.
Standard library only (Python 3.8+). ffmpeg (optional) is needed for `record`, the .NET SDK for `mod_build`.
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
import tempfile
import time
import traceback
import urllib.error
import urllib.request
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
CONFIG = os.path.join(HERE, 'bsr_agent.json')
WORK = os.path.join(HERE, 'bsr_work')
DEFAULT_RELAY = 'https://bs-remote.pages.dev/api'
MOD = 'http://127.0.0.1:6557'
VERSION = '0.1.0'
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

def mod_call(method, path, args=None, timeout=180):
    data = json.dumps(args or {}).encode('utf-8') if method != 'GET' else None
    req = urllib.request.Request(MOD + path, data=data, method=method, headers={'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read(), r.headers.get('content-type', '')
    except urllib.error.HTTPError as e:
        return e.code, e.read(), e.headers.get('content-type', '')


def mod_alive():
    try:
        status, _, _ = mod_call('GET', '/state', timeout=3)
        return status == 200
    except Exception:
        return False


def game_running():
    if platform.system() != 'Windows':
        return False
    out = subprocess.run(['tasklist', '/FI', 'IMAGENAME eq Beat Saber.exe', '/NH'], capture_output=True, text=True).stdout
    return 'Beat Saber.exe' in out


def safe_name(s):
    return re.sub(r'[^\w.\-() ]', '_', s or '')[:100]


# ---------------------------------------------------------------------------------------------
# commands: each returns (result dict, [(file name, bytes, content type)])

def cmd_ping(cfg, a):
    return {'ok': True, 'agent': VERSION, 'host': socket.gethostname(), 'game_dir': cfg.get('game_dir'),
            'game_running': game_running(), 'mod': mod_alive(), 'ffmpeg': bool(shutil.which('ffmpeg')),
            'dotnet': bool(shutil.which('dotnet')), 'python': sys.version.split()[0]}, []


def cmd_mod(cfg, a):
    """Forward to the BSRemote mod: {method, path, args}. PNG replies / base64 images become files."""
    status, body, ctype = mod_call(a.get('method', 'POST'), a['path'], a.get('args'), timeout=a.get('timeout', 180))
    if ctype.startswith('image/'):
        return {'ok': status == 200, 'status': status}, [('image.png', body, 'image/png')]
    try:
        data = json.loads(body)
    except Exception:
        return {'ok': False, 'status': status, 'raw': body[:2000].decode('utf-8', 'replace')}, []
    files = []
    for i, b64 in enumerate(data.pop('images', None) or []):
        files.append((f'shot_{i:02d}.png', base64.b64decode(b64), 'image/png'))
    data['status'] = status
    return data, files


def cmd_game_start(cfg, a):
    if game_running():
        return {'ok': True, 'already_running': True, 'mod': mod_alive()}, []
    exe = game_path(cfg, 'Beat Saber.exe')
    args = [exe] + (['fpfc'] if a.get('fpfc', True) else []) + list(a.get('extra_args', []))
    subprocess.Popen(args, cwd=cfg['game_dir'])
    t0 = time.time()
    while time.time() - t0 < a.get('timeout', 240):
        if mod_alive():
            status, body, _ = mod_call('GET', '/state', timeout=5)
            return {'ok': True, 'seconds': round(time.time() - t0, 1), 'state': json.loads(body)}, []
        time.sleep(2)
    return {'ok': False, 'error': 'game started but the BSRemote mod did not answer', 'log': log_tail(cfg, 60)}, []


def cmd_game_stop(cfg, a):
    subprocess.run(['taskkill', '/IM', 'Beat Saber.exe', '/F'], capture_output=True)
    t0 = time.time()
    while game_running() and time.time() - t0 < 30:
        time.sleep(1)
    return {'ok': not game_running()}, []


def cmd_map_download(cfg, a):
    """BeatSaver key -> CustomLevels/<key> (<name>). Returns the hash used by /play."""
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
        with zipfile.ZipFile(io_bytes(data)) as z:
            for m in z.namelist():
                if m.endswith('/') or '..' in m or os.path.isabs(m):
                    continue
                out = os.path.join(tmp, os.path.basename(m))
                os.makedirs(tmp, exist_ok=True)
                with open(out, 'wb') as f:
                    f.write(z.read(m))
        os.replace(tmp, dest)
    diffs = [f"{d['characteristic']}/{d['difficulty']}" for d in ver.get('diffs', [])]
    return {'ok': True, 'hash': ver['hash'].upper(), 'folder': dest, 'name': info['name'], 'difficulties': diffs}, []


def io_bytes(b):
    import io
    return io.BytesIO(b)


# Camera2 camera used for remote shots: positionable, full window, on top, objects hidden.
DEFAULT_CAMERA = {
    'type': 'Positionable',
    'worldCamVisibility': 'Hidden',
    'FOV': 70,
    'layer': 100,
    'renderScale': 1.0,
    'antiAliasing': 4,
    'viewRect': {'x': 0, 'y': 0, 'width': 1, 'height': 1, 'locked': True},
    'targetPos': {'x': 0, 'y': 1.7, 'z': 0},
    'targetRot': {'x': 0, 'y': 0, 'z': 0},
    'visibleObjects': {'Walls': 'Hidden', 'Debris': False, 'UI': False, 'Avatar': 'Hidden', 'Floor': True,
                       'CutParticles': False, 'Notes': 'Hidden', 'EverythingElse': True},
}


def cmd_camera_file(cfg, a):
    """Write a Camera2 camera config (read by Camera2 when the game starts)."""
    name = safe_name(a.get('name', 'Remote'))
    d = game_path(cfg, 'UserData', 'Camera2', 'Cameras')
    os.makedirs(d, exist_ok=True)
    path = os.path.join(d, name + '.json')
    if a.get('read_only'):
        files = sorted(os.listdir(d)) if os.path.isdir(d) else []
        content = {f: open(os.path.join(d, f), encoding='utf-8').read() for f in files if f.endswith('.json')}
        return {'ok': True, 'files': content}, []
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(a.get('config') or DEFAULT_CAMERA, f, indent=2)
    return {'ok': True, 'path': path, 'note': 'Camera2 reads camera files at game start'}, []


def cmd_mod_build(cfg, a):
    """Download the mod source zip from the relay, dotnet build it, install the dll (game must be closed)."""
    if not shutil.which('dotnet'):
        return {'ok': False, 'error': 'dotnet not found: install the .NET SDK (https://dotnet.microsoft.com/download)'}, []
    src = os.path.join(WORK, 'mod-src')
    shutil.rmtree(src, ignore_errors=True)
    os.makedirs(src, exist_ok=True)
    with zipfile.ZipFile(io_bytes(Relay(cfg).blob(a.get('blob', 'bsremote-src.zip')))) as z:
        z.extractall(src)
    proc = subprocess.run(['dotnet', 'build', '-c', 'Release', f"-p:BeatSaberDir={cfg['game_dir']}", '-nologo'],
                          cwd=src, capture_output=True, text=True)
    log = (proc.stdout + proc.stderr)[-12000:]
    if proc.returncode != 0:
        return {'ok': False, 'error': 'build failed', 'log': log}, []
    dll = os.path.join(src, 'bin', 'Release', 'BSRemote.dll')
    installed = False
    if a.get('install', True):
        if game_running():
            return {'ok': True, 'built': True, 'installed': False, 'note': 'game is running: stop it, then build again to install', 'log': log[-3000:]}, []
        shutil.copy2(dll, game_path(cfg, 'Plugins', 'BSRemote.dll'))
        installed = True
    return {'ok': True, 'built': True, 'installed': installed, 'log': log[-3000:]}, []


def cmd_record(cfg, a):
    """Record the Beat Saber window with ffmpeg for N seconds (optionally starting the mod's /resume)."""
    ff = shutil.which('ffmpeg')
    if not ff:
        return {'ok': False, 'error': 'ffmpeg not found in PATH'}, []
    out = os.path.join(WORK, 'record.mp4')
    os.makedirs(WORK, exist_ok=True)
    secs = float(a.get('seconds', 10))
    cmd = [ff, '-y', '-f', 'gdigrab', '-framerate', str(a.get('fps', 30)), '-i', 'title=Beat Saber',
           '-t', str(secs), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', str(a.get('crf', 23)), '-pix_fmt', 'yuv420p', out]
    proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    if a.get('resume'):
        time.sleep(0.5)
        mod_call('POST', '/resume')
    _, err = proc.communicate(timeout=secs + 60)
    if proc.returncode != 0:
        return {'ok': False, 'error': err.decode('utf-8', 'replace')[-3000:]}, []
    with open(out, 'rb') as f:
        data = f.read()
    return {'ok': True, 'bytes': len(data)}, [('record.mp4', data, 'video/mp4')]


def log_tail(cfg, n=200):
    try:
        p = game_path(cfg, 'Logs', '_latest.log')
        with open(p, encoding='utf-8', errors='replace') as f:
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
    'mod': cmd_mod,
    'game_start': cmd_game_start,
    'game_stop': cmd_game_stop,
    'map_download': cmd_map_download,
    'camera_file': cmd_camera_file,
    'mod_build': cmd_mod_build,
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
            info = f'{socket.gethostname()} v{VERSION} game={int(game_running())} mod={int(mod_alive())}'
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
