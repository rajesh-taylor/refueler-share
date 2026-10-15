#!/usr/bin/env bash
# bin/ship-app.sh — build, check, deploy and PROVE the standalone app on share.refueler.io.
# X5-1 · 14 Oct 2026 · docs/X5-plan-v1.md §2.8. Stops at the first failure; ends "✓ SHIPPED (app)".
#
#   bin/ship-app.sh            preflight → build → check → deploy (Pages, direct upload) → prove live
#   bin/ship-app.sh --check    build + check only, no git preflight, no deploy (safe anywhere)
#   bin/ship-app.sh --prove    prove only: is share.refueler.io serving exactly dist/?
#
# What gets deployed is dist/, and dist/ is exactly what is hashed:
#   dist/*.html, dist/signin/, dist/manifest.webmanifest   (Eleventy, eleventy.app.js)
#   dist/v/<sha>/      every frontend/ asset in SM_ASSETS + blake3/, then frontend/app/ over it
#   dist/v/<prev>/     the release live before this one, rebuilt byte-for-byte from git, so a
#                      tab opened before the ship can still lazy-load its own modules
#   dist/_headers      CSP (bin/lib/app-csp.txt; Report-Only at X5-1, enforced since X5-2) + fixed headers
# While refueler.io/share/ still runs (until X5-2), shared JS/CSS ships twice:
# bin/ship-frontend.sh (refueler.io) and this script. The asset list is ONE list: share-mirror.sh.
#
# Written for macOS /bin/bash 3.2 (no associative arrays, no mapfile).

set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=lib/share-mirror.sh
. "$ROOT/bin/lib/share-mirror.sh"

MODE="${1:-ship}"
APP_HOST="${APP_HOST:-https://share.refueler.io}"
PROJECT="refueler-share-app"
CSP_FILE="$ROOT/bin/lib/app-csp.txt"
DIST="$ROOT/dist"
APP_SRC="$ROOT/frontend/app"
PROVE_TIMEOUT="${PROVE_TIMEOUT:-300}"
# Satoshi (header only): ITF Free Font License v2.0 allows self-hosting on our own site but not
# redistribution, so the official WOFF2 is gitignored and lives only on this Mac. Hash = the file
# from Fontshare's Satoshi zip, unmodified (no subsetting or conversion allowed).
SATOSHI="$APP_SRC/fonts/Satoshi-Variable.woff2"
SATOSHI_SHA256="e739aff9b4d02c264341d6d4872edcda28e79373aeda936f659566a1cd3eb47f"

die()  { echo "" >&2; echo "✗ $*" >&2; exit 1; }
step() { echo "▶ $*"; }

# ── release dir: build one release's assets from a git tree into DEST ────────
# copy_release SRC_ROOT DEST — SRC_ROOT has frontend/ (working tree or git archive)
copy_release() {
  local src="$1" dest="$2" n f
  mkdir -p "$dest"
  for n in $SM_ASSETS; do
    [ -f "$src/frontend/$n" ] || die "release asset missing: frontend/$n"
    cp "$src/frontend/$n" "$dest/$n"
  done
  for f in $(sm_files_under "$src/frontend/blake3"); do
    mkdir -p "$(dirname "$dest/blake3/$f")"; cp "$src/frontend/blake3/$f" "$dest/blake3/$f"
  done
  [ -d "$src/frontend/app" ] || die "frontend/app/ missing in $src"
  for f in $(sm_files_under "$src/frontend/app"); do
    mkdir -p "$(dirname "$dest/$f")"; cp "$src/frontend/app/$f" "$dest/$f"
  done
}

