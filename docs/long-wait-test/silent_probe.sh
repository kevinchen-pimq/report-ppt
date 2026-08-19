#!/bin/bash
# 靜默等待 $1 秒，期間不輸出任何東西（= 不產生任何通知），時間到才回報
D=/tmp/claude-0/-home-user-report-ppt/597b6683-3bf6-540c-ab8b-9066ec2b73a5/scratchpad/longwait
WAIT=$1
S_WALL=$(date +%s); S_MONO=$(awk '{printf "%d",$1}' /proc/uptime)
sleep "$WAIT"
E_WALL=$(date +%s); E_MONO=$(awk '{printf "%d",$1}' /proc/uptime)
HB_LAST=$(tail -1 $D/heartbeat.log)
HB_GAPS=$(grep -c '^GAP' $D/heartbeat.log)
HB_LINES=$(grep -c '^OK\|^GAP' $D/heartbeat.log)
ALIVE=$(pgrep -f heartbeat.sh >/dev/null && echo yes || echo no)
echo "PROBE_DONE 目標=${WAIT}s 實際牆鐘=$((E_WALL-S_WALL))s 實際單調=$((E_MONO-S_MONO))s | 心跳存活=$ALIVE 心跳筆數=$HB_LINES GAP數=$HB_GAPS | 容器uptime=${E_MONO}s | 最後心跳: $HB_LAST"
