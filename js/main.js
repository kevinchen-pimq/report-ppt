import { Game } from './game/Game.js';
import { filesFromZip, filesFromFileList, parseInfo, coverUrl, DIFF_NAMES } from './mapLoader.js';
import { parseDifficulty } from './beatmap.js';
import { searchMaps, mapById, latestVersion, download } from './beatsaver.js';

const $ = (id) => document.getElementById(id);
const menu = $('menu');

const game = new Game($('scene'), {
  onExit: (results) => {
    menu.classList.remove('hidden');
    if (results) showResult(results);
  },
});

let current = null; // { files, info, coverImage, coverSrc }
let selected = null; // { set, diff, map }

// ---------------------------------------------------------------------------
// Status line
let statusTimer = null;
function status(msg, { error = false, sticky = false } = {}) {
  const el = $('status');
  el.textContent = msg;
  el.classList.toggle('error', error);
  el.classList.add('show');
  clearTimeout(statusTimer);
  if (!sticky) statusTimer = setTimeout(() => el.classList.remove('show'), error ? 6000 : 3000);
}

// ---------------------------------------------------------------------------
// Settings (persisted per browser)
const SETTINGS_KEY = 'webxr-saber-settings';
function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
  } catch (e) {
    return {};
  }
}
function saveSettings(s) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch (e) {
    /* storage unavailable */
  }
}

function readSettings() {
  return {
    noFail: $('opt-nofail').checked,
    autoplay: $('opt-auto').checked,
    offsetMs: Number($('opt-offset').value),
    volume: Number($('opt-volume').value),
    sfxVolume: Number($('opt-sfx').value),
    saberAngle: Number($('opt-angle').value),
    leftColor: $('opt-left').value,
    rightColor: $('opt-right').value,
  };
}

function syncSettingsUI() {
  $('out-offset').textContent = `${$('opt-offset').value} ms`;
  $('out-volume').textContent = `${Math.round($('opt-volume').value * 100)}%`;
  $('out-sfx').textContent = `${Math.round($('opt-sfx').value * 100)}%`;
  $('out-angle').textContent = `${$('opt-angle').value}°`;
}

(function initSettings() {
  const s = loadSettings();
  if (s.noFail !== undefined) $('opt-nofail').checked = s.noFail;
  if (s.autoplay !== undefined) $('opt-auto').checked = s.autoplay;
  for (const [key, id] of [['offsetMs', 'opt-offset'], ['volume', 'opt-volume'], ['sfxVolume', 'opt-sfx'], ['saberAngle', 'opt-angle'], ['leftColor', 'opt-left'], ['rightColor', 'opt-right']]) {
    if (s[key] !== undefined) $(id).value = s[key];
  }
  syncSettingsUI();
  game.applySettings(readSettings());
  for (const el of document.querySelectorAll('#settings-card input')) {
    el.addEventListener('input', () => {
      syncSettingsUI();
      const v = readSettings();
      game.applySettings(v);
      saveSettings(v);
    });
  }
})();

// ---------------------------------------------------------------------------
// Map loading
async function loadFiles(files, label) {
  try {
    const info = parseInfo(files);
    const src = coverUrl(files, info);
    const coverImage = new Image();
    if (src) coverImage.src = src;
    if (current?.coverSrc) URL.revokeObjectURL(current.coverSrc);
    current = { files, info, coverImage: src ? coverImage : null, coverSrc: src };
    selected = null;
    game.audio.buffer = null;
    renderSong();
    status(`正在解碼音樂…`, { sticky: true });
    await game.loadSong(files.get(info.songFile));
    status(`已載入：${info.title}${label ? `（${label}）` : ''}`);
    $('play-vr').disabled = !vrSupported || !selected;
    $('play-desktop').disabled = !selected;
  } catch (e) {
    console.error(e);
    status(`載入失敗：${e.message}`, { error: true });
  }
}

async function loadZipBuffer(buffer, label) {
  status('正在解壓縮…', { sticky: true });
  try {
    const files = await filesFromZip(buffer);
    await loadFiles(files, label);
  } catch (e) {
    console.error(e);
    status(`載入失敗：${e.message}`, { error: true });
  }
}

$('file-zip').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (f) await loadZipBuffer(await f.arrayBuffer(), f.name);
  e.target.value = '';
});

$('file-folder').addEventListener('change', async (e) => {
  const list = [...e.target.files];
  if (!list.length) return;
  status('正在讀取資料夾…', { sticky: true });
  try {
    await loadFiles(await filesFromFileList(list), list[0].webkitRelativePath.split('/')[0]);
  } catch (err) {
    status(`載入失敗：${err.message}`, { error: true });
  }
  e.target.value = '';
});

