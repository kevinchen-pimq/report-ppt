/**
 * Drive Static Site
 * 把一個 Google Drive 資料夾當成靜態網站，用 Apps Script Web App 對外提供。
 *
 *   https://script.google.com/macros/s/<部署ID>/exec              → /index.html
 *   https://script.google.com/macros/s/<部署ID>/exec/about.html   → /about.html
 *   https://script.google.com/macros/s/<部署ID>/exec/blog/        → /blog/index.html
 *
 * Apps Script 的 HtmlService 會把頁面放進 googleusercontent.com 的沙盒 iframe，
 * 所以瀏覽器無法再用相對路徑去抓 CSS / JS / 圖片。這支程式在伺服器端把 HTML 改寫：
 *   - <link rel="stylesheet"> 與 <script src> 直接內嵌
 *   - 圖片、字型、CSS 裡的 url() 轉成 data URI
 *   - <a href> 等頁面連結改成指向 Web App 的絕對網址（並跳出 iframe）
 * 改寫結果會壓縮後放進 CacheService，修改 Drive 內容後執行 purgeCache() 立即生效。
 */

const CONFIG = {
  // 網站根目錄的 Drive 資料夾 ID。也可以在「專案設定 → 指令碼屬性」設定 ROOT_FOLDER_ID（優先）。
  ROOT_FOLDER_ID: '',
  // 請求資料夾時依序尋找的首頁檔名
  INDEX_FILES: ['index.html', 'index.htm'],
  // 找不到檔案時顯示的頁面（放在根目錄），不存在就用內建的 404 頁
  NOT_FOUND_PAGE: '404.html',
  // 快取秒數（最長 21600 = 6 小時），0 代表不快取
  CACHE_SECONDS: 600,
  // 超過這個大小的圖片 / 檔案不轉 data URI，改用 Drive 連結（檔案需設為「知道連結的人可檢視」）
  MAX_INLINE_BYTES: 5 * 1024 * 1024,
  // 資料夾沒有首頁時，是否列出檔案清單
  AUTO_INDEX: false,
  // 是否允許其他網站用 iframe 嵌入
  ALLOW_IFRAME_EMBED: false,
  // 分頁圖示網址（HtmlService 只接受 http(s) 網址，留空則用 Google 預設）
  FAVICON_URL: '',
  DEFAULT_VIEWPORT: 'width=device-width, initial-scale=1',
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
};

const MAX_CACHE_CHUNKS_ = 40; // 每塊 90KB，約 3.6MB
const CACHE_CHUNK_SIZE_ = 90000;
const MAX_CSS_DEPTH_ = 5;

// 一次請求內的暫存
const memo_ = { baseUrl: undefined, cacheVersion: null, root: null, nodes: {} };

// ---------------------------------------------------------------------------
// 入口
// ---------------------------------------------------------------------------

function doGet(e) {
  try {
    return handleRequest_((e && e.pathInfo) || '');
  } catch (err) {
    console.error(err && err.stack ? err.stack : err);
    return messagePage_('500', '伺服器錯誤', String((err && err.message) || err));
  }
}

/** 修改 Drive 內容後執行這個函式，讓所有快取立即失效。 */
function purgeCache() {
  const props = PropertiesService.getScriptProperties();
  const next = String(Number(props.getProperty('CACHE_VERSION') || '0') + 1);
  props.setProperty('CACHE_VERSION', next);
  console.log('快取已清除，CACHE_VERSION = ' + next);
}

/** 在編輯器執行，確認根目錄設定正確並列出首頁會載入的內容。 */
function checkSetup() {
  const root = getRootFolder_();
  console.log('根目錄：' + root.getName() + ' (' + root.getId() + ')');
  const node = resolvePath_('');
  const index = CONFIG.INDEX_FILES.map((n) => findChild_(node.folder, n, 'file')).find(Boolean);
  console.log(index ? '首頁：' + index.getName() : '警告：根目錄沒有 ' + CONFIG.INDEX_FILES.join(' / '));
  console.log('Web App 網址：' + (getBaseUrl_() || '（尚未部署）'));
}

