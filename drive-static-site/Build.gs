/**
 * 在 Apps Script 裡執行 esbuild（WebAssembly 版），打包每個網站 HTML 引用的 JS / TS / CSS。
 *
 *   buildAll()             重新建置所有網站
 *   buildChanged()         只建置有檔案變更的網站，並讓它們的快取失效（給時間觸發器用）
 *   installBuildTrigger()  每 CONFIG.BUILD_TRIGGER_MINUTES 分鐘自動執行 buildChanged()
 *   removeBuildTrigger()
 *   installEsbuild()       下載 esbuild.wasm 到 Drive（第一次建置會自動執行）
 *
 * 哪些檔案會被打包：
 *   - <script type="module" src="…">   → ESM（可以 import 其他檔案、npm 套件）
 *   - <script src="….ts/.tsx/.jsx">     → IIFE
 *   - <script src="….js"> 且有 import / export / require → IIFE
 *     （沒有的維持原樣，避免全域函式被包進 IIFE 後 onclick="fn()" 找不到）
 *   - <link rel="stylesheet" href="…">  → 合併 @import、minify；url() 保留路徑，由 Code.gs 決定內嵌方式
 * 打包結果寫到網站根目錄的 _build.json，Code.gs 輸出頁面時會改用打包後的程式碼。
 *
 * import 的解析：
 *   './x'、'../x'、'/x'   → 同一個網站資料夾裡的檔案（自動補 .ts .tsx .js .jsx .mjs .json .css 與 /index.*）
 *   'dayjs'、'react/jsx-runtime' → site.json 的 imports 對應，否則 https://esm.sh/<套件>
 *   'https://…'           → 用 UrlFetchApp 下載
 *   圖片、字型            → data URI
 */

const BUILD_TIME_BUDGET_MS_ = 4.5 * 60 * 1000; // Apps Script 單次執行上限 6 分鐘
const SOURCE_EXTS_ = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.mts', '.cjs', '.json', '.css'];
const LOADER_BY_EXT_ = {
  ts: 'ts', mts: 'ts', cts: 'ts', tsx: 'tsx', js: 'js', mjs: 'js', cjs: 'js', jsx: 'jsx',
  json: 'json', css: 'css', txt: 'text', md: 'text', html: 'text', csv: 'text', svg: 'dataurl',
  png: 'dataurl', jpg: 'dataurl', jpeg: 'dataurl', gif: 'dataurl', webp: 'dataurl', avif: 'dataurl', ico: 'dataurl',
  woff: 'dataurl', woff2: 'dataurl', ttf: 'dataurl', otf: 'dataurl', eot: 'dataurl', wasm: 'binary',
};
const MODULE_SYNTAX_RE_ = /^\s*(import\s*[\w{*'"(]|export\s)|\brequire\s*\(\s*['"]/m;

async function buildAll() {
  return buildSites_(listSiteNames_(), true);
}

async function buildChanged() {
  return buildSites_(listSiteNames_(), false);
}

function installBuildTrigger() {
  removeBuildTrigger();
  ScriptApp.newTrigger('buildChanged').timeBased().everyMinutes(CONFIG.BUILD_TRIGGER_MINUTES).create();
  console.log('已設定每 ' + CONFIG.BUILD_TRIGGER_MINUTES + ' 分鐘檢查一次網站變更');
}

function removeBuildTrigger() {
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === 'buildChanged')
    .forEach((t) => ScriptApp.deleteTrigger(t));
}

/** 下載對應版本的 esbuild.wasm（約 12MB）到 Google Drive 的「我的雲端硬碟」。 */
function installEsbuild() {
  const url = 'https://unpkg.com/esbuild-wasm@' + ESBUILD_VERSION + '/esbuild.wasm';
  const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
  if (res.getResponseCode() !== 200) throw new Error('下載 esbuild.wasm 失敗（HTTP ' + res.getResponseCode() + '）：' + url);
  const file = DriveApp.createFile(res.getBlob().setName(esbuildWasmName_()).setContentType('application/wasm'));
  setProp_('ESBUILD_WASM_FILE_ID', file.getId());
  console.log('已下載 ' + file.getName() + '（' + formatBytes_(file.getSize()) + '）到 Drive：' + file.getUrl());
  return file;
}

// ---------------------------------------------------------------------------
// 建置流程
// ---------------------------------------------------------------------------

async function buildSites_(names, force) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) {
    console.log('另一個建置正在執行，略過這次');
    return [];
  }
  const started = Date.now();
  const results = [];
  let esbuild = null;
  try {
    for (const name of names) {
      if (Date.now() - started > BUILD_TIME_BUDGET_MS_) {
        console.warn('時間快用完了，剩下的網站下次再建置');
        break;
      }
      const site = siteRef_(name);
      if (!siteFolder_(site)) continue;

      const files = scanSiteFiles_(site);
      const fingerprint = fingerprint_(files);
      const previous = siteManifest_(site);
      if (!force && previous && previous.fingerprint === fingerprint) continue;

      const t0 = Date.now();
      site.files = files; // 建置期間 Code.gs 的 getFileByPath_ 直接查這份清單
      const entries = findEntries_(site, files);
      const built = {};
      const paths = Object.keys(entries);
      if (paths.length && !esbuild) esbuild = await startEsbuild_();
      for (const path of paths) built[path] = await bundleEntry_(esbuild, site, files, path, entries[path]);

      writeManifest_(site, {
        fingerprint: fingerprint,
        builtAt: new Date().toISOString(),
        esbuild: ESBUILD_VERSION,
        entries: built,
      });
      bumpSiteVersion_(name);

      const failed = paths.filter((p) => built[p].error);
      results.push({ site: name, entries: paths.length, failed: failed.length });
      console.log((failed.length ? '✗ ' : '✓ ') + name + '：' + paths.length + ' 個進入點' +
        (failed.length ? '，' + failed.length + ' 個失敗' : '') + '（' + (Date.now() - t0) + ' ms）');
      paths.forEach((p) => {
        const e = built[p];
        if (e.error) console.error('  ' + p + '\n' + e.error);
        else console.log('  ' + p + ' → ' + formatBytes_(e.code.length) + (e.css ? ' + CSS ' + formatBytes_(e.css.length) : ''));
        (e.warnings || []).forEach((w) => console.warn('  ⚠ ' + w));
      });
    }
    if (!results.length) console.log('沒有需要建置的網站');
    return results;
  } finally {
    if (esbuild) esbuild.stop(); // 清掉 Go runtime 的計時器，讓這次執行可以結束
    lock.releaseLock();
  }
}

