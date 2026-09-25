#!/usr/bin/env bash
# bin/ship-frontend.sh — the ONE command that takes a Share frontend change to refueler.io/share/.
# Share-Sync-1 · 25 Sep 2026.
#
#   /Users/rajeshtaylor/Documents/refueler-share/bin/ship-frontend.sh "fix: what changed"
#
# In order, stopping at the first problem:
#   1. preflight   both repos on main, not behind origin; refueler.io has no unrelated unpushed commits
#   2. commit      refueler-share: ONLY the mirrored paths (other staged/unstaged work is left alone)
#   3. sync        frontend/ → refueler.io working tree
#   4. commit      refueler.io: ONLY the mirror paths (plans.css, navy-office, everything else untouched)
#   5. verify      committed refueler-share == committed refueler.io, byte for byte — before any push
#   6. push        refueler.io first (that is the deploy), then refueler-share (pre-push hook re-verifies)
#   7. prove       poll the PUBLIC site until every mirrored file is byte-identical, or fail loudly
# Safe to re-run: with nothing new it simply re-verifies and re-proves.

set -euo pipefail
SHARE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=lib/share-mirror.sh
. "$SHARE_ROOT/bin/lib/share-mirror.sh"
IO="$SM_IO_ROOT"

MSG="${1:-}"
[ -n "$MSG" ] || sm_die "usage: $SHARE_ROOT/bin/ship-frontend.sh \"commit message\""

tmp="$(mktemp -d "${TMPDIR:-/tmp}/sm-ship.XXXXXX")"
trap 'rm -rf "$tmp"' EXIT

# ── 1. preflight ──────────────────────────────────────────────────────────────
echo "▶ 1/7 preflight"
git -C "$SHARE_ROOT" config core.hooksPath bin/githooks          # self-healing: the hook is never "not installed"
[ -x "$SHARE_ROOT/bin/githooks/pre-push" ] || sm_die "bin/githooks/pre-push not executable — run: chmod +x $SHARE_ROOT/bin/githooks/pre-push"
[ -d "$IO/.git" ] || sm_die "refueler.io repo not found at $IO"

for repo in "$SHARE_ROOT" "$IO"; do
  b="$(git -C "$repo" rev-parse --abbrev-ref HEAD)"
  [ "$b" = "main" ] || sm_die "$(basename "$repo") is on branch '$b', not main — nothing done"
  git -C "$repo" fetch --quiet origin main || sm_die "cannot fetch origin/main for $(basename "$repo") — offline?"
  behind="$(git -C "$repo" rev-list --count HEAD..origin/main)"
  [ "$behind" -eq 0 ] || sm_die "$(basename "$repo") is $behind commit(s) behind origin/main — run: git -C $repo pull --ff-only"
done
ahead="$(git -C "$IO" rev-list --count origin/main..HEAD)"
if [ "$ahead" -ne 0 ]; then
  echo "  refueler.io already has $ahead unpushed commit(s) this script did not make:" >&2
  git -C "$IO" log --oneline origin/main..HEAD >&2
  sm_die "refusing to push someone else's work to production — push or reset those first, then re-run"
fi
sm_check_canon "$SHARE_ROOT"
[ "$SM_FAILS" -eq 0 ] || sm_die "canonical frontend/ has problems (above) — nothing done"
echo "  ✓ both repos on main and current; canonical frontend/ consistent"

# ── 2. commit refueler-share (mirrored paths only) ────────────────────────────
echo "▶ 2/7 commit refueler-share"
CPATHS="$(sm_canon_paths)"
# shellcheck disable=SC2086
git -C "$SHARE_ROOT" add -A -- $CPATHS
# shellcheck disable=SC2086
if git -C "$SHARE_ROOT" diff --cached --quiet -- $CPATHS; then
  echo "  · no uncommitted frontend changes"
else
  # shellcheck disable=SC2086
  git -C "$SHARE_ROOT" commit --quiet -m "$MSG" -- $CPATHS
  echo "  ✓ $(git -C "$SHARE_ROOT" log -1 --format='%h %s')"
fi
SHA="$(git -C "$SHARE_ROOT" rev-parse HEAD)"; SHORT="$(git -C "$SHARE_ROOT" rev-parse --short HEAD)"

# ── 3. sync from the COMMITTED tree (not the working tree) ────────────────────
echo "▶ 3/7 sync → refueler.io working tree"
sm_extract_canon "$SHARE_ROOT" "$SHA" "$tmp/canon"
sm_check_canon "$tmp/canon"
[ "$SM_FAILS" -eq 0 ] || sm_die "committed tree differs from working tree (gitignored file? see above) — nothing pushed"
sm_sync "$tmp/canon" "$IO" >/dev/null
echo "  ✓ copied from refueler-share @ $SHORT"

# ── 4. commit refueler.io (mirror paths only) ─────────────────────────────────
echo "▶ 4/7 commit refueler.io"
MPATHS="$(sm_mirror_paths)"
# shellcheck disable=SC2086
git -C "$IO" add -A -- $MPATHS
# shellcheck disable=SC2086
if git -C "$IO" diff --cached --quiet -- $MPATHS; then
  echo "  · mirror already matches — nothing to commit"
else
  # shellcheck disable=SC2086
  git -C "$IO" commit --quiet -m "sync: $MSG (refueler-share $SHORT)" -- $MPATHS
  echo "  ✓ $(git -C "$IO" log -1 --format='%h %s')"
fi

# ── 5. verify committed vs committed, before anything leaves this machine ────
echo "▶ 5/7 verify (committed ↔ committed)"
sm_extract_mirror "$IO" HEAD "$tmp/io"
sm_compare "$tmp/canon" "$tmp/io" || sm_die "committed trees differ — NOTHING pushed. Both commits are local; fix and re-run."
echo "  ✓ byte-identical"

# ── 6. push: refueler.io first (the deploy), then refueler-share ─────────────
echo "▶ 6/7 push"
git -C "$IO" push --quiet origin main || sm_die "refueler.io push FAILED — nothing is live. Fix, then re-run."
echo "  ✓ refueler.io pushed — Cloudflare Pages is building"
if ! git -C "$SHARE_ROOT" push --quiet origin main; then
  sm_die "refueler-share push FAILED after refueler.io went out — site is updating; fix the push, then re-run to finish"
fi
echo "  ✓ refueler-share pushed (pre-push hook passed)"

# ── 7. prove it on the public site ────────────────────────────────────────────
echo "▶ 7/7 prove"
sm_live "$tmp/canon" "${LIVE_TIMEOUT:-600}" || sm_die "pushed, but refueler.io/share/ is NOT serving it — see above"
echo ""
echo "✓ SHIPPED  refueler-share $SHORT → $SM_LIVE_BASE/share/"
echo "  Bytes proven live. Behaviour is still yours to eyeball: CLAUDE.md §Frontend change checklist, step 2."
