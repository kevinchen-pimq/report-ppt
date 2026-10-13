#!/usr/bin/env python3
"""Controller side of BS Remote: queue commands for the PC agent and collect the results.

  BSR_TOKEN=… python3 bsr.py status
  python3 bsr.py run ping
  python3 bsr.py run mod '{"method":"GET","path":"/state"}'
  python3 bsr.py blob bsremote-src.zip mod.zip        (upload a file the agent can fetch)
  python3 bsr.py shoot --hash 2CC66… --diff ExpertPlus --times 14,43,52 --out shots/ \
      --pose '0,1.7,0 0,0,0 70'  --pose '0,4,-3 15,0,0 80'

Poses are "x,y,z rx,ry,rz fov" in Beat Saber (Unity) coordinates: x right, y up, z forward,
Euler degrees. The player stands at the origin, eyes about 1.7 m up.
"""
import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request

RELAY = os.environ.get('BSR_RELAY', 'https://bs-remote.pages.dev/api')


def token():
    t = os.environ.get('BSR_TOKEN')
    if not t and os.environ.get('BSR_TOKEN_FILE'):
        t = open(os.environ['BSR_TOKEN_FILE']).read().strip()
    if not t:
        sys.exit('set BSR_TOKEN or BSR_TOKEN_FILE')
    return t


def req(method, path, body=None, ctype='application/json', timeout=60):
    data = None
    h = {'Authorization': 'Bearer ' + token(), 'User-Agent': 'bsr-cli'}
    if body is not None:
        data = body if isinstance(body, bytes) else json.dumps(body).encode()
        h['Content-Type'] = ctype
    r = urllib.request.Request(RELAY + path, data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(r, timeout=timeout) as resp:
            return resp.status, resp.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def run(cmd_type, args=None, out=None, timeout=600, quiet=False):
    """Queue a command, wait for its result, download its files into `out`. Returns the result dict."""
    for attempt in range(5):
        status, body = req('POST', '/cmd', {'type': cmd_type, 'args': args or {}})
        if status == 200:
            break
        time.sleep(2 * (attempt + 1))
    else:
        raise RuntimeError(f'queue failed: {status} {body[:200]}')
    cid = json.loads(body)['id']
    t0 = time.time()
    while True:
        status, body = req('GET', f'/result/{cid}')
        if status == 200:
            res = json.loads(body)
            break
        if time.time() - t0 > timeout:
            raise TimeoutError(f'{cmd_type} ({cid}): no result after {timeout}s (agent offline?)')
        time.sleep(1.5)
    saved = []
    if out:
        os.makedirs(out, exist_ok=True)
        for f in res.get('files', []):
            if f['name'] == 'result.json':
                continue
            st, data = req('GET', f"/file/{cid}/{f['name']}", timeout=300)
            p = os.path.join(out, f"{cid}-{f['name']}")
            with open(p, 'wb') as fh:
                fh.write(data)
            saved.append(p)
    res['saved'] = saved
    if not quiet:
        print(json.dumps({k: v for k, v in res.items() if k not in ('log',)}, indent=1)[:4000])
        if res.get('log'):
            print(res['log'][-4000:])
    return res


def parse_pose(s):
    parts = s.split()
    pos = [float(v) for v in parts[0].split(',')]
    rot = [float(v) for v in parts[1].split(',')] if len(parts) > 1 else [0, 0, 0]
    pose = {'pos': pos, 'rot': rot}
    if len(parts) > 2:
        pose['fov'] = float(parts[2])
    return pose


def shoot(a):
    """For each song time: (re)start the level a few seconds before it, freeze there, capture every pose."""
    poses = [parse_pose(p) for p in a.pose] or [{'pos': [0, 1.7, 0], 'rot': [0, 0, 0], 'fov': 70}]
    hide = {k: True for k in ('notes', 'walls', 'ui', 'debris', 'particles', 'avatar', 'sabers')} if not a.show_objects else None
    times = sorted(float(t) for t in a.times.split(','))
    current = None  # song time we are frozen at (None: not in a level)
    index = []
    for t in times:
        if current is None or t < current + 0.05 or t - current > a.max_gap:
            play = {'hash': a.hash, 'characteristic': a.characteristic, 'difficulty': a.diff, 'start': max(0.0, t - a.lead), 'speed': 1, 'noFail': True}
            if a.environment:
                play['environment'] = a.environment
            r = run('mod', {'path': '/play', 'args': play, 'timeout': 120}, quiet=True)
            if not r.get('ok'):
                print('play failed:', r)
                return
        else:
            run('mod', {'path': '/resume'}, quiet=True)
        args = {'at': t, 'cam': a.cam, 'poses': poses, 'superSize': a.supersize, 'timeout': a.max_gap + a.lead + 30}
        if hide:
            args['hide'] = hide
        r = run('mod', {'path': '/shots', 'args': args, 'timeout': 240}, out=a.out, quiet=True)
        if not r.get('ok'):
            print('shots failed:', r)
            return
        current = r.get('songTime', t)
        for i, p in enumerate(r['saved']):
            index.append({'time': t, 'songTime': current, 'pose': poses[i] if i < len(poses) else None, 'file': p})
            print(f'{t:7.2f}s pose {i}: {p}')
    with open(os.path.join(a.out, 'index.json'), 'w') as f:
        json.dump(index, f, indent=1)
    run('mod', {'path': '/resume'}, quiet=True)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest='cmd', required=True)
    sub.add_parser('status')
    r = sub.add_parser('run')
    r.add_argument('type')
    r.add_argument('args', nargs='?', default='{}')
    r.add_argument('--out', default='bsr-out')
    r.add_argument('--timeout', type=float, default=600)
    b = sub.add_parser('blob')
    b.add_argument('name')
    b.add_argument('file')
    s = sub.add_parser('shoot')
    s.add_argument('--hash', required=True)
    s.add_argument('--diff', default='ExpertPlus')
    s.add_argument('--characteristic', default='Standard')
    s.add_argument('--environment')
    s.add_argument('--times', required=True, help='song seconds, comma separated')
    s.add_argument('--pose', action='append', default=[], help='"x,y,z rx,ry,rz fov"')
    s.add_argument('--cam', default='Remote')
    s.add_argument('--lead', type=float, default=6, help='start this many seconds before a time')
    s.add_argument('--max-gap', type=float, default=20, help='resume instead of restarting when the next time is this close')
    s.add_argument('--supersize', type=int, default=1)
    s.add_argument('--show-objects', action='store_true', help='keep notes / walls / HUD visible')
    s.add_argument('--out', default='bsr-shots')
    q = sub.add_parser('clear')
    a = ap.parse_args()
    if a.cmd == 'status':
        print(req('GET', '/status')[1].decode())
    elif a.cmd == 'run':
        run(a.type, json.loads(a.args), out=a.out, timeout=a.timeout)
    elif a.cmd == 'blob':
        print(req('PUT', f'/blob/{a.name}', open(a.file, 'rb').read(), ctype='application/octet-stream', timeout=300))
    elif a.cmd == 'shoot':
        shoot(a)
    elif a.cmd == 'clear':
        print(req('DELETE', '/queue')[1].decode())


if __name__ == '__main__':
    main()
