/**
 * Drive Static Sites
 * 一個 Apps Script Web App，把 Google Drive 上的多個資料夾當成多個靜態網站。
 *
 *   SITES_FOLDER/                  https://script.google.com/macros/s/<部署ID>/exec
 *   ├── blog/       ──────────→    …/exec/blog/            → blog/index.html
 *   │   ├── index.html             …/exec/blog/about.html  → blog/about.html
 *   │   ├── site.json   （選用）每個網站自己的設定
 *   │   └── _build.json （自動產生）esbuild 打包結果
 *   └── docs/       ──────────→    …/exec/docs/
 *
 * Apps Script 的 HtmlService 會把頁面放進 googleusercontent.com 的沙盒 iframe，
 * 瀏覽器無法再用相對路徑載入 CSS / JS / 圖片，所以伺服器端會改寫 HTML：
 *   - <script src> / <link rel="stylesheet"> 內嵌（有 esbuild 打包結果就用打包後的版本，見 Build.gs）
 *   - 公開分享的圖片改用 Drive 縮圖網址，其餘檔案轉成 data URI
 *   - <a href> 等頁面連結改成 Web App 的絕對網址（並跳出 iframe）
 * 改寫結果壓縮後放進 CacheService；Build.gs 的 buildChanged() 偵測到檔案變更會自動讓快取失效。
 */

const CONFIG = {
  // 放網站的 Drive 資料夾 ID，每個子資料夾就是一個網站（子資料夾名稱 = 網址第一段）。
  // 也可以在「專案設定 → 指令碼屬性」設定 SITES_FOLDER_ID（優先）。
  SITES_FOLDER_ID: '',
  // 不在 SITES_FOLDER 裡的網站：指令碼屬性 SITES = {"名稱": "資料夾ID", ...}
  // /exec 直接顯示這個網站的首頁；留空則顯示網站列表
  DEFAULT_SITE: '',
  // 沒有 DEFAULT_SITE 時，/exec 是否列出所有網站
  LIST_SITES: true,
  // 快取秒數（最長 21600 = 6 小時），0 代表不快取
  CACHE_SECONDS: 600,
  // 是否允許其他網站用 iframe 嵌入
  ALLOW_IFRAME_EMBED: false,
  // 分頁圖示網址（HtmlService 只接受 http(s) 網址）
  FAVICON_URL: '',
  DEFAULT_VIEWPORT: 'width=device-width, initial-scale=1',
  // 自動建置的檢查間隔（分鐘，只能是 1、5、10、15、30），見 installBuildTrigger()
  BUILD_TRIGGER_MINUTES: 10,

  // 每個網站的預設設定，可以在網站根目錄放 site.json 覆寫其中任何欄位
  SITE_DEFAULTS: {
    indexFiles: ['index.html', 'index.htm'],
    notFound: '404.html',
    autoIndex: false,
    // 圖片（png / jpeg / webp / bmp）：
    //   'auto'   公開分享（知道連結的人可檢視）的用 Drive 縮圖網址，否則內嵌成 data URI
    //   'drive'  一律用縮圖網址；'inline' 一律內嵌
    // drive.google.com/uc?id=… 不能用在 <img>（瀏覽器會以 ERR_BLOCKED_BY_ORB 擋下），縮圖網址可以。
    imageMode: 'auto',
    thumbnailSize: 'w2000',
    // 超過這個大小的檔案不轉 data URI（圖片改縮圖網址，其他改 Drive 下載連結）
    maxInlineBytes: 5 * 1024 * 1024,
    // esbuild 選項（Build.gs）
    build: {
      minify: true,
      target: 'es2020',
      sourcemap: false,
      jsx: undefined, // 'automatic' 搭配 jsxImportSource 使用 React 17+ 的 JSX runtime
      jsxImportSource: undefined,
      define: {},
    },
    // npm 套件來源：import 'dayjs' → https://esm.sh/dayjs
    cdn: 'https://esm.sh/',
    // 指定套件版本或網址（類似 import map），鍵以 / 結尾代表前綴對應
    imports: {},
  },
};

const MIME_BY_EXT_ = {
  html: 'text/html', htm: 'text/html', css: 'text/css', js: 'text/javascript', mjs: 'text/javascript',
  json: 'application/json', map: 'application/json', webmanifest: 'application/manifest+json',
  txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', xml: 'application/xml',
  rss: 'application/rss+xml', atom: 'application/atom+xml', ics: 'text/calendar', vcf: 'text/vcard',
  svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', avif: 'image/avif', ico: 'image/x-icon', bmp: 'image/bmp',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf', eot: 'application/vnd.ms-fontobject',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', mp4: 'video/mp4', webm: 'video/webm',
  vtt: 'text/vtt', pdf: 'application/pdf', zip: 'application/zip',
  ts: 'text/plain', tsx: 'text/plain', jsx: 'text/plain',
};

const SITE_CONFIG_FILE_ = 'site.json';
const MANIFEST_FILE_ = '_build.json';
const NEEDS_BUILD_RE_ = /\.(tsx?|jsx|mts|cts)$/i;
const MAX_CACHE_CHUNKS_ = 40; // 每塊 90KB，約 3.6MB
const CACHE_CHUNK_SIZE_ = 90000;
const MAX_CSS_DEPTH_ = 5;

