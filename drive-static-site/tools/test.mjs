#!/usr/bin/env node
/**
 * 在「沒有 setTimeout / TextEncoder / crypto / URL」的 V8 環境裡，用模擬的 Apps Script 服務
 * 跑一次完整流程：installEsbuild → buildAll → doGet → buildChanged。
 * Drive 用暫存資料夾模擬，UrlFetchApp 會真的連網（unpkg、esm.sh）。
 *
 *   npm test                 測試 example-sites
 *   npm test -- --keep       保留暫存資料夾，並把輸出的 HTML 存在 out/
 */
import vm from 'node:vm';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const KEEP = process.argv.includes('--keep');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'drive-static-site-'));
const SITES = path.join(TMP, 'sites');
const MYDRIVE = path.join(TMP, 'mydrive');
fs.cpSync(path.join(ROOT, 'example-sites'), SITES, { recursive: true });
fs.mkdirSync(MYDRIVE);

let failures = 0;
const check = (ok, msg) => {
  console.log((ok ? '  ✔ ' : '  ✘ ') + msg);
  if (!ok) failures++;
};

// ---- Utilities / Blob ------------------------------------------------------
const toBuf = (b) => Buffer.from(Array.from(b, (x) => x & 255));
function mkBlob(buf, type = 'application/octet-stream', name = null) {
  const blob = {
    getBytes: () => Array.from(buf, (x) => (x > 127 ? x - 256 : x)), // 和 Apps Script 一樣是有號 byte
    getDataAsString: () => buf.toString('utf8'),
    setDataFromString: (s) => ((buf = Buffer.from(s, 'utf8')), blob),
    getContentType: () => type,
    setContentType: (t) => ((type = t), blob),
    getName: () => name,
    setName: (n) => ((name = n), blob),
  };
  return blob;
}
const Utilities = {
  Charset: { UTF_8: 'utf8' },
  DigestAlgorithm: { SHA_256: 'sha256', MD5: 'md5' },
  computeDigest: (a, s) => Array.from(crypto.createHash(a).update(s, 'utf8').digest(), (x) => (x > 127 ? x - 256 : x)),
  base64Encode: (b) => (typeof b === 'string' ? Buffer.from(b, 'utf8') : toBuf(b)).toString('base64'),
  base64EncodeWebSafe: (b) => (typeof b === 'string' ? Buffer.from(b, 'utf8') : toBuf(b)).toString('base64url'),
  base64Decode: (s) => Array.from(Buffer.from(s, 'base64')),
  newBlob: (d, type, name) => mkBlob(typeof d === 'string' ? Buffer.from(d, 'utf8') : toBuf(d), type, name),
  gzip: (b) => mkBlob(zlib.gzipSync(toBuf(b.getBytes()))),
  ungzip: (b) => mkBlob(zlib.gunzipSync(toBuf(b.getBytes()))),
  sleep: (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms),
};

