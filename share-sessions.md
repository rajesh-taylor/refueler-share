# share-sessions.md — refueler-share

---

## Sessions 1–26 — compact log (B1 + B2)

| # | Date | Commit | Summary |
|---|------|--------|---------|
| 1 | 10 Jul | — | Architecture planning: token lifetime, upload model, NUT-11 P2SH, storage spec |
| 2 | 11 Jul | `session-2-build` | Worker scaffold (3 endpoints), `frontend/index.html`, Supabase `spent_tokens` |
| 3 | 11 Jul | `172a2e0` | NUT-11 Mode 1 passphrase gating (`nut11.js`, `manifest.js`) |
| 4 | 11 Jul | `42180c1` | Stripe products + prices (live GBP), webhook, `subscribers` table, R2 buckets |
| 5 | 12 Jul | `9a5fdc1` | Turnstile widget, all 6 secrets set, Pages project, `share.refueler.io` live |
| 6 | 12 Jul | `458bc99` | `STRIPE_WEBHOOK_SECRET` rotated (exposed in git) |
| 7 | 12 Jul | `3b9a9aa` | Visible Turnstile widget (invisible mode broke Safari ITP) |
| 8 | 12 Jul | `0369dc8` | blake3-wasm local bundle (`frontend/blake3/`, force-committed) — CDN broken |
| 9–10 | 13 Jul | (grouped) | secp256k1 v2 API fix (`secp.ProjectivePoint`), R2 binding `BUCKET`, SHA-256 passphrase hash |
| 11 | 13 Jul | `e50b58c`+`ec0c325` | Decrypt stall fixed, filename preservation. Full upload/download flow ✓ |
| 12 | 13 Jul | — | Stripe Customer Portal, `/subscription/portal`, R2 lifecycle rules |
| 13 | 14 Jul | — | `upgrade.html` rebuild: Paper/Carbon tokens, Stripe remount |
| 14–15 | 14 Jul | `f52b55f` | Eleventy 3.x scaffold: `src/` → `frontend/`, partials. B1 complete. |
| 16 | 14 Jul | grouped | KV status system: `refueler-share-kv` (binding `STATUS_KV`), `GET /status`, `POST /admin/status`, maintenance banner (`sessionStorage` dismiss) |
| 17 | 14 Jul | grouped | `src/status.njk`: ops + crypto integrity sections, 60s auto-refresh, banner-linked only |
| 18 | 14 Jul | grouped | AE dataset `share_events` (binding `AE`), `logEvent()` helper, `timed()` router wrapper |
| 19 | 14 Jul | grouped | `/admin/metrics`: MRR, subscribers_by_tier, paid_total, churn MTD. RLS deny-all on ledger tables. `cancelled_at` added to `subscribers` |
| 20 | 14 Jul | grouped | `double_spend_attempts` table, `credential_uniqueness_rate` metric |
| 21 | 14 Jul | grouped | `frontend/admin/dashboard.html` scaffold: password gate, live metric cards, 60s refresh |
| 19-plan | 14 Jul | — | Roadmap S19–S120 drafted. Critical chains recorded in Share-Master-Context.md |
| 22 | 15 Jul | `d1bcb5a`+`f36e385` | `GET /admin/ae-metrics`: AE SQL proxy, CF_AE_TOKEN scoped. CORS `X-Admin-Key` fix. |
| 23 | 15 Jul | `a4bc625` | AE SQL column syntax fix (`double1`/`blob1` not array syntax). p95/p99 latency + error rate cards. |
| 24 | 15 Jul | `5be5811` | `GET /admin/snapshot`, System Summary dashboard section (6 metric tiles) |
| 25 | 15 Jul | `fc6cba9`+`99afaaa` | Free-to-paid conversion rate, dashboard restructure |
| 26 | 15 Jul | — | B2 close. 10/13 metrics live. Context files updated to v2.1. |

