import { Game } from './game/Game.js';
import { settings } from './settings.js';
import { Library, diffName, defaultSetIndex, mapStats } from './library.js';
import { searchMaps, mapById, latestVersion, download } from './beatsaver.js';
import { DIFF_NAMES } from './mapLoader.js';

const $ = (id) => document.getElementById(id);
const menu = $('menu');
const library = new Library();

const game = new Game($('scene'), {
  library,
  hooks: {
    onExit: (results) => {
      menu.classList.remove('hidden');
      if (results) showResult(results);
      if (game.current) selectEntry(game.current.entry, game.current.setIdx, game.current.diffIdx);
    },
    onError: (e) => status(`載入失敗：${e.message}`, { error: true }),
    onModelsChanged: (names) => syncModelNames(names),
  },
});

let current = null; // { entry, setIdx, diffIdx, preview }

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
// Settings (shared with the in-VR menu through the settings store)
const CHECKS = ['noFail', 'autoplay', 'useMapColors', 'saberFlip'];
const SELECTS = ['spectator', 'saberModel', 'noteModel', 'wallStyle'];
const RANGES_UI = {
  playerHeight: (v) => `${Number(v).toFixed(2)} m`,
  audioLatencyMs: (v) => `${v > 0 ? '+' : ''}${v} ms`,
  volume: (v) => `${Math.round(v * 100)}%`,
  sfxVolume: (v) => `${Math.round(v * 100)}%`,
  saberAngle: (v) => `${v}°`,
};

function syncSettingsUI(v) {
  for (const k of CHECKS) $(`opt-${k}`).checked = !!v[k];
  for (const [k, fmt] of Object.entries(RANGES_UI)) {
    $(`opt-${k}`).value = v[k];
    $(`out-${k}`).textContent = fmt(v[k]);
  }
  for (const k of SELECTS) $(`opt-${k}`).value = v[k];
  $('opt-leftColor').value = v.leftColor;
  $('opt-rightColor').value = v.rightColor;
}

syncSettingsUI(settings.all);
settings.subscribe((v) => syncSettingsUI(v));
for (const k of CHECKS) $(`opt-${k}`).addEventListener('change', (e) => settings.set({ [k]: e.target.checked }));
for (const k of Object.keys(RANGES_UI)) $(`opt-${k}`).addEventListener('input', (e) => settings.set({ [k]: Number(e.target.value) }));
for (const k of SELECTS) $(`opt-${k}`).addEventListener('change', (e) => settings.set({ [k]: e.target.value }));

// ---------------------------------------------------------------------------
// Custom saber / note models (.glb), stored in IndexedDB by the game
function syncModelNames(names) {
  for (const kind of ['saber', 'note']) {
    $(`name-${kind}`).textContent = names[kind] || '未上傳';
    $(`rm-${kind}`).hidden = !names[kind];
    $(`opt-${kind}Model`).querySelector('option[value="custom"]').disabled = !names[kind];
  }
}
syncModelNames({ saber: null, note: null });
for (const kind of ['saber', 'note']) {
  $(`up-${kind}`).addEventListener('change', async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    if (f.size > 30 * 1024 * 1024) {
      status('模型檔太大（上限 30 MB）', { error: true });
      return;
    }
    try {
      status(`正在載入模型 ${f.name}…`, { sticky: true });
      await game.setCustomModel(kind, await f.arrayBuffer(), f.name);
      status(`已套用自訂${kind === 'saber' ? '光劍' : '方塊'}：${f.name}`);
    } catch (err) {
      console.error(err);
      status(`模型載入失敗：${err.message}（只支援 glTF 2.0 .glb）`, { error: true });
    }
  });
  $(`rm-${kind}`).addEventListener('click', () => game.removeCustomModel(kind));
}
$('opt-leftColor').addEventListener('input', (e) => settings.set({ leftColor: e.target.value }));
$('opt-rightColor').addEventListener('input', (e) => settings.set({ rightColor: e.target.value }));

