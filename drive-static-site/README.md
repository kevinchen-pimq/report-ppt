# Drive Static Sites

一個 Google Apps Script Web App，把 Google Drive 上的**多個資料夾當成多個靜態網站**，
並且**在 Apps Script 裡用 esbuild（WebAssembly）打包** TypeScript / ES module / npm 套件。不需要在電腦上裝 Node。

```
SITES_FOLDER/                      https://script.google.com/macros/s/<ID>/exec   → 網站列表
├── demo/                    →     …/exec/demo/                 → demo/index.html
│   ├── index.html                 …/exec/demo/about.html
│   ├── js/main.ts                 （Apps Script 裡的 esbuild 打包後內嵌）
│   ├── css/style.css              （@import 合併、minify）
│   ├── site.json                  （選用）這個網站自己的設定
│   └── _build.json                （自動產生）打包結果
└── docs/                    →     …/exec/docs/
```

`example-sites/` 有兩個範例網站，可以直接上傳測試：
- `demo/`：TypeScript + `import dayjs from 'dayjs'` + JS 裡 import CSS + CSS `@import`
- `docs/`：純 HTML，一般 `<script>` 裡的全域函式（`onclick="toggleNote()"`）

## 專案檔案

| 檔案 | 用途 |
| --- | --- |
| `Code.gs` | `doGet`：依網址第一段找網站、改寫 HTML、快取 |
| `Build.gs` | `buildAll` / `buildChanged` / `installBuildTrigger`：在 Apps Script 裡執行 esbuild |
| `Polyfills.gs` | esbuild-wasm 需要、Apps Script 沒有的 `setTimeout`、`TextEncoder`、`crypto`、`performance` |
| `Esbuild.gs` | esbuild-wasm 的 JS API（由 `npm run vendor` 產生，勿手改） |
| `appsscript.json` | 權限與 Web App 設定 |

## 安裝

1. **準備網站**：在 Drive 建一個資料夾（例如 `sites`），把 `example-sites/` 裡的 `demo`、`docs` 兩個資料夾上傳進去。
   網址列 `drive.google.com/drive/folders/<這一段>` 就是資料夾 ID。
2. **建立 Apps Script 專案**：開啟 <https://script.new>。
3. **貼上程式**：建立 `Code.gs`、`Build.gs`、`Polyfills.gs`、`Esbuild.gs` 四個檔案並貼上內容（順序不拘）。
4. **manifest**：「專案設定」→ 勾選「在編輯器中顯示『appsscript.json』」，貼上本目錄的 `appsscript.json`。
5. **指令碼屬性**：「專案設定 → 指令碼屬性」新增 `SITES_FOLDER_ID` = 步驟 1 的資料夾 ID。
6. **建置**：在編輯器選 `buildAll` 執行並授權。第一次會把 `esbuild-<版本>.wasm`（約 12MB）下載到「我的雲端硬碟」。
7. **自動建置**：執行一次 `installBuildTrigger`，之後每 10 分鐘檢查變更、自動建置並清快取。
8. **部署**：「部署」→「新增部署作業」→「網頁應用程式」，執行身分「我」，存取權「所有人」。
9. 打開 `/exec` 網址會看到網站列表，`/exec/demo/`、`/exec/docs/` 就是兩個網站。

用 clasp 的話：`clasp create --type webapp --rootDir drive-static-site && clasp push`（`.claspignore` 只推 `.gs` 與 `appsscript.json`）。

### 權限

| 權限 | 為什麼需要 |
| --- | --- |
| `drive` | 讀網站檔案；寫入 `_build.json` 與 `esbuild.wasm` |
| `script.external_request` | 下載 esbuild.wasm、從 esm.sh 下載 npm 套件 |
| `script.scriptapp` | 建立自動建置的時間觸發器 |

## 多個網站