**Permanent do-not-retry (B1–B2):**
- blake3-wasm CDN (esm.sh/unpkg) — local bundle only
- Invisible Turnstile — visible managed widget only
- `secp.Point` — removed in noble v2, use `secp.ProjectivePoint`
- `binding = "R2"` in wrangler.toml — must be `BUCKET`
- BLAKE3 for passphrase hash — must be SHA-256
- `wrangler r2 bucket lifecycle set --rule` inline JSON — use `add` subcommand; `lifecycle get` → `lifecycle list`
- AE SQL: use `double1`/`blob1` column names, not `doubles[N]`/`blob[N]` array syntax
- DO NOT await `env.AE.writeDataPoint()` — fire-and-forget
- DO NOT call AE SQL API from Worker — proxy via `/admin/ae-metrics` only
- DO NOT use KV counter for double-spend tracking — race condition; Supabase table only
- `spatial_ref_sys` RLS is false — PostGIS system table, leave alone
- `sessionStorage` only for banner dismiss (not localStorage)
- DO NOT add `/status` to nav — banner-linked only

---

## Sessions 27–29 — B3 Stripe test coverage (16–20 July 2026)

| # | Commit | Summary |
|---|--------|---------|
| 27 | `5f3cb8e` | Stripe CLI installed. 4 test prices created. Root cause of `client_secret` mismatch identified: `checkout/sessions ui_mode:embedded` incompatible with `stripe.elements()` |
| 28 | `5f3cb8e` | Direct Subscription creation pattern confirmed. 4242 card flow ✓. Webhook handler extended with `customer.subscription.created`. |
| 29 | `5d8c1ea` | `STRIPE_SECRET_KEY` rotated to `sk_live_...ZehD`. Portal `resource_missing` confirmed correct (no active sub). Cancellation code-complete. **B3 closed.** |

**B3 do-not-retry:**
- DO NOT use `checkout/sessions ui_mode:embedded` — use direct Subscription + `expand[0]=latest_invoice.payment_intent`
- DO NOT `decodeURIComponent` Stripe `client_secret` — already decoded
- DO NOT attempt Customer Portal without active subscription — Stripe returns `resource_missing`
- 4242 card is test-mode only — never works in live mode

---

## Sessions 34–52 — B4 Security hardening + B5 Design full pass

| # | Commit | Summary |
|---|--------|---------|
| S34 | `7738450f` | BLAKE3 WASM in Worker. `verifyChunkHash()` live. Integrity gap closed. |
| S35-e | `95a12b4` | Paid tiers greyed out (soft launch). Uncounted. |
| S35 | `ab01388` | AAD overflow fix — `DataView.setUint32(0,i,false)` into 4-byte buffer. |
| S36 | `b877c76` | KV-backed rate limiting: `ratelimit.js`, 3 endpoints, 429s logged to AE. |
| S36b | `0cc4de9` | `/log/error` endpoint + `reportError()` helper. 6 capture points. |
| S36c | `2db7b08` | Dashboard legibility pass. Snapshot strip. Paper/Carbon cookie. Modal stubs. |
| S37 | `7684118` | Dashboard: Satoshi figures, row 2 6-cell, row 3 3-cell. `client_errors_24h` stub. |
| S38 | `20da7d4` | `client_errors_24h` AE query. 3 rogue secrets deleted. Wrangler 4.112. |
| S39 | `ab4fc98` | Server-side tier enforcement. 10 MB chunk cap. KV byte counter. |
| S40 | `c6f1a7a` | MIME denylist gate on chunk 0 (6 types). 415 + AE log on miss. |
| S41 | `b2a4ba0` | UUID validation (RFC 4122). Chunk bounds check. |
| S42a | `c8a57a42` | `handleLogError` fix. Filename sanitisation. 64 KB manifest cap. Chunk + expiry guards. |
| S42b | `18d85351` | Per-UUID auth rate limit. Download rate limiting. Chunk count defence. |
| S42c | `c053cbc` | UUID-bound credential issuance. Worker generates UUID. `waitForTurnstile` fix. |
| S42d | `0b32e69` | Turnstile nonce binding. Safari polling fallback. Wrangler 4.113. |
| S42e | — | Full B4 audit. Marketing claim rulings. UK regulatory language. B5 handoff. |
| S43 | `5c54802` | DESIGN-TOKENS.md v1.0 applied to index, upgrade, status pages. |
| S44 | `b15f407` | Dashboard design pass I: sidebar, token alignment, Satoshi figures, 4 latency cards. |
| S45 | `7187e41` | Dashboard design pass II: 240px sidebar, gold wordmark, farming card. |
| S46a | `bbf271a` | Modal build I: 14 modal keys, skeleton, focus trap. CSS+JS extracted to dashboard.css/js. |
| S46b | `023dfcc` | Modal polish: formatBytes, zero=green, datasource banner, × close. smokeTest 27 pass. |
| S47a | `63eb253` | FREE_EXPIRY fixed (5d→7d). Progress smooth. QR retina. Cap nudge. status.njk editorial. |
| S47b | `d8faf0f` | QR 200px SVG (qr-creator). 2-col button grid. Serif integrity notes. Ghost back links. |
| S47c | `cb7a925` | Receiver landing page. USP A/B test (Variant A/B, sessionStorage, AE logging). |
| S47d | `3eb4ec4` | QR guard. Drop zone single-file rejection. Colophon. Footer subdomain-only. Turnstile theme. |
| S48 | `0761f4c` | Maintenance modal. Theme cookie `rs-theme` scoped to `.refueler.io`. No FOUC. |
| S48a | `0152aae` | FSAA streaming download. Pipeline depth 2. Per-chunk retry 1s/2s/4s. Blob fallback. |
| S49a | `3598a65` | Carbon gold edging. `--inset-rule` throughout. Brand token aliases in shared-styles. |
| S50 | `e3a4407` | Serif audit. 3 correct usages confirmed. 3 CSS-only additions. |
| S51 | `c182036` | File extraction: `frontend/share.css` (367L), `frontend/share.js` (899L), `frontend/upgrade.css` (419L). |
| S52 | — | `TIER_EXPIRY_SECONDS.free` 5d→7d. `--heading` alias. Lightning ops plan. Context v4.0. B5 closed. |

