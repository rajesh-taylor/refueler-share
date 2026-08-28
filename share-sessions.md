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
| AP-7 | 2 Aug | AP-6 analysis consolidated and extended. Two-axis category framing locked: "recipient problem" (transfer survives laptop closure / recipient unavailability — P2P fails this) + "compulsion problem" (nothing to hand over — storing services with server-side keys fail this). Refueler Share is the only architecture solving both simultaneously. Two-axis framing is index hero candidate and article 5 spine. Recovery window publication restriction locked: B9 whitepaper §Future work only before shipping — no product copy or marketing. Recovery window privacy properties enumerated (3 properties). Renewal warning banner copy locked: "Your subscription renews on [date]. Your transfers will remain accessible." Article 1 iteration hold cleared — week of 5 Aug now open. Git push hygiene rule added to CLAUDE.md. |
| AP-8 | 4 Aug | Nav rewrite + head.njk theme script rewrite across `refueler-share` and `refueler-io`. Share nav links now: Notes, Upgrade, Support, theme pill — App/Editorial/Privacy removed. head.njk theme script: `localStorage`/`rfTheme` replaced with `rs-theme` cookie scoped to `.refueler.io` (30-day, `SameSite=Lax`); `classList` pattern removed; `dataset.theme` only; `window.toggleTheme` global exposed. Cross-domain theme persistence confirmed between `refueler.io` and `share.refueler.io`. Nav architecture locked: main site = ecosystem nav; Share = product nav. Files changed: `src/_includes/nav.njk`, `src/_includes/head.njk`. refueler-io: support page copy genericised, `support@refueler.io` set as primary contact, nav wordmark breadcrumb bug fixed (hardcoded "Legend" default removed). |
| AP-9 | 27 Aug | B7 re-sequence. Lightning infra I (S74) added — invoice-creation before webhook. Silent Drop confirmed Production Max only, no Creative Premium variant. B9 backend locked as LNbits-on-Hetzner CAX21 (no LND yet); Blink graph-risk documented as migration driver. LND deferred to post-B9 trigger condition. §Lightning node corrected CAX21 LND+Neutrino → CAX21 LNbits. B7 session budget expanded 25→50 core + 5 buffer. Provisioning discipline rule added to B9 notes. |
| AP-9a | 28 Aug | Three Opus-1 decisions patched into context files from `silent-drop-strategy-decisions.md` (lives in `refueler-io/docs/`): (1) Lightning identity invariant added to do-not-retry — Lightning path must never create an identity record, load-bearing for Silent Drop. (2) Journalist/source-protection hero copy gating rule added to marketing claim rulings — blocked until Silent Drop shipped + blinded-relay crypto reviewed + VPN scoping stated. (3) Internal framing block added to Share-Master-Context.md — canonical "what Share is" statement including correlation problem definition, two-dimensional tier model, and "policy is the credential" direction. Silent Drop two-axis positioning confirmed: not a third pillar, the sharpest expression of the existing two axes. |

---

## Sessions 73–73a — B7 in progress (5 Aug 2026)

| # | Commit | Summary |
|---|--------|---------|
| S73 | 4c95cf6 | Pre-B7 Blink checklist: BLINK_SHARE_API_KEY + BLINK_SHARE_WALLET_ID set, callback endpoint confirmed, Share-Master-Context updated re shared Blink account. |
| S73a | `a19778c` | Fix: static Trend/Export section titles were overlapping the injected table. Strip `.modal-sparkline-stub` class on open; hide `.modal-section-title` and CSV button; restore all on `closeModal()`. Both Paper and Carbon confirmed working. |

**B7 snags added (resolve at S100):**
- Theme toggle absent from modals — minor UX, add to S100 snag sweep
- `receiver_ab_shown` / `receiver_ab_downloaded` events routed to `/log/error` instead of AE — S47c A/B tracking code calling `reportError()` in error. Investigate in `frontend/share.js` at S100.

---

