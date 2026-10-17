#!/usr/bin/env bash
# bin/ship-app.sh — build, check, release, deploy and PROVE the standalone app on share.refueler.io.
# X5-1 · 14 Oct 2026 · docs/X5-plan-v1.md §2.8. Stops at the first failure; ends "✓ SHIPPED (app)".
# Share-Release-1a · 17 Oct 2026: two builds per ship, --rebuild, a GitHub release per ship.
#
#   bin/ship-app.sh            preflight → build ×2 → check + release files → draft release →
#                              deploy (Pages, direct upload) → prove live → publish the release
#   bin/ship-app.sh --check    build + check only, no git preflight, no deploy (safe anywhere)
#   bin/ship-app.sh --ci       --check without Satoshi (GitHub CI: the font is never committed;
#                              an empty stand-in fills its slot, and nothing is deployed)
#   bin/ship-app.sh --rebuild <commit> [<prev>]
#                              rebuild one release from git alone (git archive), the release
#                              <prev> kept beside it, + its release files; deploys nothing
#   bin/ship-app.sh --prove    prove only: is share.refueler.io serving exactly dist/?
#
# What gets deployed is dist/, and dist/ is exactly what is hashed:
#   dist/*.html, dist/signin/, dist/manifest.webmanifest   (Eleventy, eleventy.app.js)
#   dist/v/<sha>/      every frontend/ asset in AA_ASSETS + blake3/, then frontend/app/ over it
#   dist/v/<prev>/     the release live before this one, rebuilt byte-for-byte from git, so a
#                      tab opened before the ship can still lazy-load its own modules
#   dist/release.json  WEBCAT-format manifest (unsigned) of every served file but itself
#   dist/release-extra.json   sidecar: commit, previous release, pins (bin/lib/release-manifest.mjs)
#   dist/_headers      CSP (bin/lib/app-csp.txt; Report-Only at X5-1, enforced since X5-2) + fixed headers
# The GitHub release app-<sha> carries manifest.json (= release.json), release-extra.json and
# SHA256SUMS (every served file); they're written to build/release/. Order: draft before deploy,
# publish only after prove, so a published release never names a commit that isn't live.
# Since X5-2 (15 Oct 2026) this is the only way Share's frontend reaches the public: the
# refueler.io/share/ mirror is retired. The asset list lives in bin/lib/app-assets.sh.
#
# Reproducible: every ship builds twice, from the working tree and from `git archive HEAD`, and
# refuses on any difference. Nothing in the build reads the clock. Rule: a template that ever
# needs a date takes it from the commit (`git log -1 --format=%ct`), never Date.now() or `date`.
# Pages ignores mtimes and the hashes don't include them, so no SOURCE_DATE_EPOCH.
#
# Written for macOS /bin/bash 3.2 (no associative arrays, no mapfile).

set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=lib/app-assets.sh
. "$ROOT/bin/lib/app-assets.sh"

MODE="${1:-ship}"
APP_HOST="${APP_HOST:-https://share.refueler.io}"
PROJECT="refueler-share-app"
REPO="rajesh-taylor/refueler-share"
# Every `gh` call names the repo, whatever directory the script is run from (Share-Release-1b:
# run from ~, `gh release create` looked for a git repo in ~ and failed).
export GH_REPO="$REPO"
CSP_FILE="$ROOT/bin/lib/app-csp.txt"
DIST="$ROOT/dist"
RELEASE_OUT="$ROOT/build/release"
APP_SRC="$ROOT/frontend/app"
ELEVENTY="$ROOT/node_modules/.bin/eleventy"
PROVE_TIMEOUT="${PROVE_TIMEOUT:-300}"
# Satoshi (header only): ITF Free Font License v2.0 allows self-hosting on our own site but not
# redistribution, so the official WOFF2 is gitignored and lives only on this Mac. Hash = the file
# from Fontshare's Satoshi zip, unmodified (no subsetting or conversion allowed).
SATOSHI="$APP_SRC/fonts/Satoshi-Variable.woff2"
SATOSHI_SHA256="e739aff9b4d02c264341d6d4872edcda28e79373aeda936f659566a1cd3eb47f"