/** 遞迴列出網站資料夾裡所有檔案：Map<相對路徑, File> */
function scanSiteFiles_(site) {
  const files = new Map();
  const walk = (folder, prefix) => {
    const fi = folder.getFiles();
    while (fi.hasNext()) {
      const f = fi.next();
      const p = prefix + f.getName();
      if (!f.isTrashed() && p !== MANIFEST_FILE_ && f.getName().charAt(0) !== '.' && !files.has(p)) files.set(p, f);
    }
    const di = folder.getFolders();
    while (di.hasNext()) {
      const d = di.next();
      if (!d.isTrashed() && d.getName().charAt(0) !== '.') walk(d, prefix + d.getName() + '/');
    }
  };
  walk(siteFolder_(site), '');
  return files;
}

function fingerprint_(files) {
  const lines = [];
  files.forEach((f, p) => lines.push(p + '|' + f.getLastUpdated().getTime() + '|' + f.getSize()));
  lines.sort();
  return Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, lines.join('\n'), Utilities.Charset.UTF_8));
}

/** 掃描所有 HTML，找出要打包的進入點：{ 'js/main.ts': { kind: 'js', module: true }, 'css/a.css': { kind: 'css' } } */
function findEntries_(site, files) {
  const entries = {};
  files.forEach((file, htmlPath) => {
    if (!/\.html?$/i.test(htmlPath)) return;
    const baseDir = dirname_(htmlPath);
    readText_(file).replace(HTML_TOKEN_RE_, (m, blockName, blockAttrs, body, tagName, tagAttrs) => {
      const isScript = blockName && blockName.toLowerCase() === 'script';
      const isLink = tagName && tagName.toLowerCase() === 'link';
      if (!isScript && !isLink) return m;
      const tag = parseTag_(isScript ? 'script' : 'link', isScript ? blockAttrs : tagAttrs);
      const ref = getAttr_(tag, isScript ? 'src' : 'href');
      if (ref == null || !isLocalRef_(ref)) return m;
      const path = resolveRef_(ref, baseDir, htmlPath).path;
      const target = files.get(path);
      if (!target) return m;

      if (isLink) {
        const rel = (getAttr_(tag, 'rel') || '').toLowerCase().split(/\s+/);
        if (rel.indexOf('stylesheet') >= 0) entries[path] = { kind: 'css' };
        return m;
      }
      const isModule = (getAttr_(tag, 'type') || '').toLowerCase() === 'module';
      const prev = entries[path];
      if (isModule || (prev && prev.module)) {
        entries[path] = { kind: 'js', module: true };
      } else if (NEEDS_BUILD_RE_.test(path) || MODULE_SYNTAX_RE_.test(readText_(target))) {
        entries[path] = { kind: 'js', module: false };
      }
      return m;
    });
  });
  return entries;
}

