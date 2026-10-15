#!/bin/bash
# Share preview harness: the real app build (bin/ship-app.sh --check → dist/), pointed at the
# fake Worker on :8766 and a stub Turnstile. Output: $OUT/app (served on :8765).
# X5-2 (15 Oct 2026): rebuilt on dist/ — it used to render the old refueler.io mirror page.
set -euo pipefail
H="$(cd "$(dirname "$0")" && pwd)"; OUT="$H/.out"
S="$(cd "$H/../.." && pwd)"
"$S/bin/ship-app.sh" --check >/dev/null
rm -rf "$OUT/app"; mkdir -p "$OUT"; cp -R "$S/dist" "$OUT/app"; rm -f "$OUT/app/_headers"
REL="$(sed -n 's|.*src="/v/\([0-9a-z]*\)/share.js".*|\1|p' "$OUT/app/index.html" | head -1)"
A="$OUT/app/v/$REL"
cp "$H/turnstile-stub.js" "$A/turnstile-stub.js"
sed -i '' 's|https://api.share.refueler.io|http://localhost:8766|g' "$A/config.js" "$A/share-early.js"
sed -i '' "s|https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit|/v/$REL/turnstile-stub.js|" "$A/signin.js" "$A/upload-turnstile.js"
sed -i '' 's|https://refueler.io/notes/|http://localhost:8765/notes/|g' "$A/download-notes.js"
# Part retries wait 2 → 10 s live (~2 min before "Stopped"); 0.2 s each here.
perl -0pi -e 's/RETRY_DELAYS_MS = \[[^\]]*\]/RETRY_DELAYS_MS = [200, 200, 200, 200, 200]/' "$A/progress.js"
# Notes card: a fixed stand-in for refueler.io/notes/latest.json
mkdir -p "$OUT/app/notes"
cat > "$OUT/app/notes/latest.json" <<'JSON'
{"schema":"notes-latest.v1","title":"Harness article","summary":"A stand-in for the newest Notes article.","url":"http://localhost:8765/notes/harness/"}
JSON
echo "built $(date +%H:%M:%S) (release $REL)"