// 一次執行內的暫存
const memo_ = { baseUrl: undefined, props: null, sites: {} };

// ---------------------------------------------------------------------------
// 入口
// ---------------------------------------------------------------------------

function doGet(e) {
  try {
    return handleRequest_((e && e.pathInfo) || '');
  } catch (err) {
    console.error(err && err.stack ? err.stack : err);
    return messagePage_(null, '500', '伺服器錯誤', String((err && err.message) || err));
  }
}

/** 讓所有網站的快取立即失效。 */
function purgeCache() {
  setProp_('CACHE_VERSION', String(Date.now()));
  console.log('已清除所有網站的快取');
}

/** 在編輯器執行，檢查設定並列出所有網站。 */
function checkSetup() {
  const root = sitesRoot_();
  console.log('網站資料夾：' + (root ? root.getName() + ' (' + root.getId() + ')' : '（未設定 SITES_FOLDER_ID）'));
  const extra = explicitSites_();
  if (Object.keys(extra).length) console.log('指令碼屬性 SITES：' + JSON.stringify(extra));
  console.log('Web App 網址：' + (getBaseUrl_() || '（尚未部署）'));
  listSiteNames_().forEach((name) => {
    const site = siteRef_(name);
    const folder = siteFolder_(site);
    if (!folder) return console.log('✗ ' + name + '：找不到資料夾');
    const cfg = siteConfig_(site);
    const index = cfg.indexFiles.map((n) => findChild_(folder, n, 'file')).find(Boolean);
    const manifest = siteManifest_(site);
    const built = manifest ? Object.keys(manifest.entries || {}).length + ' 個進入點，' + manifest.builtAt : '尚未建置';
    console.log((index ? '✓ ' : '⚠ ') + name + '  ' + siteUrl_(site, '', true) +
      '\n    首頁：' + (index ? index.getName() : '沒有 ' + cfg.indexFiles.join(' / ')) +
      '\n    圖片：' + cfg.imageMode + (isPublic_(folder) ? '（資料夾已公開）' : '（資料夾未公開）') +
      '\n    建置：' + built);
  });
}

function handleRequest_(rawPath) {
  const full = normalizePath_(/%[0-9a-f]{2}/i.test(rawPath) ? safeDecode_(rawPath) : rawPath);
  if (!full) {
    if (CONFIG.DEFAULT_SITE) return serveSite_(siteRef_(CONFIG.DEFAULT_SITE), '');
    if (CONFIG.LIST_SITES) return htmlOutput_(renderSiteList_());
    return messagePage_(null, '404', '找不到頁面', '/');
  }
  const i = full.indexOf('/');
  const name = i < 0 ? full : full.slice(0, i);
  return serveSite_(siteRef_(name), i < 0 ? '' : full.slice(i + 1));
}

function serveSite_(site, reqPath) {
  const cacheKey = 'page:' + reqPath;
  const cached = cacheGetJson_(site, cacheKey);
  if (cached) return htmlOutput_(cached);

  if (!siteFolder_(site)) return messagePage_(null, '404', '找不到網站', site.name);
  if (isHiddenPath_(reqPath)) return notFound_(site, reqPath);

  const cfg = siteConfig_(site);
  const node = resolvePath_(site, reqPath);
  if (!node) return notFound_(site, reqPath);

  if (node.kind === 'folder') {
    for (const name of cfg.indexFiles) {
      const file = findChild_(node.folder, name, 'file');
      if (file) return renderAndCache_(site, file, joinPath_(reqPath, name), cacheKey);
    }
    if (cfg.autoIndex) return htmlOutput_(renderListing_(site, node.folder, reqPath));
    return notFound_(site, reqPath);
  }

  if (guessMime_(reqPath, node.file) === 'text/html') return renderAndCache_(site, node.file, reqPath, cacheKey);
  return serveAsset_(site, node.file, reqPath);
}

function renderAndCache_(site, file, filePath, cacheKey) {
  const page = renderHtmlPage_(site, readText_(file), filePath);
  cachePutJson_(site, cacheKey, page);
  return htmlOutput_(page);
}

function notFound_(site, reqPath) {
  const name = siteConfig_(site).notFound;
  if (name && reqPath !== name) {
    const cached = cacheGetJson_(site, 'page:' + name);
    if (cached) return htmlOutput_(cached);
    const file = findChild_(siteFolder_(site), name, 'file');
    if (file) return renderAndCache_(site, file, name, 'page:' + name);
  }
  return messagePage_(site, '404', '找不到頁面', '/' + site.name + '/' + reqPath);
}

/** 設定檔、建置結果、以 . 開頭的檔案不對外提供 */
function isHiddenPath_(path) {
  return path === SITE_CONFIG_FILE_ || path === MANIFEST_FILE_ || path.split('/').some((s) => s.charAt(0) === '.');
}

// ---------------------------------------------------------------------------
// 網站
// ---------------------------------------------------------------------------

/** 不碰 Drive 的網站參照；資料夾、設定、建置結果都在需要時才讀取。 */
function siteRef_(name) {
  if (!memo_.sites[name]) memo_.sites[name] = { name: name, nodes: {} };
  return memo_.sites[name];
}

function sitesRoot_() {
  if (memo_.sitesRoot === undefined) {
    const id = props_().SITES_FOLDER_ID || CONFIG.SITES_FOLDER_ID;
    memo_.sitesRoot = id ? DriveApp.getFolderById(id) : null;
  }
  return memo_.sitesRoot;
}

