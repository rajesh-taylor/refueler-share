#!/bin/bash
# Share preview harness: the real app build (bin/ship-app.sh --check → dist/), pointed at the
# fake Worker on :8766 and a stub Turnstile. Output: $OUT/app (served on :8765).
# Turnstile-Gate-1: also the real gate build (dist-gate/) → $OUT/gate (served on :8768 by
# serve-gate.mjs, under its real CSP with localhost swapped in). The app frames it; the stub
# runs inside the gate, as Cloudflare's script does live. ?ts= on the app URL is passed to the
# gate's address (harness only) so the stub's modes still work; ?ts=real loads Cloudflare's
# real script in the gate with a test sitekey (needs the network).
# X5-2 (15 Oct 2026): rebuilt on dist/ — it used to render the old refueler.io mirror page.
set -euo pipefail
H="$(cd "$(dirname "$0")" && pwd)"; OUT="$H/.out"
S="$(cd "$H/../.." && pwd)"
# CI has no Satoshi (never committed): --ci puts an empty stand-in in its slot, as app-check.yml does.
MODE=--check; [ -n "${CI:-}" ] && MODE=--ci
"$S/bin/ship-app.sh" "$MODE" >/dev/null
rm -rf "$OUT/app"; mkdir -p "$OUT"; cp -R "$S/dist" "$OUT/app"; rm -f "$OUT/app/_headers"
REL="$(sed -n 's|.*src="/v/\([0-9a-z]*\)/share.js".*|\1|p' "$OUT/app/index.html" | head -1)"
A="$OUT/app/v/$REL"
GATE_PORT="${GATE_PORT:-8768}"
rm -rf "$OUT/gate"; cp -R "$S/dist-gate" "$OUT/gate"; rm -f "$OUT/gate/_headers" "$OUT/gate/release.json"
G="$OUT/gate/v/$REL"
cp "$H/turnstile-stub.js" "$G/turnstile-stub.js"
# perl -pi, not sed -i: this also runs on GitHub's Linux runners (Test-Hardening-1).
perl -pi -e 's|https://api.share.refueler.io|http://localhost:8766|g' "$A/config.js" "$A/share-early.js"
# The app: frame the local gate, and pass ?ts= through to it.
perl -pi -e "s|https://gate.share.refueler.io|http://localhost:$GATE_PORT|" "$A/config.js"
perl -pi -e "s|const GATE_SRC = GATE_ORIGIN \\+ '/';|const GATE_SRC = GATE_ORIGIN + '/' + location.search;|" "$A/gate-client.js"
grep -q "location.search;" "$A/gate-client.js" || { echo "build.sh: gate-client.js GATE_SRC line not found" >&2; exit 1; }
# The gate: parent = the local app; the stub in place of Cloudflare's script, unless ?ts=real
# (then the real script, with Cloudflare's always-pass test sitekey).
perl -pi -e "s|'https://share.refueler.io'|'http://localhost:8765'|" "$G/gate.js"
perl -pi -e "s|^const API_SRC = .*|const API_SRC = new URLSearchParams(location.search).get('ts') === 'real' ? 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit' : '/v/$REL/turnstile-stub.js';|" "$G/gate.js"
perl -pi -e "s|^const APP_SITEKEY = .*|const APP_SITEKEY = '1x00000000000000000000AA';   // harness: Cloudflare's always-pass test key|" "$G/gate.js"
grep -q "turnstile-stub.js" "$G/gate.js" && grep -q "localhost:8765" "$G/gate.js" || { echo "build.sh: gate.js rewrite failed" >&2; exit 1; }
perl -pi -e 's|https://refueler.io/notes/|http://localhost:8765/notes/|g' "$A/download-notes.js"
# Part retries wait 2 → 10 s live (~2 min before "Stopped"); 0.2 s each here.
perl -0pi -e 's/RETRY_DELAYS_MS = \[[^\]]*\]/RETRY_DELAYS_MS = [200, 200, 200, 200, 200]/' "$A/progress.js"
# Notes card: a fixed stand-in for refueler.io/notes/latest.json
mkdir -p "$OUT/app/notes"
cat > "$OUT/app/notes/latest.json" <<'JSON'
{"schema":"notes-latest.v1","title":"Harness article","summary":"A stand-in for the newest Notes article.","url":"http://localhost:8765/notes/harness/"}
JSON
# The vector page (H2): real built modules, real CSP. Harness only, never in dist/.
mkdir -p "$OUT/app/kat"
cp "$H/kat/index.html" "$H/kat/page.js" "$S/test-vectors/v1.json" "$S/test-vectors/run.mjs" "$OUT/app/kat/"
printf '{"rel":"%s"}\n' "$REL" > "$OUT/app/kat/rel.json"
echo "built $(date +%H:%M:%S) (release $REL)"