---

## Sessions 53–72a — B6 Testing infrastructure + folder upload

| # | Commit | Summary |
|---|--------|---------|
| S53 | `b1d9855`+`ca1260c` | Folder upload I. fflate 0.8.2, client-side zip, zip progress UI. fflate bare `Uint8Array` fix (macOS). |
| S54 | `c732abf` | Folder upload II. `sanitisePath`, depth limit 20, file count cap 500 warn/2000 hard stop, memory pressure warning. |
| S55 | — | Folder upload III. Receiver UX: folder icon, zip-as-is decision locked, `rc-folder-note`. |
| S56 | `6cf711d`+`7735787` | Folder upload smoke test. fflate + qr-creator self-hosted. Drop zone fix. Full round-trip ✓. |
| S57 | — | Bearer TTL investigation. 900s hardcoded exp fatal for large transfers. Root cause identified. |
| S58 | `f94a158` | Bearer TTL fix. Token exp = `manifest.expiry_timestamp`. Smoke test ✓. |
| S59 | — | Buffer. Skipped — S58 clean. |
| S60 | `e59305c` | Unit tests I. Vitest 2 harness. ratelimit + manifest. 43 passing. |
| S61 | — | Unit tests II. nut00 BDHKE + blake3. 100 passing. blake3.js null-guard fix. |
| S62 | — | Unit tests III. turnstile + stripe. 178 passing across 6 suites. |
| S63 | — | Testing infra review I. Integration harness designed. TESTING.md created. |
| S64 | `def77b5` | Integration tests I. wrangler dev --local harness. Full BDHKE in client.js. 181 passing. |
| S65 | `8dc8dce` | Security regression suite I. Rate limits, UUID binding, nonce binding. 188 passing. |
| S66 | `344e32d` | Security regression suite II. MIME, UUID validation, chunk bounds, tier cap. 207 passing / 8 suites. |
| S67 | — | Testing infra review II. k6 architecture locked. TESTING.md discrepancies flagged. |
| S68 | `53d24ee` | Load tests I. credential-burst + concurrent-transfers. chunks.js hash table pre-computed. All thresholds green. |
| S69 | `38c60e5` | Load tests II. download-saturation + mixed-realistic + preload-transfers.mjs + README. All thresholds green. |
| S70 | `731b571` | CI pipeline I. GitHub Actions Level 1 green. stripe-events.js Web Crypto. ESLint flat config. |
| S71 | `93b2b86` | CI pipeline II + Lightning admin toggle + Stripe webhook security tests. 211 passing / 1 skipped. |
| S72 | `319225f` | Stripe webhook provide/inject fix. Valid-sig test un-skipped. 212 passing / 0 skipped. |
| S72a | — | B6 close. Snag sweep. TESTING.md v0.5. Context trim. B7 brief. B6 formally closed. |

