#!/usr/bin/env bash
# scripts/tg-smoke.sh — Traitor's Gate production smoke test
#
# Usage: ADMIN_KEY=<your-admin-key> bash scripts/tg-smoke.sh
#
# Tests the TG boundary behaviour against the live Worker using synthetic UUIDs.
# Does not issue credentials or upload files — exercises auth and routing only.
# A full end-to-end smoke (credential → upload → download → confirm) requires
# the integration suite: npm run test:integration

set -euo pipefail

WORKER="https://refueler-share.rt-fc4.workers.dev"
ADMIN_KEY="${ADMIN_KEY:?ADMIN_KEY env var required}"
PASS=0
FAIL=0
FAKE_UUID="00000000-0000-0000-0000-000000000000"

ok()   { echo "  ✓  $1"; ((PASS++)) || true; }
fail() { echo "  ✗  $1 — expected HTTP $2, got $3"; ((FAIL++)) || true; }

check() {
  local label="$1" expected="$2"
  local actual
  actual=$(eval "${@:3}")
  if [[ "$actual" == "$expected" ]]; then ok "$label"; else fail "$label" "$expected" "$actual"; fi
}

echo ""
echo "── Traitor's Gate production smoke ─────────────────────────────────────"
echo "   Worker: $WORKER"
echo ""

# 1. GET /meta — non-existent UUID → 404
check "GET /meta non-existent → 404" "404" \
  "curl -s -o /dev/null -w '%{http_code}' '$WORKER/meta/$FAKE_UUID'"

# 2. GET /download — non-existent UUID → 404
check "GET /download non-existent → 404" "404" \
  "curl -s -o /dev/null -w '%{http_code}' '$WORKER/download/$FAKE_UUID/0000'"

# 3. DELETE /transfer — no Authorization header → 401
check "DELETE no auth → 401" "401" \
  "curl -s -o /dev/null -w '%{http_code}' -X DELETE '$WORKER/transfer/$FAKE_UUID'"

# 4. DELETE /transfer — invalid bearer, non-existent UUID → 404
# Worker reads manifest before verifying bearer; 404 fires first.
check "DELETE invalid-bearer non-existent → 404" "404" \
  "curl -s -o /dev/null -w '%{http_code}' -X DELETE -H 'Authorization: Bearer faketoken' '$WORKER/transfer/$FAKE_UUID'"

# 5. Owner DELETE — non-existent UUID with correct admin key → 404
check "Owner DELETE non-existent → 404" "404" \
  "curl -s -o /dev/null -w '%{http_code}' -X DELETE -H 'Authorization: Bearer rfs_owner_executiondock' -H 'X-Admin-Key: $ADMIN_KEY' '$WORKER/transfer/$FAKE_UUID'"

# 6. Owner DELETE — wrong admin key → 401
check "Owner DELETE wrong key → 401" "401" \
  "curl -s -o /dev/null -w '%{http_code}' -X DELETE -H 'Authorization: Bearer rfs_owner_executiondock' -H 'X-Admin-Key: wrongkey' '$WORKER/transfer/$FAKE_UUID'"

# 7. POST /confirm — non-existent UUID → 404
check "POST /confirm non-existent → 404" "404" \
  "curl -s -o /dev/null -w '%{http_code}' -X POST '$WORKER/confirm/$FAKE_UUID'"

# 8. GET /admin/execution-dock — no admin key → 401
check "GET /admin/execution-dock no key → 401" "401" \
  "curl -s -o /dev/null -w '%{http_code}' '$WORKER/admin/execution-dock'"

# 9. GET /admin/execution-dock — correct admin key → 200
check "GET /admin/execution-dock correct key → 200" "200" \
  "curl -s -o /dev/null -w '%{http_code}' -H 'X-Admin-Key: $ADMIN_KEY' '$WORKER/admin/execution-dock'"

# 10. Malformed UUID — router rejects before UUID validation → 404
check "DELETE malformed UUID → 404" "404" \
  "curl -s -o /dev/null -w '%{http_code}' -X DELETE '$WORKER/transfer/not-a-uuid'"

echo ""
echo "── Results ──────────────────────────────────────────────────────────────"
printf "   Pass: %d  Fail: %d\n" "$PASS" "$FAIL"
echo ""
if [[ $FAIL -gt 0 ]]; then
  echo "   SMOKE FAILED"
  exit 1
else
  echo "   All smoke checks passed ✓"
  exit 0
fi
