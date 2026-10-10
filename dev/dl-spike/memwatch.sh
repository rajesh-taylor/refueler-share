#!/bin/zsh
# dev/dl-spike/memwatch.sh — Share-DL-Spike. Every 30 s: browser process memory
# (total RSS + largest process, MiB) and bytes landed in the target folder.
#   memwatch.sh "<target dir>" >> ~/.refueler-soak/dl-spike-mem.log
dir=${1:?target dir}
while true; do
  ts=$(date -u +%H:%M:%S)
  ps -axo rss=,command= | awk -v ts="$ts" '
    /WebKit\.|\/Safari\.app\//            { s+=$1; if ($1>sm) sm=$1 }
    /firefox|plugin-container/            { f+=$1; if ($1>fm) fm=$1 }
    /Google Chrome/                       { c+=$1; if ($1>cm) cm=$1 }
    END { printf "%s safari %d/%d firefox %d/%d chrome %d/%d MiB(total/max) ", ts, s/1024, sm/1024, f/1024, fm/1024, c/1024, cm/1024 }'
  echo "landed $(du -sk "$dir" 2>/dev/null | awk '{printf "%.2f GiB", $1/1048576}')"
  sleep 30
done
