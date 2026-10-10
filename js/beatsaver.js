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

// ---------------------------------------------------------------------------
// Playlists

export async function searchPlaylists(query, page = 0, sortOrder = 'Relevance') {
  const params = new URLSearchParams({ sortOrder });
  if (query) params.set('q', query);
  const res = await fetch(`${API}/playlists/search/${page}?${params}`);
  if (!res.ok) throw new Error(`BeatSaver 歌單搜尋失敗 (${res.status})`);
  return (await res.json()).docs || [];
}

/** Playlist id from "123", a playlist page URL or an API URL. */
export function parsePlaylistId(text) {
  const m = String(text).trim().match(/(?:playlists\/(?:id\/)?)?(\d+)\D*$/);
  return m ? m[1] : null;
}

/** A BeatSaver playlist with all its maps: { playlist, maps: [mapDoc] }. */
export async function fetchPlaylist(id) {
  let playlist = null;
  const maps = [];
  for (let page = 0; page < 50; page++) {
    const res = await fetch(`${API}/playlists/id/${encodeURIComponent(id)}/${page}`);
    if (res.status === 404) throw new Error(`找不到 BeatSaver 歌單 ${id}`);
    if (!res.ok) throw new Error(`讀取歌單失敗 (${res.status})`);
    const data = await res.json();
    playlist = playlist || data.playlist;
    const batch = (data.maps || []).map((m) => m.map).filter(Boolean);
    maps.push(...batch);
    if (!batch.length || batch.length < 20) break;
  }
  return { playlist, maps };
}

/** Looks up maps by hash (50 per request). Returns Map(hash -> doc). */
export async function mapsByHashes(hashes) {
  const out = new Map();
  const list = [...new Set(hashes.map((h) => h.toLowerCase()))];
  for (let i = 0; i < list.length; i += 50) {
    const chunk = list.slice(i, i + 50);
    const res = await fetch(`${API}/maps/hash/${chunk.join(',')}`);
    if (!res.ok && res.status !== 404) throw new Error(`查詢歌曲失敗 (${res.status})`);
    if (!res.ok) continue;
    const data = await res.json();
    if (chunk.length === 1) {
      if (data && data.id) out.set(chunk[0], data);
    } else {
      for (const [h, doc] of Object.entries(data || {})) if (doc && doc.id) out.set(h.toLowerCase(), doc);
    }
  }
  return out;
}

export function latestVersion(map) {
  const versions = map.versions || [];
  return versions.find((v) => v.state === 'Published') || versions[0];
}

/**
 * Downloads a URL into an ArrayBuffer, reporting progress (0..1).
 * options (all optional, used by the download manager):
 *   signal  — AbortSignal to cancel the transfer
 *   gate    — called before each read; may return a promise that holds the read
 *             back (pause) and resolves to continue or rejects to stop
 *   onBytes — onBytes(received, total) after each chunk (total 0 = unknown)
 */
export async function download(url, onProgress, { signal, gate, onBytes } = {}) {
  const res = await fetch(url, signal ? { signal } : undefined);
  if (!res.ok) throw new Error(`下載失敗 (${res.status})`);
  const total = Number(res.headers.get('content-length')) || 0;
  if (!res.body || (!total && !gate && !onBytes)) {
    const buf = await res.arrayBuffer();
    onBytes?.(buf.byteLength, total || buf.byteLength);
    return buf;
  }
  const reader = res.body.getReader();
  const chunks = [];
  let received = 0;
  try {
    for (;;) {
      const wait = gate?.();
      if (wait) await wait;
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      onBytes?.(received, total);
      if (total) onProgress?.(Math.min(1, received / total));
    }
  } catch (e) {
    reader.cancel().catch(() => {});
    throw e;
  }
  const out = new Uint8Array(received);
  let pos = 0;
  for (const c of chunks) {
    out.set(c, pos);
    pos += c.length;
  }
  return out.buffer;
}
