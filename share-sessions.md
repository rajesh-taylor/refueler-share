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
- `wrangler r2 bucket lifecycle set --rule` inline JSON — use `add` subcommand
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
| 27 | `5f3cb8e` | Stripe CLI installed. 4 test prices created. Root cause of `client_secret` mismatch: `checkout/sessions ui_mode:embedded` incompatible with `stripe.elements()` |
| 28 | `5f3cb8e` | Direct Subscription creation confirmed. 4242 card flow ✓. Webhook handler extended. |
| 29 | `5d8c1ea` | `STRIPE_SECRET_KEY` rotated. Portal `resource_missing` confirmed correct. Cancellation code-complete. **B3 closed.** |

**B3 do-not-retry:**
- DO NOT use `checkout/sessions ui_mode:embedded` — use direct Subscription + `expand[0]=latest_invoice.payment_intent`
- DO NOT `decodeURIComponent` Stripe `client_secret` — already decoded
- DO NOT attempt Customer Portal without active subscription — Stripe returns `resource_missing`

---

## Sessions 34–52 — B4 Security hardening + B5 Design full pass

| # | Commit | Summary |
|---|--------|---------|
| S34 | `7738450f` | BLAKE3 WASM in Worker. `verifyChunkHash()` live. |
| S35 | `ab01388` | AAD overflow fix — `DataView.setUint32(0,i,false)` into 4-byte buffer. |
| S36 | `b877c76` | KV-backed rate limiting: `ratelimit.js`, 3 endpoints, 429s logged to AE. |
| S36b | `0cc4de9` | `/log/error` endpoint + `reportError()` helper. 6 capture points. |
| S37–S38 | `7684118`+`20da7d4` | Dashboard design pass. `client_errors_24h` AE query. 3 rogue secrets deleted. |
| S39 | `ab4fc98` | Server-side tier enforcement. 10 MB chunk cap. KV byte counter. |
| S40 | `c6f1a7a` | MIME denylist gate on chunk 0. 415 + AE log on miss. |
| S41 | `b2a4ba0` | UUID validation (RFC 4122). Chunk bounds check. |
| S42a–S42d | various | `handleLogError` fix. Filename sanitisation. Per-UUID auth rate limit. UUID-bound credential issuance. Turnstile nonce binding. |
| S42e | — | Full B4 audit. Marketing claim rulings. UK regulatory language. B5 handoff. |
| S43 | `5c54802` | DESIGN-TOKENS.md v1.0 applied to index, upgrade, status pages. |
| S44–S45 | `b15f407`+`7187e41` | Dashboard design pass I+II: sidebar, token alignment, gold wordmark. |
| S46a–S46b | `bbf271a`+`023dfcc` | Modal build: 14 modal keys, skeleton, focus trap. formatBytes, zero=green. |
| S47a–S47d | various | FREE_EXPIRY fixed (5d→7d). QR 200px SVG (qr-creator). Receiver landing page. USP A/B test (Variant A/B, sessionStorage, AE logging). |
| S48 | `0761f4c` | Maintenance modal. Theme cookie `rs-theme`. No FOUC. |
| S48a | `0152aae` | FSAA streaming download. Per-chunk retry 1s/2s/4s. Blob fallback. |
| S49a | `3598a65` | Carbon gold edging. `--inset-rule` throughout. |
| S50 | `e3a4407` | Serif audit. 3 correct usages confirmed. |
| S51 | `c182036` | File extraction: `frontend/share.css` (367L), `frontend/share.js` (899L), `frontend/upgrade.css` (419L). |
| S52 | — | `TIER_EXPIRY_SECONDS.free` 5d→7d. Lightning ops plan. Context v4.0. B5 closed. |

---

## Sessions 53–72a — B6 Testing infrastructure + folder upload