die()  { echo "" >&2; echo "✗ $*" >&2; exit 1; }
step() { echo "▶ $*"; }

WORK="$(mktemp -d "${TMPDIR:-/tmp}/ship-app.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT
mktmp() { mktemp -d "$WORK/t.XXXXXX"; }   # removed with WORK on exit (also from $(…) subshells)

# ── release dir: build one release's assets from a git tree into DEST ────────
# copy_release SRC_ROOT DEST [ASSETS] — SRC_ROOT has frontend/ (working tree or git archive).
# ASSETS defaults to today's list; an older release passes its own (Share-MIME-1: a module
# added since that release is not in its tree).
copy_release() {
  local src="$1" dest="$2" assets="${3:-$AA_ASSETS}" n f
  mkdir -p "$dest"
  for n in $assets; do
    [ -f "$src/frontend/$n" ] || die "release asset missing: frontend/$n"
    cp "$src/frontend/$n" "$dest/$n"
  done
  for f in $(aa_files_under "$src/frontend/blake3"); do
    mkdir -p "$(dirname "$dest/blake3/$f")"; cp "$src/frontend/blake3/$f" "$dest/blake3/$f"
  done
  [ -d "$src/frontend/app" ] || die "frontend/app/ missing in $src"
  for f in $(aa_files_under "$src/frontend/app"); do
    mkdir -p "$(dirname "$dest/$f")"; cp "$src/frontend/app/$f" "$dest/$f"
  done
}

# A commit's own asset list (from its bin/lib/app-assets.sh), empty if it had none.
assets_of() {
  git -C "$ROOT" show "$1:bin/lib/app-assets.sh" 2>/dev/null \
    | sed -En 's/^AA_(JS|CSS|VENDOR)="([^"]*)".*/\2/p' | tr '\n' ' '
}

# Satoshi into a release dir that has fonts/: the official file, or (CI) an empty stand-in.
place_satoshi() {
  [ -d "$1/fonts" ] || return 0
  if [ -f "$SATOSHI" ]; then cp "$SATOSHI" "$1/fonts/Satoshi-Variable.woff2"
  elif [ "${CI_MODE:-0}" = "1" ]; then : > "$1/fonts/Satoshi-Variable.woff2"
  else die "Satoshi missing: $SATOSHI"; fi
}

check_satoshi() {
  if [ "${CI_MODE:-0}" = "1" ]; then return 0; fi
  [ -f "$SATOSHI" ] || die "Satoshi missing: $SATOSHI — download the Satoshi zip from fontshare.com and copy Fonts/WEB/fonts/Satoshi-Variable.woff2 there (never commit it)"
  [ "$(aa_hash "$SATOSHI")" = "$SATOSHI_SHA256" ] || die "Satoshi-Variable.woff2 is not the official file (hash differs) — the licence forbids modified copies"
}

