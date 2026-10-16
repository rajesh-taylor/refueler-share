# bin/lib/app-assets.sh — the app's asset list + small helpers, sourced by bin/ship-app.sh.
# X5-2 · 15 Oct 2026: replaces bin/lib/share-mirror.sh (the refueler.io/share/ mirror is retired;
# Share is served only from https://share.refueler.io). Never run directly.
# Written for macOS /bin/bash 3.2: no associative arrays, no mapfile.

# ── What goes into each release (dist/v/<sha>/) from frontend/ ───────────────
# Every top-level frontend/*.js and *.css must be listed here: an unlisted file fails the
# check (aa_check_listed), so a new module can never be left out of a release by accident.
# frontend/app/ (app-only files: header, tokens, fonts, icons) is copied over these after.
AA_JS="share.js share-early.js signin.js crypto.js config.js progress.js zip.js locke.js upload.js upload-turnstile.js upload-options.js upload-folder.js upload-start.js upload-send.js upload-resume.js upload-store.js upload-stop.js upload-net.js upload-account.js download.js download-fetch.js download-save.js download-sheets.js download-time.js download-notes.js download-program.js timestamp.js refueler-badge.js fragment.js merkle.js"
AA_CSS="share.css"
AA_VENDOR="fflate.min.js qr-creator.min.js noble-blake3.js cashu-crypto.js"   # see frontend/VENDORED.md

AA_ASSETS="$AA_JS $AA_CSS $AA_VENDOR"

AA_FAILS=0
aa_fail() { echo "  ✗ $*" >&2; AA_FAILS=$((AA_FAILS + 1)); }

aa_hash() {
  if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | cut -d' ' -f1
  else sha256sum "$1" | cut -d' ' -f1; fi
}

aa_in_list() { # aa_in_list NAME "LIST"
  case " $2 " in *" $1 "*) return 0 ;; esac; return 1
}

# Files under a directory, relative paths, Finder litter excluded, sorted.
aa_files_under() {
  [ -d "$1" ] || return 0
  ( cd "$1" && find . -type f ! -name '.DS_Store' ! -name '._*' | sed 's|^\./||' | LC_ALL=C sort )
}

# aa_check_listed FRONTEND_DIR — every top-level .js/.css is in AA_ASSETS, and every listed file exists.
aa_check_listed() {
  local f n
  for f in "$1"/*.js "$1"/*.css; do
    [ -e "$f" ] || continue
    n="$(basename "$f")"
    aa_in_list "$n" "$AA_ASSETS" || aa_fail "frontend/$n is not in bin/lib/app-assets.sh — add it to AA_JS/AA_CSS/AA_VENDOR"
  done
  for n in $AA_ASSETS; do [ -f "$1/$n" ] || aa_fail "app-assets.sh lists $n but frontend/$n does not exist"; done
}
