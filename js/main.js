import { Game } from './game/Game.js';
import { settings, DEFAULTS } from './settings.js';
import { Library, diffName, defaultSetIndex, mapStats } from './library.js';
import { searchMaps, mapById, latestVersion, download, searchPlaylists, parsePlaylistId } from './beatsaver.js';
import { Playlists } from './playlists.js';
import { DIFF_NAMES } from './mapLoader.js';
import { StylePreview } from './stylePreview.js';
import { downloads } from './downloads.js';

const $ = (id) => document.getElementById(id);
const menu = $('menu');
const library = new Library();
const playlists = new Playlists(library);

const game = new Game($('scene'), {
  library,
  playlists,
  hooks: {
    onExit: (results) => {
      menu.classList.remove('hidden');
      if (results) showResult(results);
      if (game.current) selectEntry(game.current.entry, game.current.setIdx, game.current.diffIdx);
      syncNowBar();
    },
    onError: (e) => status(`載入失敗：${e.message}`, { error: true }),
    onModelsChanged: (names) => syncModelNames(names),
    onPreviewChange: (st) => syncPreviewButtons(st),
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
// Tabs (找歌 / 歌曲 / 設定) and sub tabs
const TABS = ['find', 'song', 'settings'];
let tab = 'find';

function showTab(name) {
  if (!TABS.includes(name)) return;
  const changed = tab !== name;
  tab = name;
  for (const b of document.querySelectorAll('.tab[data-tab]')) {
    const on = b.dataset.tab === name;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', String(on));
  }
  for (const t of TABS) $(`tab-${t}`).hidden = t !== name;
  if (changed) menu.scrollTo({ top: 0 });
  syncNowBar();
}
for (const b of document.querySelectorAll('.tab[data-tab]')) b.addEventListener('click', () => showTab(b.dataset.tab));
document.addEventListener('click', (e) => {
  const g = e.target.closest('[data-goto]');
  if (g) showTab(g.dataset.goto);
});

function showSub(group, name) {
  const nav = document.querySelector(`.subnav[data-group="${group}"]`);
  for (const b of nav.querySelectorAll('.sub')) b.classList.toggle('active', b.dataset.sub === name);
  for (const p of document.querySelectorAll(`.sub-panel[data-group="${group}"]`)) p.hidden = p.id !== `sub-${name}`;
}
for (const nav of document.querySelectorAll('.subnav[data-group]')) {
  for (const b of nav.querySelectorAll('.sub')) b.addEventListener('click', () => showSub(nav.dataset.group, b.dataset.sub));
}

// Selected song bar (bottom), shown on the other tabs
function syncNowBar() {
  const show = !!current && tab !== 'song' && !menu.classList.contains('hidden');
  $('now-bar').hidden = !show;
  document.body.classList.toggle('has-nowbar', show);
  $('tab-song-dot').hidden = !current;
  if (!current) return;
  const { entry } = current;
  $('now-img').src = entry.coverSrc || '';
  $('now-title').textContent = entry.info.title;
  const d = entry.info.sets[current.setIdx]?.diffs[current.diffIdx];
  $('now-diff').textContent = `${entry.info.artist || ''}${d ? ` · ${diffName(d)}` : ''}`;
  $('now-cover').dataset.key = entry.key;
  paintPreviewButton($('now-cover'));
}
$('now-cover').addEventListener('click', (ev) => {
  ev.stopPropagation();
  if (current) game.togglePreview(current.entry);
});

// ---------------------------------------------------------------------------
// Settings (shared with the in-VR menu through the settings store)
const CHECKS = ['noFail', 'autoplay', 'useMapColors', 'saberFlip', 'showWalls', 'showBombs', 'showDebris', 'showFps'];
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

// Live 3D preview of the saber / note / wall styles (appearance settings)
const stylePreview = new StylePreview($('style-preview'), { getCustom: () => game.customModels });

syncSettingsUI(settings.all);
stylePreview.update(settings.all);
settings.subscribe((v) => {
  syncSettingsUI(v);
  stylePreview.update(v);
});
for (const k of CHECKS) $(`opt-${k}`).addEventListener('change', (e) => settings.set({ [k]: e.target.checked }));
for (const k of Object.keys(RANGES_UI)) $(`opt-${k}`).addEventListener('input', (e) => settings.set({ [k]: Number(e.target.value) }));
for (const k of SELECTS) $(`opt-${k}`).addEventListener('change', (e) => settings.set({ [k]: e.target.value }));
$('height-reset').addEventListener('click', () => settings.set({ playerHeight: DEFAULTS.playerHeight }));
$('colors-reset').addEventListener('click', () => settings.set({ leftColor: DEFAULTS.leftColor, rightColor: DEFAULTS.rightColor }));

// ---------------------------------------------------------------------------
// Custom saber / note models (.glb), stored in IndexedDB by the game
function syncModelNames(names) {
  for (const kind of ['saber', 'note']) {
    $(`name-${kind}`).textContent = names[kind] || '未上傳';
    $(`rm-${kind}`).hidden = !names[kind];
    $(`opt-${kind}Model`).querySelector('option[value="custom"]').disabled = !names[kind];
  }
  stylePreview.update(settings.all);
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
// Song preview: every song cover is a play / pause toggle
function syncPreviewButtons(st = game.previewState) {
  for (const b of document.querySelectorAll('.pv-btn')) paintPreviewButton(b, st);
}
function paintPreviewButton(b, st = game.previewState) {
  const mine = !!b.dataset.key && st.key === b.dataset.key;
  const loading = !!(mine && st.loading);
  const playing = !!(mine && st.playing);
  b.classList.toggle('loading', loading);
  b.classList.toggle('playing', playing);
  b.dataset.state = loading ? 'loading' : playing ? 'playing' : 'idle';
  const label = loading ? '載入中…' : playing ? '暫停試聽' : '試聽';
  b.title = label;
  b.setAttribute('aria-label', label);
}

/**
 * Cover image that plays / pauses the song's preview. target: a BeatSaver map doc
 * (plays BeatSaver's clip, no download) or a library entry.
 */
function coverButton(target, src) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'cover pv-btn';
  b.dataset.key = target.versions ? `bsdoc:${target.id}` : target.key;
  const img = document.createElement('img');
  img.loading = 'lazy';
  img.alt = '';
  if (src) img.src = src;
  const ico = document.createElement('span');
  ico.className = 'pv-ico';
  ico.setAttribute('aria-hidden', 'true');
  b.append(img, ico);
  b.addEventListener('click', (ev) => {
    ev.stopPropagation();
    game.togglePreview(target);
  });
  paintPreviewButton(b);
  return b;
}

// ---------------------------------------------------------------------------
// Downloads: the 下載中 panel, the top-bar badge and the state label on song rows
const ACTIVE = ['queued', 'downloading', 'paused'];
const pct = (j) => (j.total ? `${Math.min(99, Math.floor((j.received / j.total) * 100))}%` : '');

/** Row label that follows a download job: 下載 / 排隊中 / 45% / 已暫停 / ✓ 已下載. */
function jobState(id) {
  const s = document.createElement('span');
  s.className = 'r-state';
  s.dataset.job = id || '';
  paintJobState(s);
  return s;
}
function paintJobState(s) {
  const id = s.dataset.job;
  const j = id && downloads.get(id);
  const have = !!id && library.has(id);
  let text = '下載';
  if (j && j.state === 'queued') text = '排隊中';
  else if (j && j.state === 'paused') text = `已暫停 ${pct(j)}`.trim();
  else if (j && j.state === 'downloading') text = j.total && j.received >= j.total ? '儲存中…' : pct(j) || '下載中';
  else if (have) text = '✓ 已下載';
  s.textContent = text;
  s.classList.toggle('ok', have && !(j && ACTIVE.includes(j.state)));
  s.classList.toggle('busy', !!(j && ACTIVE.includes(j.state)));
}

// Rows are kept per job and updated in place, so the buttons stay put while progress ticks.
const dlRows = new Map(); // job id -> { li, fill, meta, pause, cancel }
function dlRow(j) {
  const li = document.createElement('li');
  const img = document.createElement('img');
  img.alt = '';
  if (j.cover) img.src = j.cover;
  const body = document.createElement('div');
  body.className = 'dl-body';
  const t = document.createElement('div');
  t.className = 'r-title';
  t.textContent = j.label;
  const bar = document.createElement('div');
  bar.className = 'dl-bar';
  const fill = document.createElement('i');
  bar.append(fill);
  const meta = document.createElement('div');
  meta.className = 'r-meta';
  body.append(t, bar, meta);
  const pause = document.createElement('button');
  pause.type = 'button';
  pause.className = 'btn small';
  pause.addEventListener('click', () => {
    const job = downloads.get(j.id);
    if (job?.state === 'paused') downloads.resume(j.id);
    else downloads.pause(j.id);
  });
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'btn small ghost';
  cancel.textContent = '取消';
  cancel.addEventListener('click', () => downloads.cancel(j.id));
  li.append(img, body, pause, cancel);
  return { li, fill, meta, pause, cancel };
}

function renderDownloads() {
  const jobs = downloads.list();
  const active = jobs.filter((j) => ACTIVE.includes(j.state));
  $('dl-badge').hidden = !active.length;
  $('dl-count').textContent = active.length;
  $('downloads').hidden = !jobs.length;
  const ul = $('downloads-list');
  const ids = new Set(jobs.map((j) => j.id));
  for (const [id, row] of dlRows) {
    if (!ids.has(id)) {
      row.li.remove();
      dlRows.delete(id);
    }
  }
  jobs.forEach((j, i) => {
    let row = dlRows.get(j.id);
    if (!row) {
      row = dlRow(j);
      dlRows.set(j.id, row);
    }
    if (ul.children[i] !== row.li) ul.insertBefore(row.li, ul.children[i] || null); // only moves when the order changed
    row.li.className = `dl-item ${j.state}`;
    row.fill.style.width = `${j.state === 'done' ? 100 : j.total ? Math.min(100, (j.received / j.total) * 100) : 0}%`;
    row.meta.textContent = {
      queued: '排隊中',
      downloading: j.total && j.received >= j.total ? '儲存中…' : `下載中 ${pct(j)}${j.total ? ` · ${fmtMB(j.received)} / ${fmtMB(j.total)}` : ''}`,
      paused: `已暫停 ${pct(j)}`,
      done: '✓ 完成',
      error: `失敗：${j.error || ''}`,
      cancelled: '已取消',
    }[j.state];
    const live = ACTIVE.includes(j.state);
    row.pause.hidden = !live;
    row.cancel.hidden = !live;
    row.pause.textContent = j.state === 'paused' ? '繼續' : '暫停';
  });
}

let dlFrame = 0;
downloads.subscribe(() => {
  if (dlFrame) return;
  dlFrame = requestAnimationFrame(() => {
    dlFrame = 0;
    renderDownloads();
    for (const s of document.querySelectorAll('.r-state[data-job]')) paintJobState(s);
    paintPlaylistButtons();
  });
});
$('dl-badge').addEventListener('click', () => {
  showTab('find');
  $('downloads').scrollIntoView({ behavior: 'smooth', block: 'start' });
});

$('preview-btn').addEventListener('click', () => {
  if (current) game.togglePreview(current.entry);
});

// ---------------------------------------------------------------------------
// Map loading
async function addAndSelect(promise, label) {
  try {
    const entry = await promise;
    await selectEntry(entry, undefined, undefined, { open: true });
    status(`已載入：${entry.info.title}${label ? `（${label}）` : ''}`);
    return entry;
  } catch (e) {
    if (e.name === 'AbortError') {
      status(`已取消下載${label ? `：${label}` : ''}`);
      return null;
    }
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

// Drag & drop anywhere on the page: .zip maps and .bplist playlists
const drop = $('drop');
const isFileDrag = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
function setDragging(on) {
  drop.classList.toggle('over', on);
  document.body.classList.toggle('dragging', on);
}
for (const ev of ['dragenter', 'dragover']) {
  document.addEventListener(ev, (e) => {
    e.preventDefault();
    if (isFileDrag(e)) setDragging(true);
  });
}
document.addEventListener('dragleave', (e) => {
  if (!e.relatedTarget) setDragging(false);
});
document.addEventListener('drop', async (e) => {
  e.preventDefault();
  setDragging(false);
  const f = e.dataTransfer.files[0];
  if (f && /\.(bplist|json)$/i.test(f.name)) {
    importBplistFiles([...e.dataTransfer.files]);
  } else if (f) {
    status('正在解壓縮…', { sticky: true });
    await addAndSelect(f.arrayBuffer().then((b) => library.addZip(b, f.name)), f.name);
  }
});

// Library list
library.subscribe(renderLibrary);
const fmtMB = (b) => (b >= 1073741824 ? `${(b / 1073741824).toFixed(b % 1073741824 ? 1 : 0)} GB` : `${(b / 1048576).toFixed(b < 10485760 ? 1 : 0)} MB`);

function clearSelection() {
  current = null;
  $('song').hidden = true;
  $('song-empty').hidden = false;
  updateButtons();
  syncNowBar();
}

function renderLibrary() {
  const ul = $('library');
  ul.innerHTML = '';
  const n = library.entries.length;
  $('library-info').textContent = n ? `${n} 首 · ${fmtMB(library.totalSize)} / ${fmtMB(library.limit)}` : '';
  $('library-count').textContent = n ? String(n) : '';
  $('lib-clear').hidden = !n;
  if (!n) {
    ul.innerHTML = '<li class="muted">還沒有歌曲。到「搜尋 BeatSaver」下載，或「上傳檔案」。</li>';
    return;
  }
  for (const e of library.entries) {
    const li = document.createElement('li');
    if (current?.entry === e) li.className = 'selected';
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
      if (current?.entry === e) clearSelection();
      await library.remove(e);
      status(`已刪除：${e.info.title}`);
    });
    li.append(coverButton(e, e.coverSrc), div, size, del);
    li.addEventListener('click', () => selectEntry(e, undefined, undefined, { open: true }));
    ul.append(li);
  }
}

$('lib-clear').addEventListener('click', async () => {
  if (!confirm(`刪除全部 ${library.entries.length} 首已存的歌曲？`)) return;
  clearSelection();
  game.stopPreview();
  await library.clearAll();
  forgetDeepLink(null);
  status('已清除全部歌曲');
});

library.onRemove = (entry) => {
  // also covers deletes from the VR menu
  forgetDeepLink(entry);
  if (game.previewState.entry === entry) game.stopPreview();
};

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
// Several songs can download at once (see the 下載中 panel); when one finishes, only the
// song clicked last is opened, the others just report that they are ready.
let lastRequested = null;
async function loadBeatSaverMap(doc) {
  const key = library.beatSaverKey(doc);
  lastRequested = key;
  const saved = library.has(key);
  if (!saved) status(`開始下載：${doc.name}`);
  let entry;
  try {
    entry = await library.addBeatSaver(doc);
  } catch (e) {
    if (e.name === 'AbortError') status(`已取消下載：${doc.name}`);
    else status(`下載失敗：${doc.name}（${e.message}）`, { error: true });
    return;
  }
  if (lastRequested !== key) {
    status(`已下載：${entry.info.title}`);
    return;
  }
  await selectEntry(entry, undefined, undefined, { open: true });
  status(`已載入：${entry.info.title}`);
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

let lastDocs = [];
function renderResults() {
  const list = $('results');
  list.innerHTML = '';
  for (const m of lastDocs) {
    const v = latestVersion(m);
    const li = document.createElement('li');
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
    li.append(coverButton(m, v?.coverURL), div, jobState(library.beatSaverKey(m)));
    li.addEventListener('click', () => loadBeatSaverMap(m).catch((e) => status(e.message, { error: true })));
    list.append(li);
  }
}

let searchSeq = 0;
async function runSearch(query, sortOrder) {
  const list = $('results');
  const seq = ++searchSeq;
  list.innerHTML = '<li class="muted">搜尋中…</li>';
  try {
    const docs = await searchMaps(query, 0, sortOrder);
    if (seq !== searchSeq) return;
    lastDocs = docs;
    renderResults();
    if (!docs.length) list.innerHTML = '<li class="muted">沒有結果</li>';
  } catch (e) {
    if (seq !== searchSeq) return;
    list.innerHTML = '';
    status(e.message, { error: true });
  }
}
// keep the "✓ 已下載" marks current
let resultsTimer = null;
library.subscribe(() => {
  clearTimeout(resultsTimer);
  resultsTimer = setTimeout(() => {
    if (lastDocs.length) renderResults();
  }, 200);
});

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
// Playlists (.bplist files and BeatSaver playlists)
let openPl = null; // playlist shown in the detail view
let plBusy = false;

function plItem({ cover, title, meta, state, stateOk, onClick, onDelete, missing, preview, job }) {
  const li = document.createElement('li');
  if (missing) li.className = 'missing';
  if (preview) li.append(coverButton(preview, cover));
  else {
    const img = document.createElement('img');
    img.loading = 'lazy';
    img.alt = '';
    if (cover) img.src = cover;
    li.append(img);
  }
  const div = document.createElement('div');
  const t = document.createElement('div');
  t.className = 'r-title';
  t.textContent = title;
  const m = document.createElement('div');
  m.className = 'r-meta';
  m.textContent = meta;
  div.append(t, m);
  li.append(div);
  if (job) li.append(jobState(job));
  else if (state) {
    const s = document.createElement('span');
    s.className = `r-state${stateOk ? ' ok' : ''}`;
    s.textContent = state;
    li.append(s);
  }
  if (onDelete) {
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'del';
    del.textContent = '刪除';
    del.addEventListener('click', (ev) => {
      ev.stopPropagation();
      onDelete();
    });
    li.append(del);
  }
  if (onClick) li.addEventListener('click', onClick);
  return li;
}

function renderPlaylists() {
  const ul = $('playlists');
  const items = playlists.items;
  $('pl-info').textContent = items.length ? `${items.length} 個` : '';
  $('pl-count').textContent = items.length ? String(items.length) : '';
  if (openPl && !items.some((x) => x.id === openPl.id)) openPl = null;
  $('pl-detail').hidden = !openPl;
  ul.hidden = !!openPl;
  $('pl-list-title').hidden = !!openPl;
  if (openPl) $('pl-results').hidden = true;
  if (openPl) return renderPlaylistDetail();
  ul.innerHTML = '';
  if (!items.length) {
    ul.innerHTML = '<li class="muted">尚無歌單</li>';
    return;
  }
  for (const pl of items) {
    const got = pl.songs.filter((s) => playlists.isDownloaded(s)).length;
    ul.append(plItem({
      cover: pl.cover,
      title: pl.title,
      meta: `${pl.author || (pl.source === 'bplist' ? '.bplist' : 'BeatSaver')} · ${pl.songs.length} 首 · 已下載 ${got}`,
      onClick: () => showPlaylist(pl),
      onDelete: async () => {
        if (!confirm(`刪除歌單「${pl.title}」？（已下載的歌會保留在「我的歌曲」）`)) return;
        await playlists.remove(pl);
        status(`已刪除歌單：${pl.title}`);
      },
    }));
  }
}

function renderPlaylistDetail() {
  const pl = openPl;
  const got = pl.songs.filter((s) => playlists.isDownloaded(s)).length;
  $('pl-cover').src = pl.cover || '';
  $('pl-title').textContent = pl.title;
  $('pl-meta').textContent = `${pl.author ? `${pl.author} · ` : ''}${pl.songs.length} 首 · 已下載 ${got}`;
  const running = plBusy === pl.id;
  $('pl-all').hidden = running;
  $('pl-all').disabled = got >= pl.songs.length;
  $('pl-pause').hidden = !running;
  $('pl-cancel').hidden = !running;
  paintPlaylistButtons();
  const ul = $('pl-songs');
  ul.innerHTML = '';
  pl.songs.forEach((s, i) => {
    const doc = playlists.docFor(s);
    const have = playlists.isDownloaded(s);
    const md = doc?.metadata || {};
    ul.append(plItem({
      cover: doc ? latestVersion(doc)?.coverURL : null,
      title: `${i + 1}. ${doc?.name || s.name || s.hash}`,
      meta: doc ? `${md.songAuthorName || ''} · ${md.levelAuthorName || s.mapper || ''}` : doc === null ? 'BeatSaver 上找不到這首歌' : '讀取中…',
      state: doc === null ? '' : have ? '✓ 已下載' : '下載',
      stateOk: have,
      job: doc ? playlists.jobId(s) : null,
      missing: doc === null,
      preview: doc || null,
      onClick: doc === null ? null : () => playlistSong(s),
    }));
  });
}

function showPlaylist(pl) {
  openPl = pl;
  showTab('find');
  showSub('find', 'playlists');
  renderPlaylists();
  $('pl-detail').scrollIntoView({ block: 'start' });
  playlists.resolve(pl).catch((e) => status(`讀取歌單失敗：${e.message}`, { error: true }));
}

async function playlistSong(s) {
  const name = s.name || s.hash;
  const key = playlists.jobId(s);
  lastRequested = key;
  try {
    if (!playlists.isDownloaded(s)) status(`開始下載：${name}`);
    const entry = await playlists.getSong(s);
    if (lastRequested !== key) status(`已下載：${entry.info.title}`);
    else {
      await selectEntry(entry, undefined, undefined, { open: true });
      status(`已載入：${entry.info.title}`);
    }
  } catch (e) {
    if (e.name === 'AbortError') status(`已取消下載：${name}`);
    else status(e.message, { error: true });
  }
  renderPlaylists();
}

function paintPlaylistButtons() {
  if (!openPl || !plBusy) return;
  const jobs = downloads.list().filter((j) => j.group === openPl.id && ['queued', 'downloading', 'paused'].includes(j.state));
  const allPaused = jobs.length > 0 && jobs.every((j) => j.state === 'paused');
  $('pl-pause').textContent = allPaused ? '繼續' : '暫停全部';
}
$('pl-pause').addEventListener('click', () => {
  if (!openPl) return;
  const jobs = downloads.list().filter((j) => j.group === openPl.id && ['queued', 'downloading', 'paused'].includes(j.state));
  if (jobs.length && jobs.every((j) => j.state === 'paused')) downloads.resumeAll(openPl.id);
  else downloads.pauseAll(openPl.id);
});
$('pl-cancel').addEventListener('click', () => {
  if (openPl) downloads.cancelAll(openPl.id);
});

$('pl-all').addEventListener('click', async () => {
  if (!openPl || plBusy) return;
  plBusy = openPl.id; // id of the playlist whose 全部下載 is running
  renderPlaylists();
  try {
    const r = await playlists.downloadAll(openPl);
    if (r.cancelled) status(`已取消下載（已下載 ${r.downloaded} 首）`);
    else status(r.total ? `已下載 ${r.downloaded} 首${r.failed ? `，${r.failed} 首失敗` : ''}` : '全部都已下載', { error: !!r.failed });
  } catch (e) {
    status(`下載失敗：${e.message}`, { error: true });
  }
  plBusy = false;
  renderPlaylists();
});
$('pl-back').addEventListener('click', () => {
  openPl = null;
  renderPlaylists();
});

async function importBplistFiles(files) {
  let last = null;
  for (const f of files) {
    try {
      last = await playlists.importBplist(await f.text(), f.name);
      status(`已匯入歌單：${last.title}（${last.songs.length} 首）`);
    } catch (e) {
      status(`${f.name}：${e.message}`, { error: true });
    }
  }
  if (last) showPlaylist(last);
}
$('file-bplist').addEventListener('change', (e) => {
  importBplistFiles([...e.target.files]);
  e.target.value = '';
});

async function importBeatSaverPlaylist(id) {
  try {
    status('匯入歌單中…', { sticky: true });
    const pl = await playlists.importBeatSaver(id);
    status(`已匯入歌單：${pl.title}（${pl.songs.length} 首）`);
    showPlaylist(pl);
  } catch (e) {
    status(`匯入失敗：${e.message}`, { error: true });
  }
}
$('pl-id-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const id = parsePlaylistId($('pl-id').value);
  if (!id) return status('請輸入歌單 ID（數字）或 BeatSaver 歌單網址', { error: true });
  importBeatSaverPlaylist(id);
});

$('pl-search-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const q = $('pl-search').value.trim();
  const ul = $('pl-results');
  if (openPl) {
    openPl = null;
    renderPlaylists();
  }
  ul.hidden = false;
  ul.innerHTML = '<li class="muted">搜尋中…</li>';
  try {
    const docs = await searchPlaylists(q, 0, q ? 'Relevance' : 'Rating');
    ul.innerHTML = docs.length ? '' : '<li class="muted">沒有結果</li>';
    for (const d of docs) {
      const have = playlists.items.some((x) => x.id === `bsp:${d.playlistId}`);
      ul.append(plItem({
        cover: d.playlistImage,
        title: d.name,
        meta: `${d.owner?.name || ''} · ${d.stats?.totalMaps ?? '?'} 首`,
        state: have ? '✓ 已匯入' : '匯入',
        stateOk: have,
        onClick: () => importBeatSaverPlaylist(d.playlistId),
      }));
    }
  } catch (err) {
    ul.innerHTML = '';
    status(err.message, { error: true });
  }
});

playlists.subscribe(renderPlaylists);
library.subscribe(renderPlaylists);

// ---------------------------------------------------------------------------
// Song / difficulty selection
/** open: switch to the 歌曲 tab (unless the player is busy in the settings). */
async function selectEntry(entry, setIdx, diffIdx, { open = false } = {}) {
  if (game.previewState.entry && game.previewState.entry !== entry) game.stopPreview();
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
  $('preview-btn').dataset.key = entry.key;
  $('song-title').textContent = info.title;
  $('song-sub').textContent = info.subTitle;
  $('song-artist').textContent = info.artist;
  $('song-meta').textContent = `譜師 ${info.mapper || '-'} · BPM ${Math.round(info.bpm * 100) / 100} · 格式 v${info.version}`;
  syncPreviewButtons();
  renderSets();
  renderLibrary();
  if (open && tab !== 'settings') showTab('song');
  else syncNowBar();
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
  // only one mode: no need to choose
  chars.hidden = info.sets.length < 2;
  chars.previousElementSibling.hidden = info.sets.length < 2;
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
  syncNowBar();
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

/** The game is about to take over the screen: stop the page's own 3D preview. */
function leavePage() {
  menu.classList.add('hidden');
  stylePreview.release();
  syncNowBar();
}

async function enterVR(pending) {
  try {
    leavePage();
    await game.startVR(pending);
  } catch (e) {
    console.error(e);
    menu.classList.remove('hidden');
    syncNowBar();
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
  leavePage();
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
  showTab('song');
}

// ---------------------------------------------------------------------------
// WebXR support detection
let vrSupported = false;
(async () => {
  const note = $('vr-note');
  const pill = $('vr-status');
  if (!navigator.xr) {
    note.textContent = '這個瀏覽器不支援 VR（WebXR）。請用 Meta Quest 瀏覽器，或電腦接 PC VR 時用 Chrome / Edge 開啟。也可以先用「電腦試玩」。';
    pill.textContent = '此瀏覽器不支援 VR';
    $('vr-menu').title = '這個瀏覽器不支援 VR';
    return;
  }
  try {
    vrSupported = await navigator.xr.isSessionSupported('immersive-vr');
  } catch (e) {
    vrSupported = false;
  }
  note.textContent = vrSupported
    ? '已偵測到 VR 裝置。可以在這裡選好歌再按「在 VR 中遊玩」，或按右上角「進入 VR」在 VR 裡選歌。'
    : '找不到 VR 裝置（需要 HTTPS 與支援 WebXR 的頭戴裝置）。仍可使用「電腦試玩」。';
  pill.textContent = vrSupported ? '● 已偵測到 VR' : '未偵測到 VR';
  pill.classList.toggle('ok', vrSupported);
  if (!vrSupported) $('vr-menu').title = '找不到 VR 裝置';
  updateButtons();
})();

window.addEventListener('pagehide', () => stylePreview.dispose());

// ---------------------------------------------------------------------------
// Songs saved in this browser
await library.init();
await playlists.init();

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
window.__playlists = playlists;
window.__stylePreview = stylePreview;