| # | Commit | Summary |
|---|--------|---------|
| S53 | `b1d9855`+`ca1260c` | Folder upload I. fflate 0.8.2, client-side zip, zip progress UI. |
| S54 | `c732abf` | Folder upload II. `sanitisePath`, depth limit 20, file count cap 500/2000. |
| S55 | — | Folder upload III. Receiver UX: folder icon, zip-as-is decision locked. |
| S56 | `6cf711d`+`7735787` | Folder upload smoke test. fflate + qr-creator self-hosted. Full round-trip ✓. |
| S57 | — | Bearer TTL investigation. 900s hardcoded exp fatal for large transfers. Root cause identified. |
| S58 | `f94a158` | Bearer TTL fix. Token exp = `manifest.expiry_timestamp`. Smoke test ✓. |
| S60 | `e59305c` | Unit tests I. Vitest 2 harness. ratelimit + manifest. 43 passing. |
| S61–S62 | — | Unit tests II–III. nut00 BDHKE + blake3 + turnstile + stripe. 178 passing / 6 suites. |
| S63–S64 | `def77b5` | Integration harness. wrangler dev --local. Full BDHKE in client.js. 181 passing. TESTING.md created. |
| S65–S66 | `8dc8dce`+`344e32d` | Security regression suite I–II. MIME, UUID, chunk bounds, tier cap. 207 passing / 8 suites. |
| S67–S69 | various | k6 architecture + load tests I–II. All thresholds green. |
| S70–S72 | `731b571`+`93b2b86`+`319225f` | CI Level 1 green. Lightning admin toggle. Stripe webhook security tests. 212 passing / 0 skipped. |
| S72a | — | B6 close. TESTING.md v0.5. Context trim. B7 brief. |

**B6 do-not-retry (permanent):**
- DO NOT use `[new Uint8Array(buf), { level: 0 }]` in fflate 0.8.x — bare `new Uint8Array(buf)` only
- DO NOT load fflate or qr-creator from cdnjs — self-hosted only
- DO NOT put file inputs inside the drop zone hit area — JS-triggered only
- DO NOT hardcode 900s TTL for download tokens — pass `manifest.expiry_timestamp`
- DO NOT call `client.putManifest()` in integration tests — manifest auto-written after final chunk
- DO NOT send `X-P2SH-Secret-Hash` in a separate manifest PUT — must be chunk 0 upload header
- DO NOT start Supabase mock in the test file — lifecycle owns it
- DO NOT use a dummy blinded message in `issueCredential` test helper — real BDHKE unblinding required
- DO NOT use `ProjectivePoint.subtract()` — noble v2. Use `.add(point.negate())`

---

## AP-series — Architectural planning sessions (uncounted)

| # | Date | Summary |
|---|------|---------|
| AP-0 | 29 Jul | Ad-hoc strategy. Article pipeline. API/white-label planning. Susie/BHODL contacts. |
| AP-1 | 29 Jul | /notes/ article pipeline locked. Articles 2–5 structures confirmed. notes-articles-list.md created. |
| AP-2 | 30 Jul | API architecture: HMAC signing, credential issuance, Stripe decoupling, renewal stacking. Locked. |
| AP-3 | 30 Jul | White-label: custom hostname flow, badge config via KV, IT handover doc, five-tier structure. |
| AP-3a | 30 Jul | Webhook spec locked. Single API keypair + rotation. OEM paragraph drafted. SW block (12+2) created. |
| AP-4 | 1 Aug | Security + crypto strategy. Argon2id Enterprise (post-B8). ML-KEM B10. BIP-85/FROST B12. SimpleX B9+. |
| AP-5 | 1 Aug | Incident response planning. `docs/incident-response.md` + `docs/security-breach.md` created. |
| AP-6 | 2 Aug | Competitive analysis: DashBeam. Resumable upload gap confirmed. HTTP/3 + BLAKE3 positioning locked. |
| AP-7 | 2 Aug | Two-axis framing locked: recipient problem + compulsion problem. Recovery window framing locked. Article 1 hold cleared. |
| AP-8 | 4 Aug | Nav rewrite + `head.njk` theme script. `rs-theme` cookie scoped to `.refueler.io`. |
| AP-9 | 27 Aug | B7 re-sequence. Lightning infra I added. Silent Drop confirmed Production Max only. B7 budget 25→50. |
| AP-9a | 28 Aug | Lightning identity invariant added. Journalist/source-protection hero copy gating rule added. |

