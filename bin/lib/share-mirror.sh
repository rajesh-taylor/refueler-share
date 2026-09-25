# bin/lib/share-mirror.sh — single source of truth for the refueler-share → refueler.io mirror
# Share-Sync-1 · 25 Sep 2026. Sourced by bin/sync-share.sh and bin/ship-frontend.sh — never run directly.
# Written for macOS /bin/bash 3.2: no associative arrays, no mapfile, no empty-array expansion.
#
# THE INVARIANT this file exists to protect:
#   what refueler.io/share/ serves == what refueler-share/frontend/ says, byte for byte.
# One list, used by sync, by the pre-push hook, by CI and by the live check — so they cannot drift apart.

# ── What gets mirrored ────────────────────────────────────────────────────────
# Every top-level frontend/*.js and *.css MUST appear in exactly one of the lists below.
# An unlisted file is a hard failure (this is the merkle.js / Share-6-3d trap, now closed).
SM_JS="share.js crypto.js upload.js download.js timestamp.js refueler-badge.js fragment.js merkle.js"
SM_CSS="share.css share-tokens.css status.css"
SM_VENDOR="fflate.min.js qr-creator.min.js"
SM_CANARY="mirror-canary.txt"             # pipeline canary — edit freely to prove a deploy, never app code
SM_CANON_ONLY="upgrade.css"               # deliberately NOT mirrored (pages.dev-era; refueler.io uses plans.css)
SM_MIRROR_ONLY="plans.css"                # owned by refueler.io, lives in the mirror folder, not ours

SM_ASSETS="$SM_JS $SM_CSS $SM_VENDOR $SM_CANARY"

# ── Where things live (relative to each repo root) ────────────────────────────
SM_C_FRONT="frontend"
SM_C_NJK="src/index.njk"
SM_C_B3SRC="src/blake3"
SM_C_ADMIN="worker/src/share/admin/test-upload.html"
SM_M_ASSETS="src/share/assets"
SM_M_NJK="src/share/index.njk"
SM_M_ADMIN="src/share/admin/test-upload.html"

# shellcheck disable=SC2034  # used by the scripts that source this file
SM_IO_ROOT="${REFUELER_IO_ROOT:-/Users/rajeshtaylor/Documents/refueler.io}"
SM_LIVE_BASE="${REFUELER_LIVE_BASE:-https://refueler.io}"

SM_FAILS=0
sm_fail() { echo "  ✗ $*" >&2; SM_FAILS=$((SM_FAILS + 1)); }
sm_warn() { echo "  ! $*" >&2; }
sm_die()  { echo "" >&2; echo "✗ $*" >&2; exit 1; }

sm_hash() {
  if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | cut -d' ' -f1
  else sha256sum "$1" | cut -d' ' -f1; fi
}

sm_in_list() { # sm_in_list NAME "LIST"
  case " $2 " in *" $1 "*) return 0 ;; esac; return 1
}

# Files under a directory, relative paths, Finder litter excluded, sorted.
sm_files_under() {
  [ -d "$1" ] || return 0
  ( cd "$1" && find . -type f ! -name '.DS_Store' ! -name '._*' | sed 's|^\./||' | LC_ALL=C sort )
}

# Canonical-side paths git must track (used by ship + hook extraction).
sm_canon_paths() {
  local p="" n
  for n in $SM_ASSETS; do p="$p $SM_C_FRONT/$n"; done
  echo "$p $SM_C_FRONT/blake3 $SM_C_NJK $SM_C_B3SRC $SM_C_ADMIN"
}
sm_mirror_paths() {
  local p="" n
  for n in $SM_ASSETS; do p="$p $SM_M_ASSETS/$n"; done
  echo "$p $SM_M_ASSETS/blake3 $SM_M_NJK $SM_M_ADMIN"
}

# ── index.njk: canonical → refueler.io rendering (stdout) ─────────────────────
# Front-matter patches + every root-relative reference to a mirrored asset gets the
# /share/assets/ prefix. Generic, so a new <script src="/x.js"> can't silently 404.
sm_render_njk() {
  local script n esc
  script="$(mktemp "${TMPDIR:-/tmp}/sm-njk.XXXXXX")"
  {
    echo 's|^permalink: /index\.html$|permalink: /share/index.html|'
    echo 's|^activePage: ""$|activePage: "share"|'
    for n in $SM_ASSETS; do
      esc="$(printf '%s' "$n" | sed 's/\./\\./g')"
      echo "s|\"/$esc\"|\"/share/assets/$n\"|g"
    done
  } > "$script"
  sed -f "$script" "$1"
  rm -f "$script"
}

sm_verify_njk() { # sm_verify_njk RENDERED_FILE
  local f="$1" n
  grep -q '^permalink: /share/index\.html$' "$f"          || sm_fail "index.njk: permalink not /share/index.html (HQ2)"
  grep -q '^activePage: "share"$' "$f"                     || sm_fail "index.njk: activePage not \"share\" (HQ2)"
  grep -q 'href="/share/assets/share\.css"' "$f"           || sm_fail "index.njk: CSS href not /share/assets/share.css (HQ2)"
  for n in $SM_ASSETS; do
    if grep -qF "\"/$n\"" "$f"; then sm_fail "index.njk: \"/$n\" still root-relative — would 404 on refueler.io"; fi
  done
}

