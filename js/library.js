// Song library shared by the 2D page and the in-VR menu.
// Songs are saved in the browser (see songCache.js) and survive reloads; only the
// few most recently opened songs keep their files in memory, the rest are "stubs"
// (title + cover) that load from storage when opened.
import { zipSync } from 'fflate';
import { filesFromZip, filesFromFileList, parseInfo, coverUrl, resolveColors, DIFF_NAMES } from './mapLoader.js';
import { parseDifficulty } from './beatmap.js';
import { latestVersion } from './beatsaver.js';
import { songCache, CACHE_LIMIT } from './songCache.js';
import { downloads } from './downloads.js';

const KEEP_LOADED = 3; // songs whose files stay in memory

export class Library {
  constructor() {
    this.entries = [];
    this.listeners = new Set();
    this.decoded = null; // { entry, buffer } — only the current song stays decoded
    this.limit = CACHE_LIMIT;
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(entry) {
    for (const fn of this.listeners) fn(entry);
  }

  /** Restores the songs saved in this browser. */
  async init() {
    const saved = await songCache.list();
    for (const meta of saved) {
      if (this.entries.some((e) => e.key === meta.key)) continue;
      const coverSrc = meta.cover ? URL.createObjectURL(new Blob([meta.cover], { type: meta.coverType || 'image/jpeg' })) : null;
      const entry = {
        key: meta.key,
        label: meta.label,
        beatsaverId: meta.beatsaverId,
        stub: true,
        cached: true,
        size: meta.size,
        lastUsed: meta.lastPlayed || meta.addedAt,
        summary: { title: meta.title, subTitle: meta.subTitle || '', artist: meta.artist, mapper: meta.mapper, bpm: meta.bpm, version: meta.version, sets: [] },
        coverSrc,
        coverImage: null,
      };
      entry.info = entry.summary;
      if (coverSrc) loadImage(coverSrc).then((img) => {
        entry.coverImage = img;
        this.emit(entry);
      });
      this.entries.push(entry);
    }
    this.emit(null);
  }

  has(key) {
    return this.entries.some((e) => e.key === key);
  }

  get totalSize() {
    return this.entries.reduce((n, e) => n + (e.cached ? e.size || 0 : 0), 0);
  }

  async addFiles(files, label, extra = {}, zip = null) {
    const info = parseInfo(files);
    const src = coverUrl(files, info);
    const coverImage = src ? await loadImage(src) : null;
    const key = extra.key || `${info.title}|${info.artist}|${info.mapper}|${label}`;
    const existing = this.entries.find((e) => e.key === key);
    if (existing) this.drop(existing);
    const summary = { title: info.title, subTitle: info.subTitle, artist: info.artist, mapper: info.mapper, bpm: info.bpm, version: info.version, sets: [] };
    const entry = { key, files, info, summary, coverSrc: src, coverImage, label, lastUsed: Date.now(), stub: false, cached: false, ...extra };
    this.entries.unshift(entry);
    this.emit(entry);
    this.save(entry, zip).catch((e) => console.warn('無法儲存歌曲', e));
    return entry;
  }

  /** Writes the song to browser storage, then trims the cache to its size limit. */
  async save(entry, zip) {
    const buffer = zip || zipSync(Object.fromEntries(entry.files.entries), { level: 0 }).buffer;
    const coverFile = entry.info.coverFile;
    const cover = entry.files.get(coverFile);
    const rec = await songCache.put(
      {
        key: entry.key,
        label: entry.label,
        beatsaverId: entry.beatsaverId || null,
        ...entry.summary,
        sets: undefined,
        cover: cover ? cover.slice() : null,
        coverType: /\.png$/i.test(coverFile || '') ? 'image/png' : 'image/jpeg',
      },
      buffer,
    );
    entry.cached = true;
    entry.size = rec.size;
    // keep memory bounded (e.g. while downloading a whole playlist)
    this.unloadOthers(this.decoded?.entry || entry);
    await this.evict(entry);
    this.emit(entry);
  }

  /** Removes least-recently-used songs until the cache fits its limit. */
  async evict(keep) {
    const order = this.entries.filter((e) => e.cached && e !== keep).sort((a, b) => a.lastUsed - b.lastUsed);
    while (this.totalSize > this.limit && order.length) await this.remove(order.shift());
  }

  /** Forgets a song in memory only. */
  drop(entry) {
    const i = this.entries.indexOf(entry);
    if (i >= 0) this.entries.splice(i, 1);
    if (entry.coverSrc) URL.revokeObjectURL(entry.coverSrc);
    if (this.decoded?.entry === entry) this.decoded = null;
  }

  /** Deletes a song from the library and from browser storage. */
  async remove(entry) {
    this.drop(entry);
    if (entry.cached) await songCache.remove(entry.key).catch(() => {});
    this.onRemove?.(entry);
    this.emit(null);
  }

  async clearAll() {
    for (const e of [...this.entries]) this.drop(e);
    await songCache.clear().catch(() => {});
    this.emit(null);
  }

  /** Makes sure a song's files are in memory (loading a saved song from storage). */
  async load(entry) {
    entry.lastUsed = Date.now();
    if (entry.stub) {
      const zip = await songCache.getZip(entry.key);
      if (!zip) throw new Error('找不到已儲存的歌曲檔，請重新下載');
      const files = await filesFromZip(zip);
      entry.files = files;
      entry.info = parseInfo(files);
      entry.stub = false;
    }
    if (entry.cached) songCache.touch(entry.key);
    this.unloadOthers(entry);
    return entry;
  }

  /** Frees the files of older songs (they stay listed and reload from storage). */
  unloadOthers(keep) {
    const loaded = this.entries
      .filter((e) => !e.stub && e.cached && e !== keep && e !== this.decoded?.entry)
      .sort((a, b) => b.lastUsed - a.lastUsed);
    for (const e of loaded.slice(KEEP_LOADED - 1)) {
      e.files = null;
      e.info = e.summary;
      e.stub = true;
    }
  }

  async addZip(buffer, label, extra) {
    const copy = buffer.slice(0); // kept for storage (unzipping may hand the original to a worker)
    return this.addFiles(await filesFromZip(buffer), label, extra, copy);
  }

  async addFileList(list, label) {
    return this.addFiles(await filesFromFileList(list), label);
  }

  /** The version of a map to download: the pinned one (hash) if it still exists, else the latest. */
  static versionFor(doc, hash = null) {
    return (hash && doc.versions?.find((x) => x.hash === hash.toLowerCase())) || latestVersion(doc);
  }

  /** Library key (= download job id) of a BeatSaver map, or null. */
  beatSaverKey(doc, hash = null) {
    const v = doc && Library.versionFor(doc, hash);
    return v ? `bs:${v.hash}` : null;
  }

  /**
   * Downloads a BeatSaver map document (from search / id lookup); reuses a saved copy.
   * Goes through the download manager (queue, pause / resume / cancel; see downloads.js).
   * opts: { group, label (default doc.name), cover (default the version's cover URL) }.
   * A cancelled download rejects with an Error named 'AbortError'.
   */
  async addBeatSaver(doc, onProgress, hash = null, opts = {}) {
    // a playlist may pin a specific version (hash); otherwise use the latest
    const v = Library.versionFor(doc, hash);
    if (!v) throw new Error('此譜面沒有可下載的版本');
    const key = `bs:${v.hash}`;
    const existing = this.entries.find((e) => e.key === key);
    if (existing) return this.load(existing);
    return downloads.start({
      id: key,
      url: v.downloadURL,
      label: opts.label ?? doc.name,
      cover: opts.cover ?? v.coverURL ?? null,
      group: opts.group ?? null,
      onProgress,
      then: (buf) => this.addZip(buf, `BeatSaver ${doc.id}`, { key, beatsaverId: doc.id }),
    });
  }

  isDownloaded(doc) {
    const v = latestVersion(doc);
    return !!v && this.has(`bs:${v.hash}`);
  }

  /** Decodes the entry's song (cached for the most recent entry). */
  async audioFor(entry, gameAudio) {
    if (this.decoded?.entry === entry) return this.decoded.buffer;
    const buffer = await gameAudio.decode(entry.files.get(entry.info.songFile));
    this.decoded = { entry, buffer };
    return buffer;
  }

  /** Parses one difficulty into a playable map plus display metadata. */
  loadDifficulty(entry, setIdx, diffIdx) {
    const { files, info } = entry;
    const set = info.sets[setIdx];
    const diff = set.diffs[diffIdx];
    const json = files.json(diff.file);
    const audioData = info.audioDataFile ? files.json(info.audioDataFile) : null;
    const lightshow = diff.lightshowFile ? files.json(diff.lightshowFile) : null;
    const map = parseDifficulty(json, { info, diff, audioData, lightshow });
    const meta = {
      title: info.title,
      subTitle: info.subTitle,
      artist: info.artist,
      mapper: info.mapper,
      characteristic: set.characteristic,
      difficultyName: diffName(diff),
      coverImage: entry.coverImage,
      colors: resolveColors(info, diff),
    };
    return { map, meta, set, diff };
  }
}

export function diffName(diff) {
  return diff.label || DIFF_NAMES[diff.difficulty] || diff.difficulty;
}

export function defaultSetIndex(info) {
  return Math.max(0, info.sets.findIndex((s) => s.characteristic === 'Standard'));
}

function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

export function mapStats(map) {
  const bombs = map.notes.filter((n) => n.kind === 'bomb').length;
  const nps = map.lastTime > 0 ? (map.colorNotes / map.lastTime).toFixed(2) : '0';
  return { bombs, nps };
}