function explicitSites_() {
  const raw = props_().SITES;
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch (err) {
    console.warn('指令碼屬性 SITES 不是合法的 JSON：' + err);
    return {};
  }
}

function listSiteNames_() {
  const names = Object.keys(explicitSites_());
  const root = sitesRoot_();
  if (root) {
    const it = root.getFolders();
    while (it.hasNext()) {
      const f = it.next();
      const n = f.getName();
      if (!f.isTrashed() && !/^[._]/.test(n) && names.indexOf(n) < 0) names.push(n);
    }
  }
  return names.sort();
}

function siteFolder_(site) {
  if (site.folder !== undefined) return site.folder;
  let folder = null;
  if (site.name && !/^[._]/.test(site.name)) {
    try {
      const explicitId = explicitSites_()[site.name];
      const cached = explicitId ? null : cacheGet_(null, 'site:' + site.name);
      if (explicitId) {
        folder = DriveApp.getFolderById(explicitId);
      } else if (cached) {
        folder = cached === '-' ? null : DriveApp.getFolderById(cached);
      } else {
        const root = sitesRoot_();
        folder = root ? findChild_(root, site.name, 'folder') : null;
        cachePut_(null, 'site:' + site.name, folder ? folder.getId() : '-');
      }
      if (folder && folder.isTrashed()) folder = null;
    } catch (err) {
      folder = null;
    }
  }
  site.folder = folder;
  return folder;
}

function siteConfig_(site) {
  if (!site.config) {
    let custom = {};
    const folder = siteFolder_(site);
    const file = folder && findChild_(folder, SITE_CONFIG_FILE_, 'file');
    if (file) {
      try {
        custom = JSON.parse(readText_(file));
      } catch (err) {
        console.warn(site.name + '/' + SITE_CONFIG_FILE_ + ' 格式錯誤：' + err);
      }
    }
    const d = CONFIG.SITE_DEFAULTS;
    site.config = Object.assign({}, d, custom, {
      build: Object.assign({}, d.build, custom.build),
      imports: Object.assign({}, d.imports, custom.imports),
    });
  }
  return site.config;
}

/** esbuild 打包結果（Build.gs 寫入網站根目錄的 _build.json） */
function siteManifest_(site) {
  if (site.manifest === undefined) {
    site.manifest = null;
    const folder = siteFolder_(site);
    const file = folder && findChild_(folder, MANIFEST_FILE_, 'file');
    if (file) {
      try {
        site.manifest = JSON.parse(readText_(file));
      } catch (err) {
        console.warn(site.name + '/' + MANIFEST_FILE_ + ' 讀取失敗：' + err);
      }
    }
  }
  return site.manifest;
}

function builtEntry_(site, path) {
  const m = siteManifest_(site);
  return m && m.entries && m.entries[path] ? m.entries[path] : null;
}

function bumpSiteVersion_(name) {
  setProp_('CACHE_VERSION:' + name, String(Date.now()));
}

// ---------------------------------------------------------------------------
// 輸出
// ---------------------------------------------------------------------------

function htmlOutput_(page) {
  const out = HtmlService.createHtmlOutput(page.html)
    .setTitle(page.title || 'Untitled')
    .addMetaTag('viewport', page.viewport || CONFIG.DEFAULT_VIEWPORT);
  if (CONFIG.ALLOW_IFRAME_EMBED) out.setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  if (CONFIG.FAVICON_URL) out.setFaviconUrl(CONFIG.FAVICON_URL);
  return out;
}

/** 直接請求非 HTML 檔案：文字檔用 ContentService，圖片與其他檔案用一個簡單頁面呈現。 */
function serveAsset_(site, file, path) {
  const mime = guessMime_(path, file);
  const name = file.getName();

  if (mime.indexOf('image/') === 0) {
    const src = fileUri_(site, file, mime);
    return htmlOutput_({
      title: name,
      html: '<base target="_top"><style>body{margin:0;display:grid;place-items:center;min-height:100vh;background:#111}' +
        'img{max-width:100%;max-height:100vh}</style><img src="' + escapeAttr_(src) + '" alt="' + escapeAttr_(name) + '">',
    });
  }

  if (isTextMime_(mime)) {
    return ContentService.createTextOutput(readText_(file)).setMimeType(contentServiceMime_(mime));
  }

  const href = fileUri_(site, file, mime);
  const isData = href.indexOf('data:') === 0;
  return htmlOutput_({
    title: name,
    html: '<base target="_top">' + pageStyle_() + '<main><h1>' + escapeHtml_(name) + '</h1><p>' +
      formatBytes_(file.getSize()) + ' · ' + escapeHtml_(mime) + '</p><p><a class="btn" href="' + escapeAttr_(href) + '"' +
      (isData ? ' download="' + escapeAttr_(name) + '"' : ' target="_blank" rel="noopener"') + '>下載</a></p></main>',
  });
}

function renderSiteList_() {
  const items = listSiteNames_().map((n) =>
    '<li><a href="' + escapeAttr_(siteUrl_(siteRef_(n), '', true)) + '">' + escapeHtml_(n) + '</a></li>');
  return {
    title: '網站列表',
    html: '<base target="_top">' + pageStyle_() + '<main><h1>網站列表</h1>' +
      (items.length ? '<ul>' + items.join('') + '</ul>' : '<p>還沒有任何網站。</p>') + '</main>',
  };
}

