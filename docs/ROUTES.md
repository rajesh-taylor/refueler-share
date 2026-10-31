# ROUTES.md — every route the Worker answers

> Vuln-Watch-1 · 15 Oct 2026. Checked on every push by `node bin/route-inventory.mjs --check` (CI step "Route inventory").

The Worker answers the routes below on two hostnames (column **Host**). CI reads the router in `worker/src/index.js` and `worker/src/handlers/auth.js` and fails when:

- a route has no row here, or a row has no route,
- a gate isn't one of the words below, or a host isn't `api` or `admin`,
- an `/admin/…` or `/api/v1/admin/…` path has any gate other than `admin` (or `staff`, allowed only on `/admin/reports/…`), or
- a row's host doesn't match its path: `admin` exactly for `/admin` and `/api/v1/admin/…` paths, and every `admin` or `staff` gate is on host `admin`.

**Adding a route:** add its row in the same commit, with the gate its handler actually enforces.
The admin surface is behind Cloudflare Access since H6a (Admin-Access-1a · 30 Oct 2026).

## Hosts

| Host | Meaning |
|---|---|
| `api` | `api.share.refueler.io`. Every path outside `/admin` and `/api/v1/admin`. |
| `admin` | `admin.share.refueler.io`, behind Cloudflare Access. The Worker checks Access's signed token itself first (`Cf-Access-Jwt-Assertion`, `worker/src/access_jwt.js`: 401 `{"error":"access"}`, 503 if Access's keys can't be fetched), then the route's gate. The admin host answers nothing else (404), and none of its responses carry `Access-Control-*`. On `api` these paths answer 404 `Not found`, byte for byte a path that never existed — unless `ADMIN_PUBLIC_UNTIL` (unix seconds, `worker/wrangler.toml`) is in the future: the cut-over day and break-glass only. |

## Gates

| Gate | Meaning |
|---|---|
| `public` | Anyone can call it. |
| `turnstile` | Anyone, after a Cloudflare Turnstile check. |
| `credential` | An upload credential. One of: a Cashu proof (`verifyProofV2`), a Citizen session (cookie + CSRF + exact Origin), or an API HMAC signature. Without one, the tier resolves to `free`. |
| `upload-session` | MAC'd `X-Upload-Session` token from initiate (`UPLOAD_SESSION_KEY`). |
| `link` | Anyone with the transfer UUID. For a password-protected transfer, a download token from `POST /unlock` is also needed. |
| `password` | Exchanges the transfer password for a download token. |
| `link-or-owner` | A download token for that transfer, or an `rfs_owner_` bearer **plus** the admin key. |
| `hmac` | API request signed with `rfs_sign_` (`requireApiAuth`). |
| `hmac-sandbox` | As `hmac`, with an `rfs_test_` sandbox key. |
| `admin` | `X-Admin-Key` matches Worker secret `ADMIN_KEY` (`requireAdmin`, or `requireRole` with the admin role only). |
| `staff` | `X-Admin-Key` matches `ADMIN_KEY` **or** `HELPER_KEY` (`requireRole`). Only on `/admin/reports/…`; the helper key fails every other route. Unset `HELPER_KEY`, shorter than 32 characters, or equal to `ADMIN_KEY` → helper off. |
| `magic-link` | Single-use sign-in token from the email (sign-in flow). |
| `session` | `__Host-rfs_session` cookie (+ CSRF where it writes) via `requireSession()`. |
| `stripe-sig` | Stripe webhook signature (`STRIPE_WEBHOOK_SECRET`). |
| `gone` | Answers 410 and does nothing else. |
| `cf-challenge` | Cloudflare for SaaS hostname-ownership challenge. |

**No transfer UUID in a path (UUID-Out-Of-Path-1 · 21 Oct 2026).** Cloudflare's sampled HTTP-request records keep the client IP, host and path for at least 31 days; request headers are not in them. So every route that names a transfer is a fixed path and takes the UUID in **`X-Transfer-UUID`** (400 `missing_transfer_id` without a valid one); `GET /download` takes the part number in **`X-Part`** (`0007`; 400 `missing_part`). API HMAC signatures sign the UUID on its own line (canonical v2). CI fails on a `{uuid}` in any route below (`bin/route-inventory.mjs`) and on a path built with a UUID anywhere in the app, Worker or scripts (`bin/check-no-uuid-path.mjs`, also run by `ship-app.sh` on the built app). The password route is `/unlock`: `/auth/*` is sign-in's.

Auth routes (`/auth/magic`, `/auth/verify`, `/chambers/session`, `/auth/signout*`) are served only on `AUTH_API_HOST`.
"Rate limit" means a per-IP (or per-UUID) KV throttle. That's a courtesy, never a security gate (KV-Audit).

## Routes