async function bundleEntry_(esbuild, site, files, path, entry) {
  const cfg = siteConfig_(site);
  const b = cfg.build;
  const format = entry.kind === 'css' ? undefined : entry.module ? 'esm' : 'iife';
  try {
    const result = await esbuild.build({
      entryPoints: ['/' + path],
      bundle: true,
      write: false,
      outdir: '/out',
      format: format,
      minify: b.minify !== false,
      target: b.target,
      sourcemap: b.sourcemap ? 'inline' : false,
      jsx: b.jsx,
      jsxImportSource: b.jsxImportSource,
      define: Object.assign({ 'process.env.NODE_ENV': '"production"' }, b.define),
      charset: 'utf8',
      legalComments: 'none',
      logLevel: 'silent',
      plugins: [drivePlugin_(cfg, files)],
    });
    const js = result.outputFiles.find((f) => /\.js$/.test(f.path));
    const css = result.outputFiles.find((f) => /\.css$/.test(f.path));
    const warnings = result.warnings.map(formatMessage_);
    if (entry.kind === 'css') return { kind: 'css', code: css ? css.text : '', warnings: warnings };
    return { kind: 'js', format: format, code: js ? js.text : '', css: css ? css.text : undefined, warnings: warnings };
  } catch (err) {
    const msgs = err && err.errors ? err.errors.map(formatMessage_) : [String((err && err.stack) || err)];
    return { kind: entry.kind, error: msgs.join('\n') };
  }
}

