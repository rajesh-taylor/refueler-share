#!/usr/bin/env bash
# bin/vendor-cashu.sh — rebuild frontend/cashu-crypto.js from pinned, integrity-checked npm packages.
# Cred-Fix-2b · 5 Oct 2026.
#
#   /Users/rajeshtaylor/Documents/refueler-share/bin/vendor-cashu.sh
#
# What it does, stopping at the first problem:
#   1. npm ci in a temp dir from bin/vendor-cashu/package-lock.json — npm checks every package
#      tarball (cashu-ts and everything it pulls in) against the lockfile's integrity hashes
#   2. confirms the lockfile's @cashu/cashu-ts integrity equals the registry's dist.integrity
#   3. bundles bin/vendor-cashu/entry.js with the pinned esbuild — twice, in two clean dirs,
#      and refuses unless both builds are byte-identical
#   4. writes header + bundle to frontend/cashu-crypto.js
# Upgrading: change the pins in bin/vendor-cashu/package.json AND worker/package.json together,
# run `npm install --package-lock-only --ignore-scripts` in bin/vendor-cashu/, then this script.
# The browser and the Worker must run the same cashu-ts.
# Written for macOS /bin/bash 3.2.

set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PIN="$ROOT/bin/vendor-cashu"
OUT="$ROOT/frontend/cashu-crypto.js"

CASHU_VERSION="4.11.0"
ESBUILD_VERSION="0.28.1"
ESBUILD_FLAGS="--bundle --format=esm --minify --platform=browser --target=es2020 --legal-comments=inline"

die() { echo "✗ $*" >&2; exit 1; }

hash256() {
  if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | cut -d' ' -f1
  else sha256sum "$1" | cut -d' ' -f1; fi
}

[ -f "$PIN/package-lock.json" ] || die "missing $PIN/package-lock.json"

lock_integrity="$(node -e '
  const p = require(process.argv[1]).packages["node_modules/@cashu/cashu-ts"];
  if (!p || p.version !== process.argv[2]) { console.error("lockfile has cashu-ts " + (p && p.version)); process.exit(1); }
  console.log(p.integrity);' "$PIN/package-lock.json" "$CASHU_VERSION")" || die "lockfile does not pin @cashu/cashu-ts $CASHU_VERSION"

registry_integrity="$(npm view "@cashu/cashu-ts@$CASHU_VERSION" dist.integrity)" || die "cannot reach the npm registry"
[ "$lock_integrity" = "$registry_integrity" ] || die "integrity mismatch: lockfile $lock_integrity vs registry $registry_integrity"
echo "  ✓ @cashu/cashu-ts $CASHU_VERSION integrity matches the registry"

tmp="$(mktemp -d "${TMPDIR:-/tmp}/vendor-cashu.XXXXXX")"
trap 'rm -rf "$tmp"' EXIT

build() { # build DIR → DIR/out.js
  local d="$1"
  mkdir -p "$d"
  cp "$PIN/package.json" "$PIN/package-lock.json" "$PIN/entry.js" "$d/"
  ( cd "$d" && npm ci --ignore-scripts --no-audit --no-fund --silent ) || die "npm ci failed"
  local got
  got="$(node -p 'require(process.argv[1]).version' "$d/node_modules/@cashu/cashu-ts/package.json")"
  [ "$got" = "$CASHU_VERSION" ] || die "installed cashu-ts $got, expected $CASHU_VERSION"
  got="$("$d/node_modules/.bin/esbuild" --version)"
  [ "$got" = "$ESBUILD_VERSION" ] || die "installed esbuild $got, expected $ESBUILD_VERSION"
  # shellcheck disable=SC2086
  ( cd "$d" && ./node_modules/.bin/esbuild entry.js $ESBUILD_FLAGS --log-level=warning --outfile=out.js ) || die "esbuild failed"
}

build "$tmp/a"
build "$tmp/b"
cmp -s "$tmp/a/out.js" "$tmp/b/out.js" || die "two clean builds differ — not reproducible"
echo "  ✓ two clean builds byte-identical"

EXPORTS="$(sed -n 's/^export { \(.*\) } from.*/\1/p' "$PIN/entry.js")"
[ -n "$EXPORTS" ] || die "could not read the export list from entry.js"

{
  cat <<EOF
// ── frontend/cashu-crypto.js — VENDORED, GENERATED, do not edit (Cred-Fix-2b) ──
// Rebuild with bin/vendor-cashu.sh — never hand-edit, never fetch from a CDN (F-21).
// @cashu/cashu-ts $CASHU_VERSION (MIT OR Apache-2.0) — the same exact pin as worker/package.json.
// Source:    https://registry.npmjs.org/@cashu/cashu-ts/-/cashu-ts-$CASHU_VERSION.tgz
//            $registry_integrity (= npm dist.integrity)
// Lockfile:  bin/vendor-cashu/package-lock.json sha256 $(hash256 "$PIN/package-lock.json")
//            (every bundled package checked by npm ci against it: cashu-ts, @noble/curves,
//            @noble/hashes, @scure/base, @scure/bip32 — the versions the Worker runs)
// Bundler:   esbuild $ESBUILD_VERSION $ESBUILD_FLAGS
// Exports:   $EXPORTS
// Used by:   crypto.js, upload mode only — credential format v2 (standard Cashu proof).
EOF
  cat "$tmp/a/out.js"
} > "$tmp/final.js"

mv "$tmp/final.js" "$OUT"
echo "  ✓ wrote $OUT ($(wc -c < "$OUT" | tr -d ' ') bytes, sha256 $(hash256 "$OUT"))"