AD-1 — Share admin dashboard frontend migrated to refueler-io at src/share/admin/. Theme fixed to rs-theme cookie / dataset.theme. Stale token values corrected to CSS-1a lock. Worker endpoints unchanged. See AD-1 in refueler-io SESSIONS.

---

## RU0 — Large folder OOM fix (28 Aug 2026)

| # | Commit | Summary |
|---|--------|---------|
| RU0 | pending | Streaming zip: replaced `fflate.zip()` (buffered, OOM on 1.5 GB+) with `fflate.Zip` streaming API. Files processed one at a time — one `arrayBuffer()` in flight, released before next. Peak heap: ~1× folder size (was ~3×). Already-compressed types (jpg, mp4, etc.) → `fflate.ZipPassThrough` (STORED, method=0, macOS Archive Utility compatible). Compressible types (png, txt, csv, etc.) → `fflate.ZipDeflate` level 6. Progress bar now reports input bytes consumed vs total input bytes. Unit tests: memory discipline (max concurrent reads = 1), skip-list coverage, ZipPassThrough/ZipDeflate routing. Manual smoke test: upload a ~1.5 GB photo folder, confirm completes without stall. |

**RU0 do-not-retry (permanent):**
- DO NOT use `fflate.zip()` (buffered) for folder uploads — OOM on large folders. `fflate.Zip` (streaming) only.
- DO NOT use `ZipDeflate` with `{ level: 0 }` for already-compressed files — writes method=8 (DEFLATED) with zero passes, macOS Archive Utility rejects as unsupported. Use `ZipPassThrough` instead (method=0, STORED).
- DO NOT read multiple `arrayBuffer()` calls concurrently in the zip loop — process one file at a time, yield via `setTimeout(0)` between files.

---

## B7 session plan — Lightning/Blink + anonymous paid tier
> **Re-sequenced AP-9 · 27 Aug 2026.** Three locked changes and one sequencing correction drove this revision. B9 backend locked as LNbits-on-Hetzner (no LND yet) — Blink graph-visibility is the primary migration driver; any paying Lightning subscriber is already too much exposure. Lightning infra I (S74) added to build the invoice-creation path before the webhook — the original plan had these in the wrong order. Silent Drop is Production Max only, Lightning-gated, and deferred to a dedicated SD-block; B7 lays the two-rail groundwork it hangs off. Budget expanded from 25 to 50 core + 5 buffer to keep sessions single-scoped throughout: 47 core sessions (S74–S100) + 5 buffer within a 52-slot envelope.

