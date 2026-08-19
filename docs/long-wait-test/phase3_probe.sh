#!/bin/bash
D=/tmp/claude-0/-home-user-report-ppt/597b6683-3bf6-540c-ab8b-9066ec2b73a5/scratchpad/longwait
S=$(date +%s); SB=$(cat /proc/sys/kernel/random/boot_id | head -c 8)
sleep 7200
E=$(date +%s); EB=$(cat /proc/sys/kernel/random/boot_id | head -c 8)
echo "PHASE3_DONE 睡了$((E-S))s boot前=$SB boot後=$EB uptime=$(cut -d' ' -f1 /proc/uptime)s 心跳筆數=$(grep -c '^OK\|^GAP' $D/heartbeat.log) GAP=$(grep -c '^GAP' $D/heartbeat.log) 最後心跳=$(tail -1 $D/heartbeat.log)"
