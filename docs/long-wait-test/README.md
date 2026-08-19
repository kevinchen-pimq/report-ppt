# Claude Code 雲端 Session 長時間存活測試

測試日期：2026-08-19（UTC）
環境：Claude Code on the web，Firecracker microVM（PID 1 = `process_api --firecracker-init`）

## 測試目的

確認在雲端 session 中，若長時間沒有任何對話互動，容器會不會被回收，
以及 `Monitor` 與 background bash 這兩種長時間等待機制會不會被中斷。

## 方法

三個獨立層次交叉比對，才能區分「容器被回收」與「容器只是被凍結」：

| 元件 | 位置 | 作用 |
| --- | --- | --- |
| `heartbeat.sh` | 容器內，`nohup` 脫離，**不產生任何通知** | 每 10s 記錄牆鐘時間、單調時鐘（`/proc/uptime`）、間隔、drift。事後鑑識用 |
| 靜默探針 | 容器內 registered task（`Monitor` / background bash） | 全程不輸出，時間到才吐一行。測試 in-container 計時器能否送達 |
| `send_later` | 伺服器端排程 | 不論容器死活都會喚醒 session。對照組 |

關鍵手法是**同時記錄牆鐘與單調時鐘**：容器若被 suspend 再 resume，
牆鐘 elapsed 會遠大於 uptime，drift 會暴增；若整台被換掉，`boot_id` 會變、`uptime` 歸零。

## 結果

三次容器實例：

| 實例 | boot_id | 誕生 | 死亡 | 壽命 | 死因 |
| --- | --- | --- | --- | --- | --- |
| A | `0ef8c587` | 03:13:57 | 03:53:14 | 39 分 | 無 registered task，閒置約 4.6 分鐘後回收 |
| B | `e549be98` | 03:54:45 | 05:01:17 | 66.5 分 | 有 registered task（`sleep 7200`）仍被回收，距上一回合結束僅 3.5 分鐘 |
| C | `f9ffcbb2` | 05:08:48 | （測試結束仍存活） | 122 分+ | — |

各階段靜默測試：

| 階段 | 靜默時長 | 機制 | 結果 |
| --- | --- | --- | --- |
| 一 | 28 分鐘 | `Monitor` 探針 | 通過。探針準時，心跳 229 筆 GAP=0 |
| 二 | 60 分鐘 | background bash `sleep 3600` | 通過。exit 0，boot_id 未變，心跳 388 筆 GAP=0 |
| 三（首試） | 120 分鐘 | background bash `sleep 7200` | **失敗**。容器 B 在 3.5 分鐘後被回收，任務被殺（`[killed]`） |
| 三（重測） | 120 分鐘 | background bash `sleep 7200` | 通過。exit 0，boot_id 未變，心跳 721 筆 GAP=0，drift 0~1s |

所有階段的心跳日誌 `GAP` 皆為 0、最大 delta 11s、drift 在 ±1s 內，
代表容器在存活期間**從未被凍結**，是持續運行或整台被換掉，沒有中間狀態。

## 結論

1. **沒有 registered task 時，閒置約 4.5–5 分鐘容器就被回收。**
   `nohup` 脫離的程序完全不算數——它在被回收前一直在燒 CPU 寫檔，照樣沒能續命。
   平台判斷依據是 harness 層的任務登記，不是機器忙不忙。

2. **有 registered task 時，可零通知存活至少 120 分鐘。**
   任務「存在」就足夠續命，不需要它定期吐訊息。
   `Bash` 的 `timeout` 參數上限（600000ms）**不會**套用到 `run_in_background` 的任務，
   `sleep 7200` 可以完整跑完。

3. **但這不是保證。** 階段三首試在有 `sleep 7200` 執行中的情況下，
   容器仍在 3.5 分鐘後被回收，harness 發出「容器已重啟，背景任務已停止」通知。
   同樣配置在重測時撐滿 2 小時。回收行為存在不可預測性。

4. **磁碟跨容器保留，程序不保留。** 三次換代，檔案一次都沒掉（含 mtime）。
   但所有 process 歸零：長跑的 server、training job、dev server 會無聲死掉。

5. **`Monitor` 的 `timeout_ms` 有 30 分鐘硬上限。**
   要求 3600000ms 會被壓回 1800000ms，`persistent: true` 亦然。
   超過 30 分鐘的監看必須自己接力重掛。

6. **`send_later`（伺服器端排程）是唯一可靠的喚醒管道。**
   05:03 排程、05:09 送達，期間容器整台換過，session 照樣復活。

## 實務建議

長時間工作要能承受容器換代，應該：

- 把進度**落地成檔案**（磁碟會保留），而不是留在記憶體或長跑程序裡
- 讓工作**可續跑**：重新啟動時能從檔案讀回進度繼續
- 用 **`send_later` 排程喚醒**當主要節奏控制，而不是依賴 in-container 的長 sleep
- 需要監看超過 30 分鐘時，用「`send_later` 喚醒 → 重新掛 `Monitor`」的接力模式

## 檔案

- `phases.log` — 各階段時間戳與判定
- `heartbeat_phase{1,2,3}.log` — 三個容器實例的原始心跳紀錄
- `heartbeat.sh` — 心跳產生器（牆鐘 / 單調時鐘 / GAP 偵測）
- `silent_probe.sh`、`phase2_probe.sh`、`phase3_probe.sh` — 各階段靜默探針
- `watch.sh` — 階段零用的即時監看腳本（後因會干擾測試而停用）