// ---------------------------------------------------------------------------
// Audio latency calibration on the web page (the VR menu has its own)
const cal = game.calibrator;
function calInfo() {
  const r = cal.result;
  $('cal-info').textContent = cal.running
    ? `已敲 ${cal.count} 次${r !== null ? ` · 測得 ${r > 0 ? '+' : ''}${r} ms` : '（至少 6 次）'}`
    : '聽到「嗒」聲時敲擊，測出耳機 / 喇叭的額外延遲。正值 = 聲音比畫面晚。';
  $('cal-apply').disabled = r === null;
  $('cal-apply').textContent = r !== null ? `套用 ${r} ms` : '套用';
}
function calFlash() {
  if (!cal.running) {
    $('cal-tap').classList.remove('flash');
    return;
  }
  $('cal-tap').classList.toggle('flash', cal.pulse() > 0.5);
  requestAnimationFrame(calFlash);
}
$('cal-start').addEventListener('click', () => {
  if (cal.running) cal.stop();
  else {
    cal.start(100);
    calFlash();
  }
  $('cal-start').textContent = cal.running ? '停止測試' : '開始節拍測試';
  $('cal-tap').disabled = !cal.running;
  calInfo();
});
$('cal-tap').addEventListener('pointerdown', (e) => {
  cal.tap(e.timeStamp || performance.now());
  calInfo();
});
window.addEventListener('keydown', (e) => {
  if (e.key === ' ' && cal.running && !menu.classList.contains('hidden')) {
    e.preventDefault();
    cal.tap(performance.now());
    calInfo();
  }
});
$('cal-apply').addEventListener('click', () => {
  if (cal.result !== null) settings.set({ audioLatencyMs: cal.result });
  status(`已套用音訊延遲 ${settings.get('audioLatencyMs')} ms`);
});

// ---------------------------------------------------------------------------
// Map loading
async function addAndSelect(promise, label) {
  try {
    const entry = await promise;
    await selectEntry(entry);
    status(`已載入：${entry.info.title}${label ? `（${label}）` : ''}`);
    return entry;
  } catch (e) {
    console.error(e);
    status(`載入失敗：${e.message}`, { error: true });
    return null;
  }
}

$('file-zip').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (f) {
    status('正在解壓縮…', { sticky: true });
    await addAndSelect(f.arrayBuffer().then((b) => library.addZip(b, f.name)), f.name);
  }
  e.target.value = '';
});

$('file-folder').addEventListener('change', async (e) => {
  const list = [...e.target.files];
  if (!list.length) return;
  status('正在讀取資料夾…', { sticky: true });
  const name = list[0].webkitRelativePath.split('/')[0];
  await addAndSelect(library.addFileList(list, name), name);
  e.target.value = '';
});

const drop = $('drop');
for (const ev of ['dragenter', 'dragover']) {
  document.addEventListener(ev, (e) => {
    e.preventDefault();
    drop.classList.add('over');
  });
}
for (const ev of ['dragleave', 'drop']) document.addEventListener(ev, () => drop.classList.remove('over'));
document.addEventListener('drop', async (e) => {
  e.preventDefault();
  const f = e.dataTransfer.files[0];
  if (f) {
    status('正在解壓縮…', { sticky: true });
    await addAndSelect(f.arrayBuffer().then((b) => library.addZip(b, f.name)), f.name);
  }
});

// Library list
library.subscribe(renderLibrary);
const fmtMB = (b) => (b >= 1073741824 ? `${(b / 1073741824).toFixed(b % 1073741824 ? 1 : 0)} GB` : `${(b / 1048576).toFixed(b < 10485760 ? 1 : 0)} MB`);

