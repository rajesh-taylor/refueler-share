# ROUTES.md — every route the Worker answers

> Vuln-Watch-1 · 15 Oct 2026. Checked on every push by `node bin/route-inventory.mjs --check` (CI step "Route inventory").

The Worker (`api.share.refueler.io`) answers the routes below, all on one hostname. CI reads the router in `worker/src/index.js` and `worker/src/handlers/auth.js` and fails when:

- a route has no row here, or a row has no route,
- a gate isn't one of the words below, or
- an `/admin/…` or `/api/v1/admin/…` path has any gate other than `admin`.

**Adding a route:** add its row in the same commit, with the gate its handler actually enforces.
Moving the admin surface behind Cloudflare Access is B12-Audit.

## Gates

| Gate | Meaning |
|---|---|
| `public` | Anyone can call it. |
| `turnstile` | Anyone, after a Cloudflare Turnstile check. |
| `credential` | An upload credential. One of: a Cashu proof (`verifyProofV2`), a Citizen session (cookie + CSRF + exact Origin), or an API HMAC signature. Without one, the tier resolves to `free`. |
| `upload-session` | MAC'd `X-Upload-Session` token from initiate (`UPLOAD_SESSION_KEY`). |
| `link` | Anyone with the transfer UUID. For a password-protected transfer, a download token from `POST /auth/{uuid}` is also needed. |
| `password` | Exchanges the transfer password for a download token. |
| `link-or-owner` | A download token for that transfer, or an `rfs_owner_` bearer **plus** the admin key. |
| `hmac` | API request signed with `rfs_sign_` (`requireApiAuth`). |
| `hmac-sandbox` | As `hmac`, with an `rfs_test_` sandbox key. |
| `admin` | `X-Admin-Key` matches Worker secret `ADMIN_KEY` (`requireAdmin`). |
| `magic-link` | Single-use sign-in token from the email (sign-in flow). |
| `session` | `__Host-rfs_session` cookie (+ CSRF where it writes) via `requireSession()`. |
| `stripe-sig` | Stripe webhook signature (`STRIPE_WEBHOOK_SECRET`). |
| `gone` | Answers 410 and does nothing else. |
| `cf-challenge` | Cloudflare for SaaS hostname-ownership challenge. |

Auth routes (`/auth/magic`, `/auth/verify`, `/chambers/session`, `/auth/signout*`) are served only on `AUTH_API_HOST`.
"Rate limit" means a per-IP (or per-UUID) KV throttle. That's a courtesy, never a security gate (KV-Audit).

## Routes

