// Relay between the controller (Claude's CLI, bsr.py) and the PC agent (bsr_agent.py).
// Everything lives in the R2 bucket (strongly consistent):
//   q/<time>-<id>.json      queued commands (oldest first)
//   run/<id>.json           commands handed to the agent
//   res/<id>/<name>         result files; res/<id>/result.json marks the command as done
//   blob/<name>             files for the agent (mod source zip …)
//   agent/last.json         the agent's last poll (time + info)
// Every request needs the token: "Authorization: Bearer <TOKEN>" or ?t=<TOKEN>.

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const safe = (s) => /^[\w.\-]{1,120}$/.test(s || '');

async function nextCommand(B) {
  const list = await B.list({ prefix: 'q/', limit: 5 });
  for (const o of list.objects) {
    const obj = await B.get(o.key);
    await B.delete(o.key);
    if (!obj) continue; // taken by a parallel poll
    const cmd = await obj.json();
    await B.put(`run/${cmd.id}.json`, JSON.stringify({ ...cmd, started: Date.now() }));
    return cmd;
  }
  return null;
}

export async function onRequest({ request, env, params }) {
  const url = new URL(request.url);
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '') || url.searchParams.get('t');
  if (!env.TOKEN || token !== env.TOKEN) return json({ error: 'unauthorized' }, 401);
  const B = env.BUCKET;
  const path = params.path || [];
  const [route, a, b] = path;
  const m = request.method;

  if (route === 'cmd' && m === 'POST') {
    const body = await request.json();
    if (!body || typeof body.type !== 'string') return json({ error: 'type required' }, 400);
    const id = crypto.randomUUID().slice(0, 8);
    const cmd = { id, type: body.type, args: body.args || {}, queued: Date.now() };
    await B.put(`q/${String(Date.now()).padStart(13, '0')}-${id}.json`, JSON.stringify(cmd));
    return json({ id });
  }

  if (route === 'next' && m === 'GET') {
    const info = request.headers.get('x-agent-info') || '';
    await B.put('agent/last.json', JSON.stringify({ t: Date.now(), info }));
    const wait = Math.min(25, Math.max(0, Number(url.searchParams.get('wait')) || 0)) * 1000;
    const t0 = Date.now();
    for (;;) {
      const cmd = await nextCommand(B);
      if (cmd) return json(cmd);
      if (Date.now() - t0 >= wait) return new Response(null, { status: 204 });
      await sleep(1000);
    }
  }

  if (route === 'result' && safe(a)) {
    if (m === 'POST') {
      const name = url.searchParams.get('name') || 'result.json';
      if (!safe(name)) return json({ error: 'bad name' }, 400);
      await B.put(`res/${a}/${name}`, request.body, { httpMetadata: { contentType: request.headers.get('content-type') || 'application/octet-stream' } });
      return json({ ok: true });
    }
    const res = await B.get(`res/${a}/result.json`);
    if (!res) {
      const run = await B.head(`run/${a}.json`);
      return json({ pending: true, started: !!run }, 202);
    }
    const files = (await B.list({ prefix: `res/${a}/` })).objects.map((o) => ({ name: o.key.split('/').pop(), size: o.size }));
    return json({ ...(await res.json()), files });
  }

  if (route === 'file' && safe(a) && safe(b)) {
    const obj = await B.get(`res/${a}/${b}`);
    if (!obj) return json({ error: 'not found' }, 404);
    return new Response(obj.body, { headers: { 'content-type': obj.httpMetadata?.contentType || 'application/octet-stream' } });
  }

  if (route === 'blob' && safe(a)) {
    if (m === 'PUT') {
      await B.put(`blob/${a}`, request.body);
      return json({ ok: true });
    }
    const obj = await B.get(`blob/${a}`);
    if (!obj) return json({ error: 'not found' }, 404);
    return new Response(obj.body, { headers: { 'content-type': 'application/octet-stream' } });
  }

  if (route === 'status' && m === 'GET') {
    const last = await B.get('agent/last.json');
    const q = await B.list({ prefix: 'q/' });
    const agent = last ? await last.json() : null;
    return json({ agent, agentSeenSecondsAgo: agent ? Math.round((Date.now() - agent.t) / 1000) : null, queued: q.objects.length });
  }

  if (route === 'queue' && m === 'DELETE') {
    const q = await B.list({ prefix: 'q/' });
    for (const o of q.objects) await B.delete(o.key);
    return json({ cleared: q.objects.length });
  }

  return json({ error: 'no such route' }, 404);
}