- **`SITES_FOLDER_ID`** 底下的每個子資料夾都是一個網站，資料夾名稱就是網址的第一段（`_` 或 `.` 開頭的資料夾會被忽略）。
- 放在別處的資料夾可以用指令碼屬性 **`SITES`** 加入：`{"blog": "1AbC…", "intranet": "1XyZ…"}`。
- `CONFIG.DEFAULT_SITE = 'demo'` 讓 `/exec` 直接顯示 demo 首頁；`CONFIG.LIST_SITES = false` 隱藏網站列表。
- 每個網站有獨立的快取版本，修改一個網站不會影響其他網站的快取。
- 網址規則：
  - `/` 開頭的路徑代表**該網站**的根目錄（`<link href="/css/a.css">`）
  - 往上超出網站根目錄的相對連結會連到其他網站（`<a href="../docs/">`）

### site.json（每個網站自己的設定，全部選填）

```json
{
  "indexFiles": ["index.html"],
  "notFound": "404.html",
  "autoIndex": false,
  "imageMode": "auto",
  "thumbnailSize": "w2000",
  "build": {
    "minify": true,
    "target": "es2020",
    "jsx": "automatic",
    "jsxImportSource": "react",
    "define": { "API_URL": "\"https://example.com\"" }
  },
  "imports": {
    "react": "https://esm.sh/react@18.3.1",
    "react-dom/": "https://esm.sh/react-dom@18.3.1/"
  }
}
```

預設值在 `Code.gs` 的 `CONFIG.SITE_DEFAULTS`。

## 在 Apps Script 裡執行 esbuild

Apps Script 的 V8 runtime 支援 `WebAssembly.compile`，所以可以直接跑 esbuild 的 wasm 版本。
缺少的瀏覽器 API（`setTimeout`、`TextEncoder`/`TextDecoder`、`crypto.getRandomValues`、`performance.now`）由 `Polyfills.gs` 補上；
`setTimeout` 用 Promise microtask 實作，建置完呼叫 `esbuild.stop()` 清掉 Go runtime 的計時器，讓執行可以正常結束。

### 哪些檔案會被打包

| HTML 裡的寫法 | 打包方式 |
| --- | --- |
| `<script type="module" src="js/main.ts">` | ESM |
| `<script src="app.ts">`、`.tsx`、`.jsx` | IIFE |
| `<script src="app.js">` 且檔案裡有 `import` / `export` / `require` | IIFE |
| `<script src="app.js">` 純 script | **不打包**，原樣內嵌（全域函式維持全域） |
| `<link rel="stylesheet" href="a.css">` | 合併 `@import`、minify；`url()` 保留路徑 |

### import 的解析

| import | 來源 |
| --- | --- |
| `'./util'`、`'../lib/x'`、`'/shared/y'` | 同一個網站資料夾（自動補 `.ts .tsx .js .jsx .mjs .json .css` 與 `/index.*`） |
| `'dayjs'`、`'react-dom/client'` | `site.json` 的 `imports`，否則 `https://esm.sh/<套件>`（UrlFetchApp 下載，快取 6 小時） |
| `'https://…'` | 直接下載 |
| `import logo from './logo.png'` | data URI |
| JS 裡 `import './x.css'` | 輸出成 CSS，內嵌在 `<script>` 前面 |

建議在 `site.json` 的 `imports` 指定版本（例如 `https://esm.sh/dayjs@1.11.13`），避免套件更新時行為改變。

### 建置流程

- `buildAll()`：建置所有網站。
- `buildChanged()`：計算每個網站所有檔案的「路徑 + 修改時間 + 大小」指紋，只建置有變更的網站，並讓它們的頁面快取失效。
  所以**沒有 JS 的網站也建議開啟觸發器**，修改 HTML 後會自動清快取。
- 結果寫在網站根目錄的 `_build.json`（不會對外提供）。建置失敗時，錯誤訊息（含檔名、行號）會顯示在瀏覽器的 console，也會出現在 Apps Script 的執行記錄。
- `.ts` 檔還沒建置時頁面不會壞掉，只會在 console 顯示「尚未建置」。