const drop = $('drop');
for (const ev of ['dragenter', 'dragover']) {
  document.addEventListener(ev, (e) => {
    e.preventDefault();
    drop.classList.add('over');
  });
}
for (const ev of ['dragleave', 'drop']) {
  document.addEventListener(ev, () => drop.classList.remove('over'));
}
document.addEventListener('drop', async (e) => {
  e.preventDefault();
  const f = e.dataTransfer.files[0];
  if (f) await loadZipBuffer(await f.arrayBuffer(), f.name);
});

// ---------------------------------------------------------------------------
// BeatSaver
async function loadBeatSaverMap(map) {
  const v = latestVersion(map);
  if (!v) throw new Error('此譜面沒有可下載的版本');
  status(`下載中：${map.name}…`, { sticky: true });
  const buf = await download(v.downloadURL, (p) => status(`下載中：${map.name} ${Math.round(p * 100)}%`, { sticky: true }));
  await loadZipBuffer(buf, `BeatSaver ${map.id}`);
  try {
    const url = new URL(location.href);
    url.searchParams.set('id', map.id);
    history.replaceState(null, '', url);
  } catch (e) {
    /* ignore */
  }
}

async function loadById(id) {
  try {
    status('查詢 BeatSaver…', { sticky: true });
    await loadBeatSaverMap(await mapById(id));
  } catch (e) {
    console.error(e);
    status(e.message, { error: true });
  }
}

$('id-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const id = $('bsr').value.trim();
  if (id) loadById(id);
});

async function runSearch(query, sortOrder) {
  const list = $('results');
  list.innerHTML = '<li class="muted">搜尋中…</li>';
  try {
    const docs = await searchMaps(query, 0, sortOrder);
    list.innerHTML = '';
    if (!docs.length) list.innerHTML = '<li class="muted">沒有結果</li>';
    for (const m of docs) {
      const v = latestVersion(m);
      const li = document.createElement('li');
      const img = document.createElement('img');
      img.loading = 'lazy';
      img.alt = '';
      if (v?.coverURL) img.src = v.coverURL;
      const div = document.createElement('div');
      const title = document.createElement('div');
      title.className = 'r-title';
      title.textContent = m.name;
      const meta = document.createElement('div');
      meta.className = 'r-meta';
      const diffs = [...new Set((v?.diffs || []).map((d) => DIFF_NAMES[d.difficulty] || d.difficulty))].join(' / ');
      const mins = Math.floor((m.metadata?.duration || 0) / 60);
      const secs = String((m.metadata?.duration || 0) % 60).padStart(2, '0');
      meta.textContent = `${m.metadata?.songAuthorName || ''} · ${m.metadata?.levelAuthorName || ''} · ${mins}:${secs} · ${diffs}`;
      div.append(title, meta);
      li.append(img, div);
      li.addEventListener('click', async () => {
        try {
          await loadBeatSaverMap(m);
        } catch (e) {
          status(e.message, { error: true });
        }
      });
      list.append(li);
    }
  } catch (e) {
    list.innerHTML = '';
    status(e.message, { error: true });
  }
}

$('search-form').addEventListener('submit', (e) => {
  e.preventDefault();
  for (const c of document.querySelectorAll('.chips .chip[data-sort]')) c.classList.remove('active');
  runSearch($('search').value.trim(), 'Relevance');
});
for (const chip of document.querySelectorAll('.chip[data-sort]')) {
  chip.addEventListener('click', () => {
    for (const c of document.querySelectorAll('.chip[data-sort]')) c.classList.toggle('active', c === chip);
    runSearch($('search').value.trim(), chip.dataset.sort);
  });
}

// ---------------------------------------------------------------------------
// Song / difficulty selection
let activeSet = 0;

function renderSong() {
  const { info, coverSrc } = current;
  $('song-empty').hidden = true;
  $('song').hidden = false;
  $('cover').src = coverSrc || '';
  $('song-title').textContent = info.title;
  $('song-sub').textContent = info.subTitle;
  $('song-artist').textContent = info.artist;
  $('song-meta').textContent = `譜師 ${info.mapper || '-'} · BPM ${Math.round(info.bpm * 100) / 100} · 格式 v${info.version}`;
  activeSet = Math.max(0, info.sets.findIndex((s) => s.characteristic === 'Standard'));
  renderSets();
}

function renderSets() {
  const { info } = current;
  const chars = $('chars');
  chars.innerHTML = '';
  info.sets.forEach((set, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `chip${i === activeSet ? ' active' : ''}`;
    b.textContent = set.characteristic;
    b.addEventListener('click', () => {
      activeSet = i;
      renderSets();
    });
    chars.append(b);
  });
  const set = info.sets[activeSet];
  const diffs = $('diffs');
  diffs.innerHTML = '';
  for (const d of set.diffs) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'diff';
    b.dataset.d = d.difficulty;
    b.textContent = d.label || DIFF_NAMES[d.difficulty] || d.difficulty;
    b.addEventListener('click', () => selectDiff(set, d, b));
    diffs.append(b);
  }
  // auto-select the hardest difficulty
  const last = diffs.lastElementChild;
  if (last) last.click();
}

