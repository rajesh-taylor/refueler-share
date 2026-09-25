#!/usr/bin/env bash
# bin/sync-share.sh — refueler-share → refueler.io mirror: sync, check, verify, prove live.
# Share-Sync-1 · 25 Sep 2026. File list + logic: bin/lib/share-mirror.sh (one list, every caller).
#
#   bin/sync-share.sh                   copy frontend/ → refueler.io working tree. Deploys NOTHING.
#   bin/sync-share.sh --check           read-only: are the two working trees identical?
#   bin/sync-share.sh --verify-push SHA pre-push hook: does refueler.io's PUSHED main match SHA?
#   bin/sync-share.sh --live [SECONDS]  is the public site serving exactly what HEAD says?
#
# To actually ship a frontend change, use bin/ship-frontend.sh — it does all of the above in order.

set -euo pipefail
SHARE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=lib/share-mirror.sh
. "$SHARE_ROOT/bin/lib/share-mirror.sh"

mode="${1:-sync}"

case "$mode" in
  sync)
    echo "▶ sync-share: $SHARE_ROOT/frontend → $SM_IO_ROOT/$SM_M_ASSETS"
    sm_check_canon "$SHARE_ROOT"
    [ "$SM_FAILS" -eq 0 ] || sm_die "sync-share: canonical frontend/ has problems (above) — nothing copied"
    sm_sync "$SHARE_ROOT" "$SM_IO_ROOT"
    sm_compare "$SHARE_ROOT" "$SM_IO_ROOT" || sm_die "sync-share: mirror still differs after copy — see above"
    echo "▶ sync-share: done. refueler.io WORKING TREE updated — nothing is live yet."
    echo "  Ship it: $SHARE_ROOT/bin/ship-frontend.sh \"your message\""
    ;;

  --check)
    echo "▶ sync-share --check: $SHARE_ROOT ↔ $SM_IO_ROOT (working trees)"
    if [ -z "${CI:-}" ]; then
      hp="$(git -C "$SHARE_ROOT" config core.hooksPath || true)"
      [ "$hp" = "bin/githooks" ] || sm_fail "pre-push hook not active — run: git -C $SHARE_ROOT config core.hooksPath bin/githooks"
      [ -x "$SHARE_ROOT/bin/githooks/pre-push" ] || sm_fail "bin/githooks/pre-push is not executable — git would silently skip it"
    fi
    sm_compare "$SHARE_ROOT" "$SM_IO_ROOT" || true
    [ "$SM_FAILS" -eq 0 ] || sm_die "sync-share --check: $SM_FAILS problem(s)"
    echo "  ✓ in sync"
    ;;

  --verify-push)
    sha="${2:?usage: --verify-push <sha>}"
    tmp="$(mktemp -d "${TMPDIR:-/tmp}/sm-push.XXXXXX")"
    trap 'rm -rf "$tmp"' EXIT
    [ -d "$SM_IO_ROOT/.git" ] || sm_die "PUSH BLOCKED — refueler.io repo not found at $SM_IO_ROOT"
    git -C "$SM_IO_ROOT" fetch --quiet origin main \
      || sm_die "PUSH BLOCKED — could not fetch refueler.io origin/main to verify the live mirror"
    sm_extract_canon  "$SHARE_ROOT" "$sha"         "$tmp/canon"
    sm_extract_mirror "$SM_IO_ROOT" "origin/main"  "$tmp/io"
    if ! sm_compare "$tmp/canon" "$tmp/io"; then
      short="$(git -C "$SHARE_ROOT" rev-parse --short "$sha")"
      echo "" >&2
      echo "✗ PUSH BLOCKED — refueler.io's pushed main does not serve refueler-share @ $short." >&2
      echo "  (Syncing is not enough: refueler.io must be committed AND pushed. That is the Share-DAD-1 trap.)" >&2
      echo "  Fix, from anywhere:  $SHARE_ROOT/bin/ship-frontend.sh \"your message\"" >&2
      exit 1
    fi
    echo "✓ pre-push: refueler.io origin/main matches refueler-share @ $(git -C "$SHARE_ROOT" rev-parse --short "$sha")"
    ;;

  --live)
    timeout="${2:-${LIVE_TIMEOUT:-600}}"
    tmp="$(mktemp -d "${TMPDIR:-/tmp}/sm-live-canon.XXXXXX")"
    trap 'rm -rf "$tmp"' EXIT
    sm_extract_canon "$SHARE_ROOT" HEAD "$tmp/canon"
    sm_live "$tmp/canon" "$timeout" || sm_die "live check FAILED — refueler.io/share/ is not serving refueler-share HEAD"
    ;;

  *)
    sed -n '2,11p' "$0" | sed 's/^# \{0,1\}//'
    exit 2
    ;;
esac
