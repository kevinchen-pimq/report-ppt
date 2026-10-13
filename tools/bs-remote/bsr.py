#!/usr/bin/env python3
"""Controller side of BS Remote: queue commands for the PC agent and collect the results.

  BSR_TOKEN=… python3 bsr.py status
  python3 bsr.py run ping
  python3 bsr.py run windows
  python3 bsr.py run screenshot '{"title":"LIV Output"}' --out shots/
  python3 bsr.py run pad '{"steps":[{"ly":0.5,"ms":400}],"shot_title":"LIV Output"}' --out shots/
  python3 bsr.py run shoot_at '{"times":[14,43,52],"title":"LIV Output"}' --out shots/
  python3 bsr.py blob bsr_agent.py agent/bsr_agent.py   (then: run agent_update)
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
    sub.add_parser('clear')
    a = ap.parse_args()
    if a.cmd == 'status':
        print(req('GET', '/status')[1].decode())
    elif a.cmd == 'run':
        run(a.type, json.loads(a.args), out=a.out, timeout=a.timeout)
    elif a.cmd == 'blob':
        print(req('PUT', f'/blob/{a.name}', open(a.file, 'rb').read(), ctype='application/octet-stream', timeout=300))
    elif a.cmd == 'clear':
        print(req('DELETE', '/queue')[1].decode())


if __name__ == '__main__':
    main()