---

## Sessions 73–73a — B7 in progress

| # | Commit | Summary |
|---|--------|---------|
| S73 | `4c95cf6` | ~~Pre-B7 Blink checklist.~~ **SUPERSEDED Opus-2 — Blink dead. Replaced by NB-series + LNbits.** |
| S73a | `a19778c` | Dashboard: client errors modal fix. Strip `.modal-sparkline-stub` on open; hide static section titles + CSV btn; restore on close. Both themes confirmed. |

**B7 snags (resolve at S93–S95):**
- Theme toggle absent from modals
- `receiver_ab_shown` / `receiver_ab_downloaded` events routed to `/log/error` instead of AE

---

## AD-1

Share admin dashboard frontend migrated to refueler-io at `src/share/admin/`. Theme fixed to rs-theme cookie / dataset.theme. Worker endpoints unchanged.

---

## RU0 — Large folder OOM fix (28 Aug 2026)

| # | Commit | Summary |
|---|--------|---------|
| RU0 ✓ | `49915f2`→`4b223b1` | Streaming zip: replaced `fflate.zip()` (buffered, OOM on 1.5 GB+) with `fflate.Zip` streaming API. `ZipPassThrough` (STORED) for already-compressed types. `ZipDeflate` level 6 for compressible. **Smoke test PASSED: 1.72 GB JPEG folder.** |

**RU0 do-not-retry:**
- DO NOT use `fflate.zip()` (buffered) — OOM on large folders. `fflate.Zip` (streaming) only.
- DO NOT use `ZipDeflate` with `{ level: 0 }` for already-compressed files — use `ZipPassThrough` (method=0, STORED).
- DO NOT read multiple `arrayBuffer()` calls concurrently in the zip loop — one file at a time, yield via `setTimeout(0)`.

---

## RU1 — Resumable uploads I (31 Aug 2026)

| # | Commit | Summary |
|---|--------|---------|
| RU1 ✓ | `ae78b81`→`48ed213` | IndexedDB schema live — `idbOpen()`, `writeChunkState()` (every 200 ACK), `readResumeState()`, `clearResumeState()`. `checkResumeState()` on page load with 8-day stale guard. Resume card HTML in `index.njk` (gold "Interrupted" tag, filename + pct detail, Resume + Discard buttons). Discard wired. Resume = placeholder. |

---

## RU1a — Resumable uploads II (1 Sep 2026)

| # | Commit | Summary |
|---|--------|---------|
| RU1a ✓ | `9e255fa`/`f05583f` | `resumeUpload()` wired: restores AES key/IV from IDB, re-issues credential, prompts for original file (name+size identity check), re-hashes confirmed chunks for rolling BLAKE3 root, uploads remaining chunks. Expiry-awareness: `tier` + `expiryTimestamp` on IDB record. `fetchWithTimeout()` (60s, AbortController) fixes Safari silent hang. 3× retry (2s/5s/10s). Zip progress capped at 95% + "Finalising archive" label. Toggle knob Carbon fix. 36/36 tests passing. |

**RU1a do-not-retry:**
- DO NOT use `var(--carbon)` for the active toggle knob — use `#E8E2D8` (Paper literal)
- DO NOT store IDB records without `tier` and `expiryTimestamp`
- DO NOT use bare `fetch()` for chunk uploads — always `fetchWithTimeout()` with `AbortController`

---

## RU2–RU2e — Resumable uploads III–VII (Sep 2026)