write_headers() {
  local csp
  csp="$(tr -d '\n' < "$CSP_FILE")"
  cat > "$DIST/_headers" <<EOF
/*
  Content-Security-Policy: $csp
  Cache-Control: public, max-age=0, must-revalidate, no-transform
  ! Link
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  Cross-Origin-Opener-Policy: same-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()
EOF
}

# The release currently live (from its HTML), or empty.
live_release() {
  curl -sS --max-time 20 "$APP_HOST/?v=$(date +%s)$RANDOM" 2>/dev/null \
    | sed -n 's|.*src="/v/\([0-9a-f]\{4,40\}\)/share-early\.js".*|\1|p' | head -1
}

build() {
  local sha="$1" prev="$2" tmp
  step "build dist/ (release $sha${prev:+, keeping $prev})"
  [ -f "$SATOSHI" ] || die "Satoshi missing: $SATOSHI — download the Satoshi zip from fontshare.com and copy Fonts/WEB/fonts/Satoshi-Variable.woff2 there (never commit it)"
  [ "$(sm_hash "$SATOSHI")" = "$SATOSHI_SHA256" ] || die "Satoshi-Variable.woff2 is not the official file (hash differs) — the licence forbids modified copies"
  rm -rf "$DIST"
  ( cd "$ROOT" && APP_SHA="$sha" npx --no-install eleventy --config=eleventy.app.js --quiet ) >/dev/null \
    || die "Eleventy build failed: cd $ROOT && APP_SHA=$sha npx eleventy --config=eleventy.app.js"
  copy_release "$ROOT" "$DIST/v/$sha"
  if [ -n "$prev" ] && [ "$prev" != "$sha" ]; then
    git -C "$ROOT" cat-file -e "$prev^{commit}" 2>/dev/null || die "live release $prev is not a commit here — git fetch, or ship from the right checkout"
    tmp="$(mktemp -d "${TMPDIR:-/tmp}/ship-app-prev.XXXXXX")"
    git -C "$ROOT" archive --format=tar "$prev" -- frontend | tar -x -C "$tmp"
    copy_release "$tmp" "$DIST/v/$prev"
    cp "$SATOSHI" "$DIST/v/$prev/fonts/Satoshi-Variable.woff2"   # gitignored: not in the archive
    rm -rf "$tmp"
  fi
  write_headers
  echo "  ✓ $(find "$DIST" -type f | wc -l | tr -d ' ') files"
}

check() {
  local sha="$1" f n bad=0 ref csp_lines
  step "check dist/"
  # §2.3 no inline code: every <script> has src; no on*= handlers; no style= attributes
  for f in $(find "$DIST" -name '*.html' | LC_ALL=C sort); do
    if perl -0ne 'exit((/<script(?![^>]*\bsrc=)[^>]*>/i) ? 0 : 1)' "$f"; then sm_fail "inline <script> in ${f#$DIST/}"; fi
    if perl -0ne 'exit((/<[a-z][^>]*\son[a-z]+\s*=/i) ? 0 : 1)' "$f"; then sm_fail "on*= handler in ${f#$DIST/}"; fi
    if perl -0ne 'exit((/<[a-z][^>]*\sstyle\s*=/i) ? 0 : 1)' "$f"; then sm_fail "style= attribute in ${f#$DIST/}"; fi
    if grep -q '{{\|{%' "$f"; then sm_fail "unrendered template tag in ${f#$DIST/}"; fi
    # every /v/... the page names must exist in this build
    for ref in $(grep -o '"/v/[^"?#]*"' "$f" | tr -d '"' | LC_ALL=C sort -u); do
      [ -f "$DIST$ref" ] || sm_fail "${f#$DIST/} names $ref — not in dist/"
    done
    grep -q "/v/$sha/" "$f" || sm_fail "${f#$DIST/} does not load release $sha"
  done
  for ref in $(grep -o '"/v/[^"]*"' "$DIST/manifest.webmanifest" | tr -d '"'); do
    [ -f "$DIST$ref" ] || sm_fail "manifest names $ref — not in dist/"
  done
  # _headers: exactly one CSP, byte-equal to bin/lib/app-csp.txt
  csp_lines="$(grep -c 'Content-Security-Policy' "$DIST/_headers" || true)"
  [ "$csp_lines" = "1" ] || sm_fail "_headers has $csp_lines CSP lines (want exactly 1)"
  [ "$(sed -n 's/^  Content-Security-Policy: //p' "$DIST/_headers")" = "$(tr -d '\n' < "$CSP_FILE")" ] \
    || sm_fail "_headers CSP differs from bin/lib/app-csp.txt"
  grep -q '^  ! Link$' "$DIST/_headers"      || sm_fail "_headers lacks '! Link'"
  grep -q 'no-transform' "$DIST/_headers"    || sm_fail "_headers lacks no-transform"
  # every mirrored asset, blake3 WASM, fonts, icons in this release
  for n in $SM_ASSETS; do [ -f "$DIST/v/$sha/$n" ] || sm_fail "release lacks $n"; done
  [ -f "$DIST/v/$sha/blake3/browser-async.js" ] || sm_fail "release lacks blake3/"
  [ -n "$(find "$DIST/v/$sha/blake3" -name '*.wasm' | head -1)" ] || sm_fail "release lacks the BLAKE3 .wasm"
  for f in $(sm_files_under "$APP_SRC"); do
    cmp -s "$APP_SRC/$f" "$DIST/v/$sha/$f" || sm_fail "release $f is not frontend/app/$f"
  done
  git -C "$ROOT" ls-files --error-unmatch "frontend/app/fonts/Satoshi-Variable.woff2" >/dev/null 2>&1 \
    && sm_fail "Satoshi is tracked by git — the licence forbids distributing it: git rm --cached frontend/app/fonts/Satoshi-Variable.woff2"
  for f in $(find "$DIST/v/$sha" -maxdepth 1 \( -name '*.js' -o -name '*.css' \) | LC_ALL=C sort); do
    if grep -q 'sourceMappingURL' "$f"; then sm_fail "${f#$DIST/} has a sourceMappingURL line"; fi
  done
  # no third-party CSS/fonts in the app (CSP would block them; better to fail here)
  if grep -rlq 'fonts.googleapis\|fontshare\|gstatic' "$DIST" --include='*.html' --include='*.css'; then sm_fail "third-party font reference in dist/"; fi
  [ "$SM_FAILS" -eq 0 ] || die "check FAILED — $SM_FAILS problem(s) above; nothing deployed"
  echo "  ✓ no inline code · CSP exact · ! Link · no-transform · every asset present"
}

# URL path for a dist file (Pages serves /x/index.html at /x/ and strips .html)
url_for() {
  case "$1" in
    index.html)    echo "/" ;;
    */index.html)  echo "/${1%index.html}" ;;
    *.html)        echo "/${1%.html}" ;;
    *)             echo "/$1" ;;
  esac
}