function renderLibrary() {
  const ul = $('library');
  ul.innerHTML = '';
  $('library-info').textContent = library.entries.length ? `${library.entries.length} 首 · ${fmtMB(library.totalSize)} / ${fmtMB(library.limit)}` : '';
  $('lib-clear').hidden = !library.entries.length;
  if (!library.entries.length) {
    ul.innerHTML = '<li class="muted">尚無</li>';
    return;
  }
  for (const e of library.entries) {
    const li = document.createElement('li');
    const img = document.createElement('img');
    img.alt = '';
    if (e.coverSrc) img.src = e.coverSrc;
    const div = document.createElement('div');
    const t = document.createElement('div');
    t.className = 'r-title';
    t.textContent = e.info.title;
    const m = document.createElement('div');
    m.className = 'r-meta';
    m.textContent = `${e.info.artist} · ${e.info.mapper || '-'}`;
    div.append(t, m);
    const size = document.createElement('span');
    size.className = 'r-size';
    size.textContent = e.cached ? fmtMB(e.size || 0) : '儲存中…';
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'del';
    del.textContent = '刪除';
    del.title = '從這個瀏覽器刪除';
    del.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      if (!confirm(`刪除「${e.info.title}」？`)) return;
      if (current?.entry === e) {
        current = null;
        $('song').hidden = true;
        $('song-empty').hidden = false;
        updateButtons();
      }
      await library.remove(e);
      status(`已刪除：${e.info.title}`);
    });
    li.append(img, div, size, del);
    li.addEventListener('click', () => selectEntry(e));
    ul.append(li);
  }
}

$('lib-clear').addEventListener('click', async () => {
  if (!confirm(`刪除全部 ${library.entries.length} 首已存的歌曲？`)) return;
  current = null;
  $('song').hidden = true;
  $('song-empty').hidden = false;
  updateButtons();
  await library.clearAll();
  forgetDeepLink(null);
  status('已清除全部歌曲');
});

library.onRemove = (entry) => forgetDeepLink(entry); // also covers deletes from the VR menu

