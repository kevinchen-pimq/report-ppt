# WebXR Saber

用瀏覽器就能玩的 WebXR 版 Beat Saber，可以直接讀取 Beat Saber 的自訂譜面，在 VR 頭戴裝置裡實際遊玩。
不需要建置步驟，純靜態網頁（Three.js + Web Audio）。

## 功能

- **讀取譜面**
  - 拖放 / 選擇 BeatSaver 下載的 `.zip`
  - 選擇解壓縮後的譜面資料夾
  - 直接在 BeatSaver 搜尋、瀏覽高評分 / 最新 / 精選，或輸入譜面 ID（`!bsr` 代碼）
  - 網址參數：`?id=25f`（BeatSaver ID）或 `?url=<zip 網址>`
- **支援的譜面格式**
  - `Info.dat` v2.x、v4.x
  - 難度檔 v2（`_notes`）、v3（`colorNotes` / `burstSliders`）、v4（`colorNotesData` / `chains` / `AudioData.dat` BPM 區段 / `Lightshow.dat`）
  - BPM 變化（v2 `_BPMChanges`、事件 100、v3 `bpmEvents`、v4 `bpmData`）
  - 方塊、圓點方塊、角度偏移、鏈（Chain）、炸彈、牆壁、基本燈光事件
  - Standard、OneSaber、NoArrows、Lawless、Lightshow 等譜面特性（360/90 度的旋轉事件會被忽略）
- **遊玩**
  - 左手紅劍、右手藍劍，依箭頭方向揮砍；判定顏色、方向、揮劍速度
  - 掃掠式碰撞偵測（快速揮劍不會穿透方塊）
  - 接近原作的計分：揮劍前角度 70 + 揮劍後角度 30 + 準度 15，連擊倍率 x1→x2→x4→x8
  - 血量條、Miss / 壞切 / 炸彈 / 撞牆扣血、失敗判定（可開 No Fail）
  - 方塊被切成兩半的碎片、火花、控制器震動回饋、打擊音效
  - 依譜面燈光事件變化的雷射、光環、跑道燈
  - 結算畫面（等級 SS～E、百分比、最大連擊）
- **觀戰畫面**：用 PC VR（Chrome / Edge + SteamVR / Link）遊玩時，電腦螢幕會顯示第三人稱視角（含玩家替身），
  也可切換成平滑的第一人稱視角或關閉；按 V 或畫面上方的按鈕切換。Quest 等一體機預設關閉以節省效能
- **桌面預覽**：沒有 VR 也能用滑鼠試玩，或開啟「自動遊玩」觀賞譜面

## 操作

| 動作 | VR | 桌面預覽 |
| --- | --- | --- |
| 開始 / 繼續 / 再玩一次 | 扳機 | 點擊畫面 / 空白鍵 |
| 暫停 | B / Y | 空白鍵 |
| 重新開始（暫停中） | A / X | R |
| 回到選單 | B / Y（暫停中或結算時） | Esc |
| 揮劍 | 揮動控制器 | 移動滑鼠（藍劍），按住左鍵改控制紅劍 |
| 閃避牆壁 | 移動頭部 | A / D 左右、S 蹲下 |

設定中可以調整：音訊延遲補償、音量、打擊音效、光劍角度（光劍相對手把的傾斜）、光劍顏色。

## 執行

WebXR 需要 **HTTPS**（或 `localhost`）。

本機測試：

```bash
python3 -m http.server 8000
# 開啟 http://localhost:8000
```

在 Meta Quest 上遊玩，可以把這個 repo 用 GitHub Pages 發佈（Settings → Pages → Deploy from branch，選擇根目錄），
再用 Quest 瀏覽器開啟網址，載入譜面後按「進入 VR 遊玩」。在 Quest 上最方便的是直接用 BeatSaver 搜尋或輸入 ID 載入。

PC VR 可使用 Chrome / Edge 搭配 SteamVR 或 Oculus Link。

## 專案結構

```
index.html              選單介面
css/style.css
js/main.js              介面、檔案載入、BeatSaver 整合
js/mapLoader.js         zip / 資料夾讀取、Info.dat 解析（v2 / v4）
js/beatmap.js           難度檔解析（v2 / v3 / v4）、BPM 時間換算、鏈的展開、最高分計算
js/beatsaver.js         BeatSaver API
js/game/Game.js         遊戲主迴圈、WebXR session、控制器、桌面輸入、自動遊玩
js/game/Notes.js        方塊 / 炸彈 / 鏈 / 牆的生成、移動、碰撞與切割判定
js/game/Saber.js        光劍模型、軌跡、速度與揮劍角度追蹤
js/game/Score.js        計分、連擊倍率、血量
js/game/Environment.js  場景與燈光事件
js/game/Hud.js          分數 / 連擊 / 血量面板與訊息看板
js/game/Effects.js      切割碎片與火花
js/game/Spectator.js    VR 時電腦螢幕上的第三人稱 / 第一人稱觀戰畫面
js/game/Audio.js        音樂播放時鐘與打擊音效
vendor/                 three.js、fflate（MIT，授權見 vendor/LICENSES.md）
```

Beat Saber 是 Beat Games 的商標；本專案為非官方的粉絲作品，不包含任何官方素材。譜面與音樂版權屬於各自的作者。