| Session | Label | Scope | Size |
|---------|-------|-------|------|
| S73 ✓ | Dashboard: client errors modal | `client_errors_detail` stored from AE; `parseUA()` + `escHtml()`; detail table with Time · Context · Message · Browser. | S |
| S73a ✓ | Dashboard: client errors modal fix | Strip `.modal-sparkline-stub` on open; hide static section titles + CSV btn; restore on close. Both themes confirmed. | S |
| S74 | Lightning adapter | `worker/src/lightning.js` — `createInvoice()` / `getInvoiceStatus()`. `LIGHTNING_BACKEND` env var (default: `blink`). Unit tests. This is the B9→LNbits migration seam. | S |
| S74a | Invoice creation I | `POST /subscription/lightning` handler: Blink `btcPrice` query → live GBP/sats rate. | S |
| S74b | Invoice creation II | `lnInvoiceCreate` mutation → BOLT11 string + payment hash returned. KV write: `{ paymentHash, tier, period, created_at, expires_at, settled: false }`, 25h TTL. | S |
| S74c | Invoice creation III | Unit tests for invoice creation + KV schema. Smoke test `POST /subscription/lightning` end-to-end against wrangler dev. | S |
| S75 | Webhook endpoint I | `POST /webhook/lightning` handler scaffold. Route registered. KV payment hash lookup — reject unknown hashes with 404. | S |
| S75a | Webhook endpoint II | Settled-flag dedup (`settled: true` KV write). Blink fires twice per payment — confirm dedup suppresses second callback correctly. | S |
| S75b | Webhook endpoint III | `getInvoiceStatus()` polling fallback via Blink GraphQL. Smoke: simulate missed callback, confirm polling recovers. | S |
| S75c | Webhook endpoint IV | Full integration test: create invoice → simulate Blink callback → confirm KV settled flag + no duplicate processing. | S |
| S76 | Credential issuance I | On settled webhook: extract `{ tier, period }` from KV. Call NUT-00 BDHKE issuer — real blind signature, not a stub. | S |
| S76a | Credential issuance II | Write issued credential to KV keyed by `paymentHash`. TTL: 10 minutes. | S |
| S76b | Credential issuance III | `GET /subscription/lightning/credential?hash={paymentHash}` poll endpoint. Returns 202 while pending, 200 + credential when ready, 410 if expired. | S |
| S76c | Credential issuance IV | Tier-cap enforcement for Lightning credentials (same KV byte-counter path as Stripe). Error states: cap exceeded, hash unknown, already claimed. | S |
| S76d | Credential issuance V | Unit tests for the full credential issuance path. Smoke test: pay → callback → poll → credential received. | S |
| S77 | Upgrade page rail split I | `src/upgrade.njk`: two-rail structure introduced. Lightning section scaffold alongside Stripe section. No live cards yet — structure and copy only. Locked copy: *"Both paths unlock the same transfer capacity. Lightning doesn't collect your identity — which means some account features aren't available, and some privacy features are."* | S |
| S77a | Upgrade page rail split II | Lightning tier cards (Creative Premium + Production Max) wired to `POST /subscription/lightning`. Paper/Carbon tokens. Rate display placeholder. | S |
| S77b | Upgrade page rail split III | Stripe tier cards re-enabled. Both rails visible simultaneously. Visual parity check Paper + Carbon. | S |
| S78 | Frontend Lightning flow I | QR code display on invoice creation. BOLT11 copy button. Invoice expiry countdown. | S |
| S78a | Frontend Lightning flow II | Live GBP/sats rate displayed on Lightning tier cards. Rate refreshes on card open. | S |
| S78b | Frontend Lightning flow III | Frontend polls `GET /subscription/lightning/credential` on payment hash. Spinner → success state on 200. | S |
| S78c | Frontend Lightning flow IV | Credential receipt → browser memory (same pattern as Stripe credential). Upload flow unlocks paid tier cap on receipt. | S |
| S79 | Frontend Lightning flow V | Error states: expired invoice (410 on poll), already-redeemed credential, payment timeout (25h KV expiry hit). User copy for each state. | S |
| S79a | Frontend Lightning flow VI | Full frontend smoke test: pay invoice on testnet → credential received → upload unlocked. Both Paper and Carbon themes confirmed. | S |
| S80 | Payment privacy table I | `src/_data/payment_privacy.json`. Five columns: Name / Email / Record / Refund / Privacy. Stripe vs Lightning populated. PayNym: "Coming soon." | S |
| S80a | Payment privacy table II | Eleventy partial renders JSON as comparison table. Paper/Carbon tokens. | S |
| S80b | Payment privacy table III | Collapsible section wired into upgrade page below both rail sections. Smoke test both themes. | S |
| S81 | Dashboard Lightning cards I | Lightning section scaffold in admin dashboard. Confirmation latency p95 card — LIVE. AE datapoint written at webhook settlement. | S |
| S81a | Dashboard Lightning cards II | Four stub cards greyed with "available at B9" tooltip: webhook delivery rate, signature failures, routing fee income, channel liquidity health. | S |
| S81b | Dashboard Lightning cards III | Lightning section design pass. Paper/Carbon parity. Unit tests for latency AE write. | S |
| S82 | KV Lightning admin toggle | `lightning_available` KV flag. `POST /admin/status` extended to accept it. Dashboard toggle UI. | S |
| S82a | Graceful degradation | When `lightning_available: false` — Lightning hidden on upgrade page, Stripe fully operational. User-facing copy. Smoke test both states. | S |
| S83 | Renewal warning banner | 7-day pre-expiry banner for all paid tiers (Stripe + Lightning). SessionStorage-dismiss. Copy: *"Your subscription renews on [date]. Your transfers will remain accessible."* | S |
| S83a | Paid tier activation I | Re-enable Creative Premium + Production Max. Stripe path full smoke test against live Stripe. | S |
| S83b | Paid tier activation II | Lightning path full smoke test against live Blink. Both rails confirmed live end-to-end. | S |
| S84 | B7 security audit I | Lightning invoice creation: expiry enforcement, KV race conditions on concurrent invoice creation for same tier. | S |
| S84a | B7 security audit II | Credential farming: can an attacker poll `/subscription/lightning/credential` with guessed payment hashes? Entropy audit. Fix if required. | S |
| S84b | B7 security audit III | Webhook replay: can a settled callback be replayed to issue a second credential? KV dedup verified under test. | S |
| S84c | B7 security audit IV | Double-issuance: concurrent callbacks for same payment hash. Fix and regression test. | S |
| S84d | B7 security audit V | Findings consolidated. Marketing claim rulings updated. Any fixes committed. | S |
| S85 | Hetzner + LNbits planning I | **No code. No server provisioned yet.** Decision session: LNbits-on-Hetzner CAX21 architecture confirmed. `lightning.js` swap checklist vs Blink. LNbits Blink extension config. Webhook signing spec (HMAC-SHA256 — what Blink lacks). SimpleX SMP co-location plan. Tor hidden service config. Runbook structure for B9 build. | S |
| S85a | Hetzner + LNbits planning II | **No code. No server provisioned yet.** Failure mode analysis: what happens if the Hetzner instance goes down? KV `lightning_available` toggle as kill switch. Recovery time estimate with documented runbook. Contingency Opus session flagged: full failure-mode + multi-provider strategy session before B9 build. | S |
| S86 | LNURL-withdraw gift architecture | **No code.** Design document: gift flow, wallet compatibility matrix, UX spec, NUT-20 binding potential. B9 scope confirmed. | S |
| S87 | LNbits skinning scope | **No code.** Keep/strip/brand decisions for LNbits UI. Extension shortlist. Paper/Carbon token mapping to LNbits CSS. B9 build scope output. | S |
| S88 | Silent Drop design session | **No code. No Stripe objects. Name not locked.** Confirm Option A blinded-relay design against the live Worker architecture. Enumerate the rail-gating hooks B7 has established. Produce the SD-block session plan. Journalist use case copy draft. | S |
| S89 | Tidy-up I — tier naming + copy | Names/copy audit across all pages now both rails are live. No Stripe objects. | S |
| S90 | Tidy-up II — Stripe objects | Stripe product/price object alignment with locked tier model. Only after S89 copy is confirmed. | S |
| S91 | CI Level 2 I | Integration suite in GitHub Actions. Wrangler dev --local in CI. Lightning mock for webhook tests. | S |
| S91a | CI Level 2 II | Lightning mock coverage: invoice creation, callback, credential poll. All passing in CI. | S |
| S92 | Notes article 6 prep | *"Paying anonymously for file transfer"* — article structure, copy draft, publish dependency: Lightning rail live. No code. | S |
| S93 | B7 snag sweep I | Theme toggle in modals. `receiver_ab_shown`/`receiver_ab_downloaded` A/B event routing fix (`frontend/share.js`). | S |
| S94 | B7 snag sweep II | Manifest-field minimalism audit (M-02 Blossom benchmark). UUID/fragment entropy pre-audit. `TIER_EXPIRY_SECONDS.free` stale value check. | S |
| S95 | B7 snag sweep III | Any remaining snags from S93–S94. Status tile for admin dashboard. Stripe webhook TESTING.md additions. | S |
| S96 | Context file maintenance | `Share-Master-Context.md` split → working memory (≤350 lines) + `Share-Archive.md` (B1–B6 compacted). Both files to target line counts. | S |
| S100 | B7 close | Final snag sweep. Both context files confirmed at target. §Lightning infrastructure section finalised. Critical-chain table renumbered. B8 brief written. SW block brief confirmed. | S |