function formatMessage_(m) {
  const loc = m.location ? m.location.file.replace(/^site:\//, '') + ':' + m.location.line + ':' + m.location.column + ' ' : '';
  return loc + m.text;
}

/** esbuild plugin：網站檔案從 Drive 讀取、npm 套件與網址用 UrlFetchApp 下載。 */
function drivePlugin_(cfg, files) {
  const findSource = (path) => {
    if (files.has(path)) return path;
    for (const ext of SOURCE_EXTS_) if (files.has(path + ext)) return path + ext;
    for (const ext of SOURCE_EXTS_) if (files.has(joinPath_(path, 'index' + ext))) return joinPath_(path, 'index' + ext);
    return null;
  };
  const isBare = (p) => !/^(\.{1,2}\/|\/|[a-z][a-z0-9+.\-]*:)/i.test(p);

  return {
    name: 'drive-static-site',
    setup(build) {
      build.onResolve({ filter: /.*/ }, (args) => {
        const p = args.path;
        const css = args.kind === 'url-token' || args.kind === 'import-rule';

        // 從網址下載的模組裡的 import（esm.sh 會用 /pkg@版本/... 的絕對路徑）
        if (args.namespace === 'http') {
          if (/^data:/i.test(p)) return { path: p, external: true };
          if (css) return { path: resolveUrl_(args.importer, p), external: true };
          return { path: isBare(p) ? cdnUrl_(cfg, p) : resolveUrl_(args.importer, p), namespace: 'http' };
        }
        if (/^https?:\/\//i.test(p)) return css ? { path: p, external: true } : { path: p, namespace: 'http' };
        if (/^(#|\/\/|[a-z][a-z0-9+.\-]*:)/i.test(p)) return { path: p, external: true };
        if (isBare(p) && !css) return { path: cdnUrl_(cfg, p), namespace: 'http' };

        // 網站內的檔案（CSS 的 url(x.png) 也是相對路徑）
        const m = p.match(/^([^?#]*)(.*)$/);
        const importerDir = args.namespace === 'site' ? dirname_(args.importer.replace(/^\//, '')) : '';
        const target = normalizePath_(m[1].charAt(0) === '/' ? m[1] : joinPath_(importerDir, m[1]));
        // CSS 裡的圖片、字型：改成網站根目錄的絕對路徑，留給 Code.gs 轉 data URI 或縮圖網址
        if (args.kind === 'url-token') return { path: '/' + target + m[2], external: true };
        const found = findSource(target);
        if (!found) return { errors: [{ text: '找不到檔案：' + p + '（' + (target || '/') + '）' }] };
        return { path: '/' + found, namespace: 'site' };
      });

      build.onLoad({ filter: /.*/, namespace: 'site' }, (args) => {
        const path = args.path.slice(1);
        const ext = (path.match(/\.([a-z0-9]+)$/i) || [])[1];
        const loader = LOADER_BY_EXT_[(ext || '').toLowerCase()] || 'text';
        const file = files.get(path);
        const binary = loader === 'dataurl' || loader === 'binary';
        return { contents: binary ? new Uint8Array(file.getBlob().getBytes()) : readText_(file), loader: loader };
      });

      build.onLoad({ filter: /.*/, namespace: 'http' }, (args) => fetchModule_(args.path));
    },
  };
}

/** import 'dayjs' → site.json 的 imports 對應，否則 CDN（預設 esm.sh） */
function cdnUrl_(cfg, spec) {
  const map = cfg.imports || {};
  if (map[spec]) return map[spec];
  const prefix = Object.keys(map)
    .filter((k) => k.slice(-1) === '/' && spec.indexOf(k) === 0)
    .sort((a, b) => b.length - a.length)[0];
  if (prefix) return map[prefix] + spec.slice(prefix.length);
  return cfg.cdn.replace(/\/?$/, '/') + spec;
}

/** 沒有 URL 類別的 Apps Script 版 new URL(rel, base).href */
function resolveUrl_(base, rel) {
  if (/^[a-z][a-z0-9+.\-]*:/i.test(rel)) return rel;
  const m = base.match(/^([a-z][a-z0-9+.\-]*:)\/\/([^/?#]*)([^?#]*)/i);
  if (rel.slice(0, 2) === '//') return m[1] + rel;
  const parts = rel.match(/^([^?#]*)(.*)$/);
  const path = parts[1].charAt(0) === '/' ? parts[1] : m[3].replace(/[^/]*$/, '') + parts[1];
  return m[1] + '//' + m[2] + '/' + normalizePath_(path) + parts[2];
}

function fetchModule_(url) {
  const cache = CacheService.getScriptCache();
  const key = 'http:' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, url, Utilities.Charset.UTF_8));
  let text = cache.get(key);
  if (text == null) {
    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
    if (res.getResponseCode() >= 400) return { errors: [{ text: '下載失敗（HTTP ' + res.getResponseCode() + '）：' + url }] };
    text = res.getContentText('UTF-8');
    if (text.length < 90000) cache.put(key, text, 21600);
  }
  const ext = (url.replace(/[?#].*$/, '').match(/\.([a-z0-9]+)$/i) || [])[1];
  const loader = { css: 'css', json: 'json', ts: 'ts', tsx: 'tsx', jsx: 'jsx' }[(ext || '').toLowerCase()] || 'js';
  return { contents: text, loader: loader };
}

function writeManifest_(site, data) {
  const json = JSON.stringify(data);
  const folder = siteFolder_(site);
  const existing = findChild_(folder, MANIFEST_FILE_, 'file');
  if (existing) {
    try {
      existing.setContent(json);
      return;
    } catch (err) {
      existing.setTrashed(true); // 內容太大時 setContent 會失敗，改成重新建立
    }
  }
  folder.createFile(Utilities.newBlob('', 'application/json', MANIFEST_FILE_).setDataFromString(json, 'UTF-8'));
}

// ---------------------------------------------------------------------------
// esbuild 初始化
// ---------------------------------------------------------------------------

function esbuildWasmName_() {
  return 'esbuild-' + ESBUILD_VERSION + '.wasm';
}

async function startEsbuild_() {
  const t0 = Date.now();
  installPolyfills_();
  const esbuild = esbuildModule_();
  const wasmModule = await WebAssembly.compile(esbuildWasmBytes_());
  await esbuild.initialize({ wasmModule: wasmModule, worker: false });
  console.log('esbuild ' + esbuild.version + ' 已啟動（' + (Date.now() - t0) + ' ms）');
  return esbuild;
}

function esbuildWasmBytes_() {
  let file = null;
  const id = props_().ESBUILD_WASM_FILE_ID;
  if (id) {
    try {
      file = DriveApp.getFileById(id);
      if (file.isTrashed() || file.getName() !== esbuildWasmName_()) file = null;
    } catch (err) {
      file = null;
    }
  }
  if (!file) file = installEsbuild();
  return new Uint8Array(file.getBlob().getBytes());
}