// ---- DriveApp（真實檔案系統） -----------------------------------------------
const ids = new Map(); // id → 絕對路徑
const idOf = (p) => {
  for (const [id, q] of ids) if (q === p) return id;
  const id = 'id_' + crypto.createHash('md5').update(p).digest('hex').slice(0, 12);
  ids.set(id, p);
  return id;
};
const iter = (arr) => {
  let i = 0;
  return { hasNext: () => i < arr.length, next: () => arr[i++] };
};
const PUBLIC = new Set(); // 模擬「知道連結的人可檢視」
function mkFile(p) {
  const f = {
    getId: () => idOf(p), getName: () => path.basename(p), isTrashed: () => !fs.existsSync(p),
    getSize: () => fs.statSync(p).size, getMimeType: () => 'application/octet-stream',
    getLastUpdated: () => fs.statSync(p).mtime, getUrl: () => 'https://drive.google.com/file/d/' + idOf(p),
    getBlob: () => mkBlob(fs.readFileSync(p), undefined, path.basename(p)),
    setContent: (s) => (fs.writeFileSync(p, s), f), setTrashed: (t) => (t && fs.rmSync(p), f),
    getSharingAccess: () => (PUBLIC.has(p) ? 'ANYONE_WITH_LINK' : 'PRIVATE'),
  };
  return f;
}
function mkFolder(p) {
  const kids = (dir) => fs.readdirSync(p).map((k) => path.join(p, k)).filter((k) => fs.statSync(k).isDirectory() === dir);
  const folder = {
    getId: () => idOf(p), getName: () => path.basename(p), isTrashed: () => !fs.existsSync(p),
    getFiles: () => iter(kids(false).map(mkFile)), getFolders: () => iter(kids(true).map(mkFolder)),
    getFilesByName: (n) => iter(kids(false).filter((k) => path.basename(k) === n).map(mkFile)),
    getFoldersByName: (n) => iter(kids(true).filter((k) => path.basename(k) === n).map(mkFolder)),
    createFile: (blob) => {
      const fp = path.join(p, blob.getName());
      fs.writeFileSync(fp, toBuf(blob.getBytes()));
      return mkFile(fp);
    },
    getSharingAccess: () => 'PRIVATE',
  };
  return folder;
}
const byId = (id, dir) => {
  const p = ids.get(id);
  if (!p || !fs.existsSync(p) || fs.statSync(p).isDirectory() !== dir) throw new Error('No item with the given ID could be found: ' + id);
  return dir ? mkFolder(p) : mkFile(p);
};
const DriveApp = {
  Access: { ANYONE: 'ANYONE', ANYONE_WITH_LINK: 'ANYONE_WITH_LINK' },
  getFolderById: (id) => byId(id, true),
  getFileById: (id) => byId(id, false),
  createFile: (blob) => mkFolder(MYDRIVE).createFile(blob),
};

// ---- 其他服務 ----------------------------------------------------------------
const props = { SITES_FOLDER_ID: idOf(SITES) };
const store = new Map();
const triggers = [];
let fetches = 0;
const services = {
  DriveApp,
  Utilities,
  PropertiesService: {
    getScriptProperties: () => ({
      getProperties: () => ({ ...props }), getProperty: (k) => props[k] ?? null,
      setProperty: (k, v) => { props[k] = String(v); },
    }),
  },
  CacheService: {
    getScriptCache: () => ({
      get: (k) => store.get(k) ?? null, put: (k, v) => store.set(k, v),
      getAll: (ks) => Object.fromEntries(ks.filter((k) => store.has(k)).map((k) => [k, store.get(k)])),
      putAll: (o) => Object.entries(o).forEach(([k, v]) => store.set(k, v)),
    }),
  },
  LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
  ScriptApp: {
    getService: () => ({ getUrl: () => 'https://script.google.com/macros/s/TEST/exec' }),
    newTrigger: (fn) => ({ timeBased: () => ({ everyMinutes: (n) => ({ create: () => triggers.push({ fn, n }) }) }) }),
    getProjectTriggers: () => triggers.map((t) => ({ getHandlerFunction: () => t.fn, t })),
    deleteTrigger: (x) => triggers.splice(triggers.indexOf(x.t), 1),
  },
  UrlFetchApp: {
    fetch: (url) => {
      fetches++;
      const out = path.join(TMP, 'fetch.bin');
      const code = Number(execFileSync('curl', ['-sSL', '-A', 'Mozilla/5.0 (compatible; Google-Apps-Script)',
        '-o', out, '-w', '%{http_code}', url]).toString());
      const buf = fs.readFileSync(out);
      return { getResponseCode: () => code, getBlob: () => mkBlob(buf), getContentText: () => buf.toString('utf8') };
    },
  },
  HtmlService: {
    XFrameOptionsMode: {},
    createHtmlOutput: (h) => {
      const o = { kind: 'html', content: h, setTitle: (t) => ((o.title = t), o), addMetaTag: () => o };
      return o;
    },
  },
  ContentService: {
    MimeType: { TEXT: 'TEXT', JSON: 'JSON', JAVASCRIPT: 'JAVASCRIPT', CSV: 'CSV', RSS: 'RSS', ATOM: 'ATOM', XML: 'XML', ICAL: 'ICAL', VCARD: 'VCARD' },
    createTextOutput: (s) => {
      const o = { kind: 'text', content: s, setMimeType: (m) => ((o.mime = m), o) };
      return o;
    },
  },
};