function handleRequest_(rawPath) {
  const reqPath = normalizePath_(/%[0-9a-f]{2}/i.test(rawPath) ? safeDecode_(rawPath) : rawPath);
  const cacheKey = 'page:' + reqPath;
  const cached = cacheGetJson_(cacheKey);
  if (cached) return htmlOutput_(cached);

  const node = resolvePath_(reqPath);
  if (!node) return notFound_(reqPath);

  if (node.kind === 'folder') {
    for (const name of CONFIG.INDEX_FILES) {
      const file = findChild_(node.folder, name, 'file');
      if (file) return renderAndCache_(file, joinPath_(reqPath, name), cacheKey);
    }
    if (CONFIG.AUTO_INDEX) return htmlOutput_(renderListing_(node.folder, reqPath));
    return notFound_(reqPath);
  }

  if (isHtmlPath_(reqPath, node.file)) return renderAndCache_(node.file, reqPath, cacheKey);
  return serveAsset_(node.file, reqPath);
}

function renderAndCache_(file, filePath, cacheKey) {
  const page = renderHtmlPage_(readText_(file), filePath);
  cachePutJson_(cacheKey, page);
  return htmlOutput_(page);
}

function notFound_(reqPath) {
  const name = CONFIG.NOT_FOUND_PAGE;
  if (name && reqPath !== name) {
    const cached = cacheGetJson_('page:' + name);
    if (cached) return htmlOutput_(cached);
    const file = findChild_(getRootFolder_(), name, 'file');
    if (file) return renderAndCache_(file, name, 'page:' + name);
  }
  return messagePage_('404', '找不到頁面', '/' + reqPath);
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
function serveAsset_(file, path) {
  const mime = guessMime_(path, file);
  const name = file.getName();

  if (mime.indexOf('image/') === 0) {
    const src = fileUri_(file, mime);
    return htmlOutput_({
      title: name,
      html: '<base target="_top"><style>body{margin:0;display:grid;place-items:center;min-height:100vh;background:#111}' +
        'img{max-width:100%;max-height:100vh}</style><img src="' + escapeAttr_(src) + '" alt="' + escapeAttr_(name) + '">',
    });
  }

  if (isTextMime_(mime)) {
    return ContentService.createTextOutput(readText_(file)).setMimeType(contentServiceMime_(mime));
  }

  const href = fileUri_(file, mime);
  const isData = href.indexOf('data:') === 0;
  return htmlOutput_({
    title: name,
    html: '<base target="_top">' + pageStyle_() + '<main><h1>' + escapeHtml_(name) + '</h1><p>' +
      formatBytes_(file.getSize()) + ' · ' + escapeHtml_(mime) + '</p><p><a class="btn" href="' + escapeAttr_(href) + '"' +
      (isData ? ' download="' + escapeAttr_(name) + '"' : ' target="_blank" rel="noopener"') + '>下載</a></p></main>',
  });
}

function renderListing_(folder, reqPath) {
  const rows = [];
  if (reqPath) rows.push({ name: '../', href: siteUrl_(dirname_(reqPath), true) });
  const folders = [];
  const files = [];
  const fi = folder.getFolders();
  while (fi.hasNext()) {
    const f = fi.next();
    if (!f.isTrashed()) folders.push(f.getName());
  }
  const it = folder.getFiles();
  while (it.hasNext()) {
    const f = it.next();
    if (!f.isTrashed()) files.push(f.getName());
  }
  folders.sort().forEach((n) => rows.push({ name: n + '/', href: siteUrl_(joinPath_(reqPath, n), true) }));
  files.sort().forEach((n) => rows.push({ name: n, href: siteUrl_(joinPath_(reqPath, n), false) }));
  const title = 'Index of /' + reqPath;
  return {
    title: title,
    html: '<base target="_top">' + pageStyle_() + '<main><h1>' + escapeHtml_(title) + '</h1><ul>' +
      rows.map((r) => '<li><a href="' + escapeAttr_(r.href) + '">' + escapeHtml_(r.name) + '</a></li>').join('') +
      '</ul></main>',
  };
}

function messagePage_(code, title, detail) {
  return htmlOutput_({
    title: code + ' ' + title,
    html: '<base target="_top">' + pageStyle_() + '<main><h1>' + escapeHtml_(code + ' ' + title) + '</h1><p>' +
      escapeHtml_(detail) + '</p><p><a href="' + escapeAttr_(siteUrl_('', true)) + '">回首頁</a></p></main>',
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

// 這些屬性指向的檔案會轉成 data URI
const ASSET_ATTRS_ = {
  img: ['src'], source: ['src'], video: ['src', 'poster'], audio: ['src'], track: ['src'],
  embed: ['src'], input: ['src'], object: ['data'], image: ['href', 'xlink:href'],
};
// 這些屬性指向的是頁面，改成 Web App 網址
const PAGE_ATTRS_ = { a: ['href'], area: ['href'], form: ['action'], iframe: ['src'], frame: ['src'] };

/**
 * @param {string} html 原始 HTML
 * @param {string} pagePath 這個頁面在網站中的路徑，例如 "blog/post.html"
 * @return {{title: string, viewport: string, html: string}}
 */
function renderHtmlPage_(html, pagePath) {
  const ctx = { pagePath: pagePath, baseDir: dirname_(pagePath), assets: {}, deferred: [] };
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

  // defer 的外部 script 被內嵌後會失去 defer 效果，移到 </body> 前維持執行順序
  if (ctx.deferred.length) {
    const scripts = ctx.deferred.join('\n');
    const idx = out.search(/<\/body\s*>(?![\s\S]*<\/body\s*>)/i);
    out = idx >= 0 ? out.slice(0, idx) + scripts + '\n' + out.slice(idx) : out + '\n' + scripts;
  }

  // 頁面在沙盒 iframe 內：連結預設跳出到最上層；並提供網站根網址給前端 JS 使用
  const baseUrl = getBaseUrl_();
  const inject = '<base target="_top">\n<script>window.SITE_BASE_URL=' + JSON.stringify(baseUrl).replace(/</g, '\\u003c') +
    ';window.siteUrl=function(p){return window.SITE_BASE_URL+"/"+String(p||"").replace(/^\\/+/,"");};</script>\n';
  const head = out.match(/<head\b(?:[^>"']|"[^"]*"|'[^']*')*>/i);
  out = head ? out.slice(0, head.index + head[0].length) + '\n' + inject + out.slice(head.index + head[0].length) : inject + out;

  return { title: extractTitle_(html) || pagePath, viewport: extractViewport_(html), html: out };
}

function rewriteScript_(original, tag, ctx) {
  const src = getAttr_(tag, 'src');
  if (src == null || !isLocalRef_(src)) return original;
  const ref = resolveRef_(src, ctx.baseDir, ctx.pagePath);
  const file = getFileByPath_(ref.path);
  if (!file) return original;

  const code = readText_(file).replace(/<\/script/gi, '<\\/script');
  const isModule = (getAttr_(tag, 'type') || '').toLowerCase() === 'module';
  const deferred = getAttr_(tag, 'defer') != null && !isModule;
  ['src', 'integrity', 'crossorigin', 'defer', 'async'].forEach((n) => removeAttr_(tag, n));
  const out = buildTag_(tag) + code + '</script>';
  if (deferred) {
    ctx.deferred.push(out);
    return '';
  }
  return out;
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
    const file = getFileByPath_(ref.path);
    if (!file) return null;
    const css = rewriteCss_(readText_(file), dirname_(ref.path), ctx, 1).replace(/<\/style/gi, '<\\/style');
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
  return siteUrl_(ref.path, ref.isDir) + ref.suffix;
}

/** 把網站內的檔案轉成可直接嵌入的網址（data URI 或 Drive 連結）。 */
function assetUri_(ref, ctx, depth) {
  const hash = ref.suffix.indexOf('#') >= 0 ? ref.suffix.slice(ref.suffix.indexOf('#')) : '';
  if (!(ref.path in ctx.assets)) {
    const file = getFileByPath_(ref.path);
    let uri = null;
    if (file) {
      const mime = guessMime_(ref.path, file);
      if (mime === 'text/css' && depth < MAX_CSS_DEPTH_) {
        const css = rewriteCss_(readText_(file), dirname_(ref.path), ctx, depth + 1);
        uri = 'data:text/css;charset=utf-8;base64,' + Utilities.base64Encode(css, Utilities.Charset.UTF_8);
      } else {
        uri = fileUri_(file, mime);
      }
    }
    ctx.assets[ref.path] = uri;
  }
  const uri = ctx.assets[ref.path];
  return uri ? uri + hash : null;
}

function fileUri_(file, mime) {
  if (file.getSize() > CONFIG.MAX_INLINE_BYTES) {
    return 'https://drive.google.com/uc?export=view&id=' + encodeURIComponent(file.getId());
  }
  return 'data:' + mime + ';base64,' + Utilities.base64Encode(file.getBlob().getBytes());
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
 * 解析相對路徑。"../css/a.css?v=1#x" 在 baseDir="blog" 時
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

function siteUrl_(path, isDir) {
  const base = getBaseUrl_();
  if (!path) return base + (base ? '' : '/');
  return base + '/' + path.split('/').map(encodeURIComponent).join('/') + (isDir ? '/' : '');
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

function getRootFolder_() {
  if (!memo_.root) {
    const id = PropertiesService.getScriptProperties().getProperty('ROOT_FOLDER_ID') || CONFIG.ROOT_FOLDER_ID;
    if (!id) throw new Error('尚未設定 ROOT_FOLDER_ID（指令碼屬性或 CONFIG）');
    memo_.root = DriveApp.getFolderById(id);
  }
  return memo_.root;
}

function getFileByPath_(path) {
  const node = resolvePath_(path);
  return node && node.kind === 'file' ? node.file : null;
}

/** 路徑 → { kind: 'file', file } | { kind: 'folder', folder } | null，結果會快取 Drive ID。 */
function resolvePath_(path) {
  if (path in memo_.nodes) return memo_.nodes[path];
  let node = null;

  if (!path) {
    node = { kind: 'folder', folder: getRootFolder_() };
  } else {
    const key = 'node:' + path;
    const cached = cacheGet_(key);
    if (cached === '-') {
      node = null;
    } else if (cached) {
      node = loadNode_(cached);
    }
    if (!cached || (cached !== '-' && !node)) {
      node = walkPath_(path);
      cachePut_(key, node ? (node.kind === 'file' ? 'f:' + node.file.getId() : 'd:' + node.folder.getId()) : '-');
    }
  }
  memo_.nodes[path] = node;
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

function walkPath_(path) {
  const segs = path.split('/');
  let folder = getRootFolder_();
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

function isHtmlPath_(path, file) {
  return guessMime_(path, file) === 'text/html';
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
// 快取（CacheService 每個值上限 100KB：先 gzip 再分塊）
// ---------------------------------------------------------------------------

function cacheKey_(key) {
  if (memo_.cacheVersion == null) {
    memo_.cacheVersion = PropertiesService.getScriptProperties().getProperty('CACHE_VERSION') || '0';
  }
  const raw = memo_.cacheVersion + '|' + getBaseUrl_() + '|' + key;
  return Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, raw, Utilities.Charset.UTF_8));
}

function cacheGet_(key) {
  if (!(CONFIG.CACHE_SECONDS > 0)) return null;
  return CacheService.getScriptCache().get(cacheKey_(key));
}

function cachePut_(key, value) {
  if (!(CONFIG.CACHE_SECONDS > 0)) return;
  CacheService.getScriptCache().put(cacheKey_(key), value, CONFIG.CACHE_SECONDS);
}

function cacheGetJson_(key) {
  if (!(CONFIG.CACHE_SECONDS > 0)) return null;
  try {
    const cache = CacheService.getScriptCache();
    const k = cacheKey_(key);
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

function cachePutJson_(key, obj) {
  if (!(CONFIG.CACHE_SECONDS > 0)) return;
  try {
    const gz = Utilities.gzip(Utilities.newBlob('').setDataFromString(JSON.stringify(obj), 'UTF-8'));
    const b64 = Utilities.base64Encode(gz.getBytes());
    const n = Math.ceil(b64.length / CACHE_CHUNK_SIZE_);
    if (n > MAX_CACHE_CHUNKS_) return; // 太大就不快取
    const k = cacheKey_(key);
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
