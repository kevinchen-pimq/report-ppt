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

`example-site/` 是一個可以直接上傳測試的範例網站。

## 為什麼要改寫 HTML？

Apps Script 的網頁一律放在 `*.googleusercontent.com` 的沙盒 iframe 裡，而 `ContentService`
無法回傳 `text/css` 或圖片等二進位檔。所以瀏覽器沒辦法照一般網站那樣用相對路徑去抓資源。

`Code.gs` 在伺服器端讀取 HTML 後會：

| 原始寫法 | 改寫結果 |
| --- | --- |
| `<link rel="stylesheet" href="css/a.css">` | 內嵌成 `<style>`（CSS 裡的 `url()`、`@import` 也會處理） |
| `<script src="js/a.js">` | 內嵌成 `<script>`；`defer` 的會移到 `</body>` 前保持執行順序 |
| `<img src>`、`srcset`、`<video poster>`、`<link rel="icon">`、字型 | 轉成 `data:` URI |
| `<a href="about.html">`、`<form action>`、`<iframe src>` | 改成 Web App 絕對網址，並跳出 iframe |
| `<a href="#section">` | 保持在同一頁 |
| `http://`、`//cdn…`、`mailto:` 等外部連結 | 不變 |

改寫結果會 gzip 後存進 `CacheService`（預設 10 分鐘）。

## 安裝

1. **準備網站資料夾**：在 Google Drive 建立資料夾，把網站檔案（例如 `example-site/` 的內容）上傳進去，保持目錄結構。
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
- **HTML 解析**用正規表示式，一般手寫或靜態產生器（Hugo、Jekyll、Vite build）輸出都沒問題；動態組出來的路徑（例如 JS 裡 `img.src = 'a.png'`）不會被改寫，請改用 `siteUrl()` 或 data URI。
- 同一資料夾有同名檔案時取第一個；路徑大小寫有區分。
- SPA 的 History API 路由不適用（網址在 iframe 外層）；請用 hash 路由（`#/page`）。
