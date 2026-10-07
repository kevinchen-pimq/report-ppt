// Loads a Beat Saber map (zip archive or folder) and parses Info.dat.
// Supports Info.dat v2.x and v4.x formats.
import { unzip, unzipSync, strFromU8 } from 'fflate';

const DIFF_ORDER = ['Easy', 'Normal', 'Hard', 'Expert', 'ExpertPlus'];

// A case-insensitive virtual file system rooted at the folder containing Info.dat
export class MapFiles {
  constructor(entries) {
    // entries: Map<string path, Uint8Array>
    this.entries = new Map();
    for (const [path, data] of entries) this.entries.set(path.replace(/\\/g, '/').toLowerCase(), data);
    const infoPath = [...this.entries.keys()]
      .filter((p) => /(^|\/)info\.dat$/.test(p))
      .sort((a, b) => a.length - b.length)[0];
    if (!infoPath) throw new Error('找不到 Info.dat，這不是有效的 Beat Saber 譜面');
    this.base = infoPath.slice(0, infoPath.length - 'info.dat'.length);
    this.infoPath = infoPath;
  }

  get(name) {
    if (!name) return null;
    const key = (this.base + name.replace(/\\/g, '/')).toLowerCase();
    return this.entries.get(key) || this.entries.get(name.toLowerCase()) || null;
  }

  json(name) {
    const data = this.get(name);
    if (!data) return null;
    let text = strFromU8(data);
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    return JSON.parse(text);
  }
}

export async function filesFromZip(arrayBuffer) {
  const u8 = new Uint8Array(arrayBuffer);
  const entries = await new Promise((resolve) => {
    try {
      unzip(u8, (err, data) => {
        if (err) resolve(unzipSync(u8));
        else resolve(data);
      });
    } catch (e) {
      resolve(unzipSync(u8));
    }
  });
  return new MapFiles(Object.entries(entries));
}

export async function filesFromFileList(fileList) {
  const entries = [];
  for (const f of fileList) {
    const path = f.webkitRelativePath || f.name;
    entries.push([path, new Uint8Array(await f.arrayBuffer())]);
  }
  return new MapFiles(entries);
}

export function parseInfo(files) {
  const raw = files.json(files.infoPath.slice(files.base.length));
  if (!raw) throw new Error('Info.dat 讀取失敗');
  const version = String(raw.version || raw._version || '2.0.0');

  let info;
  if (version.startsWith('4')) {
    const audio = raw.audio || {};
    const sets = new Map();
    for (const d of raw.difficultyBeatmaps || []) {
      const ch = d.characteristic || 'Standard';
      if (!sets.has(ch)) sets.set(ch, []);
      sets.get(ch).push({
        difficulty: d.difficulty,
        label: d.customData?.difficultyLabel || null,
        file: d.beatmapDataFilename,
        lightshowFile: d.lightshowDataFilename || null,
        njs: d.noteJumpMovementSpeed || 0,
        offset: d.noteJumpStartBeatOffset || 0,
        mappers: d.beatmapAuthors?.mappers || [],
      });
    }
    const mappers = new Set();
    for (const list of sets.values()) for (const d of list) d.mappers.forEach((m) => mappers.add(m));
    info = {
      version,
      title: raw.song?.title || '未知歌曲',
      subTitle: raw.song?.subTitle || '',
      artist: raw.song?.author || '',
      mapper: [...mappers].join(', '),
      bpm: audio.bpm || 120,
      songFile: audio.songFilename,
      audioDataFile: audio.audioDataFilename || null,
      coverFile: raw.coverImageFilename,
      previewStart: audio.previewStartTime || 0,
      sets: [...sets.entries()].map(([characteristic, diffs]) => ({ characteristic, diffs })),
    };
  } else {
    info = {
      version,
      title: raw._songName || '未知歌曲',
      subTitle: raw._songSubName || '',
      artist: raw._songAuthorName || '',
      mapper: raw._levelAuthorName || '',
      bpm: raw._beatsPerMinute || 120,
      songFile: raw._songFilename,
      audioDataFile: null,
      coverFile: raw._coverImageFilename,
      previewStart: raw._previewStartTime || 0,
      sets: (raw._difficultyBeatmapSets || []).map((set) => ({
        characteristic: set._beatmapCharacteristicName || 'Standard',
        diffs: (set._difficultyBeatmaps || []).map((d) => ({
          difficulty: d._difficulty,
          label: d._customData?._difficultyLabel || null,
          file: d._beatmapFilename,
          lightshowFile: null,
          njs: d._noteJumpMovementSpeed || 0,
          offset: d._noteJumpStartBeatOffset || 0,
        })),
      })),
    };
  }

  for (const set of info.sets) {
    set.diffs.sort((a, b) => DIFF_ORDER.indexOf(a.difficulty) - DIFF_ORDER.indexOf(b.difficulty));
    set.diffs = set.diffs.filter((d) => files.get(d.file));
  }
  info.sets = info.sets.filter((s) => s.diffs.length > 0);
  if (!info.sets.length) throw new Error('譜面中沒有可用的難度檔案');
  if (!files.get(info.songFile)) throw new Error(`找不到音樂檔 ${info.songFile}`);
  return info;
}

export function coverUrl(files, info) {
  const data = files.get(info.coverFile);
  if (!data) return null;
  const type = /\.png$/i.test(info.coverFile || '') ? 'image/png' : 'image/jpeg';
  return URL.createObjectURL(new Blob([data], { type }));
}

export const DIFF_NAMES = {
  Easy: 'Easy',
  Normal: 'Normal',
  Hard: 'Hard',
  Expert: 'Expert',
  ExpertPlus: 'Expert+',
};