// ---- 載入 .gs（順序刻意讓 Esbuild.gs 在最前面） --------------------------------
const logs = [];
const log = (level) => (...a) => { logs.push(a.join(' ')); console[level]('    │ ' + a.join(' ').replace(/\n/g, '\n    │ ')); };
const ctx = vm.createContext({ console: { log: log('log'), warn: log('warn'), error: log('error'), info: log('log') }, ...services });
const bare = vm.runInContext('[typeof setTimeout, typeof TextEncoder, typeof crypto, typeof performance, typeof URL, typeof fetch].join()', ctx);
console.log('環境（應該全部 undefined）：' + bare);
for (const f of ['Esbuild.gs', 'Polyfills.gs', 'Code.gs', 'Build.gs']) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
}
const run = (code) => vm.runInContext(code, ctx);
const get = (p) => {
  run('memo_.sites = {}; memo_.props = null; memo_.sitesRoot = undefined;'); // 每個請求都是新的執行
  return ctx.doGet({ pathInfo: p });
};

// ---- 測試 --------------------------------------------------------------------
console.log('\n▶ doGet 在建置前（不應載入 esbuild）');
let r = get('docs');
check(r.kind === 'html' && r.content.includes('文件站'), 'docs 首頁可以顯示');
check(run('typeof globalThis.self') === 'undefined', 'doGet 沒有安裝 polyfill');
r = get('demo');
check(/console\.error\(.*js\/main\.ts 尚未建置/.test(r.content), 'demo 未建置時提示 main.ts 尚未建置');

console.log('\n▶ checkSetup()');
run('checkSetup()');

console.log('\n▶ buildAll()（第一次會下載 esbuild.wasm）');
let t0 = Date.now();
let results = await run('buildAll()');
console.log(`  （${Date.now() - t0} ms，UrlFetchApp ${fetches} 次）`);
check(fs.existsSync(path.join(MYDRIVE, 'esbuild-' + run('ESBUILD_VERSION') + '.wasm')), 'esbuild.wasm 已存到 Drive');
const manifest = JSON.parse(fs.readFileSync(path.join(SITES, 'demo/_build.json'), 'utf8'));
check(JSON.stringify(Object.keys(manifest.entries).sort()) === '["css/style.css","js/main.ts"]', 'demo 進入點：css/style.css、js/main.ts');
const main = manifest.entries['js/main.ts'];
check(main && !main.error && main.format === 'esm', 'main.ts 以 ESM 打包成功');
check(main && /YYYY-MM-DD/.test(main.code) && /現在時間/.test(main.code), 'main.ts 包含 dayjs（esm.sh）與中文字串');
check(main && main.css && /#clock/.test(main.css), 'main.ts import 的 CSS 輸出到 css 欄位');
const style = manifest.entries['css/style.css'];
check(style && /--accent/.test(style.code) && !/@import/.test(style.code), 'style.css 合併了 @import');
check(style && /url\("?\/img\/pattern\.svg"?\)/.test(style.code), 'CSS 的 url() 改成網站根目錄路徑');
check(!fs.existsSync(path.join(SITES, 'docs/_build.json')) || !Object.keys(JSON.parse(fs.readFileSync(path.join(SITES, 'docs/_build.json'), 'utf8')).entries).length,
  'docs 的一般 script 沒有被打包');
check(run('globalThis.__pendingTimers ? __pendingTimers() : 0') === 0, '建置完沒有殘留的計時器（執行可以結束）');

console.log('\n▶ doGet 在建置後');
const pages = {};
for (const p of ['', 'demo', 'demo/blog/first-post.html', 'docs', 'docs/app.js', 'demo/site.json', 'demo/_build.json', 'nope', 'demo/nope.html']) {
  r = get(p);
  pages[p] = r;
  console.log(`  /${p} → ${r.kind} ${r.title ?? r.mime}`);
}
check(pages[''].content.includes('/exec/demo/') && pages[''].content.includes('/exec/docs/'), '/exec 列出兩個網站');
check(pages.demo.content.includes('<script type="module">') && pages.demo.content.includes('YYYY-MM-DD'), 'demo 內嵌打包後的 main.ts');
check(/<style>\s*#clock/.test(pages.demo.content), 'demo 內嵌 main.ts 的 CSS');
check(/url\("data:image\/svg\+xml;base64,/.test(pages.demo.content), 'CSS 背景圖轉成 data URI');
check(pages.demo.content.includes('href="https://script.google.com/macros/s/TEST/exec/demo/about.html"'), '連結指向 /exec/demo/about.html');
check(pages['demo/blog/first-post.html'].content.includes('href="https://script.google.com/macros/s/TEST/exec/demo/blog/"'), '子目錄頁面的相對連結正確');
check(pages.docs.content.includes('function toggleNote()') && !pages.docs.content.includes('(()=>'), 'docs 的全域函式維持原樣');
check(pages.docs.content.includes('href="https://script.google.com/macros/s/TEST/exec/demo/"'), '跨網站連結 ../demo/ 正確');
check(pages['docs/app.js'].kind === 'text', '/docs/app.js 以文字回傳');
check(pages['demo/site.json'].title.startsWith('找不到頁面') && pages['demo/_build.json'].title.startsWith('找不到頁面'), 'site.json、_build.json 不對外提供');
check(pages.nope.title === '404 找不到網站', '不存在的網站顯示 404');
check(pages['demo/nope.html'].title === '找不到頁面', '不存在的頁面顯示網站自己的 404.html');

console.log('\n▶ buildChanged()');
results = await run('buildChanged()');
check(results.length === 0, '沒有變更時不重新建置');
const versionBefore = props['CACHE_VERSION:demo'];
fs.writeFileSync(path.join(SITES, 'demo/js/clock.ts'), fs.readFileSync(path.join(SITES, 'demo/js/clock.ts'), 'utf8').replace("el.textContent = format(new Date());", "el.textContent = '⏰ ' + format(new Date());"));
fs.utimesSync(path.join(SITES, 'demo/js/clock.ts'), new Date(), new Date(Date.now() + 5000));
fetches = 0;
results = await run('buildChanged()');
check(results.length === 1 && results[0].site === 'demo', '只重新建置有變更的 demo');
check(props['CACHE_VERSION:demo'] !== versionBefore, 'demo 的快取版本已更新');
check(fetches === 0, 'esm.sh 的模組從快取讀取（UrlFetchApp 0 次）');
check(get('demo').content.includes('⏰'), '頁面顯示新版程式碼');

console.log('\n▶ 建置錯誤');
fs.writeFileSync(path.join(SITES, 'demo/js/clock.ts'), 'export function startClock( {');
fs.utimesSync(path.join(SITES, 'demo/js/clock.ts'), new Date(), new Date(Date.now() + 10000));
await run('buildChanged()');
check(/console\.error\(.*建置失敗.*clock\.ts:1/.test(get('demo').content), '錯誤訊息（含檔名與行號）顯示在瀏覽器 console');

console.log('\n▶ installBuildTrigger()');
run('installBuildTrigger(); installBuildTrigger();');
check(triggers.length === 1 && triggers[0].fn === 'buildChanged', '只建立一個 buildChanged 觸發器');

if (KEEP) {
  const out = path.join(ROOT, 'tools/out');
  fs.mkdirSync(out, { recursive: true });
  for (const [p, r] of Object.entries(pages)) if (r.kind === 'html') fs.writeFileSync(path.join(out, (p || 'index').replace(/\//g, '__') + '.html'), r.content);
  console.log('\n輸出：' + out + '\n暫存：' + TMP);
} else {
  fs.rmSync(TMP, { recursive: true, force: true });
}
console.log(failures ? `\n✘ ${failures} 項失敗` : '\n✔ 全部通過');
process.exit(failures ? 1 : 0);