function renderListing_(site, folder, reqPath) {
  const rows = [];
  if (reqPath) rows.push({ name: '../', href: siteUrl_(site, dirname_(reqPath), true) });
  const folders = [];
  const files = [];
  const fi = folder.getFolders();
  while (fi.hasNext()) {
    const f = fi.next();
    if (!f.isTrashed() && f.getName().charAt(0) !== '.') folders.push(f.getName());
  }
  const it = folder.getFiles();
  while (it.hasNext()) {
    const f = it.next();
    const p = joinPath_(reqPath, f.getName());
    if (!f.isTrashed() && !isHiddenPath_(p)) files.push(f.getName());
  }
  folders.sort().forEach((n) => rows.push({ name: n + '/', href: siteUrl_(site, joinPath_(reqPath, n), true) }));
  files.sort().forEach((n) => rows.push({ name: n, href: siteUrl_(site, joinPath_(reqPath, n), false) }));
  const title = 'Index of /' + site.name + '/' + reqPath;
  return {
    title: title,
    html: '<base target="_top">' + pageStyle_() + '<main><h1>' + escapeHtml_(title) + '</h1><ul>' +
      rows.map((r) => '<li><a href="' + escapeAttr_(r.href) + '">' + escapeHtml_(r.name) + '</a></li>').join('') +
      '</ul></main>',
  };
}

function messagePage_(site, code, title, detail) {
  const home = site && siteFolder_(site) ? siteUrl_(site, '', true) : getBaseUrl_() || '/';
  return htmlOutput_({
    title: code + ' ' + title,
    html: '<base target="_top">' + pageStyle_() + '<main><h1>' + escapeHtml_(code + ' ' + title) + '</h1><p>' +
      escapeHtml_(detail) + '</p><p><a href="' + escapeAttr_(home) + '">回首頁</a></p></main>',
  });
}

function pageStyle_() {
  return '<style>body{font:16px/1.6 system-ui,sans-serif;margin:0;color:#222;background:#fff}' +
    'main{max-width:720px;margin:0 auto;padding:32px 16px}a{color:#1a73e8}' +
    '.btn{display:inline-block;padding:8px 16px;border-radius:6px;background:#1a73e8;color:#fff;text-decoration:none}' +
    '@media (prefers-color-scheme:dark){body{background:#1e1e1e;color:#eee}a{color:#8ab4f8}}</style>';
}

// ---------------------------------------------------------------------------
// HTML 改寫
// ---------------------------------------------------------------------------

