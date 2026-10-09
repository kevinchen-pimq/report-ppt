# WebXR Saber

用瀏覽器就能玩的 WebXR 版 Beat Saber，可以直接讀取 Beat Saber 的自訂譜面，在 VR 頭戴裝置裡實際遊玩。
不需要建置步驟，純靜態網頁（Three.js + Web Audio）。

## 功能

- **讀取譜面**
  - 拖放 / 選擇 BeatSaver 下載的 `.zip`
  - 選擇解壓縮後的譜面資料夾
  - 直接在 BeatSaver 搜尋、瀏覽高評分 / 最新 / 精選，或輸入譜面 ID（`!bsr` 代碼）
  - 網址參數：`?id=25f`（BeatSaver ID）或 `?url=<zip 網址>`
  - **歌曲會存在瀏覽器裡**（IndexedDB，只在你自己的裝置上）：重新整理後仍在歌曲庫，已下載的 BeatSaver 譜面不會重複下載；
    上限 1 GB，滿了會刪除最久沒玩的歌；網頁與 VR 歌曲庫都可以個別刪除或清除全部
- **支援的譜面格式**
  - `Info.dat` v2.x、v4.x
  - 難度檔 v2（`_notes`）、v3（`colorNotes` / `burstSliders` / `sliders`）、v4（`colorNotesData` / `chains` / `arcs` / `njsEvents` / `AudioData.dat` BPM 區段 / `Lightshow.dat`）
  - BPM 變化（v2 `_BPMChanges`、事件 100、v3 `bpmEvents`、v4 `bpmData`）
  - 方塊、圓點方塊、角度偏移、鏈（Chain）、**弧線（Arc）**、炸彈、牆壁、基本燈光事件、色彩加強（Boost）事件
  - **NJS 變速事件**（v4 `njsEvents`，含緩動曲線）：方塊速度隨譜面變化，反應時間不變
  - **譜面自訂顏色**：v2.1 / v4 `colorSchemes`、v2 難度 `_customData`（`_colorLeft`、`_envColorLeft`、`_obstacleColor`…），可在設定中關閉
  - Standard、OneSaber、NoArrows、Lawless、Lightshow 等譜面特性（360/90 度的旋轉事件會被忽略）
- **遊玩**
  - 左手紅劍、右手藍劍，依箭頭方向揮砍；判定顏色、方向、揮劍速度
  - 掃掠式碰撞偵測（快速揮劍不會穿透方塊）
  - 接近原作的計分：揮劍前角度 70 + 揮劍後角度 30 + 準度 15，連擊倍率 x1→x2→x4→x8
  - 血量條、Miss / 壞切 / 炸彈 / 撞牆扣血、失敗判定（可開 No Fail）
  - 方塊被切成兩半的碎片、火花、控制器震動回饋、打擊音效
  - 依譜面燈光事件變化的雷射、光環、跑道燈
  - 結算畫面（等級 SS～E、百分比、最大連擊）
- **VR 內選單**（控制器雷射指向 + 扳機點選，搖桿捲動）
  - 歌曲庫：網頁上載入或 VR 中下載的歌曲
  - BeatSaver：高評分 / 最新 / 精選、虛擬鍵盤搜尋、直接下載
  - 歌曲頁：選擇譜面特性與難度，顯示方塊數、NJS、變速事件、自訂顏色
  - 設定、開始前 / 暫停 / 結算畫面（暫停中可直接調整延遲與音量）、本機最佳成績
- **身高校正**：在 VR 中站直按「測量身高」，或手動輸入；方塊與牆壁高度依原作公式調整
- **音訊延遲校正**：節拍測試，跟著「嗒」聲扣扳機（或在網頁上敲擊），取中位數得出延遲；
  再對照閃爍光圈微調。藍牙耳機等額外延遲都能補償
- **外觀自訂**（網頁「外觀」區與 VR 選單「外觀」頁，VR 中有 3D 即時預覽）
  - 光劍：經典 / 霓虹 / 武士刀 / 水晶，或上傳自訂 glTF 2.0（.glb）模型
  - 方塊：經典（彩色玻璃質感、圓角亮邊、外圍光暈、發光箭頭）/ 機械方塊 / 霓虹框 / 外框（黑底、只描外圍輪廓並發光、彩色箭頭），或上傳自訂 .glb 模型（箭頭與圓點仍由遊戲繪製）
  - 牆壁：半透明或只顯示邊框（邊框寬度固定，在 VR 中清楚可見）
  - 自訂模型存在瀏覽器的 IndexedDB，重新整理後仍保留；判定範圍不受模型影響
- **觀戰畫面**：用 PC VR（Chrome / Edge + SteamVR / Link）遊玩時，電腦螢幕會顯示第三人稱視角（含玩家替身），
  也可切換成平滑的第一人稱視角或關閉；按 V 或畫面上方的按鈕切換。Quest 等一體機預設關閉以節省效能
- **桌面預覽**：沒有 VR 也能用滑鼠試玩，或開啟「自動遊玩」觀賞譜面

## 操作

