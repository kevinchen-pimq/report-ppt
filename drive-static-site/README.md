# Drive Static Site

用 Google Apps Script 把一個 Google Drive 資料夾變成靜態網站。

```
Drive 資料夾                      網址
├── index.html          →  https://script.google.com/macros/s/<ID>/exec
├── about.html          →  …/exec/about.html
├── css/style.css          （自動內嵌）
├── js/app.js              （自動內嵌）
├── img/logo.svg           （轉成 data URI）
└── blog/
    ├── index.html      →  …/exec/blog/
    └── first-post.html →  …/exec/blog/first-post.html
```

`example-site/` 是範例網站的原始碼，用 `npm run build` 打包後上傳 `dist/`。

## 為什麼要改寫 HTML？

Apps Script 的網頁一律放在 `*.googleusercontent.com` 的沙盒 iframe 裡，而 `ContentService`
無法回傳 `text/css` 或圖片等二進位檔。所以瀏覽器沒辦法照一般網站那樣用相對路徑去抓資源。

`Code.gs` 在伺服器端讀取 HTML 後會：

| 原始寫法 | 改寫結果 |
| --- | --- |
| `<link rel="stylesheet" href="css/a.css">` | 內嵌成 `<style>`（CSS 裡的 `url()`、`@import` 也會處理） |
| `<script src="js/a.js">` | 內嵌成 `<script>`；`defer` 的會移到 `</body>` 前保持執行順序 |
| `<img src>`、`srcset`、CSS 背景圖（png / jpeg / webp） | 公開分享的檔案用 Drive 縮圖網址，否則轉成 `data:` URI（見下方「圖片」） |
| SVG、GIF、`<video poster>`、`<link rel="icon">`、字型 | 轉成 `data:` URI |
| `<a href="about.html">`、`<form action>`、`<iframe src>` | 改成 Web App 絕對網址，並跳出 iframe |
| `<a href="#section">` | 保持在同一頁 |
| `http://`、`//cdn…`、`mailto:` 等外部連結 | 不變 |

改寫結果會 gzip 後存進 `CacheService`（預設 10 分鐘）。

## 安裝

1. **準備網站資料夾**：先 `npm install && npm run build` 打包（見下方「用 esbuild 打包」），
   在 Google Drive 建立資料夾，把 `dist/` 的內容上傳進去，保持目錄結構。
   想讓圖片走 Drive 縮圖網址，就把這個資料夾設成「知道連結的任何人都能檢視」。
   網址列 `https://drive.google.com/drive/folders/<這一段>` 就是資料夾 ID。
2. **建立 Apps Script 專案**：開啟 <https://script.new>。
3. **貼上程式**：把 `Code.gs` 的內容貼到編輯器的 `Code.gs`。
4. **設定 manifest**：「專案設定」→ 勾選「在編輯器中顯示『appsscript.json』資訊清單檔案」，
   再把本目錄的 `appsscript.json` 內容貼上（只要求 Drive 唯讀權限）。
5. **設定根目錄**：「專案設定」→「指令碼屬性」新增 `ROOT_FOLDER_ID` = 資料夾 ID
   （或直接改 `Code.gs` 裡的 `CONFIG.ROOT_FOLDER_ID`）。
6. **檢查**：在編輯器選擇 `checkSetup` 執行一次，依指示授權，Log 會顯示根目錄與首頁。
7. **部署**：「部署」→「新增部署作業」→ 類型選「網頁應用程式」
   - 執行身分：**我**
   - 誰可以存取：**所有人**
8. 打開部署後拿到的 `/exec` 網址就是你的網站。

之後修改程式要「管理部署作業 → 編輯 → 版本：新版本」才會生效；只修改 Drive 裡的網站檔案則不用重新部署。

### 用 clasp（選用）

```bash
npm i -g @google/clasp
clasp login
clasp create --type webapp --title "Drive Static Site" --rootDir drive-static-site
clasp push   # 會上傳 Code.gs 與 appsscript.json
```

目錄裡的 `.claspignore` 只放行 `Code.gs` 與 `appsscript.json`，`example-site/` 不會被推上去。

## 圖片：Drive 縮圖網址 vs data URI

把圖片轉成 data URI 會讓 HTML 變很大（base64 多 33%），也無法被瀏覽器分開快取。
所以 `IMAGE_MODE: 'auto'`（預設）會檢查每張圖片的分享設定：

- **知道連結的任何人可檢視** → `https://drive.google.com/thumbnail?id=<ID>&sz=w2000`
- **未公開** → `data:image/...;base64,...`

| 網址 | 可以放在 `<img>` 嗎？ |
| --- | --- |
| `drive.google.com/thumbnail?id=…&sz=w2000` | ✅ 可以（轉址到 `lh3.googleusercontent.com`，有 `Access-Control-Allow-Origin: *`） |
| `lh3.googleusercontent.com/d/<ID>=w2000` | ✅ 可以 |
| `drive.google.com/uc?id=…`、`uc?export=view&id=…` | ❌ 不行。轉址後回應帶 `Cross-Origin-Resource-Policy: same-site`，Chrome 會以 `ERR_BLOCKED_BY_ORB` 擋下。只能當下載連結用 |

（以上用 Chromium 從 `*.script.googleusercontent.com` 網域實測。）

注意事項：