function selectDiff(set, diff, button) {
  try {
    const { files, info } = current;
    const json = files.json(diff.file);
    const audioData = info.audioDataFile ? files.json(info.audioDataFile) : null;
    const lightshow = diff.lightshowFile ? files.json(diff.lightshowFile) : null;
    const map = parseDifficulty(json, { info, diff, audioData, lightshow });
    selected = { set, diff, map };
    for (const b of $('diffs').children) b.classList.toggle('active', b === button);
    const nps = map.lastTime > 0 ? (map.colorNotes / map.lastTime).toFixed(2) : '0';
    const bombs = map.notes.filter((n) => n.kind === 'bomb').length;
    let text = `方塊 ${map.colorNotes} · 鏈 ${map.links} · 炸彈 ${bombs} · 牆 ${map.walls.length} · NJS ${map.njs} · NPS ${nps} · 譜面格式 v${map.version}`;
    if (/360|90/.test(set.characteristic)) text += ' · ⚠ 旋轉模式的旋轉事件會被忽略';
    $('diff-stats').textContent = text;
    $('play-vr').disabled = !vrSupported || !game.audio.buffer;
    $('play-desktop').disabled = !game.audio.buffer;
  } catch (e) {
    console.error(e);
    selected = null;
    status(`難度解析失敗：${e.message}`, { error: true });
  }
}

function currentMeta() {
  const { info, coverImage } = current;
  return {
    title: info.title,
    subTitle: info.subTitle,
    artist: info.artist,
    mapper: info.mapper,
    characteristic: selected.set.characteristic,
    difficultyName: selected.diff.label || DIFF_NAMES[selected.diff.difficulty] || selected.diff.difficulty,
    coverImage: coverImage && coverImage.complete && coverImage.naturalWidth ? coverImage : null,
  };
}

$('play-vr').addEventListener('click', async () => {
  if (!selected) return;
  game.applySettings(readSettings());
  game.setMap(selected.map, currentMeta());
  try {
    menu.classList.add('hidden');
    await game.startVR();
  } catch (e) {
    console.error(e);
    menu.classList.remove('hidden');
    status(`無法進入 VR：${e.message}`, { error: true });
  }
});

$('play-desktop').addEventListener('click', () => {
  if (!selected) return;
  game.applySettings(readSettings());
  game.setMap(selected.map, currentMeta());
  menu.classList.add('hidden');
  game.startDesktop();
});

function showResult(r) {
  const el = $('last-result');
  el.hidden = false;
  el.innerHTML = '';
  const h = document.createElement('h2');
  h.textContent = `${r.failed ? '挑戰失敗' : '完成'}：${r.title} · ${r.characteristic} ${r.difficulty}`;
  const rank = document.createElement('div');
  rank.className = 'rank';
  rank.textContent = `${r.rank}  ${r.percent.toFixed(2)}%`;
  const stats = document.createElement('div');
  stats.className = 'stats';
  for (const s of [`分數 ${r.score.toLocaleString('en-US')}`, `最大連擊 ${r.maxCombo}`, `命中 ${r.hits}`, `Miss ${r.misses}`, `壞切 ${r.badCuts}`, `炸彈 ${r.bombHits}`]) {
    const span = document.createElement('span');
    span.textContent = s;
    stats.append(span);
  }
  el.append(h, rank, stats);
}

// ---------------------------------------------------------------------------
// WebXR support detection
let vrSupported = false;
(async () => {
  const note = $('vr-note');
  if (!navigator.xr) {
    note.textContent = '此瀏覽器不支援 WebXR。請用 Meta Quest 瀏覽器 / PC VR 的 Chrome、Edge 開啟（需 HTTPS）。';
    return;
  }
  try {
    vrSupported = await navigator.xr.isSessionSupported('immersive-vr');
  } catch (e) {
    vrSupported = false;
  }
  note.textContent = vrSupported ? '已偵測到 VR 裝置，按「進入 VR 遊玩」開始。' : '找不到 VR 裝置（需要 HTTPS 與支援 WebXR 的頭戴裝置）。仍可使用桌面預覽。';
  if (selected && game.audio.buffer) $('play-vr').disabled = !vrSupported;
})();

// ---------------------------------------------------------------------------
// Deep links: ?id=<BeatSaver key> or ?url=<zip url>
const params = new URLSearchParams(location.search);
if (params.get('id')) {
  $('bsr').value = params.get('id');
  loadById(params.get('id'));
} else if (params.get('url')) {
  (async () => {
    try {
      status('下載譜面…', { sticky: true });
      await loadZipBuffer(await download(params.get('url'), (p) => status(`下載中 ${Math.round(p * 100)}%`, { sticky: true })), 'URL');
    } catch (e) {
      status(e.message, { error: true });
    }
  })();
} else {
  runSearch('', 'Rating');
  document.querySelector('.chip[data-sort="Rating"]').classList.add('active');
}

window.__game = game;
