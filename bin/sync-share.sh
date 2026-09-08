#!/usr/bin/env bash
# bin/sync-share.sh — refueler-share → refueler.io asset sync
# Run from refueler-share repo root after any edit to frontend/ assets.
# Syncs JS, CSS, WASM, and index.njk to the refueler.io mirror.
# refueler-share/frontend/ is canonical. Never edit mirror files directly.
#
# Updated Share-snag-1 (8 Sep 2026): index.njk now synced here.
# The manual sed workaround in REFUELER-BRIDGE.md §Share boundary is retired.

set -euo pipefail

SHARE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IO_ASSETS="/Users/rajeshtaylor/Documents/refueler.io/src/share/assets"
IO_SHARE="/Users/rajeshtaylor/Documents/refueler.io/src/share"

echo "▶ sync-share: ${SHARE_ROOT}/frontend/ → ${IO_ASSETS}/"

# ── 1. JS modules ─────────────────────────────────────────────────────────────
for f in share.js crypto.js upload.js download.js timestamp.js refueler-badge.js; do
  if [[ -f "${SHARE_ROOT}/frontend/${f}" ]]; then
    cp "${SHARE_ROOT}/frontend/${f}" "${IO_ASSETS}/${f}"
    echo "  ✓ ${f}"
  fi
done

# ── 2. CSS ────────────────────────────────────────────────────────────────────
for f in share.css share-tokens.css status.css; do
  if [[ -f "${SHARE_ROOT}/frontend/${f}" ]]; then
    cp "${SHARE_ROOT}/frontend/${f}" "${IO_ASSETS}/${f}"
    echo "  ✓ ${f}"
  fi
done

# ── 3. Vendored libs ──────────────────────────────────────────────────────────
for f in fflate.min.js qr-creator.min.js; do
  if [[ -f "${SHARE_ROOT}/frontend/${f}" ]]; then
    cp "${SHARE_ROOT}/frontend/${f}" "${IO_ASSETS}/${f}"
    echo "  ✓ ${f}"
  fi
done

# ── 4. BLAKE3 WASM bundle ─────────────────────────────────────────────────────
if [[ -d "${SHARE_ROOT}/frontend/blake3" ]]; then
  mkdir -p "${IO_ASSETS}/blake3"
  cp -r "${SHARE_ROOT}/frontend/blake3/." "${IO_ASSETS}/blake3/"
  echo "  ✓ blake3/"
fi

# ── 5. index.njk — single source of truth ────────────────────────────────────
# Canonical lives at refueler-share/src/index.njk.
# The four values below differ between repos; everything else is identical.
#
#   permalink:  /index.html          → /share/index.html
#   activePage: ""                   → "share"
#   CSS href:   /share.css           → /share/assets/share.css
#   asset path: /fflate.min.js etc   → /share/assets/fflate.min.js etc
#
# We copy then patch in-place. The canonical file is never modified.

SRC_NJK="${SHARE_ROOT}/src/index.njk"
DST_NJK="${IO_SHARE}/index.njk"

if [[ ! -f "${SRC_NJK}" ]]; then
  echo "  ✗ src/index.njk not found — skipping njk sync" >&2
else
  cp "${SRC_NJK}" "${DST_NJK}"

  # front-matter
  sed -i '' 's|^permalink: /index\.html$|permalink: /share/index.html|' "${DST_NJK}"
  sed -i '' 's|^activePage: ""$|activePage: "share"|'                    "${DST_NJK}"

  # CSS href (inside <head>)
  sed -i '' 's|href="/share\.css"|href="/share/assets/share.css"|'        "${DST_NJK}"

  # JS asset paths (bottom of <body>)
  sed -i '' 's|src="/fflate\.min\.js"|src="/share/assets/fflate.min.js"|'           "${DST_NJK}"
  sed -i '' 's|src="/qr-creator\.min\.js"|src="/share/assets/qr-creator.min.js"|'   "${DST_NJK}"
  sed -i '' 's|src="/share\.js"|src="/share/assets/share.js"|'                       "${DST_NJK}"
  sed -i '' 's|src="/refueler-badge\.js"|src="/share/assets/refueler-badge.js"|'     "${DST_NJK}"

  echo "  ✓ index.njk (patched for refueler.io)"

  # Verify the three HQ2 invariants are present in the output
  errors=0
  grep -q 'permalink: /share/index\.html' "${DST_NJK}" || { echo "  ✗ VERIFY FAIL: permalink not patched" >&2; errors=$((errors+1)); }
  grep -q 'activePage: "share"'           "${DST_NJK}" || { echo "  ✗ VERIFY FAIL: activePage not patched" >&2; errors=$((errors+1)); }
  grep -q 'href="/share/assets/share\.css"' "${DST_NJK}" || { echo "  ✗ VERIFY FAIL: CSS href not patched" >&2; errors=$((errors+1)); }
  if [[ $errors -gt 0 ]]; then
    echo "  ✗ sync-share: index.njk verification failed — check sed patterns above" >&2
    exit 1
  fi
  echo "  ✓ index.njk HQ2 invariants verified"
fi

echo "▶ sync-share: done"