**Buffer pool (5 sessions):** S74d · S76e · S84e · S85b · S100a

---

## SW block session plan — white-label + API build (post-B7)

| Session | Label | Scope | Size |
|---------|-------|-------|------|
| SW1 | CF for SaaS setup | SaaS enablement, fallback origin, Worker route. Smoke: `GET /status` via wl hostname. | S |
| SW2 | API auth I | `api_auth.js` — HMAC-SHA256 verify, key lookup, ±300s window. Unit tests. | S |
| SW2a | API auth II | `POST /api/v1/credential/issue` + quota KV, 402 on exhaustion, AE `transfer_ref` logging. | S |
| SW2b | API auth III | Rotation with 24h grace. Unit tests. | S |
| SW3 | Badge + /wl/config | `GET /wl/config` by Host header. Fail-safe `badge: true`. Badge component Paper/Carbon. | S |
| SW4 | Webhooks I | Registration endpoints. `rfs_whsec_` issuance. `wh_config_` KV schema. URL validation. | S |
| SW4a | Webhooks II | Delivery via `ctx.waitUntil`. Dead-letter KV (7-day TTL). AE log per attempt. | S |
| SW4b | Webhooks III | Daily cron retry of dead-letter items. | S |
| SW5 | Client dashboard I | `dashboard.share.refueler.io` scaffold. API-key auth. Transfers table from AE. | S |
| SW5a | Client dashboard II | Capability gating. Webhook monitoring card. Hostname health card. Paper/Carbon. | S |
| SW6 | Onboarding flow | Per-client admin runbook. CF custom-hostname → keypair → KV write → activation smoke test. | S |
| SW7 | IT handover PDF | Two-page branded PDF. Paper theme. Three substitution fields. Built once, generated per client. | S |
| SW8 | Daily cron | Hostname health checks → AE. `[triggers]` in wrangler.toml. | S |
| SW9 | SW close | Snag sweep. TESTING.md additions. Context trim pass. B8 brief. Buffer review. | S |

