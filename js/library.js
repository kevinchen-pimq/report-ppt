// In-memory song library shared by the 2D page and the in-VR menu.
import { filesFromZip, filesFromFileList, parseInfo, coverUrl, resolveColors, DIFF_NAMES } from './mapLoader.js';
import { parseDifficulty } from './beatmap.js';
import { latestVersion, download } from './beatsaver.js';

const MAX_ENTRIES = 12;

export class Library {
  constructor() {
    this.entries = [];
    this.listeners = new Set();
    this.decoded = null; // { entry, buffer } — only the current song stays decoded
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(entry) {
    for (const fn of this.listeners) fn(entry);
  }

  async addFiles(files, label, extra = {}) {
    const info = parseInfo(files);
    const src = coverUrl(files, info);
    const coverImage = src ? await loadImage(src) : null;
    const key = extra.key || `${info.title}|${info.artist}|${info.mapper}|${label}`;
    const existing = this.entries.find((e) => e.key === key);
    if (existing) this.remove(existing);
    const entry = { key, files, info, coverSrc: src, coverImage, label, ...extra };
    this.entries.unshift(entry);
    while (this.entries.length > MAX_ENTRIES) this.remove(this.entries[this.entries.length - 1]);
    this.emit(entry);
    return entry;
  }

  remove(entry) {
    const i = this.entries.indexOf(entry);
    if (i >= 0) this.entries.splice(i, 1);
    if (entry.coverSrc) URL.revokeObjectURL(entry.coverSrc);
    if (this.decoded?.entry === entry) this.decoded = null;
  }

  async addZip(buffer, label, extra) {
    return this.addFiles(await filesFromZip(buffer), label, extra);
  }

  async addFileList(list, label) {
    return this.addFiles(await filesFromFileList(list), label);
  }

  /** Downloads a BeatSaver map document (from search / id lookup). */
  async addBeatSaver(doc, onProgress) {
    const v = latestVersion(doc);
    if (!v) throw new Error('此譜面沒有可下載的版本');
    const existing = this.entries.find((e) => e.key === `bs:${v.hash}`);
    if (existing) return existing;
    const buf = await download(v.downloadURL, onProgress);
    return this.addZip(buf, `BeatSaver ${doc.id}`, { key: `bs:${v.hash}`, beatsaverId: doc.id });
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