| # | Commit | Summary |
|---|--------|---------|
| RU2 | `9fce220` | Resume progress strings wired. Renewal banner deferred to SW-block. |
| RU2a | — | IDB write verification: all five fields confirmed present. Resume card confirmed rendering. Mirror sync gap identified. |
| RU2b | `bd48ad8` | Resume card HTML synced to `refueler-io/src/share/index.njk`. Root cause: Turnstile never rendered on resume path. |
| RU2c | `2f348cb`/Worker `0c216a5` | Resume credential uses `resume: true` + `resume_uuid`; Worker R2 HEAD check on chunk `0000`; no Turnstile. 3× retry loop. `promptForResumeFile` focus/change race fixed. |
| RU2d | `2e1604a`/`bc0d597`/`1030572` | Verification loop hang fixed. Resume button fix. CORS fix. WiFi-kill → card → resume → share card ✓. |
| RU2e | `1e33ebe` | 409 detection: clear IDB, show "already completed", repurpose Discard as "New upload". Encrypted-chunks reassurance note. **RU-block closed.** |

**RU do-not-retry:**
- DO NOT require Turnstile on the resume credential path — use `resume: true` + `resume_uuid` + R2 HEAD check
- DO NOT treat HTTP 409 on resume chunk PUT as generic 4xx — it means transfer already complete

---

## SYNC-1 — Dual-repo asset sync fix (31 Aug 2026)

**Commits:** `refueler-share` `2d26587` · `refueler.io` `706fe65`+`ae6f9e1`

- `bin/sync-share.sh` committed — guarded sync (copy → diff verify → commit+push both repos).
- Embedded git repos (`refueler-app`, `terminals/numo-fork`) added to `.gitignore` in `refueler-io`.

**Do-not-retry:**
- DO NOT edit files in `refueler.io/src/share/assets/` directly — GENERATED header for a reason.
- Always run `bin/sync-share.sh` after editing any shared asset in `refueler-share/frontend/`.

---

## HQ-series — HTTP/3 + BLAKE3 integrity positioning

| Session | Commit | Summary |
|---------|--------|---------|
| HQ1 ✓ | `b66d401` | `blob4` httpProtocol added to AE schema. "Hashing password" copy fix. Auth comment updated. Stale zk_verification_note replaced. |
| HQ2 ✓ | `9cd2241` | BLAKE3 + HTTP/3 trust band (upgrade page). Plans + Status in share nav. activePage fix. Async card removed. njk/CSS path issues resolved. |

---

## NB-series — node bootstrap (pre-B7, gates all B7 code)

| Session | Label | Scope |
|---------|-------|-------|
| NB-1 | Node runbook (Opus, no code) | OS hardening → phoenixd + seed backup → LNbits → cloudflared tunnel → Tor per-service .onion → backup + monitoring → failure modes. |
| NB-2 | Provision + execute | Provision Instance A (CAX21). Follow runbook. Verify phoenixd → bech32 on-chain send. |
| NB-3 | End-to-end test | LNbits invoice → pay → callback → GET re-verify → splice-out liquidation. |
| NB-4 | Node live | Set Worker secrets `LNBITS_URL` + `LNBITS_API_KEY`. Declare node live. B7 code may now start. |

---

## B7 session plan — Lightning/LNbits + anonymous paid tier