### 效能（在模擬環境測得，實際 Apps Script 會比較慢）

| 步驟 | 時間 |
| --- | --- |
| 從 Drive 讀取 esbuild.wasm + 編譯 + 初始化 | 2–4 秒（第一次下載約 8–10 秒） |
| 打包 demo（TS + dayjs + CSS） | 約 0.2 秒 |
| 沒有變更時的 `buildChanged()` | 只掃描檔案，不啟動 esbuild |

單次執行上限 6 分鐘，網站很多時 `buildChanged()` 會在 4.5 分鐘後停止，剩下的下次再建。
一般帳號的觸發器每天總執行時間上限 90 分鐘，網站很多時可以把 `CONFIG.BUILD_TRIGGER_MINUTES` 調大。

## 圖片：Drive 縮圖網址 vs data URI

`imageMode: 'auto'`（預設）會檢查每張 png / jpeg / webp / bmp 的分享設定：

- **知道連結的任何人可檢視** → `https://drive.google.com/thumbnail?id=<ID>&sz=w2000`（HTML 小很多）
- **未公開** → `data:image/...;base64,...`

| 網址 | 可以放在 `<img>` 嗎？ |
| --- | --- |
| `drive.google.com/thumbnail?id=…&sz=w2000` | ✅ 可以（轉址到 `lh3.googleusercontent.com`） |
| `lh3.googleusercontent.com/d/<ID>=w2000` | ✅ 可以 |
| `drive.google.com/uc?id=…`、`uc?export=view&id=…` | ❌ 回應帶 `Cross-Origin-Resource-Policy: same-site`，Chrome 會以 `ERR_BLOCKED_BY_ORB` 擋下 |

（用 Chromium 從 `*.script.googleusercontent.com` 網域實測。）縮圖不會放大、GIF 會失去動畫，所以 GIF 與 SVG 一律內嵌。
把整個網站資料夾設成公開，所有圖片就都走縮圖網址；但這代表知道檔案 ID 的人都能下載原圖。

## 其他

- **前端 JS 取用網站檔案**：每頁都有 `window.SITE_BASE_URL` 與 `siteUrl('data/a.json')`，
  文字檔（JSON、CSV、TXT、JS）直接請求會用 ContentService 回傳：`fetch(siteUrl('data/a.json'))`。
- **清快取**：`purgeCache()` 清除所有網站；`buildChanged()` 只清有變更的網站。
- **升級 esbuild**：`npm i -D esbuild-wasm@<版本> && npm run vendor`，把新的 `Esbuild.gs` 貼到 Apps Script，下次建置會自動下載對應的 wasm。
- **測試**：`npm install && npm test` 會在沒有 `setTimeout` / `TextEncoder` / `crypto` / `URL` 的 V8 環境裡，
  用模擬的 Apps Script 服務跑完整流程（安裝 esbuild → 建置 → doGet → 變更偵測 → 錯誤回報），需要網路。

## 限制

- **網址**固定是 `script.google.com/macros/s/…/exec/…`，一般帳號部署時頁面上方會有 Google 的警告橫幅。
- **HTTP 狀態碼**一律 200；**SEO** 幾乎沒有（內容在 iframe 內）；**流量**受 Apps Script 配額限制。適合內部文件、報告分享、作品集。
- 改了 Drive 檔案後，要等觸發器（預設 10 分鐘）或手動執行 `buildChanged()` 才會更新。
- 動態 `import()` 會被打包進同一個檔案（沒有 code splitting）。
- JS 裡動態組出來的路徑（`img.src = 'a.png'`）不會被改寫，請改用 `import logo from './a.png'`。
- HTML 用正規表示式解析，手寫或一般靜態產生器的輸出都沒問題。
- SPA 請用 hash 路由（`#/page`），History API 路由不適用。