**B6 do-not-retry (permanent):**
- DO NOT use `[new Uint8Array(buf), { level: 0 }]` in fflate 0.8.x — bare `new Uint8Array(buf)` only.
- DO NOT load fflate or qr-creator from cdnjs — self-hosted only (`frontend/`).
- DO NOT put file inputs inside the drop zone hit area — JS-triggered only.
- DO NOT hardcode 900s TTL for download tokens — pass `manifest.expiry_timestamp`.
- DO NOT call `client.putManifest()` in integration tests — manifest auto-written after final chunk.
- DO NOT send `X-P2SH-Secret-Hash` in a separate manifest PUT — must be chunk 0 upload header.
- DO NOT start Supabase mock in the test file — lifecycle owns it.
- DO NOT use a dummy blinded message in `issueCredential` test helper — real BDHKE unblinding required.
- DO NOT use `ProjectivePoint.subtract()` — noble v2. Use `.add(point.negate())`.

---

## AP-series — Architectural planning sessions (uncounted)

| # | Date | Summary |
|---|------|---------|
| AP-0 | 29 Jul | Ad-hoc strategy. Article pipeline (12 titles). API/white-label planning item. Mullvad payment decoupling. Client dashboard scoped. API pricing model direction set. Susie/BHODL contacts logged. |
| AP-1 | 29 Jul | /notes/ article pipeline locked. Articles 2–5 structures confirmed. Byline: Rajesh Taylor. notes-articles-list.md created. Article 1 iteration decisions locked, one-week hold. |
| AP-2 | 30 Jul | API architecture planning. Auth: HMAC signing. Credential issuance on behalf of end users. Stripe decoupling. Renewal: credentials stack. Dashboard: hosted, AE-backed. All decisions locked. |
| AP-3 | 30 Jul | White-label implementation planning. Custom hostname flow. Badge config via KV. IT handover doc locked. Five-tier structure locked. Pricing cadence 1/3/12 months. |
| AP-3a | 30 Jul | Webhook spec locked. Single API key + rotation locked. OEM positioning paragraph drafted. SW block created: 12 core + 2 buffer. All context files updated. |
| AP-4 | 1 Aug | Security and cryptography strategy session. Argon2id for Enterprise API (client-side KDF, post-B8). ML-KEM shipping order locked (Prod Max + Enterprise first, B10). BIP-39 12-word account creation for enterprise. BIP-85 staff key derivation (B8 planning). FROST threshold signatures (B12, whitepaper §Future work). Silent Payments over PayNym long-term. Nostr keypair dashboard auth (SW/B8). SimpleX Chat for internal + enterprise support comms (B9+). Incident response plan (B9 scope): three severity tiers, pre-written S1 template, tabletop simulation before alpha. Status page incident dashboard: homepage modal, S1/S2/S3 panel with KV-backed `incident_active` key. No social media — refueler.io is the canonical destination. refueler-multi-core: Esplora/Mempool.space fork post-B9. |
| AP-5 | 1 Aug | Incident response and security breach planning. `docs/incident-response.md` and `docs/security-breach.md` created. B9 build scope confirmed. |
| AP-6 | 2 Aug | Competitive analysis: DashBeam (dashbeam.net). Synchronous P2P vs asynchronous cloud relay — confirmed different product categories. DashBeam free tier not a threat to professional buyer segment. Resumable upload/download gap confirmed as the one genuine weakness. HTTP/3 + BLAKE3 positioning locked. Pay-to-extend transfer window design deferred to B8 — use case is the recipient extending a lapsed window without contacting sender, preserving professional relationship. First-transfer experience aesthetic locked: Jaeger-LeCoultre restraint, Source Serif 4, ceremonial link presentation, haptics, A/B tests via existing sessionStorage infrastructure. R-series and HQ-series post-SW blocks created. |
| AP-8 | 4 Aug | Nav rewrite + head.njk theme script rewrite across `refueler-share` and `refueler-io`. Share nav links now: Notes, Upgrade, Support, theme pill — App/Editorial/Privacy removed. head.njk theme script: `localStorage`/`rfTheme` replaced with `rs-theme` cookie scoped to `.refueler.io` (30-day, `SameSite=Lax`); `classList` pattern removed; `dataset.theme` only; `window.toggleTheme` global exposed. Cross-domain theme persistence confirmed between `refueler.io` and `share.refueler.io`. Nav architecture locked: main site = ecosystem nav; Share = product nav. Files changed: `src/_includes/nav.njk`, `src/_includes/head.njk`. refueler-io: support page copy genericised, `support@refueler.io` set as primary contact, nav wordmark breadcrumb bug fixed (hardcoded "Legend" default removed). |
| AP-7 | 2 Aug | AP-6 analysis consolidated and extended. Two-axis category framing locked: "recipient problem" (transfer survives laptop closure / recipient unavailability — P2P fails this) + "compulsion problem" (nothing to hand over — storing services with server-side keys fail this). Refueler Share is the only architecture solving both simultaneously. Two-axis framing is index hero candidate and article 5 spine. Recovery window publication restriction locked: B9 whitepaper §Future work only before shipping — no product copy or marketing. Recovery window privacy properties enumerated (3 properties). Renewal warning banner copy locked: "Your subscription renews on [date]. Your transfers will remain accessible." Article 1 iteration hold cleared — week of 5 Aug now open. Git push hygiene rule added to CLAUDE.md. |

