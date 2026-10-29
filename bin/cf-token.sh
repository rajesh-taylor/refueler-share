#!/bin/bash
# cf-token.sh — run ONE command with a scoped Cloudflare API token from the macOS Keychain
# (H6 · D-8, 29 Oct 2026). Replaces the wrangler OAuth login.
#
#   bin/cf-token.sh deploy <command…>   # Workers Scripts Edit + Workers Routes Edit (refueler.io) + Tail Read
#   bin/cf-token.sh ship   <command…>   # Cloudflare Pages Edit
#
# The token lives in the Keychain item "refueler-cf-<name>" and is passed only to that
# command's environment (CLOUDFLARE_API_TOKEN), never in argv, a file or the shell.
# Store one (hidden prompt; paste the token):
#   security add-generic-password -U -a "$USER" -s refueler-cf-deploy -T "" -w
set -euo pipefail

ACCOUNT_ID="fc4f3e5aeebe483677d14185daf544f5"   # not secret (wrangler.toml-adjacent config)
die() { echo "cf-token: $*" >&2; exit 2; }

[ $# -ge 2 ] || die "usage: cf-token.sh deploy|ship <command…>"
name="$1"; shift
case "$name" in deploy|ship) ;; *) die "unknown token '$name' (deploy or ship)";; esac
command -v security >/dev/null || die "macOS Keychain (security) not found — this runs on Rajesh's Mac only"

token="$(security find-generic-password -a "$USER" -s "refueler-cf-$name" -w 2>/dev/null)" \
  || die "no Keychain item refueler-cf-$name — see the header of this file"
[ -n "$token" ] || die "Keychain item refueler-cf-$name is empty"

CLOUDFLARE_API_TOKEN="$token" CLOUDFLARE_ACCOUNT_ID="$ACCOUNT_ID" exec "$@"