# ── Canonical self-consistency (no mirror needed) ─────────────────────────────
sm_check_canon() { # sm_check_canon SHARE_ROOT
  local s="$1" f n
  for f in $(cd "$s/$SM_C_FRONT" 2>/dev/null && find . -maxdepth 1 -type f \( -name '*.js' -o -name '*.css' \) | sed 's|^\./||' | LC_ALL=C sort); do
    if ! sm_in_list "$f" "$SM_ASSETS" && ! sm_in_list "$f" "$SM_CANON_ONLY"; then
      sm_fail "frontend/$f is not in the sync list — add it to SM_JS/SM_CSS in bin/lib/share-mirror.sh (or SM_CANON_ONLY if it must never ship)"
    fi
  done
  for n in $SM_ASSETS; do
    [ -f "$s/$SM_C_FRONT/$n" ] || sm_fail "frontend/$n is listed for sync but missing — remove it from the list or restore it"
  done
  [ -f "$s/$SM_C_NJK" ]   || sm_fail "$SM_C_NJK missing"
  [ -f "$s/$SM_C_ADMIN" ] || sm_fail "$SM_C_ADMIN missing"
  [ -f "$s/$SM_C_FRONT/blake3/browser-async.js" ] || sm_fail "frontend/blake3/ missing or empty"
  # src/blake3 feeds frontend/blake3 via Eleventy passthrough — an un-built vendor update ships stale WASM
  for f in $(sm_files_under "$s/$SM_C_B3SRC"); do
    if [ ! -f "$s/$SM_C_FRONT/blake3/$f" ] || ! cmp -s "$s/$SM_C_B3SRC/$f" "$s/$SM_C_FRONT/blake3/$f"; then
      sm_fail "src/blake3/$f differs from frontend/blake3/$f — run: cd $s && npm run build"
    fi
  done
}

# ── The comparison. Returns via SM_FAILS; prints only problems. ──────────────
sm_compare() { # sm_compare SHARE_ROOT IO_ROOT
  local s="$1" m="$2" n f tmp before
  before=$SM_FAILS
  sm_check_canon "$s"

  for n in $SM_ASSETS; do
    [ -f "$s/$SM_C_FRONT/$n" ] || continue
    if [ ! -f "$m/$SM_M_ASSETS/$n" ]; then sm_fail "mirror missing $SM_M_ASSETS/$n"
    elif ! cmp -s "$s/$SM_C_FRONT/$n" "$m/$SM_M_ASSETS/$n"; then sm_fail "mirror stale: $n"; fi
  done

  for f in $(sm_files_under "$s/$SM_C_FRONT/blake3"); do
    if [ ! -f "$m/$SM_M_ASSETS/blake3/$f" ]; then sm_fail "mirror missing blake3/$f"
    elif ! cmp -s "$s/$SM_C_FRONT/blake3/$f" "$m/$SM_M_ASSETS/blake3/$f"; then sm_fail "mirror stale: blake3/$f"; fi
  done
  for f in $(sm_files_under "$m/$SM_M_ASSETS/blake3"); do
    [ -f "$s/$SM_C_FRONT/blake3/$f" ] || sm_fail "mirror has blake3/$f with no canonical source — unverifiable WASM/JS in production"
  done

  for f in $(cd "$m/$SM_M_ASSETS" 2>/dev/null && find . -maxdepth 1 -type f ! -name '.DS_Store' | sed 's|^\./||' | LC_ALL=C sort); do
    sm_in_list "$f" "$SM_ASSETS" || sm_in_list "$f" "$SM_MIRROR_ONLY" || sm_warn "mirror-only file $SM_M_ASSETS/$f (not from refueler-share — stale? io-owned? add to SM_MIRROR_ONLY)"
  done

  if [ -f "$s/$SM_C_NJK" ]; then
    tmp="$(mktemp "${TMPDIR:-/tmp}/sm-idx.XXXXXX")"
    sm_render_njk "$s/$SM_C_NJK" > "$tmp"
    sm_verify_njk "$tmp"
    if [ ! -f "$m/$SM_M_NJK" ]; then sm_fail "mirror missing $SM_M_NJK"
    elif ! cmp -s "$tmp" "$m/$SM_M_NJK"; then sm_fail "mirror stale: $SM_M_NJK (edited directly in refueler.io, or not synced)"; fi
    rm -f "$tmp"
  fi

  if [ -f "$s/$SM_C_ADMIN" ]; then
    if [ ! -f "$m/$SM_M_ADMIN" ]; then sm_fail "mirror missing $SM_M_ADMIN"
    elif ! cmp -s "$s/$SM_C_ADMIN" "$m/$SM_M_ADMIN"; then sm_fail "mirror stale: $SM_M_ADMIN"; fi
  fi
  [ "$SM_FAILS" -eq "$before" ]
}

