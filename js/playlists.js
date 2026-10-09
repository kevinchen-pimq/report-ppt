// Playlists: Beat Saber .bplist files and BeatSaver online playlists.
// Saved in the browser next to the songs; songs download on demand.
import { songCache } from './songCache.js';
import { fetchPlaylist, mapsByHashes, mapById, latestVersion } from './beatsaver.js';

function imageDataUrl(image) {
  if (!image || typeof image !== 'string') return null;
  if (image.startsWith('data:')) return image;
  const b64 = image.replace(/^base64,/, '');
  const type = b64.startsWith('iVBOR') ? 'image/png' : 'image/jpeg';
  return `data:${type};base64,${b64}`;
}

export class Playlists {
  constructor(library) {
    this.library = library;
    this.items = [];
    this.docs = new Map(); // hash -> BeatSaver map doc (null = not found)
    this.missingKeys = new Set(); // key-only songs not found on BeatSaver
    this.listeners = new Set();
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit() {
    for (const fn of this.listeners) fn();
  }

  async init() {
    this.items = await songCache.listPlaylists();
    this.emit();
  }

  async save(pl) {
    const i = this.items.findIndex((x) => x.id === pl.id);
    if (i >= 0) this.items.splice(i, 1);
    this.items.unshift(pl);
    this.emit();
    await songCache.putPlaylist(pl).catch((e) => console.warn('無法儲存歌單', e));
    return pl;
  }

  async remove(pl) {
    this.items = this.items.filter((x) => x.id !== pl.id);
    this.emit();
    await songCache.removePlaylist(pl.id).catch(() => {});
  }

  /** Imports a .bplist (JSON text). */
  async importBplist(text, fileName = '') {
    let data;
    try {
      data = JSON.parse(String(text).replace(/^﻿/, ''));
    } catch (e) {
      throw new Error('不是有效的 .bplist 歌單檔');
    }
    const songs = (data.songs || [])
      .map((s) => ({ hash: (s.hash || '').toLowerCase() || null, key: s.key || null, name: s.songName || s.name || '', mapper: s.levelAuthorName || '' }))
      .filter((s) => s.hash || s.key);
    if (!songs.length) throw new Error('歌單裡沒有歌曲');
    const title = data.playlistTitle || fileName.replace(/\.bplist$/i, '') || '未命名歌單';
    const syncURL = data.customData?.syncURL || '';
    const bsId = (syncURL.match(/playlists\/id\/(\d+)/) || [])[1] || null;
    return this.save({
      id: bsId ? `bsp:${bsId}` : `bp:${title}|${songs.length}|${songs[0].hash || songs[0].key}`,
      source: 'bplist',
      bsId,
      title,
      author: data.playlistAuthor || '',
      description: data.playlistDescription || '',
      cover: imageDataUrl(data.image),
      songs,
      addedAt: Date.now(),
    });
  }

  /** Imports a BeatSaver playlist by id (all its maps). */
  async importBeatSaver(id) {
    const { playlist, maps } = await fetchPlaylist(id);
    const songs = [];
    for (const doc of maps) {
      const v = latestVersion(doc);
      if (!v) continue;
      this.docs.set(v.hash, doc);
      songs.push({ hash: v.hash, key: doc.id, name: doc.name, mapper: doc.metadata?.levelAuthorName || '' });
    }
    return this.save({
      id: `bsp:${id}`,
      source: 'beatsaver',
      bsId: String(id),
      title: playlist?.name || `BeatSaver 歌單 ${id}`,
      author: playlist?.owner?.name || '',
      description: playlist?.description || '',
      cover: playlist?.playlistImage || null,
      // playlist images can't be drawn in VR (no CORS); a song cover can
      coverAlt: maps[0] ? latestVersion(maps[0])?.coverURL || null : null,
      songs,
      addedAt: Date.now(),
    });
  }

  /** Fetches BeatSaver data (name, cover, versions) for the songs that lack it. */
  async resolve(pl) {
    const missing = pl.songs.filter((s) => s.hash && !this.docs.has(s.hash)).map((s) => s.hash);
    if (missing.length) {
      const found = await mapsByHashes(missing);
      for (const h of missing) this.docs.set(h, found.get(h) || null);
    }
    let changed = false;
    for (const s of pl.songs) {
      if (s.hash || !s.key || this.missingKeys.has(s.key)) continue;
      try {
        const doc = await mapById(s.key);
        s.hash = latestVersion(doc)?.hash || null;
        if (s.hash) {
          this.docs.set(s.hash, doc);
          changed = true;
        } else this.missingKeys.add(s.key);
      } catch (e) {
        this.missingKeys.add(s.key);
      }
    }
    if (!pl.coverAlt) {
      const doc = pl.songs.map((s) => this.docFor(s)).find(Boolean);
      pl.coverAlt = doc ? latestVersion(doc)?.coverURL || null : null;
      changed = changed || !!pl.coverAlt;
    }
    // remember the hashes found for key-only songs and the fallback cover
    if (changed) await songCache.putPlaylist(pl).catch(() => {});
    this.emit();
  }

  /** BeatSaver doc of a song: undefined = not looked up yet, null = not on BeatSaver. */
  docFor(song) {
    if (!song.hash) return this.missingKeys.has(song.key) ? null : undefined;
    return this.docs.get(song.hash);
  }

  isDownloaded(song) {
    if (!song.hash) return false;
    if (this.library.has(`bs:${song.hash}`)) return true;
    // the pinned version may be gone from BeatSaver; then the latest one is downloaded
    const doc = this.docs.get(song.hash);
    const v = doc && !doc.versions?.some((x) => x.hash === song.hash) ? latestVersion(doc) : null;
    return !!v && this.library.has(`bs:${v.hash}`);
  }

  /** Downloads (or loads the saved copy of) one playlist song; returns the library entry. */
  async getSong(song, onProgress) {
    const doc = this.docFor(song);
    if (!doc) throw new Error(`BeatSaver 上找不到「${song.name || song.hash}」`);
    return this.library.addBeatSaver(doc, onProgress, song.hash);
  }

  /** Downloads every song not saved yet; onProgress(done, total, song). */
  async downloadAll(pl, onProgress) {
    await this.resolve(pl);
    const todo = pl.songs.filter((s) => this.docFor(s) && !this.isDownloaded(s));
    let done = 0;
    let failed = 0;
    for (const s of todo) {
      onProgress?.(done, todo.length, s);
      try {
        await this.getSong(s);
      } catch (e) {
        failed++;
      }
      done++;
    }
    onProgress?.(done, todo.length, null);
    return { downloaded: done - failed, failed, total: todo.length };
  }
}