// Drop ?id=… from the address so a reload doesn't download a deleted song again
function forgetDeepLink(entry) {
  try {
    const url = new URL(location.href);
    const id = url.searchParams.get('id');
    if (id && (!entry || entry.beatsaverId === id)) {
      url.searchParams.delete('id');
      history.replaceState(null, '', url);
    }
  } catch (err) {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// BeatSaver
async function loadBeatSaverMap(doc) {
  status(`下載中：${doc.name}…`, { sticky: true });
  const entry = await addAndSelect(
    library.addBeatSaver(doc, (p) => status(`下載中：${doc.name} ${Math.round(p * 100)}%`, { sticky: true })),
    `BeatSaver ${doc.id}`,
  );
  if (!entry) return;
  try {
    const url = new URL(location.href);
    url.searchParams.set('id', doc.id);
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
      meta.textContent = `${m.metadata?.songAuthorName || ''} · ${m.metadata?.levelAuthorName || ''} · ${mins}:${secs} · ${diffs}${library.isDownloaded(m) ? ' · ✓ 已下載' : ''}`;
      div.append(title, meta);
      li.append(img, div);
      li.addEventListener('click', () => loadBeatSaverMap(m).catch((e) => status(e.message, { error: true })));
      list.append(li);
    }
  } catch (e) {
    list.innerHTML = '';
    status(e.message, { error: true });
  }
}

$('search-form').addEventListener('submit', (e) => {
  e.preventDefault();
  for (const c of document.querySelectorAll('.chip[data-sort]')) c.classList.remove('active');
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
async function selectEntry(entry, setIdx, diffIdx) {
  if (entry.stub) {
    // saved song: load its files from browser storage
    status(`讀取中：${entry.info.title}…`, { sticky: true });
    try {
      await library.load(entry);
      status(`已載入：${entry.info.title}`);
    } catch (e) {
      status(`讀取失敗：${e.message}`, { error: true });
      return;
    }
  }
  const info = entry.info;
  current = { entry, setIdx: setIdx ?? defaultSetIndex(info), diffIdx: 0, preview: null };
  current.diffIdx = diffIdx ?? info.sets[current.setIdx].diffs.length - 1;
  $('song-empty').hidden = true;
  $('song').hidden = false;
  $('cover').src = entry.coverSrc || '';
  $('song-title').textContent = info.title;
  $('song-sub').textContent = info.subTitle;
  $('song-artist').textContent = info.artist;
  $('song-meta').textContent = `譜師 ${info.mapper || '-'} · BPM ${Math.round(info.bpm * 100) / 100} · 格式 v${info.version}`;
  renderSets();
}

function renderSets() {
  const { entry } = current;
  const info = entry.info;
  const chars = $('chars');
  chars.innerHTML = '';
  info.sets.forEach((set, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `chip${i === current.setIdx ? ' active' : ''}`;
    b.textContent = set.characteristic;
    b.addEventListener('click', () => {
      current.setIdx = i;
      current.diffIdx = info.sets[i].diffs.length - 1;
      renderSets();
    });
    chars.append(b);
  });
  const diffs = $('diffs');
  diffs.innerHTML = '';
  info.sets[current.setIdx].diffs.forEach((d, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `diff${i === current.diffIdx ? ' active' : ''}`;
    b.dataset.d = d.difficulty;
    b.textContent = diffName(d);
    b.addEventListener('click', () => {
      current.diffIdx = i;
      renderSets();
    });
    diffs.append(b);
  });
  previewDiff();
}

function previewDiff() {
  try {
    const p = library.loadDifficulty(current.entry, current.setIdx, current.diffIdx);
    current.preview = p;
    const m = p.map;
    const st = mapStats(m);
    let text = `方塊 ${m.colorNotes} · 鏈 ${m.links} · 弧線 ${m.arcs.length} · 炸彈 ${st.bombs} · 牆 ${m.walls.length} · NJS ${m.njs} · NPS ${st.nps} · 譜面格式 v${m.version}`;
    if (m.njsEvents) text += ` · NJS 變速事件 ${m.njsEvents}`;
    if (p.meta.colors) text += ' · 有自訂顏色';
    if (/360|90/.test(p.set.characteristic)) text += ' · ⚠ 旋轉模式的旋轉事件會被忽略';
    $('diff-stats').textContent = text;
  } catch (e) {
    console.error(e);
    current.preview = null;
    $('diff-stats').textContent = `難度解析失敗：${e.message}`;
  }
  updateButtons();
}

function updateButtons() {
  const ok = !!current?.preview;
  $('play-vr').disabled = !vrSupported || !ok;
  $('play-desktop').disabled = !ok;
  $('vr-menu').disabled = !vrSupported;
}

async function enterVR(pending) {
  try {
    menu.classList.add('hidden');
    await game.startVR(pending);
  } catch (e) {
    console.error(e);
    menu.classList.remove('hidden');
    status(`無法進入 VR：${e.message}`, { error: true });
  }
}

$('play-vr').addEventListener('click', () => {
  if (current?.preview) enterVR({ entry: current.entry, setIdx: current.setIdx, diffIdx: current.diffIdx });
});
$('vr-menu').addEventListener('click', () => enterVR(null));

$('play-desktop').addEventListener('click', () => {
  if (!current?.preview) return;
  if (cal.running) $('cal-start').click();
  menu.classList.add('hidden');
  game.startDesktop(current.entry, current.setIdx, current.diffIdx);
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
  const items = [`分數 ${r.score.toLocaleString('en-US')}`, `最大連擊 ${r.maxCombo}`, `命中 ${r.hits}`, `Miss ${r.misses}`, `壞切 ${r.badCuts}`, `炸彈 ${r.bombHits}`];
  if (r.best) items.push(r.best.isNew ? '新紀錄！' : `最佳 ${r.best.score.toLocaleString('en-US')}`);
  for (const s of items) {
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
  note.textContent = vrSupported
    ? '已偵測到 VR 裝置。可以先在這裡選歌，或直接進入 VR 選單選歌。'
    : '找不到 VR 裝置（需要 HTTPS 與支援 WebXR 的頭戴裝置）。仍可使用桌面預覽。';
  updateButtons();
})();

// ---------------------------------------------------------------------------
// Songs saved in this browser
await library.init();

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
      const buf = await download(params.get('url'), (p) => status(`下載中 ${Math.round(p * 100)}%`, { sticky: true }));
      await addAndSelect(library.addZip(buf, 'URL'), 'URL');
    } catch (e) {
      status(e.message, { error: true });
    }
  })();
}
runSearch('', 'Rating');
document.querySelector('.chip[data-sort="Rating"]').classList.add('active');

window.__game = game;
window.__library = library;