<!-- routes:begin -->
| Method | Path | Gate | Host | Rate limit | Handler |
|---|---|---|---|---|---|
| GET | `/.well-known/cf-custom-hostname-challenge/*` | cf-challenge | api | — | `handleCfChallenge` |
| OPTIONS | `/api/v1/auth/ping` | public | api | — | `handleAuthPingOptions` |
| GET | `/api/v1/auth/ping` | hmac | api | — | `handleAuthPing` |
| GET | `/wl/config` | public | api | — | `handleWlConfig` |
| GET | `/health` | public | api | — | inline (Ops-Alerts-1 heartbeat) |
| GET | `/status` | public | api | — | `handleStatus` |
| POST | `/admin/status` | admin | admin | — | `handleAdminStatus` |
| GET | `/admin/status` | admin | admin | — | `handleStatus` |
| POST | `/api/v1/credential/issue` | hmac | api | yes | `handleApiCredentialIssue` |
| GET | `/api/v1/capabilities` | hmac | api | yes | `handleApiCapabilities` |
| POST | `/api/v1/webhook/register` | hmac | api | yes | `handleWebhookRegister` |
| DELETE | `/api/v1/webhook/register` | hmac | api | yes | `handleWebhookRegister` |
| GET | `/api/v1/webhook/register` | hmac | api | yes | `handleWebhookRegister` |
| GET | `/api/v1/receipt/{acceptance\|collection}` | hmac | api | yes | `handleApiReceipt` |
| GET | `/api/v1/webhooks/status` | hmac | api | yes | `handleWebhookStatus` |
| GET | `/api/v1/hostname/health` | hmac | api | yes | `handleHostnameHealth` |
| POST | `/api/v1/admin/sandbox/activate` | admin | admin | yes | `handleSandboxActivate` |
| POST | `/api/v1/admin/sandbox/reset` | admin | admin | yes | `handleSandboxReset` |
| GET | `/api/v1/sandbox/status` | hmac-sandbox | api | yes | `handleSandboxStatus` |
| POST | `/api/v1/sandbox/spend` | hmac-sandbox | api | yes | `handleSandboxSpend` |
| POST | `/credential/issue` | turnstile | api | yes | `handleCredentialIssue` |
| POST | `/upload/initiate` | credential | api | yes | `handleInitiate` |
| POST | `/upload/urls` | upload-session | api | yes | `handleUploadUrls` |
| POST | `/upload/finalise` | upload-session | api | yes | `handleFinalise` |
| POST | `/unlock` | password | api | yes (IP + UUID) | `handleAuth` |
| GET | `/meta` | link | api | — | `handleMeta` |
| GET | `/download` | link | api | yes | `handleDownload` |
| DELETE | `/transfer` | link-or-owner | api | — | `handleDeleteTransfer` |
| POST | `/confirm` | link | api | — | `handleConfirmTransfer` |
| POST | `/timestamp/submit` | public | api | yes | `handleTimestampSubmit` |
| GET | `/timestamp/seal` | link | api | — | `handleTimestampSeal` |
| POST | `/webhook/stripe` | stripe-sig | api | — | `handleStripeWebhook` |
| POST | `/subscription/checkout` | public | api | — | `handleCheckout` |
| GET | `/subscription/status` | gone | api | — | (410) |
| POST | `/subscription/portal` | gone | api | — | (410) |
| POST | `/log/error` | public | api | yes | `handleLogError` |
| GET | `/admin/metrics` | admin | admin | — | `handleAdminMetrics` |
| GET | `/admin/ae-metrics` | admin | admin | — | `handleAdminAeMetrics` |
| GET | `/admin/snapshot` | admin | admin | — | `handleAdminSnapshot` |
| GET | `/admin/execution-dock` | admin | admin | — | `handleExecutionDock` |
| GET | `/admin/storage` | admin | admin | — | `handleAdminStorage` |
| GET | `/admin/client-errors-log` | admin | admin | — | `handleClientErrorsLog` |
| GET | `/admin/api-stats` | admin | admin | — | `handleApiStats` |
| GET | `/admin/news-events` | admin | admin | — | `handleNewsEvents` |
| POST | `/admin/news-events` | admin | admin | — | `handleNewsEvents` |
| DELETE | `/admin/news-events/{id}` | admin | admin | — | `handleNewsEvents` |
| GET | `/admin/hostname-health` | admin | admin | — | `handleAdminHostnameHealth` |
| POST | `/admin/btc-rate` | admin | admin | — | `handleAdminBtcRatePost` |
| GET | `/admin/btc-rate` | admin | admin | — | `handleAdminBtcRateGet` |
| GET | `/admin/btc-price` | admin | admin | — | `handleAdminBtcPrice` |
| GET | `/admin/growth-snapshot` | admin | admin | — | `handleGrowthSnapshot` |
| GET | `/admin/kv-stats` | admin | admin | — | `handleAdminKvStats` |
| POST | `/admin/r2-presign-test` | admin | admin | — | `handleAdminR2PresignTest` |
| POST | `/api/v1/admin/quota/provision` | admin | admin | — | `handleAdminQuotaProvision` |
| POST | `/admin/quota-reconcile` | admin | admin | — | `handleQuotaReconcile` |
| POST | `/admin/nightly-sweep` | admin | admin | — | `handleNightlySweep` |
| POST | `/api/v1/admin/storage-quota` | admin | admin | — | `handleAdminStorageQuota` |
| POST | `/api/v1/admin/quota/cancel` | admin | admin | — | `handleAdminQuotaCancel` |
| POST | `/api/v1/admin/api-client` | admin | admin | — | `handleAdminApiClientCreate` |
| POST | `/api/v1/admin/api-client/revoke` | admin | admin | — | `handleAdminApiClientRevoke` |
| GET | `/admin/orphan-sweep` | admin | admin | — | `handleOrphanSweep` |
| POST | `/admin/patch-merkle-root` | admin | admin | — | `handlePatchMerkleRoot` |
| GET | `/admin/reports/whoami` | staff | admin | yes | `handleReportsWhoami` |
| GET | `/admin/reports/lookup` | staff | admin | yes | `handleReportsLookup` |
| GET | `/admin/reports/register` | staff | admin | yes | `handleReportsRegister` |
| POST | `/admin/reports/open` | staff | admin | yes | `handleReportsOpen` |
| POST | `/admin/reports/update` | staff | admin | yes | `handleReportsUpdate` |
| GET | `/admin/reports/export` | admin | admin | yes | `handleReportsExport` |
| GET | `/admin/reports/export-training` | admin | admin | yes | `handleReportsExportTraining` |
| POST | `/admin/reports/delete-training` | admin | admin | yes | `handleReportsDeleteTraining` |
| POST | `/admin/reports/takedown` | staff | admin | yes | `handleReportsTakedown` |
| POST | `/admin/test-credential` | admin | admin | yes | `handleTestCredential` |
| POST | `/auth/magic` | public | api | yes | `handleMagic` |
| POST | `/auth/verify` | magic-link | api | yes | `handleVerify` |
| GET | `/chambers/session` | session | api | — | `handleSession` |
| POST | `/auth/signout` | session | api | — | `handleSignout` |
| POST | `/auth/signout-everywhere` | session | api | — | `handleSignout` |
<!-- routes:end -->

