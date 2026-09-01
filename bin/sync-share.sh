#!/usr/bin/env bash
set -euo pipefail

CANONICAL_DIR="/Users/rajeshtaylor/Documents/refueler-share/frontend"
MIRROR_DIR="/Users/rajeshtaylor/Documents/refueler.io/src/share/assets"
CANONICAL_REPO="/Users/rajeshtaylor/Documents/refueler-share"
MIRROR_REPO="/Users/rajeshtaylor/Documents/refueler.io"

TEXT_SYNC_FILES=("share.js" "share.css" "share-tokens.css" "status.css")
BINARY_SYNC_FILES=("fflate.min.js" "qr-creator.min.js")
SYNC_DIRS=("blake3")

RED='\033[0;31m'; GRN='\033[0;32m'; YLW='\033[1;33m'; BLU='\033[0;34m'; RST='\033[0m'
log()  { echo -e "${BLU}[sync-share]${RST} $*"; }
ok()   { echo -e "${GRN}[sync-share] ✓${RST} $*"; }
warn() { echo -e "${YLW}[sync-share] ⚠${RST} $*"; }
die()  { echo -e "${RED}[sync-share] ✗ ABORT:${RST} $*" >&2; exit 1; }

HEADER_MARKER="/* GENERATED FILE - do not edit directly"

stamp_header() {
  local file="$1"
  local tmp
  tmp="$(mktemp)"
  # Strip existing generated header if present (any leading /* GENERATED ... */ block)
  if head -1 "$file" | grep -qF "GENERATED FILE"; then
    # Find the closing */ line number and skip past it
    local end_line
    end_line=$(grep -n "^.*\*/$" "$file" | head -1 | cut -d: -f1)
    tail -n +$((end_line + 1)) "$file" > "$tmp"
  else
    cp "$file" "$tmp"
  fi
  {
    echo "/* GENERATED FILE - do not edit directly"
    echo "   Canonical: refueler-share/frontend/"
    echo "   Mirror:    refueler.io/src/share/assets/"
    echo "   Tool:      bin/sync-share.sh"
    echo "   Edit the canonical, then run bin/sync-share.sh to propagate. */"
    cat "$tmp"
  } > "$file"
  rm "$tmp"
}

verify_text_sync() {
  local src="$1" dst="$2"
  local tmp_dst
  tmp_dst="$(mktemp)"
  # Strip header from dst: skip lines until past closing */
  local end_line
  end_line=$(grep -n "^.*\*/$" "$dst" | head -1 | cut -d: -f1)
  tail -n +$((end_line + 1)) "$dst" > "$tmp_dst"
  if ! diff -q "$src" "$tmp_dst" > /dev/null 2>&1; then
    rm "$tmp_dst"
    die "Body mismatch after copy+stamp for $(basename "$src"). Aborting."
  fi
  rm "$tmp_dst"
}

verify_binary_sync() {
  local src_md5 dst_md5
  src_md5=$(md5 -q "$1"); dst_md5=$(md5 -q "$2")
  [[ "$src_md5" == "$dst_md5" ]] || die "MD5 mismatch: $(basename "$1")"
}

git_commit_push() {
  local repo="$1" msg="$2"
  cd "$repo"
  if git diff --quiet && git diff --staged --quiet; then
    warn "$(basename "$repo"): nothing to commit"
    return
  fi
  git add -A && git commit -m "$msg" && git push
  ok "$(basename "$repo"): committed + pushed"
}

log "Starting sync - $(date '+%Y-%m-%d %H:%M:%S')"
log "Canonical : $CANONICAL_DIR"
log "Mirror    : $MIRROR_DIR"
echo ""

[[ -d "$CANONICAL_DIR" ]]       || die "Canonical dir not found"
[[ -d "$MIRROR_DIR" ]]          || die "Mirror dir not found"
[[ -d "$CANONICAL_REPO/.git" ]] || die "Not a git repo: $CANONICAL_REPO"
[[ -d "$MIRROR_REPO/.git" ]]    || die "Not a git repo: $MIRROR_REPO"
command -v rsync > /dev/null    || die "rsync not found"

CHANGED_FILES=()

log "Syncing text assets..."
for f in "${TEXT_SYNC_FILES[@]}"; do
  src="$CANONICAL_DIR/$f"; dst="$MIRROR_DIR/$f"
  [[ -f "$src" ]] || die "Missing canonical: $src"
  before_md5=""; [[ -f "$dst" ]] && before_md5=$(md5 -q "$dst")
  cp "$src" "$dst"
  stamp_header "$dst"
  verify_text_sync "$src" "$dst"
  after_md5=$(md5 -q "$dst")
  if [[ "$before_md5" != "$after_md5" ]]; then ok "$f - updated"; CHANGED_FILES+=("$f")
  else ok "$f - unchanged"; fi
done

log "Syncing binary assets..."
for f in "${BINARY_SYNC_FILES[@]}"; do
  src="$CANONICAL_DIR/$f"; dst="$MIRROR_DIR/$f"
  [[ -f "$src" ]] || die "Missing canonical: $src"
  before_md5=""; [[ -f "$dst" ]] && before_md5=$(md5 -q "$dst")
  cp "$src" "$dst"
  verify_binary_sync "$src" "$dst"
  after_md5=$(md5 -q "$dst")
  if [[ "$before_md5" != "$after_md5" ]]; then ok "$f - updated"; CHANGED_FILES+=("$f")
  else ok "$f - unchanged"; fi
done

log "Syncing directories..."
for d in "${SYNC_DIRS[@]}"; do
  [[ -d "$CANONICAL_DIR/$d" ]] || die "Missing canonical dir: $d"
  rsync -a --delete --checksum "$CANONICAL_DIR/$d/" "$MIRROR_DIR/$d/"
  src_hashes=$(find "$CANONICAL_DIR/$d" -type f | sort | xargs md5 -q 2>/dev/null | tr -d '\n')
  dst_hashes=$(find "$MIRROR_DIR/$d"    -type f | sort | xargs md5 -q 2>/dev/null | tr -d '\n')
  [[ "$src_hashes" == "$dst_hashes" ]] || die "MD5 tree mismatch for $d/"
  ok "$d/ - synced and verified"
  CHANGED_FILES+=("$d/")
done

echo ""
[[ ${#CHANGED_FILES[@]} -eq 0 ]] && log "All in sync. Nothing to commit." || log "Changed: ${CHANGED_FILES[*]}"

echo ""
log "Committing both repos..."
COMMIT_MSG="SYNC-1: sync share assets canonical->mirror (bin/sync-share.sh)"
git_commit_push "$CANONICAL_REPO" "$COMMIT_MSG"
git_commit_push "$MIRROR_REPO"    "$COMMIT_MSG"

echo ""
ok "SYNC-1 complete - $(date '+%Y-%m-%d %H:%M:%S')"
