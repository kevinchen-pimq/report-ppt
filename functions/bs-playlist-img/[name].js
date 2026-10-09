// Cloudflare Pages Function: /bs-playlist-img/<id>.jpg
// BeatSaver serves playlist images without a CORS header, so the VR menu (which
// draws covers into a WebGL texture) can't use them directly. This fetches the
// image from BeatSaver and hands it back with permission to use it.
// Only BeatSaver playlist images are allowed (not a general proxy).
export async function onRequestGet({ params }) {
  const m = /^(\d{1,10})\.(jpg|jpeg|png|webp)$/.exec(String(params.name));
  if (!m) return new Response('Bad request', { status: 400 });
  const upstream = await fetch(`https://cfcdn.beatsaver.com/playlist/${m[1]}.${m[2]}`, {
    cf: { cacheEverything: true, cacheTtl: 86400 },
  });
  const type = upstream.headers.get('content-type') || '';
  if (!upstream.ok || !type.startsWith('image/')) {
    return new Response('Not found', { status: upstream.status === 404 ? 404 : 502, headers: { 'access-control-allow-origin': '*' } });
  }
  return new Response(upstream.body, {
    headers: {
      'content-type': type,
      'access-control-allow-origin': '*',
      'cache-control': 'public, max-age=86400',
      'x-content-type-options': 'nosniff',
    },
  });
}