<!-- routes:begin -->
| Method | Path | Gate | Rate limit | Handler |
|---|---|---|---|---|
| GET | `/.well-known/cf-custom-hostname-challenge/*` | cf-challenge | — | `handleCfChallenge` |
| OPTIONS | `/api/v1/auth/ping` | public | — | `handleAuthPingOptions` |
| GET | `/api/v1/auth/ping` | hmac | — | `handleAuthPing` |
| GET | `/wl/config` | public | — | `handleWlConfig` |
| GET | `/status` | public | — | `handleStatus` |
| POST | `/admin/status` | admin | — | `handleAdminStatus` |
| POST | `/api/v1/credential/issue` | hmac | yes | `handleApiCredentialIssue` |
| GET | `/api/v1/capabilities` | hmac | yes | `handleApiCapabilities` |
| POST | `/api/v1/webhook/register` | hmac | yes | `handleWebhookRegister` |
| DELETE | `/api/v1/webhook/register` | hmac | yes | `handleWebhookRegister` |
| GET | `/api/v1/webhook/register` | hmac | yes | `handleWebhookRegister` |
| GET | `/api/v1/receipt/{uuid}/{acceptance\|collection}` | hmac | yes | `handleApiReceipt` |
| GET | `/api/v1/webhooks/status` | hmac | yes | `handleWebhookStatus` |
| GET | `/api/v1/hostname/health` | hmac | yes | `handleHostnameHealth` |
| POST | `/api/v1/sandbox/activate` | admin | yes | `handleSandboxActivate` |
| POST | `/api/v1/sandbox/reset` | admin | yes | `handleSandboxReset` |
| GET | `/api/v1/sandbox/status` | hmac-sandbox | yes | `handleSandboxStatus` |
| POST | `/api/v1/sandbox/spend` | hmac-sandbox | yes | `handleSandboxSpend` |
| POST | `/credential/issue` | turnstile | yes | `handleCredentialIssue` |
| POST | `/upload/{uuid}/initiate` | credential | yes | `handleInitiate` |
| POST | `/upload/{uuid}/urls` | upload-session | yes | `handleUploadUrls` |
| POST | `/upload/{uuid}/finalise` | upload-session | yes | `handleFinalise` |
| POST | `/auth/{uuid}` | password | yes (IP + UUID) | `handleAuth` |
| GET | `/meta/{uuid}` | link | — | `handleMeta` |
| GET | `/download/{uuid}/{part}` | link | yes | `handleDownload` |
| DELETE | `/transfer/{uuid}` | link-or-owner | — | `handleDeleteTransfer` |
| POST | `/confirm/{uuid}` | link | — | `handleConfirmTransfer` |
| POST | `/timestamp/submit` | public | yes | `handleTimestampSubmit` |
| GET | `/timestamp/seal/{uuid}` | link | — | `handleTimestampSeal` |
| POST | `/webhook/stripe` | stripe-sig | — | `handleStripeWebhook` |
| POST | `/subscription/checkout` | public | — | `handleCheckout` |
| GET | `/subscription/status` | gone | — | (410) |
| POST | `/subscription/portal` | gone | — | (410) |
| POST | `/log/error` | public | yes | `handleLogError` |
| GET | `/admin/metrics` | admin | — | `handleAdminMetrics` |
| GET | `/admin/ae-metrics` | admin | — | `handleAdminAeMetrics` |
| GET | `/admin/snapshot` | admin | — | `handleAdminSnapshot` |
| GET | `/admin/execution-dock` | admin | — | `handleExecutionDock` |
| GET | `/admin/storage` | admin | — | `handleAdminStorage` |
| GET | `/admin/client-errors-log` | admin | — | `handleClientErrorsLog` |
| GET | `/admin/api-stats` | admin | — | `handleApiStats` |
| GET | `/admin/news-events` | admin | — | `handleNewsEvents` |
| POST | `/admin/news-events` | admin | — | `handleNewsEvents` |
| DELETE | `/admin/news-events/{id}` | admin | — | `handleNewsEvents` |
| GET | `/admin/hostname-health` | admin | — | `handleAdminHostnameHealth` |
| POST | `/admin/btc-rate` | admin | — | `handleAdminBtcRatePost` |
| GET | `/admin/btc-rate` | admin | — | `handleAdminBtcRateGet` |
| GET | `/admin/btc-price` | admin | — | `handleAdminBtcPrice` |
| GET | `/admin/growth-snapshot` | admin | — | `handleGrowthSnapshot` |
| GET | `/admin/kv-stats` | admin | — | `handleAdminKvStats` |
| POST | `/admin/r2-presign-test` | admin | — | `handleAdminR2PresignTest` |
| POST | `/api/v1/admin/quota/provision` | admin | — | `handleAdminQuotaProvision` |
| POST | `/admin/quota-reconcile` | admin | — | `handleQuotaReconcile` |
| POST | `/api/v1/admin/storage-quota` | admin | — | `handleAdminStorageQuota` |
| POST | `/api/v1/admin/quota/cancel` | admin | — | `handleAdminQuotaCancel` |
| POST | `/api/v1/admin/api-client` | admin | — | `handleAdminApiClientCreate` |
| POST | `/api/v1/admin/api-client/revoke` | admin | — | `handleAdminApiClientRevoke` |
| GET | `/admin/orphan-sweep` | admin | — | `handleOrphanSweep` |
| POST | `/admin/patch-merkle-root` | admin | — | `handlePatchMerkleRoot` |
| DELETE | `/admin/purge-test-transfers` | admin | — | `handlePurgeTestTransfers` |
| POST | `/admin/test-credential` | admin | yes | `handleTestCredential` |
| POST | `/auth/magic` | public | yes | `handleMagic` |
| POST | `/auth/verify` | magic-link | yes | `handleVerify` |
| GET | `/chambers/session` | session | — | `handleSession` |
| POST | `/auth/signout` | session | — | `handleSignout` |
| POST | `/auth/signout-everywhere` | session | — | `handleSignout` |
<!-- routes:end -->

66 routes, 30 of them gated by the admin key (26 under `/admin` or `/api/v1/admin`, plus the sandbox activate/reset pair). Anything not listed answers 404.