**Buffer pool (2 sessions):** SW2c · SW5b

---

## R-series — Resumable uploads (post-SW)

| Session | Label | Scope | Size |
|---------|-------|-------|------|
| RU1 | Resumable uploads I | IndexedDB schema: write chunk completion state on each 200 ACK. On page load: detect interrupted transfer, offer resume or discard. | S |
| RU1a | Resumable uploads II | Resume flow: skip confirmed chunks. Unit tests. | S |
| RU2 | Resumable uploads III | Resume UI: progress bar shows "Resuming from chunk N of M." Credential expiry awareness. | S |
| RU2a | Resumable uploads IV | Integration test: interrupt at chunk 3, reload, confirm resume from chunk 3. Root cause investigation of 5 Aug stall (Worker timeout / macOS drop — fflate OOM root cause resolved at RU0). | S |

**Buffer pool (2 sessions):** RU1b · RU2b

---

## HQ-series — HTTP/3 + BLAKE3 integrity positioning (post-R-series)

| Session | Label | Scope | Size |
|---------|-------|-------|------|
| HQ1 | HTTP/3 verification + AE instrumentation | Confirm HTTP/3 active. Add `Alt-Svc` logging to AE. Add chunk upload latency datapoint. Draft canonical copy string. Wire to upgrade page and index page. | S |
| HQ2 | Competitive positioning copy + /notes/ hook | Write the technical distinction cleanly. Ensure consistency across index, upgrade, and notes articles. No overclaiming — "server-side chunk integrity" not "end-to-end file integrity." | S |

**Buffer pool (2 sessions):** HQ1b · HQ2b

*"Nothing stops this train."*