write_headers() {
  local out="$1" csp
  csp="$(tr -d '\n' < "$CSP_FILE")"
  cat > "$out/_headers" <<EOF
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

# build_into SRC OUT SHA PREV [ASSETS] — one complete deploy tree from the tree at SRC (the
# working tree, or a git archive with node_modules linked in). PREV is rebuilt from git.
build_into() {
  local src="$1" out="$2" sha="$3" prev="$4" assets="${5:-$AA_ASSETS}" tmp prev_assets
  rm -rf "$out"
  [ "$src" = "$ROOT" ] || [ -e "$src/node_modules" ] || ln -s "$ROOT/node_modules" "$src/node_modules"
  ( cd "$src" && APP_SHA="$sha" APP_PREV="$([ "$prev" = "$sha" ] || echo "$prev")" "$ELEVENTY" --config=eleventy.app.js --output="$out" --quiet ) >/dev/null \
    || die "Eleventy build failed: cd $src && APP_SHA=$sha APP_PREV=$prev npx eleventy --config=eleventy.app.js"
  copy_release "$src" "$out/v/$sha" "$assets"
  [ -f "$out/v/$sha/fonts/Satoshi-Variable.woff2" ] || place_satoshi "$out/v/$sha"
  if [ -n "$prev" ] && [ "$prev" != "$sha" ]; then
    git -C "$ROOT" cat-file -e "$prev^{commit}" 2>/dev/null || die "release $prev is not a commit here — git fetch, or ship from the right checkout"
    tmp="$(mktmp)"
    git -C "$ROOT" archive --format=tar "$prev" -- frontend | tar -x -C "$tmp"
    prev_assets="$(assets_of "$prev")"
    copy_release "$tmp" "$out/v/$prev" "${prev_assets:-$AA_ASSETS}"
    place_satoshi "$out/v/$prev"   # gitignored: not in the archive
  fi
  write_headers "$out"
}

# Every file a release takes from frontend/ is tracked by git (Satoshi excepted): an untracked
# file would ship, and nobody could rebuild it from the public source.
check_tracked() {
  local tracked n f bad=0
  tracked="$(git -C "$ROOT" ls-files -- frontend)"
  for f in $(for n in $AA_ASSETS; do echo "frontend/$n"; done; \
             aa_files_under "$ROOT/frontend/blake3" | sed 's|^|frontend/blake3/|'; \
             aa_files_under "$APP_SRC" | sed 's|^|frontend/app/|'); do
    [ "$f" = "frontend/app/fonts/Satoshi-Variable.woff2" ] && continue
    printf '%s\n' "$tracked" | grep -qxF "$f" || { echo "  ✗ not tracked by git: $f" >&2; bad=1; }
  done
  [ "$bad" -eq 0 ] || die "release would ship files that aren't in git — git add them (and commit), or delete them"
}

# build SHA PREV — dist/ from the working tree; then (clean tree, or ship/ci) a second build
# from `git archive HEAD`, which must be byte-identical.
build() {
  local sha="$1" prev="$2" tmp diffs
  step "build dist/ (release $sha${prev:+, keeping $prev}) · node $(node -v) · eleventy $(eleventy_version)"
  check_satoshi
  build_into "$ROOT" "$DIST" "$sha" "$prev"
  echo "  ✓ $(find "$DIST" -type f | wc -l | tr -d ' ') files"
  if [ "$MODE" = "--check" ] && [ -n "$(git -C "$ROOT" status --porcelain)" ]; then
    echo "  ⚠ uncommitted changes: second build and tracked-file check skipped (a ship refuses until committed)"
    return 0
  fi
  check_tracked
  step "second build from git archive HEAD (must be byte-identical)"
  tmp="$(mktmp)"
  mkdir -p "$tmp/src"
  git -C "$ROOT" archive --format=tar HEAD | tar -x -C "$tmp/src"
  build_into "$tmp/src" "$tmp/dist" "$sha" "$prev"
  if ! diffs="$(diff -r -q "$DIST" "$tmp/dist" 2>&1)"; then
    printf '%s\n' "$diffs" | sed "s|$tmp/dist|<git archive build>|g; s|$DIST|dist|g; s|^|  ✗ |" >&2
    die "the two builds differ — dist/ holds something git doesn't (uncommitted change, untracked or ignored file?) or the build isn't reproducible; nothing deployed"
  fi
  echo "  ✓ two builds byte-identical"
}

eleventy_version() { node -p "require('$ROOT/node_modules/@11ty/eleventy/package.json').version"; }

# release_files COMMIT40 PREV — dist/release.json + dist/release-extra.json, and the three
# release assets in build/release/. .nvmrc is read from the commit being released.
release_files() {
  local full="$1" prev="$2" nvmrc standin=""
  nvmrc="$(git -C "$ROOT" show "$full:.nvmrc" 2>/dev/null | tr -d '[:space:]' || true)"
  [ "${CI_MODE:-0}" = "1" ] && standin="--standin"
  rm -rf "$RELEASE_OUT"
  node "$ROOT/bin/lib/release-manifest.mjs" generate --dist "$DIST" --out "$RELEASE_OUT" \
    --commit "$full" --prev "$prev" --csp "$CSP_FILE" --satoshi-sha "$SATOSHI_SHA256" \
    --nvmrc "${nvmrc:-none}" --eleventy "$(eleventy_version)" $standin \
    || die "release files could not be written (bin/lib/release-manifest.mjs)"
}

check() {
  local sha="$1" f n bad=0 ref csp_lines
  step "check dist/"
  aa_check_listed "$ROOT/frontend"
  # §2.3 no inline code: every <script> has src; no on*= handlers; no style= attributes
  for f in $(find "$DIST" -name '*.html' | LC_ALL=C sort); do
    if perl -0ne 'exit((/<script(?![^>]*\bsrc=)[^>]*>/i) ? 0 : 1)' "$f"; then aa_fail "inline <script> in ${f#$DIST/}"; fi
    if perl -0ne 'exit((/<[a-z][^>]*\son[a-z]+\s*=/i) ? 0 : 1)' "$f"; then aa_fail "on*= handler in ${f#$DIST/}"; fi
    if perl -0ne 'exit((/<[a-z][^>]*\sstyle\s*=/i) ? 0 : 1)' "$f"; then aa_fail "style= attribute in ${f#$DIST/}"; fi
    if grep -q '{{\|{%' "$f"; then aa_fail "unrendered template tag in ${f#$DIST/}"; fi
    # every /v/... the page names must exist in this build
    for ref in $(grep -o '"/v/[^"?#]*"' "$f" | tr -d '"' | LC_ALL=C sort -u); do
      [ -f "$DIST$ref" ] || aa_fail "${f#$DIST/} names $ref — not in dist/"
    done
    grep -q "/v/$sha/" "$f" || aa_fail "${f#$DIST/} does not load release $sha"
  done
  for ref in $(grep -o '"/v/[^"]*"' "$DIST/manifest.webmanifest" | tr -d '"'); do
    [ -f "$DIST$ref" ] || aa_fail "manifest names $ref — not in dist/"
  done
  # _headers: exactly one CSP, byte-equal to bin/lib/app-csp.txt
  csp_lines="$(grep -c 'Content-Security-Policy' "$DIST/_headers" || true)"
  [ "$csp_lines" = "1" ] || aa_fail "_headers has $csp_lines CSP lines (want exactly 1)"
  [ "$(sed -n 's/^  Content-Security-Policy: //p' "$DIST/_headers")" = "$(tr -d '\n' < "$CSP_FILE")" ] \
    || aa_fail "_headers CSP differs from bin/lib/app-csp.txt"
  grep -q '^  ! Link$' "$DIST/_headers"      || aa_fail "_headers lacks '! Link'"
  grep -q 'no-transform' "$DIST/_headers"    || aa_fail "_headers lacks no-transform"
  # every listed asset, blake3 WASM, fonts, icons in this release
  for n in $AA_ASSETS; do [ -f "$DIST/v/$sha/$n" ] || aa_fail "release lacks $n"; done
  [ -f "$DIST/v/$sha/blake3/browser-async.js" ] || aa_fail "release lacks blake3/"
  [ -n "$(find "$DIST/v/$sha/blake3" -name '*.wasm' | head -1)" ] || aa_fail "release lacks the BLAKE3 .wasm"
  for f in $(aa_files_under "$APP_SRC"); do
    cmp -s "$APP_SRC/$f" "$DIST/v/$sha/$f" || aa_fail "release $f is not frontend/app/$f"
  done
  git -C "$ROOT" ls-files --error-unmatch "frontend/app/fonts/Satoshi-Variable.woff2" >/dev/null 2>&1 \
    && aa_fail "Satoshi is tracked by git — the licence forbids distributing it: git rm --cached frontend/app/fonts/Satoshi-Variable.woff2"
  for f in $(find "$DIST/v/$sha" -maxdepth 1 \( -name '*.js' -o -name '*.css' \) | LC_ALL=C sort); do
    if grep -q 'sourceMappingURL' "$f"; then aa_fail "${f#$DIST/} has a sourceMappingURL line"; fi
  done
  # no third-party CSS/fonts in the app (CSP would block them; better to fail here)
  if grep -rlq 'fonts.googleapis\|fontshare\|gstatic' "$DIST" --include='*.html' --include='*.css'; then aa_fail "third-party font reference in dist/"; fi
  [ "$AA_FAILS" -eq 0 ] || die "check FAILED — $AA_FAILS problem(s) above; nothing deployed"
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
  tmp="$(mktmp)"
  pending="$(cd "$DIST" && find . -type f ! -name '_headers' | sed 's|^\./||' | LC_ALL=C sort)"
  start=$(date +%s)
  while :; do
    still=""
    for f in $pending; do
      url="$APP_HOST$(url_for "$f")?v=$(date +%s)$RANDOM"
      if ! curl -sSL --max-time 30 -o "$tmp/got" "$url" 2>/dev/null; then still="$still $f"; continue; fi
      got="$(aa_hash "$tmp/got")"; want="$(aa_hash "$DIST/$f")"
      [ "$got" = "$want" ] || still="$still $f"
    done
    [ -z "$still" ] && break
    now=$(date +%s); waited=$((now - start))
    if [ "$waited" -ge "$PROVE_TIMEOUT" ]; then
      for f in $still; do echo "  ✗ NOT LIVE / NOT IDENTICAL after ${waited}s: $f" >&2; done
      echo "    An HTML mismatch with an extra <script> = Cloudflare injection (Rocket Loader, Email" >&2
      echo "    Obfuscation, Web Analytics) — turn it off for share.refueler.io." >&2
      return 1
    fi
    nap=$((PROVE_TIMEOUT - waited)); [ "$nap" -gt 15 ] && nap=15
    set -- $still; echo "  … $# file(s) not live yet (${waited}s), retrying in ${nap}s"
    pending="$still"; sleep "$nap"
  done
  echo "  ✓ every dist/ file live and byte-identical"

  csp="$(tr -d '\n' < "$CSP_FILE")"
  for url in "$APP_HOST/" "$APP_HOST/v/$SHA/share.js" "$APP_HOST/no-such-page-$RANDOM"; do
    [ "$(header_of "$url" 'content-security-policy')" = "$csp" ] || aa_fail "CSP header not exact on $url"
    [ -z "$(header_of "$url" 'content-security-policy-report-only')" ] || aa_fail "a Report-Only CSP is still on $url (enforced since X5-2)"
    [ -z "$(header_of "$url" 'x-robots-tag')" ] || aa_fail "X-Robots-Tag on $url (dropped at X5-2)"
    lk="$(header_of "$url" 'link')"; [ -z "$lk" ] || aa_fail "Link header on $url: $lk"
    cc="$(header_of "$url" 'cache-control' | tr 'A-Z' 'a-z')"
    # Pages answers a 404 with its own fixed "Cache-Control: no-store", ignoring _headers
    # (seen live 14 Oct). Harmless: nothing caches it, and the share.refueler.io Configuration
    # Rule turns the injections off anyway. Every 200 must carry no-transform.
    case "$url:$cc" in *no-such-page-*:no-store) ;; *:*no-transform*) ;; *) aa_fail "no-transform missing on $url ($cc)" ;; esac
    case "$cc" in *max-age=0*|*no-store*|*no-cache*) ;; *) aa_fail "browser-cacheable $url ($cc) — restore the Cache Rule: host share.refueler.io, Browser TTL = Respect origin" ;; esac
  done
  [ "$(curl -s -o /dev/null -w '%{http_code}' "$APP_HOST/no-such-page-$RANDOM")" = "404" ] || aa_fail "unknown path is not a 404 (SPA fallback? 404.html missing?)"
  [ "$AA_FAILS" -eq 0 ] || return 1
  echo "  ✓ headers: CSP (enforced) exact · no Link · no-transform · max-age=0 · real 404"
}

