// Minimal BeatSaver API client (the API and CDN both allow CORS).
const API = 'https://api.beatsaver.com';

export async function searchMaps(query, page = 0, sortOrder = 'Relevance') {
  const params = new URLSearchParams({ sortOrder });
  if (query) params.set('q', query);
  const res = await fetch(`${API}/search/text/${page}?${params}`);
  if (!res.ok) throw new Error(`BeatSaver 搜尋失敗 (${res.status})`);
  const data = await res.json();
  return data.docs || [];
}

export async function mapById(id) {
  const clean = String(id).trim().replace(/^!bsr\s+/i, '').replace(/^.*\/maps\//, '');
  const res = await fetch(`${API}/maps/id/${encodeURIComponent(clean)}`);
  if (res.status === 404) throw new Error(`找不到 BeatSaver 譜面 ${clean}`);
  if (!res.ok) throw new Error(`BeatSaver 讀取失敗 (${res.status})`);
  return res.json();
}

export function latestVersion(map) {
  const versions = map.versions || [];
  return versions.find((v) => v.state === 'Published') || versions[0];
}

/** Downloads a URL into an ArrayBuffer, reporting progress (0..1). */
export async function download(url, onProgress) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`下載失敗 (${res.status})`);
  const total = Number(res.headers.get('content-length')) || 0;
  if (!res.body || !total) return res.arrayBuffer();
  const reader = res.body.getReader();
  const chunks = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    onProgress?.(received / total);
  }
  const out = new Uint8Array(received);
  let pos = 0;
  for (const c of chunks) {
    out.set(c, pos);
    pos += c.length;
  }
  return out.buffer;
}