| 動作 | VR | 桌面預覽 |
| --- | --- | --- |
| 選單操作 | 雷射指向按鈕 + 扳機，搖桿上下捲動 | 滑鼠點選 / 滾輪 |
| 開始 / 繼續 / 再玩一次 | 按面板上的按鈕 | 空白鍵或點按鈕 |
| 暫停 | B / Y | 空白鍵 |
| 重新開始（暫停中） | A / X | R |
| 回到選單 | B / Y（暫停中、開始前或結算時） | Esc |
| 揮劍 | 揮動控制器 | 移動滑鼠（藍劍），按住左鍵改控制紅劍 |
| 閃避牆壁 | 移動頭部 | A / D 左右、S 蹲下 |

設定（網頁與 VR 選單共用並自動儲存）：不會失敗、自動遊玩、譜面自訂顏色、身高、音訊延遲、音量、打擊音效、
光劍角度（光劍相對手把的傾斜）、光劍顏色、觀戰畫面、光劍 / 方塊模型、牆壁樣式。

### 自訂模型規格

- 格式：glTF 2.0 二進位 `.glb`（貼圖需內嵌；不支援 Draco / KTX2 壓縮）
- 光劍：模型最長的軸會當成劍身，離原點較遠的一端是劍尖（方向相反時打開「反轉方向」），自動縮放成約 1.2 m。
  材質或物件名稱含 `blade` / `glow` / `color` / `light` / `saber` / `beam` 的部分會套用光劍顏色
- 方塊：正面朝 +Z，自動置中並縮放成方塊大小；名稱含 `arrow` / `dot` / `white` / `metal` / `frame` / `keep`
  的材質保持原色，其餘套用方塊顏色

## 線上遊玩

**https://xr-saber.pages.dev**（Cloudflare Pages）

用 Quest 瀏覽器開啟，按「進入 VR 選單」即可在 VR 中搜尋 BeatSaver 譜面遊玩。

## 執行

WebXR 需要 **HTTPS**（或 `localhost`）。

本機測試：

```bash
python3 -m http.server 8000
# 開啟 http://localhost:8000
```

在 Meta Quest 上遊玩，可以把這個 repo 用 GitHub Pages 發佈（Settings → Pages → Deploy from branch，選擇根目錄），
再用 Quest 瀏覽器開啟網址，按「進入 VR 選單」後在 VR 裡搜尋 BeatSaver 譜面即可。
第一次玩建議先到「身高 / 延遲校正」測量身高與音訊延遲。

PC VR 可使用 Chrome / Edge 搭配 SteamVR 或 Oculus Link。

### 部署到 Cloudflare Pages

```bash
npx wrangler login            # 在容器 / SSH 環境用 npx wrangler login --device
./scripts/deploy-pages.sh     # 上傳 index.html、css、js、vendor、_headers 到 xr-saber 專案
```

`_headers` 設定了 vendor 檔案的快取與 WebXR 的 Permissions-Policy。

## 專案結構

```
index.html              選單介面
css/style.css
js/main.js              網頁介面、檔案載入、BeatSaver 整合
js/settings.js          設定（網頁與 VR 共用，存在 localStorage）
js/library.js           歌曲庫：載入、下載、解析難度、音樂解碼快取、只在記憶體保留最近的歌
js/songCache.js         歌曲儲存（IndexedDB）：清單、讀取、刪除、容量上限
js/mapLoader.js         zip / 資料夾讀取、Info.dat 解析（v2 / v4）、譜面自訂顏色
js/beatmap.js           難度檔解析（v2 / v3 / v4）、BPM 時間換算、鏈與弧線、NJS 變速曲線、最高分計算
js/beatsaver.js         BeatSaver API
js/game/Game.js         遊戲主迴圈、WebXR session、控制器、桌面輸入、自動遊玩
js/game/Notes.js        方塊 / 炸彈 / 鏈 / 牆的生成、移動、碰撞與切割判定
js/game/Arcs.js         弧線的繪製與震動回饋
js/game/Menu.js         VR 選單各頁面（歌曲庫、BeatSaver、設定、校正、開始 / 暫停 / 結算）
js/game/ui/             Canvas 面板元件與控制器雷射指標
js/game/Calibration.js  音訊延遲節拍測試
js/game/Saber.js        光劍、軌跡、速度與揮劍角度追蹤
js/game/Models.js       光劍 / 方塊 / 牆壁樣式、邊框發光著色器、自訂 glTF 模型載入與儲存
js/game/Score.js        計分、連擊倍率、血量
js/game/Environment.js  場景與燈光事件
js/game/Hud.js          分數 / 連擊 / 血量面板與訊息看板
js/game/Effects.js      切割碎片與火花
js/game/Spectator.js    VR 時電腦螢幕上的第三人稱 / 第一人稱觀戰畫面
js/game/Audio.js        音樂播放時鐘與打擊音效
vendor/                 three.js、fflate（MIT，授權見 vendor/LICENSES.md）
```

Beat Saber 是 Beat Games 的商標；本專案為非官方的粉絲作品，不包含任何官方素材。譜面與音樂版權屬於各自的作者。