| Session | Label | Scope |
|---------|-------|-------|
| S74 | Lightning adapter | `worker/src/lightning.js` — `createInvoice()` / `getInvoiceStatus()` over LNbits REST. Unit tests. |
| S74a | Invoice creation I | `POST /subscription/lightning` handler. LNbits invoice denominated in GBP. |
| S74b | Invoice creation II | `POST /api/v1/payments` → BOLT11 + payment_hash. KV write with 25h TTL. |
| S74c | Invoice creation III | Unit tests. Smoke test end-to-end against wrangler dev. |
| S75 | Webhook endpoint I | `POST /webhook/lightning` scaffold. KV payment-hash lookup. Callback = notification only. |
| S75a | Webhook endpoint II | Re-verify via `GET /api/v1/payments/{hash}`, require `paid: true`. Settled-flag dedup. |
| S75b | Webhook endpoint III | Polling fallback via same GET. Smoke: drop callback, confirm poll path settles. |
| S75c | Webhook endpoint IV | Full integration test: create → callback → re-verify → credential issued exactly once. |
| S76 | Credential issuance I | On settled webhook: real NUT-00 BDHKE blind signature. |
| S76a | Credential issuance II | Write credential to KV keyed by paymentHash. 10-minute TTL. |
| S76b | Credential issuance III | `GET /subscription/lightning/credential` poll endpoint. 202 pending / 200 ready / 410 expired. |
| S76c | Credential issuance IV | Tier-cap enforcement for Lightning credentials. Error states. |
| S76d | Credential issuance V | Unit tests. Smoke test: pay → callback → poll → credential received. |
| S77 | Upgrade page rail split I | Two-rail structure. Lightning section scaffold. Copy locked. |
| S77a | Upgrade page rail split II | Lightning tier cards wired to `POST /subscription/lightning`. |
| S77b | Upgrade page rail split III | Stripe tier cards re-enabled. Both rails visible. Visual parity check. |
| S78 | Frontend Lightning flow I | QR code display. BOLT11 copy button. Invoice expiry countdown. |
| S78a | Frontend Lightning flow II | Live GBP/sats rate on Lightning tier cards. |
| S78b | Frontend Lightning flow III | Frontend polls credential endpoint on payment hash. |
| S78c | Frontend Lightning flow IV | Credential receipt → browser memory. Upload flow unlocks paid tier. |
| S79 | Frontend Lightning flow V | Error states: expired invoice, already-redeemed credential, payment timeout. |
| S79a | Frontend Lightning flow VI | Full frontend smoke test: pay → credential → upload unlocked. Both themes. |
| S80 | Payment privacy table I | `src/_data/payment_privacy.json`. Stripe vs Lightning. PayNym "coming soon." |
| S80a | Payment privacy table II | Eleventy partial renders comparison table. Paper/Carbon tokens. |
| S80b | Payment privacy table III | Collapsible section on upgrade page. |
| S81 | Dashboard Lightning cards I | Confirmation latency p95 card — LIVE. AE datapoint at webhook settlement. |
| S81a | Dashboard Lightning cards II | Four stub cards greyed "available at B9". |
| S81b | Dashboard Lightning cards III | Lightning section design pass. Unit tests. |
| S82 | KV Lightning admin toggle | `lightning_available` KV flag. Dashboard toggle UI. |
| S82a | Graceful degradation | `lightning_available: false` — Lightning hidden, Stripe fully operational. |
| S83 | Renewal warning banner | 7-day pre-expiry banner. SessionStorage-dismiss. |
| S83a | Paid tier activation I | Re-enable Creative Premium + Production Max. Stripe full smoke test. |
| S83b | Paid tier activation II | Lightning full smoke test against live LNbits. Both rails confirmed live. |
| S84 | B7 security audit I | Lightning invoice creation: expiry enforcement, KV race conditions. |
| S84a | B7 security audit II | Credential farming: entropy audit on payment hash polling. |
| S84b | B7 security audit III | Webhook replay: KV dedup verified under test. |
| S84c | B7 security audit IV | Double-issuance: concurrent callbacks for same payment hash. |
| S84d | B7 security audit V | Findings consolidated. Marketing claim rulings updated. |
| S85 | LNbits ops verification | Post-node-live sanity: wallet API keys scoped, cloudflared healthy, Tor onions resolving. |
| S86 | LNURL-withdraw gift architecture | No code. Design document: gift flow, wallet compatibility, NUT-20 binding potential. |
| S87 | LNbits skinning scope | No code. Keep/strip/brand decisions. Paper/Carbon token mapping. |
| S88 | Silent Drop design session | No code. Confirm blinded-relay design. Produce SD-block session plan. |
| S89 | Tidy-up I — tier naming + copy | Names/copy audit across all pages. No Stripe objects. |
| S90 | Tidy-up II — Stripe objects | Stripe product/price alignment with locked tier model. After S89 confirmed. |
| S91 | CI Level 2 I | Integration suite in GitHub Actions. Lightning mock for webhook tests. |
| S91a | CI Level 2 II | Lightning mock coverage. All passing in CI. |
| S92 | Notes article 6 prep | "Paying anonymously for file transfer" — structure + copy draft. No code. |
| S93 | B7 snag sweep I | Theme toggle in modals. `receiver_ab` A/B event routing fix. |
| S94 | B7 snag sweep II | Manifest-field minimalism audit. UUID/fragment entropy pre-audit. |
| S95 | B7 snag sweep III | Remaining snags. Status tile for admin dashboard. |
| S96 | Context file maintenance | `Share-Master-Context.md` split → working memory (≤350L) + `Share-Archive.md`. |
| S100 | B7 close | Final snag sweep. Context files at target. B8 brief written. SW block brief confirmed. |