---

## Sessions 73–73a — B7 in progress (5 Aug 2026)

| # | Commit | Summary |
|---|--------|---------|
| S73 | `2a20177` | Dashboard: client errors modal — `client_errors_detail` stored from AE response; `parseUA()` + `escHtml()` helpers added; detail table renders Time · Context · Message · Browser; stub class stripped on open, restored on close. |
| S73a | `a19778c` | Fix: static Trend/Export section titles were overlapping the injected table. Strip `.modal-sparkline-stub` class on open; hide `.modal-section-title` and CSV button; restore all on `closeModal()`. Both Paper and Carbon confirmed working. |

**B7 snags added (resolve at S87):**
- Theme toggle absent from modals — minor UX, add to S87 snag sweep
- `receiver_ab_shown` / `receiver_ab_downloaded` events routed to `/log/error` instead of AE — S47c A/B tracking code calling `reportError()` in error. Investigate in `frontend/share.js` at S87.

---

## B7 session plan — Lightning/Blink + anonymous paid tier

| Session | Label | Scope | Size |
|---------|-------|-------|------|
| S73 ✓ | Dashboard: client errors modal | `client_errors_detail` stored from AE; `parseUA()` + `escHtml()`; detail table with Time · Context · Message · Browser. | M |
| S73a ✓ | Dashboard: client errors modal fix | Strip `.modal-sparkline-stub` on open; hide static section titles + CSV btn; restore on close. Both themes confirmed. | S |
| S74 | Lightning infra II-a | `POST /webhook/lightning` endpoint. KV payment tracking schema — 25h TTL. | M |
| S74a | Lightning infra II-b | Dedup logic. `getBlinkInvoiceStatus()` polling fallback. Smoke test full chain. | M |
| S75 | Credential issuance I-a | On settled webhook: resolve `{ tier, period }`. Issue Cashu credential. | L |
| S75a | Credential issuance I-b | Write credential to KV keyed by `paymentHash` (10 min TTL). `GET /subscription/lightning/credential` poll endpoint. | L |
| S75b | Credential issuance I-c | Tier cap wiring for Lightning credentials. Error states. Smoke test full chain. | L |
| S76 | Frontend Lightning flow I-a | `src/upgrade.njk`: Lightning tier cards enabled. `POST /subscription/lightning` wired. Paper/Carbon tokens. | M |
| S76a | Frontend Lightning flow I-b | QR display. BOLT11 copy button. Rate display. Polling for credential on payment hash. | M |
| S77 | Frontend Lightning flow II-a | Credential receipt → browser memory. Upload flow unlocks paid tier cap on credential receipt. | M |
| S77a | Frontend Lightning flow II-b | Error states: expired invoice, already-redeemed, payment timeout. Full frontend smoke test. | M |
| S78 | GBP/sats pricing display | Blink `btcPrice` query wired. Rate stored in KV. Displayed on frontend. | S |
| S79 | Payment privacy table I | `src/_data/payment_privacy.json`. Stripe and Lightning columns populated. PayNym: "Coming soon." | S |
| S79a | Payment privacy table II | Eleventy partial renders JSON. Collapsible section on upgrade page. Paper/Carbon tokens. | S |
| S80 | Dashboard Lightning cards I-a | Lightning section. Confirmation latency p95 LIVE. AE logging for latency datapoint. | M |
| S80a | Dashboard Lightning cards I-b | Four stub cards (greyed, "available at B9" tooltip). | M |
| S81 | KV Lightning admin toggle | `lightning_available` flag. `POST /admin/status` extended. Graceful degradation copy. | S |
| S82 | Paid tier activation I-a | Re-enable Creative Premium + Production Max. Stripe path smoke test. | M |
| S82a | Paid tier activation I-b | Lightning path smoke test. Both payment paths confirmed live. | M |
| S83 | B7 security audit I-a | Full security review Lightning flow: expiry, KV races, credential farming, double-issuance. | M |
| S83a | B7 security audit I-b | Webhook replay attack surface. Findings fixed. Marketing claim rulings updated. | M |
| S84 | LNbits planning I | Read lnbits repo. Keep/strip/brand decisions. Extension shortlist. Webhook signing spec. No code. | S |
| S85 | LNbits planning II | Skinning scope. LNURL-withdraw gift architecture design. NUT-20 binding spec. No code. | S |
| S86 | LNURL-withdraw gift architecture | Design document. Wallet compatibility matrix. Gift flow UX spec. B9 scope locked. | S |
| S87 | B7 close | Snag sweep. Context files updated. §Lightning infrastructure finalised. B8 brief. | S |