76 routes: 36 on `api`; 40 on `admin` — 34 gated by the admin key alone and 6 by `staff` (admin or helper key). Anything not listed answers 404.

**Report route tools (OSA-Tools-1 · 22 Oct 2026).** `/admin/reports/*` serve the Online Safety report route: `whoami` → `{role}`; `lookup` reads the R2 manifest only and answers `state` (`live` · `expired` · `gone` · `removed` · `not_found`) and `consumed`, plus `tier`, `created_at`, `expires_at`, `upload_complete` for live/expired — nothing else; the register (`register`, `open`, `update`, `export`, `export-training`, `delete-training`) lives in Supabase (`supabase/migrations/20261022_osa_tools_1_reports.sql`, functions only), keyed by case reference `R-YYYY-NNN` (training `T-YYYY-NNN`) and holding uuid8 — never the full transfer ID, an email, or the key part after the `#`. A helper may update CSEA and terrorism rows only and never changes a category. All answer `no-store`; 30 requests / 60 s per IP. Design: private `docs/OSA-Tools-plan-v1.md`.

**Take-down (OSA-Tools-2 · 22 Oct 2026).** `POST /admin/reports/takedown` — transfer ID in `X-Transfer-UUID`, body `{"case_ref":"R-2026-001","confirm":"<first 8 characters>"}`. The case must exist, be open and name this link's first 8 characters (else 409 `case_mismatch`, with `why`); `confirm` must equal them (400 `confirm_mismatch`). The helper key may take down only a case whose register category is `csea` or `terrorism` (403 `helper_category`). Then the usual deletion sequence runs with a `removed` mark: the leftover record is `{"consumed":true,"consumed_at":…,"removed":true}` (57 bytes, swept after 30 days like any other) and `/meta` answers 410 `{"error":"removed"}` so the page says "removed after a report" — the only route that tells it apart. Answers: 200 `{destroyed, removed_at, register_updated}` (destroy first, record second: `register_updated:false` = write the time in by hand); 200 `{already_removed}` (idempotent; the register is left alone); 410 `already_gone` (deleted for another reason; a deletion left part-way is finished as what it was); 202 `{partial}` (retry — it resumes and still ends removed); 404 no such link. The old `DELETE /transfer` with an owner bearer stays for test clean-up only.