**Buffer pool (5 sessions):** S74d · S76e · S84e · S85b · S100a

---

## SD-block — Silent Drop (post-HQ, before SW)

Session plan produced at S88. Scope: Production Max, Lightning-only standing-receive inbox. SD-feature ships here; journalist hero copy gated until B9. Incident-response tabletop must complete before SD-block launch.

---

## SW block session plan — white-label + API build (post-SD-block)

| Session | Label | Scope |
|---------|-------|-------|
| SW1 | CF for SaaS setup | SaaS enablement, fallback origin, Worker route. |
| SW2 | API auth I | `api_auth.js` — HMAC-SHA256 verify, key lookup, ±300s window. Unit tests. |
| SW2a | API auth II | `POST /api/v1/credential/issue` + quota KV, 402 on exhaustion, AE `transfer_ref` logging. |
| SW3 | Badge + /wl/config | `GET /wl/config` by Host header. Fail-safe `badge: true`. Badge component Paper/Carbon. |
| SW4 | Webhooks I | Registration endpoints. `rfs_whsec_` issuance. `wh_config_` KV schema. URL validation. |
| SW4a | Webhooks II | Delivery via `ctx.waitUntil`. Dead-letter KV (7-day TTL). AE log per attempt. |
| SW4b | Webhooks III | Daily cron retry of dead-letter items. |
| SW5 | Client dashboard I | `dashboard.share.refueler.io` scaffold. API-key auth. Transfers table from AE. |
| SW5a | Client dashboard II | Capability gating. Webhook monitoring card. Hostname health card. Paper/Carbon. |
| SW6 | Onboarding flow | Per-client admin runbook. CF custom-hostname → keypair → KV write → activation smoke test. |
| SW7 | IT handover PDF | Two-page branded PDF. Paper theme. Three substitution fields. |
| SW8 | Daily cron | Hostname health checks → AE. `[triggers]` in wrangler.toml. |
| SW9 | SW close | Snag sweep. TESTING.md additions. Context trim pass. B8 brief. Buffer review. |

**Buffer pool (2 sessions):** SW2c · SW5b

---

## Locked block sequence (Opus-2 · 29 Aug 2026)

`NB → B7 → SYNC-1 → RU-block → HQ → SD-block → SW → B8 → B9 → B10+`

*(SYNC-1 and RU-block and HQ-series are now complete — sequence advances to SD-block after B7.)*

---

## Opus-2 · 29 Aug 2026 (uncounted)

B7 resequenced for LNbits/phoenixd. NB-series node bootstrap block created. S74–S76 rewritten for LNbits REST. Webhook model corrected (unsigned callback → authenticated GET re-verify). Phoenixd→LND trigger locked. Instance topology confirmed (A: Share+Pass, B: Legend post-B9, C: SimpleX at B9). SD-block placed post-HQ, pre-SW. SYNC-1 inserted. Blink cleanup checklist produced. Ad-hoc 30 Aug — `fflate.zip()` OOM root cause confirmed; Safari chunk 82 failure was transient DNS, not code bug.

*"Nothing stops this train."*