header_of() { # header_of URL NAME → value (lowercased name match), CR stripped
  curl -sSI --max-time 20 "$1" 2>/dev/null | tr -d '\r' | grep -i "^$2:" | head -1 | cut -d: -f2- | sed 's/^ //'
}

prove() {
  local start now waited pending still f got want url tmp csp cc lk nap
  step "prove: $APP_HOST serves dist/ byte for byte (up to ${PROVE_TIMEOUT}s)"
  tmp="$(mktemp -d "${TMPDIR:-/tmp}/ship-app-live.XXXXXX")"
  pending="$(cd "$DIST" && find . -type f ! -name '_headers' | sed 's|^\./||' | LC_ALL=C sort)"
  start=$(date +%s)
  while :; do
    still=""
    for f in $pending; do
      url="$APP_HOST$(url_for "$f")?v=$(date +%s)$RANDOM"
      if ! curl -sSL --max-time 30 -o "$tmp/got" "$url" 2>/dev/null; then still="$still $f"; continue; fi
      got="$(sm_hash "$tmp/got")"; want="$(sm_hash "$DIST/$f")"
      [ "$got" = "$want" ] || still="$still $f"
    done
    [ -z "$still" ] && break
    now=$(date +%s); waited=$((now - start))
    if [ "$waited" -ge "$PROVE_TIMEOUT" ]; then
      for f in $still; do echo "  ✗ NOT LIVE / NOT IDENTICAL after ${waited}s: $f" >&2; done
      echo "    An HTML mismatch with an extra <script> = Cloudflare injection (Rocket Loader, Email" >&2
      echo "    Obfuscation, Web Analytics) — turn it off for share.refueler.io." >&2
      rm -rf "$tmp"; return 1
    fi
    nap=$((PROVE_TIMEOUT - waited)); [ "$nap" -gt 15 ] && nap=15
    set -- $still; echo "  … $# file(s) not live yet (${waited}s), retrying in ${nap}s"
    pending="$still"; sleep "$nap"
  done
  rm -rf "$tmp"
  echo "  ✓ every dist/ file live and byte-identical"

  csp="$(tr -d '\n' < "$CSP_FILE")"
  for url in "$APP_HOST/" "$APP_HOST/v/$SHA/share.js" "$APP_HOST/no-such-page-$RANDOM"; do
    [ "$(header_of "$url" 'content-security-policy')" = "$csp" ] || sm_fail "CSP header not exact on $url"
    [ -z "$(header_of "$url" 'content-security-policy-report-only')" ] || sm_fail "a Report-Only CSP is still on $url (enforced since X5-2)"
    [ -z "$(header_of "$url" 'x-robots-tag')" ] || sm_fail "X-Robots-Tag on $url (dropped at X5-2)"
    lk="$(header_of "$url" 'link')"; [ -z "$lk" ] || sm_fail "Link header on $url: $lk"
    cc="$(header_of "$url" 'cache-control' | tr 'A-Z' 'a-z')"
    # Pages answers a 404 with its own fixed "Cache-Control: no-store", ignoring _headers
    # (seen live 14 Oct). Harmless: nothing caches it, and the share.refueler.io Configuration
    # Rule turns the injections off anyway. Every 200 must carry no-transform.
    case "$url:$cc" in *no-such-page-*:no-store) ;; *:*no-transform*) ;; *) sm_fail "no-transform missing on $url ($cc)" ;; esac
    case "$cc" in *max-age=0*|*no-store*|*no-cache*) ;; *) sm_fail "browser-cacheable $url ($cc) — restore the Cache Rule: host share.refueler.io, Browser TTL = Respect origin" ;; esac
  done
  [ "$(curl -s -o /dev/null -w '%{http_code}' "$APP_HOST/no-such-page-$RANDOM")" = "404" ] || sm_fail "unknown path is not a 404 (SPA fallback? 404.html missing?)"
  [ "$SM_FAILS" -eq 0 ] || return 1
  echo "  ✓ headers: CSP (enforced) exact · no Link · no-transform · max-age=0 · real 404"
}