**Buffer pool (5 sessions):** S75c · S76b · S83b · S84a · S87a

---

## SW block session plan — white-label + API build (post-B7)

| Session | Label | Scope | Size |
|---------|-------|-------|------|
| SW1 | CF for SaaS setup | SaaS enablement, fallback origin, Worker route. Smoke: `GET /status` via wl hostname. | S |
| SW2 | API auth I | `api_auth.js` — HMAC-SHA256 verify, key lookup, ±300s window. Unit tests. | M |
| SW2a | API auth II | `POST /api/v1/credential/issue` + quota KV, 402 on exhaustion, AE `transfer_ref` logging. Rotation with 24h grace. | M |
| SW3 | Badge + /wl/config | `GET /wl/config` by Host header. Fail-safe `badge: true`. Badge component Paper/Carbon. | S |
| SW4 | Webhooks I | Registration endpoints. `rfs_whsec_` issuance. `wh_config_` KV schema. URL validation. | M |
| SW4a | Webhooks II | Delivery via `ctx.waitUntil`. Dead-letter KV (7-day TTL). AE log per attempt. Daily cron retry. | M |
| SW5 | Client dashboard I | `dashboard.share.refueler.io` scaffold. API-key auth. Transfers table from AE. | M |
| SW5a | Client dashboard II | Capability gating. Webhook monitoring card. Hostname health card. Paper/Carbon. | M |
| SW6 | Onboarding flow | Per-client admin runbook. CF custom-hostname → keypair → KV write → activation smoke test. | S |
| SW7 | IT handover PDF | Two-page branded PDF. Paper theme. Three substitution fields. Built once, generated per client. | S |
| SW8 | Daily cron | Hostname health checks → AE. Dead-letter webhook retry. `[triggers]` in wrangler.toml. | S |
| SW9 | SW close | Snag sweep. TESTING.md additions. Context trim pass. B8 brief. Buffer review. | S |

**Buffer pool (2 sessions):** SW2b · SW5b

---

## R-series — Resumable uploads (post-SW)

| Session | Label | Scope | Size |
|---------|-------|-------|------|
| RU1 | Resumable uploads I | IndexedDB schema: write chunk completion state on each 200 ACK. On page load: detect interrupted transfer, offer resume or discard. Resume flow: skip confirmed chunks. Unit tests same session. | M |
| RU2 | Resumable uploads II | Resume UI: progress bar shows "Resuming from chunk N of M." Credential expiry awareness. Integration test: interrupt at chunk 3, reload, confirm resume from chunk 3. | M |

**Buffer pool (2 sessions):** RU1b · RU2b

---

## HQ-series — HTTP/3 + BLAKE3 integrity positioning (post-R-series)

| Session | Label | Scope | Size |
|---------|-------|-------|------|
| HQ1 | HTTP/3 verification + AE instrumentation | Confirm HTTP/3 active. Add `Alt-Svc` logging to AE. Add chunk upload latency datapoint. Draft canonical copy string. Wire to upgrade page and index page. | M |
| HQ2 | Competitive positioning copy + /notes/ hook | Write the technical distinction cleanly. Ensure consistency across index, upgrade, and notes articles. No overclaiming — "server-side chunk integrity" not "end-to-end file integrity." | S |

**Buffer pool (2 sessions):** HQ1b · HQ2b

*"Nothing stops this train."*
