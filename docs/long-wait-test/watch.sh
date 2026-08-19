#!/bin/bash
D=/tmp/claude-0/-home-user-report-ppt/597b6683-3bf6-540c-ab8b-9066ec2b73a5/scratchpad/longwait
LOG=$D/heartbeat.log
next=120        # 前 10 分鐘每 2 分鐘回報一次
while true; do
  sleep 20
  if ! pgrep -f "heartbeat.sh" >/dev/null 2>&1; then
    echo "DEAD 背景心跳程序已消失 t=$(date -u '+%H:%M:%SZ') last=$(tail -1 "$LOG" 2>/dev/null)"
    exit 1
  fi
  # 檔案超過 60 秒沒更新 = 卡住/被凍結
  age=$(( $(date +%s) - $(stat -c %Y "$LOG" 2>/dev/null || echo 0) ))
  if [ "$age" -gt 60 ]; then
    echo "STALLED 心跳檔 ${age}s 未更新 t=$(date -u '+%H:%M:%SZ')"
  fi
  # GAP 事件（牆鐘跳躍，代表容器曾被凍結）
  gaps=$(grep -c '^GAP' "$LOG" 2>/dev/null || echo 0)
  if [ "$gaps" -gt "${seen_gaps:-0}" ]; then
    echo "GAP 偵測到時間跳躍: $(grep '^GAP' "$LOG" | tail -1)"
    seen_gaps=$gaps
  fi
  # 里程碑回報
  last=$(tail -1 "$LOG" 2>/dev/null)
  e=$(echo "$last" | grep -o 'elapsed=[0-9]*' | cut -d= -f2)
  [ -z "$e" ] && continue
  if [ "$e" -ge "$next" ]; then
    echo "ALIVE $last"
    if [ "$e" -ge 600 ]; then next=$(( (e/900 + 1) * 900 )); else next=$(( e + 120 )); fi
  fi
done