# ── Copy canonical → mirror (working trees). Never deletes anything. ─────────
sm_sync() { # sm_sync SHARE_ROOT IO_ROOT
  local s="$1" m="$2" n f
  [ -d "$m/$SM_M_ASSETS" ] || sm_die "refueler.io mirror not found at $m/$SM_M_ASSETS"
  for n in $SM_ASSETS; do
    cp "$s/$SM_C_FRONT/$n" "$m/$SM_M_ASSETS/$n"; echo "  ✓ $n"
  done
  for f in $(sm_files_under "$s/$SM_C_FRONT/blake3"); do
    mkdir -p "$(dirname "$m/$SM_M_ASSETS/blake3/$f")"
    cp "$s/$SM_C_FRONT/blake3/$f" "$m/$SM_M_ASSETS/blake3/$f"
  done
  echo "  ✓ blake3/"
  sm_render_njk "$s/$SM_C_NJK" > "$m/$SM_M_NJK"; echo "  ✓ index.njk (rendered for refueler.io)"
  mkdir -p "$(dirname "$m/$SM_M_ADMIN")"
  cp "$s/$SM_C_ADMIN" "$m/$SM_M_ADMIN"; echo "  ✓ admin/test-upload.html"
}

# ── Extract committed trees (what a push actually carries) ────────────────────
sm_extract() { # sm_extract REPO REV DEST PATH...
  local repo="$1" rev="$2" dest="$3" p have=""
  shift 3
  mkdir -p "$dest"
  for p in "$@"; do
    git -C "$repo" cat-file -e "$rev:$p" 2>/dev/null && have="$have $p"
  done
  [ -n "$have" ] || return 0
  # shellcheck disable=SC2086
  git -C "$repo" archive --format=tar "$rev" -- $have | tar -x -C "$dest"
}

# shellcheck disable=SC2046  # word-splitting the path list is the point
sm_extract_canon()  { sm_extract "$1" "$2" "$3" $(sm_canon_paths); }
sm_extract_mirror() { sm_extract "$1" "$2" "$3" $SM_M_ASSETS $SM_M_NJK $SM_M_ADMIN; }

# ── Live check: fetch from the PUBLIC site, compare hashes. ───────────────────
# Status codes prove nothing here: refueler.io answers a missing asset with 200 + the homepage.
sm_strip_cf() { perl -0pe 's{<script>\(function\(\)\{[^\n]*?__CF\$cv\$params[^\n]*?</script>(?=</body>)}{}g' "$1"; }

sm_live() { # sm_live CANON_ROOT TIMEOUT_SECONDS
  local s="$1" timeout="$2" start now pending n f tmp url rel local_file got want still waited nap
  tmp="$(mktemp -d "${TMPDIR:-/tmp}/sm-live.XXXXXX")"
  pending=""
  for n in $SM_ASSETS; do pending="$pending assets/$n"; done
  for f in $(sm_files_under "$s/$SM_C_FRONT/blake3"); do pending="$pending assets/blake3/$f"; done
  pending="$pending admin/test-upload.html"
  start=$(date +%s)
  echo "▶ live check: $SM_LIVE_BASE/share/ vs refueler-share (up to ${timeout}s)"
  while :; do
    still=""
    for rel in $pending; do
      case "$rel" in
        assets/*) local_file="$s/$SM_C_FRONT/${rel#assets/}" ;;
        admin/*)  local_file="$s/$SM_C_ADMIN" ;;
      esac
      url="$SM_LIVE_BASE/share/$rel?v=$(date +%s)$RANDOM"
      if ! curl -sSL --max-time 20 -o "$tmp/got" "$url" 2>/dev/null; then still="$still $rel"; continue; fi
      if [ "${rel%.html}" != "$rel" ]; then sm_strip_cf "$tmp/got" > "$tmp/got2"; mv "$tmp/got2" "$tmp/got"; fi
      got="$(sm_hash "$tmp/got")"; want="$(sm_hash "$local_file")"
      [ "$got" = "$want" ] || still="$still $rel"
    done
    if [ -z "$still" ]; then
      if curl -sSL --max-time 20 "$SM_LIVE_BASE/share/?v=$(date +%s)" | grep -q 'src="/share/assets/share\.js"'; then
        rm -rf "$tmp"; echo "  ✓ every mirrored file is live and byte-identical; /share/ loads share.js from /share/assets/"; return 0
      fi
      still="/share/ page"
    fi
    now=$(date +%s); waited=$((now - start))
    if [ "$waited" -ge "$timeout" ]; then
      rm -rf "$tmp"
      for rel in $still; do echo "  ✗ NOT LIVE after ${waited}s: $rel" >&2; done
      echo "    Check the refueler-io project in Cloudflare → Workers & Pages → Deployments (failed build?)" >&2
      return 1
    fi
    nap=$((timeout - waited)); if [ "$nap" -gt 20 ]; then nap=20; fi
    set -- $still; echo "  … $# file(s) not live yet (${waited}s) — Cloudflare Pages still building? retrying in ${nap}s"
    pending="$still"; sleep "$nap"
  done
}