case "$MODE" in
  --check)
    SHA="$(git -C "$ROOT" rev-parse --short=10 HEAD)"
    build "$SHA" ""
    check "$SHA"
    echo "✓ CHECKED (app) — dist/ built for $SHA, nothing deployed"
    ;;

  --prove)
    [ -d "$DIST/v" ] || die "no dist/ — run bin/ship-app.sh --check first"
    SHA="$(sed -n 's|.*src="/v/\([0-9a-f]\{4,40\}\)/theme-early\.js".*|\1|p' "$DIST/index.html" | head -1)"
    prove || die "prove FAILED — share.refueler.io is not serving dist/"
    echo "✓ PROVEN (app) — release $SHA"
    ;;

  ship)
    step "1/5 preflight"
    [ "$(git -C "$ROOT" rev-parse --abbrev-ref HEAD)" = "main" ] || die "not on main"
    [ -z "$(git -C "$ROOT" status --porcelain)" ] || die "working tree not clean — commit first (the release is named after HEAD)"
    git -C "$ROOT" fetch --quiet origin main || die "could not fetch origin"
    [ "$(git -C "$ROOT" rev-list --count HEAD..origin/main)" -eq 0 ] || die "behind origin/main — git pull --ff-only"
    [ "$(git -C "$ROOT" rev-list --count origin/main..HEAD)" -eq 0 ] || die "HEAD not pushed — git push first (a release must exist on GitHub)"
    SHA="$(git -C "$ROOT" rev-parse --short=10 HEAD)"
    PREV="$(live_release || true)"
    echo "  ✓ main, clean, pushed · release $SHA · live now: ${PREV:-none}"
    step "2/5"; build "$SHA" "$PREV"
    step "3/5"; check "$SHA"
    step "4/5 deploy (Cloudflare Pages, direct upload, project $PROJECT)"
    # Run from a directory with no wrangler.toml (the Worker's would be read and ignored, with a warning).
    ( cd "$DIST" && "$ROOT/worker/node_modules/.bin/wrangler" pages deploy "$DIST" --project-name "$PROJECT" --branch main \
        --commit-hash "$(git -C "$ROOT" rev-parse HEAD)" --commit-message "release $SHA" --commit-dirty=false ) \
      || die "wrangler pages deploy failed"
    step "5/5"; prove || die "prove FAILED — deployed, but share.refueler.io is not serving dist/ exactly"
    echo ""
    echo "✓ SHIPPED (app) — $APP_HOST release $SHA"
    echo "  Now look: Safari + Mullvad at $APP_HOST (X5-Plan §2.9)."
    ;;

  *)
    sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//'
    exit 2
    ;;
esac