- `sz=w2000` 是最大寬度，原圖較小時不會放大；可以用 `THUMBNAIL_SIZE` 調整。
- 縮圖會重新編碼，GIF 動畫會消失，所以 GIF 與 SVG 一律內嵌。
- 公開分享代表知道檔案 ID 的人都能下載原圖；ID 是隨機的，但不適合放機密圖片。
- 想全部內嵌（不公開分享任何檔案）就設 `IMAGE_MODE: 'inline'`；確定都公開了可以設 `'drive'`，省下每張圖檢查分享設定的時間。

## 用 esbuild 打包

Apps Script 頁面在沙盒 iframe 裡，`import './util.js'` 這種相對路徑的模組載入會失敗，
所以 JS 要先打包成單一檔案。`build.mjs` 會：

- 掃描所有 HTML 的本地 `<script src>` 和 `<link rel="stylesheet">`，當成 esbuild 的進入點
- `type="module"` 打包成 ESM，一般 script 打包成 IIFE，並且 minify
- 支援 **TypeScript / JSX**（`<script src="app.ts">` 會輸出 `app.js`，HTML 路徑一起改）與 **npm 套件**（`import dayjs from 'dayjs'`）
- CSS 的 `@import` 合併成一個檔，`url()` 的圖片 / 字型保留在原路徑，交給 Apps Script 處理
- 已被打包進去的模組不會複製到 `dist/`；HTML、圖片、JSON 等原樣複製

```bash
cd drive-static-site
npm install
npm run build                                   # example-site → dist
node build.mjs my-site dist                     # 打包自己的網站
node build.mjs my-site dist --dev               # 不 minify、含 inline sourcemap
node build.mjs my-site "$HOME/Google Drive/我的雲端硬碟/site" --watch
```

最後一行把輸出直接指到「Google 雲端硬碟電腦版」的同步資料夾，存檔 → 自動打包 → 自動上傳，
再執行 `purgeCache()`（或等快取過期）就上線了。

用 Vite / Astro 等工具產生的 `dist/` 也可以直接上傳；只要確認 JS 是打包好的單一檔案、沒有動態 `import()` 分割出來的 chunk。

## 更新內容

- 改了 Drive 上的檔案後，最多等 `CACHE_SECONDS`（預設 600 秒）就會更新。
- 想立即生效：在編輯器執行 `purgeCache()`。
- 開發時可以把 `CONFIG.CACHE_SECONDS` 設成 `0` 關閉快取。

## 設定（`Code.gs` 開頭的 `CONFIG`）

| 項目 | 預設 | 說明 |
| --- | --- | --- |
| `ROOT_FOLDER_ID` | `''` | 網站根目錄；指令碼屬性 `ROOT_FOLDER_ID` 優先 |
| `INDEX_FILES` | `['index.html','index.htm']` | 資料夾首頁 |
| `NOT_FOUND_PAGE` | `'404.html'` | 找不到時顯示根目錄的這個檔案 |
| `CACHE_SECONDS` | `600` | 快取秒數，最多 21600 |
| `MAX_INLINE_BYTES` | `5MB` | 超過的檔案改用 Drive 連結（需設為「知道連結的人可檢視」） |
| `AUTO_INDEX` | `false` | 沒有首頁時列出資料夾內容 |
| `ALLOW_IFRAME_EMBED` | `false` | 允許別的網站用 iframe 嵌入 |
| `FAVICON_URL` | `''` | 分頁圖示（需為 http(s) 網址） |

## 在前端 JS 取用網站裡的檔案

頁面裡的相對 `fetch('data.json')` 會打到沙盒網域而失敗。每個頁面都會注入：

```js
window.SITE_BASE_URL          // "https://script.google.com/macros/s/<ID>/exec"
window.siteUrl('data/a.json') // ".../exec/data/a.json"
```

文字類檔案（JSON、CSV、XML、TXT、JS）直接請求時會用 `ContentService` 回傳，可以這樣讀：

```js
const data = await fetch(siteUrl('data/posts.json')).then((r) => r.json());
```

## 限制

- **網址**固定是 `script.google.com/macros/s/…/exec/…`，頁面最上方會有 Google 的「這個應用程式是由其他使用者建立」橫幅（用 Workspace 帳號在網域內部署則不會）。
- **HTTP 狀態碼**一律是 200（HtmlService 無法設定），所以 404 頁不會回傳 404。
- **SEO**：內容在 iframe 內，搜尋引擎幾乎無法索引。適合內部文件、作品集、報告分享，不適合需要曝光的網站。
- **效能**：第一次載入要讀 Drive（每個檔案約數十～數百毫秒），之後走快取。頁面內嵌了所有資源，圖片多的頁面會很大；大圖請壓縮或放外部 CDN。
- **配額**：Apps Script Web App 有每日執行次數與同時執行數上限（一般帳號約 30 個同時請求），不適合高流量。
- **HTML 解析**用正規表示式，一般手寫或靜態產生器（Hugo、Jekyll、Vite build）輸出都沒問題；動態組出來的路徑（例如 JS 裡 `img.src = 'a.png'`）不會被改寫，請在 JS 裡 `import logo from './a.png'`（esbuild 會轉成 data URI）或改用 Drive 縮圖網址。
- **ES module 的相對 import** 不打包就無法運作，請用 `build.mjs`。
- 同一資料夾有同名檔案時取第一個；路徑大小寫有區分。
- SPA 的 History API 路由不適用（網址在 iframe 外層）；請用 hash 路由（`#/page`）。
