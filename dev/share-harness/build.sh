#!/bin/bash
# Share-Upload-2 preview harness: refueler.io (current working tree) + canonical Share page,
# pointed at the fake Worker on :8766 and a stub Turnstile. Output: $OUT/io/_site (served on :8765).
set -euo pipefail
H="$(cd "$(dirname "$0")" && pwd)"; OUT="$H/.out"
S="$(cd "$H/../.." && pwd)"
IO="${REFUELER_IO_ROOT:-$(cd "$S/../refueler.io" && pwd)}"
. "$S/bin/lib/share-mirror.sh"
rm -rf "$OUT/io/src"; mkdir -p "$OUT/io"
cp -R "$IO/src" "$OUT/io/src"; cp "$IO/eleventy.config.js" "$IO/package.json" "$OUT/io/"
[ -e "$OUT/io/node_modules" ] || ln -s "$IO/node_modules" "$OUT/io/node_modules"
A="$OUT/io/src/share/assets"
for n in $SM_ASSETS; do [ -f "$S/frontend/$n" ] && cp "$S/frontend/$n" "$A/$n"; done
rm -rf "$A/blake3"; cp -R "$S/frontend/blake3" "$A/blake3"
sm_render_njk "$S/src/index.njk" > "$OUT/io/src/share/index.njk"
cp "$H/turnstile-stub.js" "$A/turnstile-stub.js"
sed -i '' 's|https://api.share.refueler.io|http://localhost:8766|g' "$A/crypto.js" "$OUT/io/src/share/index.njk"
sed -i '' 's|https://challenges.cloudflare.com/turnstile/v0/api.js[^"]*|/share/assets/turnstile-stub.js|' "$OUT/io/src/share/index.njk"
sed -i '' 's|https://refueler.io/notes/|http://localhost:8765/notes/|g' "$A/download.js"
# Chunk retries wait 2 → 60 s live (~2 min before "Stopped"); 0.2 s each here.
sed -i '' 's|_DIRECT_RETRY_DELAYS = \[[^]]*\]|_DIRECT_RETRY_DELAYS = [200, 200, 200, 200, 200]|' "$A/upload.js"
(cd "$OUT/io" && npx @11ty/eleventy --quiet >/dev/null)
echo "built $(date +%H:%M:%S)"
