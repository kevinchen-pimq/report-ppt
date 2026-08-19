#!/bin/bash
# 每 10 秒寫一次心跳，紀錄牆鐘時間、單調時間(uptime)、以及與上次的間隔
LOG=/tmp/claude-0/-home-user-report-ppt/597b6683-3bf6-540c-ab8b-9066ec2b73a5/scratchpad/longwait/heartbeat.log
START_WALL=$(date +%s)
START_MONO=$(awk '{printf "%d", $1}' /proc/uptime)
PREV=$START_WALL
echo "START pid=$$ wall=$(date -u '+%Y-%m-%dT%H:%M:%SZ') uptime=${START_MONO}s" >> "$LOG"
while true; do
  sleep 10
  NOW=$(date +%s)
  MONO=$(awk '{printf "%d", $1}' /proc/uptime)
  DELTA=$((NOW - PREV))
  ELAPSED=$((NOW - START_WALL))
  MONO_ELAPSED=$((MONO - START_MONO))
  DRIFT=$((ELAPSED - MONO_ELAPSED))
  TAG="OK"
  [ "$DELTA" -gt 30 ] && TAG="GAP"
  echo "$TAG t=$(date -u '+%Y-%m-%dT%H:%M:%SZ') elapsed=${ELAPSED}s mono=${MONO_ELAPSED}s delta=${DELTA}s drift=${DRIFT}s" >> "$LOG"
  PREV=$NOW
done