// 註解 | <script>/<style> 區塊（內容不處理標籤） | 一般開始標籤（屬性值可含 >）
const HTML_TOKEN_RE_ =
  /<!--[\s\S]*?-->|<(script|style)\b((?:[^>"']|"[^"]*"|'[^']*')*)>([\s\S]*?)<\/\1\s*>|<([a-zA-Z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/gi;

const ATTR_RE_ = /([^\s"'>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

// 這些屬性指向的檔案會轉成 data URI / 縮圖網址
const ASSET_ATTRS_ = {
  img: ['src'], source: ['src'], video: ['src', 'poster'], audio: ['src'], track: ['src'],
  embed: ['src'], input: ['src'], object: ['data'], image: ['href', 'xlink:href'],
};
// 這些屬性指向的是頁面，改成 Web App 網址
const PAGE_ATTRS_ = { a: ['href'], area: ['href'], form: ['action'], iframe: ['src'], frame: ['src'] };

/**
 * @param {Object} site
 * @param {string} html 原始 HTML
 * @param {string} pagePath 頁面在網站中的路徑，例如 "blog/post.html"
 * @return {{title: string, viewport: string, html: string}}
 */
function renderHtmlPage_(site, html, pagePath) {
  const ctx = { site: site, pagePath: pagePath, baseDir: dirname_(pagePath), assets: {}, deferred: [] };
  let out = html.replace(HTML_TOKEN_RE_, (m, blockName, blockAttrs, body, tagName, tagAttrs) => {
    if (m.charAt(1) === '!') return m;
    if (blockName) {
      const name = blockName.toLowerCase();
      return name === 'script'
        ? rewriteScript_(m, parseTag_(name, blockAttrs), ctx)
        : '<' + blockName + blockAttrs + '>' + rewriteCss_(body, ctx.baseDir, ctx, 0) + '</style>';
    }
    return rewriteTag_(m, parseTag_(tagName.toLowerCase(), tagAttrs), ctx);
  });

  // defer 的外部 script 內嵌後會失去 defer 效果，移到 </body> 前維持執行順序
  if (ctx.deferred.length) {
    const scripts = ctx.deferred.join('\n');
    const idx = out.search(/<\/body\s*>(?![\s\S]*<\/body\s*>)/i);
    out = idx >= 0 ? out.slice(0, idx) + scripts + '\n' + out.slice(idx) : out + '\n' + scripts;
  }

  // 頁面在沙盒 iframe 內：連結預設跳出到最上層；並提供網站根網址給前端 JS 使用
  const inject = '<base target="_top">\n<script>window.SITE_BASE_URL=' +
    JSON.stringify(siteUrl_(site, '', false)).replace(/</g, '\\u003c') +
    ';window.siteUrl=function(p){return window.SITE_BASE_URL+"/"+String(p||"").replace(/^\\/+/,"");};</script>\n';
  const head = out.match(/<head\b(?:[^>"']|"[^"]*"|'[^']*')*>/i);
  out = head ? out.slice(0, head.index + head[0].length) + '\n' + inject + out.slice(head.index + head[0].length) : inject + out;

  return { title: extractTitle_(html) || pagePath, viewport: extractViewport_(html), html: out };
}

function rewriteScript_(original, tag, ctx) {
  const src = getAttr_(tag, 'src');
  if (src == null || !isLocalRef_(src)) return original;
  const ref = resolveRef_(src, ctx.baseDir, ctx.pagePath);

  let code;
  let css = '';
  const built = builtEntry_(ctx.site, ref.path);
  if (built) {
    if (built.error) return consoleError_(ref.path + ' 建置失敗：\n' + built.error);
    code = built.code;
    css = built.css || '';
  } else {
    const file = getFileByPath_(ctx.site, ref.path);
    if (!file) return original;
    if (NEEDS_BUILD_RE_.test(ref.path)) return consoleError_(ref.path + ' 尚未建置，請在 Apps Script 執行 buildAll()');
    code = readText_(file);
  }

  code = code.replace(/<\/script/gi, '<\\/script');
  const isModule = (getAttr_(tag, 'type') || '').toLowerCase() === 'module';
  const deferred = getAttr_(tag, 'defer') != null && !isModule;
  ['src', 'integrity', 'crossorigin', 'defer', 'async'].forEach((n) => removeAttr_(tag, n));
  // JS 裡 import 的 CSS 由 esbuild 輸出成獨立的 CSS
  const style = css ? '<style>\n' + rewriteCss_(css, dirname_(ref.path), ctx, 1).replace(/<\/style/gi, '<\\/style') + '\n</style>' : '';
  const out = buildTag_(tag) + code + '</script>';
  if (deferred) {
    ctx.deferred.push(out);
    return style;
  }
  return style + out;
}

function consoleError_(message) {
  return '<script>console.error(' + JSON.stringify(message).replace(/</g, '\\u003c') + ');</script>';
}

function rewriteTag_(original, tag, ctx) {
  const style = getAttr_(tag, 'style');
  if (style && /url\(|@import/i.test(style)) setAttr_(tag, 'style', rewriteCss_(style, ctx.baseDir, ctx, 0));

  if (tag.name === 'link') {
    const replaced = rewriteLink_(tag, ctx);
    if (replaced != null) return replaced;
  }

  (PAGE_ATTRS_[tag.name] || []).forEach((attr) => {
    const v = getAttr_(tag, attr);
    if (v == null) return;
    if (attr === 'href' && v.trim().charAt(0) === '#' && getAttr_(tag, 'target') == null) {
      setAttr_(tag, 'target', '_self'); // 同頁錨點不要被 <base target="_top"> 帶走
      return;
    }
    const url = pageHref_(v, ctx);
    if (url != null) setAttr_(tag, attr, url);
  });

  (ASSET_ATTRS_[tag.name] || []).forEach((attr) => {
    const v = getAttr_(tag, attr);
    const uri = v != null && isLocalRef_(v) ? assetUri_(resolveRef_(v, ctx.baseDir, ctx.pagePath), ctx, 0) : null;
    if (uri) setAttr_(tag, attr, uri);
  });

  if (tag.name === 'img' || tag.name === 'source') {
    const srcset = getAttr_(tag, 'srcset');
    if (srcset) setAttr_(tag, 'srcset', rewriteSrcset_(srcset, ctx));
  }

  return tag.changed ? buildTag_(tag) : original;
}

/** 回傳取代用的字串；回傳 null 表示照一般標籤處理。 */
function rewriteLink_(tag, ctx) {
  const href = getAttr_(tag, 'href');
  if (href == null || !isLocalRef_(href)) return null;
  const rel = (getAttr_(tag, 'rel') || '').toLowerCase().split(/\s+/);
  const ref = resolveRef_(href, ctx.baseDir, ctx.pagePath);

  if (rel.indexOf('stylesheet') >= 0) {
    let css;
    const built = builtEntry_(ctx.site, ref.path);
    if (built) {
      if (built.error) return consoleError_(ref.path + ' 建置失敗：\n' + built.error);
      css = built.code;
    } else {
      const file = getFileByPath_(ctx.site, ref.path);
      if (!file) return null;
      css = readText_(file);
    }
    css = rewriteCss_(css, dirname_(ref.path), ctx, 1).replace(/<\/style/gi, '<\\/style');
    const media = getAttr_(tag, 'media');
    return '<style' + (media ? ' media="' + escapeAttr_(media) + '"' : '') + '>\n' + css + '\n</style>';
  }
  // 資源都已內嵌，預先載入沒有意義
  if (['preload', 'prefetch', 'modulepreload'].some((r) => rel.indexOf(r) >= 0)) return '';

  const uri = assetUri_(ref, ctx, 0);
  if (uri) setAttr_(tag, 'href', uri);
  return null;
}

function rewriteCss_(css, baseDir, ctx, depth) {
  return css
    .replace(/@import\s+(['"])([^'"]+)\1/gi, (m, q, u) => '@import url(' + q + u + q + ')')
    .replace(/url\(\s*(['"]?)(.*?)\1\s*\)/gi, (m, q, u) => {
      if (!isLocalRef_(u)) return m;
      const uri = assetUri_(resolveRef_(u, baseDir, ctx.pagePath), ctx, depth);
      return uri ? 'url("' + uri + '")' : m;
    });
}

function rewriteSrcset_(srcset, ctx) {
  return srcset.split(',').map((part) => {
    const m = part.trim().match(/^(\S+)(.*)$/);
    if (!m || !isLocalRef_(m[1])) return part.trim();
    const uri = assetUri_(resolveRef_(m[1], ctx.baseDir, ctx.pagePath), ctx, 0);
    return (uri || m[1]) + m[2];
  }).join(', ');
}

function pageHref_(href, ctx) {
  if (!isLocalRef_(href)) return null;
  const ref = resolveRef_(href, ctx.baseDir, ctx.pagePath);
  // 相對路徑往上超出網站根目錄（例如 ../other-site/）就連到同一個部署的其他網站
  const p = String(href).trim().replace(/[?#].*$/, '');
  if (p && p.charAt(0) !== '/') {
    const hostPath = normalizePath_(joinPath_(joinPath_(ctx.site.name, ctx.baseDir), p.split('/').map(safeDecode_).join('/')));
    if (hostPath.split('/')[0] !== ctx.site.name) {
      return getBaseUrl_() + (hostPath ? '/' + hostPath.split('/').map(encodeURIComponent).join('/') + (ref.isDir ? '/' : '') : '') + ref.suffix;
    }
  }
  return siteUrl_(ctx.site, ref.path, ref.isDir) + ref.suffix;
}

/** 把網站內的檔案轉成可直接嵌入的網址（data URI 或 Drive 縮圖網址）。 */
function assetUri_(ref, ctx, depth) {
  const hash = ref.suffix.indexOf('#') >= 0 ? ref.suffix.slice(ref.suffix.indexOf('#')) : '';
  if (!(ref.path in ctx.assets)) {
    const file = getFileByPath_(ctx.site, ref.path);
    let uri = null;
    if (file) {
      const mime = guessMime_(ref.path, file);
      if (mime === 'text/css' && depth < MAX_CSS_DEPTH_) {
        const css = rewriteCss_(readText_(file), dirname_(ref.path), ctx, depth + 1);
        uri = 'data:text/css;charset=utf-8;base64,' + Utilities.base64Encode(css, Utilities.Charset.UTF_8);
      } else {
        uri = fileUri_(ctx.site, file, mime);
      }
    }
    ctx.assets[ref.path] = uri;
  }
  const uri = ctx.assets[ref.path];
  return uri ? uri + hash : null;
}

const THUMBNAIL_MIME_RE_ = /^image\/(png|jpeg|webp|bmp)$/;

function fileUri_(site, file, mime) {
  const cfg = siteConfig_(site);
  const thumbnailable = THUMBNAIL_MIME_RE_.test(mime);
  if (thumbnailable && cfg.imageMode !== 'inline' && (cfg.imageMode === 'drive' || isPublic_(file))) {
    return thumbnailUrl_(file, cfg);
  }
  if (file.getSize() > cfg.maxInlineBytes) {
    // uc 連結只適合當下載連結；被 <img>/<video> 等內嵌載入時會被瀏覽器擋下
    return thumbnailable
      ? thumbnailUrl_(file, cfg)
      : 'https://drive.google.com/uc?export=download&id=' + encodeURIComponent(file.getId());
  }
  return 'data:' + mime + ';base64,' + Utilities.base64Encode(file.getBlob().getBytes());
}

function thumbnailUrl_(file, cfg) {
  return 'https://drive.google.com/thumbnail?id=' + encodeURIComponent(file.getId()) +
    '&sz=' + encodeURIComponent(cfg.thumbnailSize);
}

/** 匿名訪客能不能看到這個檔案（縮圖網址需要）。 */
function isPublic_(item) {
  try {
    const access = item.getSharingAccess();
    return access === DriveApp.Access.ANYONE || access === DriveApp.Access.ANYONE_WITH_LINK;
  } catch (err) {
    return false;
  }
}

function extractTitle_(html) {
  const m = html.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i);
  return m ? decodeEntities_(m[1].trim()) : '';
}

function extractViewport_(html) {
  const metas = html.match(/<meta\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi) || [];
  for (const meta of metas) {
    const tag = parseTag_('meta', meta.slice(5, -1));
    if ((getAttr_(tag, 'name') || '').toLowerCase() === 'viewport') return getAttr_(tag, 'content') || '';
  }
  return '';
}

// ---------------------------------------------------------------------------
// 標籤解析
// ---------------------------------------------------------------------------

function parseTag_(name, attrStr) {
  const attrs = [];
  let m;
  ATTR_RE_.lastIndex = 0;
  while ((m = ATTR_RE_.exec(attrStr))) {
    const raw = m[2] != null ? m[2] : m[3] != null ? m[3] : m[4];
    attrs.push({ name: m[1], value: raw == null ? null : decodeEntities_(raw) });
  }
  return { name: name, attrs: attrs, selfClose: /\/\s*$/.test(attrStr), changed: false };
}

function findAttr_(tag, name) {
  return tag.attrs.find((a) => a.name.toLowerCase() === name);
}

/** 屬性不存在回傳 null，沒有值（例如 defer）回傳空字串。 */
function getAttr_(tag, name) {
  const a = findAttr_(tag, name);
  return a ? (a.value == null ? '' : a.value) : null;
}

function setAttr_(tag, name, value) {
  const a = findAttr_(tag, name);
  if (a) a.value = value;
  else tag.attrs.push({ name: name, value: value });
  tag.changed = true;
}

function removeAttr_(tag, name) {
  const before = tag.attrs.length;
  tag.attrs = tag.attrs.filter((a) => a.name.toLowerCase() !== name);
  if (tag.attrs.length !== before) tag.changed = true;
}

function buildTag_(tag) {
  const attrs = tag.attrs.map((a) => (a.value == null ? ' ' + a.name : ' ' + a.name + '="' + escapeAttr_(a.value) + '"'));
  return '<' + tag.name + attrs.join('') + (tag.selfClose ? ' />' : '>');
}

// ---------------------------------------------------------------------------
// 路徑
// ---------------------------------------------------------------------------

/** 是否為網站內的相對 / 根目錄路徑（排除 http:、data:、mailto:、//cdn、#anchor 等）。 */
function isLocalRef_(ref) {
  const s = String(ref).trim();
  return !!s && !/^(#|[a-z][a-z0-9+.\-]*:|\/\/)/i.test(s) && !/^(\{\{|<\?|\$\{)/.test(s);
}

/**
 * 解析相對路徑（/ 開頭代表網站根目錄）。"../css/a.css?v=1#x" 在 baseDir="blog" 時
 * → { path: "css/a.css", suffix: "?v=1#x", isDir: false }
 */
function resolveRef_(ref, baseDir, pagePath) {
  const m = String(ref).trim().match(/^([^?#]*)(.*)$/);
  const p = m[1];
  if (!p) return { path: pagePath || '', suffix: m[2], isDir: false };
  const full = p.charAt(0) === '/' ? p : (baseDir ? baseDir + '/' : '') + p;
  return {
    path: normalizePath_(full.split('/').map(safeDecode_).join('/')),
    suffix: m[2],
    isDir: /(^|\/)(\.\.?)?$/.test(p),
  };
}

/** 去掉多餘的斜線、處理 . 與 ..（不會超出根目錄）。 */
function normalizePath_(path) {
  const out = [];
  String(path).split('/').forEach((seg) => {
    if (!seg || seg === '.') return;
    if (seg === '..') out.pop();
    else out.push(seg);
  });
  return out.join('/');
}

function dirname_(path) {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i);
}

function joinPath_(dir, name) {
  return dir ? dir + '/' + name : name;
}

function safeDecode_(s) {
  try {
    return decodeURIComponent(s);
  } catch (err) {
    return s;
  }
}

function siteUrl_(site, path, isDir) {
  const root = getBaseUrl_() + '/' + encodeURIComponent(site.name);
  if (!path) return root + (isDir ? '/' : '');
  return root + '/' + path.split('/').map(encodeURIComponent).join('/') + (isDir ? '/' : '');
}

function getBaseUrl_() {
  if (memo_.baseUrl === undefined) {
    let url = '';
    try {
      url = ScriptApp.getService().getUrl() || '';
    } catch (err) {
      url = '';
    }
    memo_.baseUrl = url.replace(/\/+$/, '');
  }
  return memo_.baseUrl;
}

// ---------------------------------------------------------------------------
// Drive
// ---------------------------------------------------------------------------

function getFileByPath_(site, path) {
  if (site.files) return site.files.get(path) || null; // 建置時已掃描過整個網站
  const node = resolvePath_(site, path);
  return node && node.kind === 'file' ? node.file : null;
}

/** 網站內的路徑 → { kind: 'file', file } | { kind: 'folder', folder } | null，Drive ID 會快取。 */
function resolvePath_(site, path) {
  if (path in site.nodes) return site.nodes[path];
  let node = null;

  if (!path) {
    node = { kind: 'folder', folder: siteFolder_(site) };
  } else {
    const key = 'node:' + path;
    const cached = cacheGet_(site, key);
    if (cached && cached !== '-') node = loadNode_(cached);
    if (!cached || (cached !== '-' && !node)) {
      node = walkPath_(siteFolder_(site), path);
      cachePut_(site, key, node ? (node.kind === 'file' ? 'f:' + node.file.getId() : 'd:' + node.folder.getId()) : '-');
    }
  }
  site.nodes[path] = node;
  return node;
}

function loadNode_(cached) {
  try {
    const id = cached.slice(2);
    if (cached.charAt(0) === 'f') {
      const file = DriveApp.getFileById(id);
      return file.isTrashed() ? null : { kind: 'file', file: file };
    }
    const folder = DriveApp.getFolderById(id);
    return folder.isTrashed() ? null : { kind: 'folder', folder: folder };
  } catch (err) {
    return null; // 檔案已刪除或權限變更，重新走路徑
  }
}

function walkPath_(root, path) {
  const segs = path.split('/');
  let folder = root;
  for (let i = 0; i < segs.length; i++) {
    if (i === segs.length - 1) {
      const file = findChild_(folder, segs[i], 'file');
      if (file) return { kind: 'file', file: file };
    }
    folder = findChild_(folder, segs[i], 'folder');
    if (!folder) return null;
  }
  return { kind: 'folder', folder: folder };
}

function findChild_(folder, name, kind) {
  const it = kind === 'file' ? folder.getFilesByName(name) : folder.getFoldersByName(name);
  while (it.hasNext()) {
    const item = it.next();
    if (!item.isTrashed()) return item;
  }
  return null;
}

function readText_(file) {
  return file.getBlob().getDataAsString('UTF-8').replace(/^﻿/, '');
}

function guessMime_(path, file) {
  const ext = (path.match(/\.([a-z0-9]+)$/i) || [])[1];
  return (ext && MIME_BY_EXT_[ext.toLowerCase()]) || (file && file.getMimeType()) || 'application/octet-stream';
}

function isTextMime_(mime) {
  return mime.indexOf('text/') === 0 || /json|javascript|xml/.test(mime);
}

function contentServiceMime_(mime) {
  const M = ContentService.MimeType;
  if (/json/.test(mime)) return M.JSON;
  if (/javascript/.test(mime)) return M.JAVASCRIPT;
  if (mime === 'text/csv') return M.CSV;
  if (/rss/.test(mime)) return M.RSS;
  if (/atom/.test(mime)) return M.ATOM;
  if (/xml/.test(mime)) return M.XML;
  if (mime === 'text/calendar') return M.ICAL;
  if (mime === 'text/vcard') return M.VCARD;
  return M.TEXT; // ContentService 沒有 text/css、text/html，一律以純文字回傳
}

// ---------------------------------------------------------------------------
// 指令碼屬性與快取（CacheService 每個值上限 100KB：先 gzip 再分塊）
// ---------------------------------------------------------------------------

function props_() {
  if (!memo_.props) memo_.props = PropertiesService.getScriptProperties().getProperties();
  return memo_.props;
}

function setProp_(key, value) {
  PropertiesService.getScriptProperties().setProperty(key, value);
  if (memo_.props) memo_.props[key] = value;
}

/** site 為 null 時是全域快取；否則鍵值包含該網站的版本，buildChanged() / purgeCache() 會換版本。 */
function cacheKey_(site, key) {
  const p = props_();
  const version = (p.CACHE_VERSION || '0') + '.' + (site ? p['CACHE_VERSION:' + site.name] || '0' : '');
  const raw = version + '|' + getBaseUrl_() + '|' + (site ? site.name : '') + '|' + key;
  return Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, raw, Utilities.Charset.UTF_8));
}

function cacheGet_(site, key) {
  if (!(CONFIG.CACHE_SECONDS > 0)) return null;
  return CacheService.getScriptCache().get(cacheKey_(site, key));
}

function cachePut_(site, key, value) {
  if (!(CONFIG.CACHE_SECONDS > 0)) return;
  CacheService.getScriptCache().put(cacheKey_(site, key), value, CONFIG.CACHE_SECONDS);
}

function cacheGetJson_(site, key) {
  if (!(CONFIG.CACHE_SECONDS > 0)) return null;
  try {
    const cache = CacheService.getScriptCache();
    const k = cacheKey_(site, key);
    const n = Number(cache.get(k));
    if (!n) return null;
    const keys = [];
    for (let i = 0; i < n; i++) keys.push(k + '.' + i);
    const parts = cache.getAll(keys);
    let b64 = '';
    for (const pk of keys) {
      if (parts[pk] == null) return null;
      b64 += parts[pk];
    }
    const blob = Utilities.newBlob(Utilities.base64Decode(b64), 'application/x-gzip');
    return JSON.parse(Utilities.ungzip(blob).getDataAsString('UTF-8'));
  } catch (err) {
    console.warn('讀取快取失敗：' + err);
    return null;
  }
}

function cachePutJson_(site, key, obj) {
  if (!(CONFIG.CACHE_SECONDS > 0)) return;
  try {
    const gz = Utilities.gzip(Utilities.newBlob('').setDataFromString(JSON.stringify(obj), 'UTF-8'));
    const b64 = Utilities.base64Encode(gz.getBytes());
    const n = Math.ceil(b64.length / CACHE_CHUNK_SIZE_);
    if (n > MAX_CACHE_CHUNKS_) return; // 太大就不快取
    const k = cacheKey_(site, key);
    const entries = {};
    for (let i = 0; i < n; i++) entries[k + '.' + i] = b64.substr(i * CACHE_CHUNK_SIZE_, CACHE_CHUNK_SIZE_);
    entries[k] = String(n);
    CacheService.getScriptCache().putAll(entries, CONFIG.CACHE_SECONDS);
  } catch (err) {
    console.warn('寫入快取失敗：' + err);
  }
}

// ---------------------------------------------------------------------------
// 字串工具
// ---------------------------------------------------------------------------

function escapeHtml_(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr_(s) {
  return escapeHtml_(s).replace(/"/g, '&quot;');
}

function decodeEntities_(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|#39);/gi, (m, e) => {
    const k = e.toLowerCase();
    if (k.charAt(0) === '#') {
      const code = k.charAt(1) === 'x' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
      try {
        return String.fromCodePoint(code);
      } catch (err) {
        return m;
      }
    }
    return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[k];
  });
}

function formatBytes_(n) {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1024 / 1024).toFixed(1) + ' MB';
}