# GitHub must refuse to move or delete app-* tags, and lock published releases.
check_protections() {
  local id ok=""
  for id in $(gh api "repos/$REPO/rulesets" --jq '.[] | select(.target=="tag" and .enforcement=="active") | .id' 2>/dev/null); do
    if [ "$(gh api "repos/$REPO/rulesets/$id" --jq '[(.conditions.ref_name.include | index("refs/tags/app-*") != null),
        ([.rules[].type] | index("update") != null), ([.rules[].type] | index("deletion") != null),
        (.bypass_actors | length == 0)] | all' 2>/dev/null)" = "true" ]; then ok=1; fi
  done
  [ -n "$ok" ] || die "no active tag ruleset on refs/tags/app-* blocking update + deletion with no bypass (GitHub → Settings → Rules → Rulesets)"
  [ "$(gh api "repos/$REPO/immutable-releases" --jq '.enabled' 2>/dev/null)" = "true" ] \
    || die "release immutability is off (GitHub → Settings → General → Releases)"
}

remote_tag_commit() { # commit the remote tag points at (peeled), or empty
  git -C "$ROOT" ls-remote origin "refs/tags/$1" "refs/tags/$1^{}" 2>/dev/null | awk '{print $1}' | tail -1
}

release_notes() { # release_notes TAG FULL PREV → stdout
  local tag="$1" full="$2" prev="$3" prev_line
  if [ -z "$prev" ] || [ "$prev" = "${full:0:10}" ]; then prev_line="none"
  elif gh release view "app-$prev" >/dev/null 2>&1; then prev_line="[app-$prev](https://github.com/$REPO/releases/tag/app-$prev), kept at /v/$prev/"
  else prev_line="$prev (shipped before releases were published), kept at /v/$prev/"; fi
  cat <<EOF
Release $tag of https://share.refueler.io.

- Commit: [$full](https://github.com/$REPO/commit/$full)
- Previous release: $prev_line
- Files: \`SHA256SUMS\` lists the SHA-256 of every file this deploy serves; \`manifest.json\` holds the same hashes in WEBCAT's manifest format (unsigned) and is also served at /release.json; \`release-extra.json\` holds the commit, the previous release and the build pins.
- How to check these files against https://share.refueler.io yourself: https://share.refueler.io/verify/
- Rebuild from source on GitHub's machines: [runs for this tag](https://github.com/$REPO/actions/workflows/release-rebuild.yml?query=branch%3A$tag)
- Not rebuilt there: the Satoshi font, whose licence lets us serve it but not publish it. Its listed hash is the official Fontshare file's.
EOF
}

case "$MODE" in
  --check)
    SHA="$(git -C "$ROOT" rev-parse HEAD | cut -c1-10)"
    build "$SHA" ""
    check "$SHA"
    release_files "$(git -C "$ROOT" rev-parse HEAD)" ""
    echo "✓ CHECKED (app) — dist/ built for $SHA, nothing deployed"
    ;;

  --ci)
    CI_MODE=1
    SHA="$(git -C "$ROOT" rev-parse HEAD | cut -c1-10)"
    build "$SHA" ""
    check "$SHA"
    release_files "$(git -C "$ROOT" rev-parse HEAD)" ""
    echo "✓ CHECKED (app, CI — no Satoshi) — dist/ built for $SHA, nothing deployed"
    ;;

  --rebuild)
    [ -n "${2:-}" ] || die "usage: bin/ship-app.sh --rebuild <commit> [<prev>]"
    FULL="$(git -C "$ROOT" rev-parse --verify --quiet "$2^{commit}")" || die "$2 is not a commit here — git fetch --tags"
    SHA="${FULL:0:10}"
    PREV=""
    if [ -n "${3:-}" ] && [ "$3" != "none" ]; then
      PREV="$(git -C "$ROOT" rev-parse --verify --quiet "$3^{commit}" | cut -c1-10)" || die "$3 is not a commit here — git fetch"
      [ -n "$PREV" ] || die "$3 is not a commit here — git fetch"
    fi
    if [ -f "$SATOSHI" ]; then check_satoshi; else CI_MODE=1; fi
    step "rebuild release $SHA from git alone${PREV:+ (keeping $PREV)} · node $(node -v) · eleventy $(eleventy_version)${CI_MODE:+ · Satoshi stand-in}"
    T="$(mktmp)"; mkdir -p "$T/src"
    git -C "$ROOT" archive --format=tar "$FULL" | tar -x -C "$T/src"
    ASSETS="$(assets_of "$FULL")"
    build_into "$T/src" "$DIST" "$SHA" "$PREV" "${ASSETS:-$AA_ASSETS}"
    echo "  ✓ $(find "$DIST" -type f | wc -l | tr -d ' ') files"
    release_files "$FULL" "$PREV"
    echo "✓ REBUILT (app) — release $SHA in dist/, SHA256SUMS in build/release/SHA256SUMS, nothing deployed"
    ;;

  --prove)
    [ -d "$DIST/v" ] || die "no dist/ — run bin/ship-app.sh --check first"
    SHA="$(sed -n 's|.*src="/v/\([0-9a-f]\{4,40\}\)/theme-early\.js".*|\1|p' "$DIST/index.html" | head -1)"
    prove || die "prove FAILED — share.refueler.io is not serving dist/"
    echo "✓ PROVEN (app) — release $SHA"
    ;;

  ship)
    step "1/7 preflight"
    [ "$(git -C "$ROOT" rev-parse --abbrev-ref HEAD)" = "main" ] || die "not on main"
    [ -z "$(git -C "$ROOT" status --porcelain)" ] || die "working tree not clean — commit first (the release is named after HEAD)"
    git -C "$ROOT" fetch --quiet origin main || die "could not fetch origin"
    [ "$(git -C "$ROOT" rev-list --count HEAD..origin/main)" -eq 0 ] || die "behind origin/main — git pull --ff-only"
    [ "$(git -C "$ROOT" rev-list --count origin/main..HEAD)" -eq 0 ] || die "HEAD not pushed — git push first (a release must exist on GitHub)"
    command -v gh >/dev/null 2>&1 || die "gh (GitHub CLI) not found — brew install gh"
    gh auth status >/dev/null 2>&1 || die "gh is not signed in — gh auth login"
    check_protections
    FULL="$(git -C "$ROOT" rev-parse HEAD)"
    SHA="${FULL:0:10}"
    TAG="app-$SHA"
    T="$(mktmp)"
    STATE="new"
    if gh release view "$TAG" --json isDraft --jq '.isDraft' > "$T/draft" 2>/dev/null; then
      if [ "$(cat "$T/draft")" = "true" ]; then
        echo "  · a draft $TAG from an earlier failed ship: deleting it, a new one follows"
        gh release delete "$TAG" --yes >/dev/null || die "could not delete the draft release $TAG"
      else
        [ "$(remote_tag_commit "$TAG")" = "$FULL" ] || die "release $TAG is published but its tag isn't on $FULL — investigate before shipping"
        gh release download "$TAG" --pattern SHA256SUMS --pattern release-extra.json --dir "$T/published" >/dev/null \
          || die "could not download $TAG's SHA256SUMS + release-extra.json"
        STATE="reship"
      fi
    fi
    if [ "$STATE" = "new" ]; then
      [ -z "$(remote_tag_commit "$TAG")" ] || die "tag $TAG exists on GitHub with no release — investigate before shipping"
      PREV="$(live_release || true)"
    else
      # Same deploy as the first time: its kept previous release comes from the release itself.
      PREV="$(node -p "require('$T/published/release-extra.json').previous_release || ''")"
    fi
    echo "  ✓ main, clean, pushed · gh signed in · app-* tags protected · releases immutable"
    echo "  ✓ release $SHA · live now: $(live_release || true) · keeping: ${PREV:-none}${STATE:+ · $STATE}"
    step "2/7"; build "$SHA" "$PREV"
    step "3/7"; check "$SHA"
    release_files "$FULL" "$PREV"
    if [ "$STATE" = "reship" ]; then
      cmp -s "$RELEASE_OUT/SHA256SUMS" "$T/published/SHA256SUMS" \
        || die "re-ship of $TAG builds different files from its published release (diff build/release/SHA256SUMS against the release's) — nothing deployed"
      step "4/7 release $TAG already published; this build matches its SHA256SUMS"
    else
      step "4/7 draft release $TAG (private until the deploy is proven)"
      release_notes "$TAG" "$FULL" "$PREV" > "$T/notes.md"
      gh release create "$TAG" --draft --target "$FULL" --title "$TAG" --notes-file "$T/notes.md" \
        "$RELEASE_OUT/manifest.json" "$RELEASE_OUT/release-extra.json" "$RELEASE_OUT/SHA256SUMS" >/dev/null \
        || die "could not create the draft release $TAG"
      [ "$(gh release view "$TAG" --json assets --jq '.assets | length')" = "3" ] || die "draft $TAG does not have its three files"
      echo "  ✓ draft $TAG with manifest.json, release-extra.json, SHA256SUMS"
    fi
    step "5/7 deploy (Cloudflare Pages, direct upload, project $PROJECT)"
    # Run from a directory with no wrangler.toml (the Worker's would be read and ignored, with a warning).
    ( cd "$DIST" && "$ROOT/worker/node_modules/.bin/wrangler" pages deploy "$DIST" --project-name "$PROJECT" --branch main \
        --commit-hash "$FULL" --commit-message "release $SHA" --commit-dirty=false ) \
      || die "wrangler pages deploy failed$([ "$STATE" = new ] && echo " (the $TAG draft stays private; the next ship replaces it)")"
    step "6/7"; prove || die "prove FAILED — deployed, but share.refueler.io is not serving dist/ exactly (the $TAG release is not published)"
    if [ "$STATE" = "reship" ]; then
      echo ""
      echo "✓ SHIPPED (app) — $APP_HOST release $TAG (re-ship; already published)"
    else
      step "7/7 publish $TAG as the latest release"
      gh release edit "$TAG" --draft=false --latest >/dev/null \
        || die "LIVE but NOT PUBLISHED: run  gh release edit $TAG --draft=false --latest  (from $ROOT)"
      [ "$(gh release view "$TAG" --json isDraft --jq '.isDraft')" = "false" ] || die "LIVE but $TAG still a draft: gh release edit $TAG --draft=false --latest"
      [ "$(remote_tag_commit "$TAG")" = "$FULL" ] || die "$TAG published but its tag doesn't point at $FULL — investigate"
      echo "  ✓ https://github.com/$REPO/releases/tag/$TAG"
      echo ""
      echo "✓ SHIPPED (app) — release $TAG published"
    fi
    echo "  Now look: Safari + Mullvad at $APP_HOST (X5-Plan §2.9)."
    ;;

  *)
    sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'
    exit 2
    ;;
esac
