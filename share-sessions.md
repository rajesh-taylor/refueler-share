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
| S58 | `f94a158` | Bearer TTL fix. Token exp = `manifest.expiry`. Smoke test ✓. |
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
| AP-10 | 3 Sep | Roadmap resequenced. TG-block, TH-series, SW, B8 require no Hetzner. Traitor's Gate internal vocab locked. Tower Hill / OpenTimestamps: 2–3 Opus scoping sessions. Execution Dock: 48h Three Tides grace. Dragon status vocabulary locked. BRIDGE v6.7, Master-Context v7.0. |

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
| RU1 ✓ | `ae78b81`→`48ed213` | IndexedDB schema live — `idbOpen()`, `writeChunkState()` (every 200 ACK), `readResumeState()`, `clearResumeState()`. `checkResumeState()` on page load with 8-day stale guard. Resume card HTML in `index.njk`. Discard wired. Resume = placeholder. |

---

## RU1a — Resumable uploads II (1 Sep 2026)

| # | Commit | Summary |
|---|--------|---------|
| RU1a ✓ | `9e255fa`/`f05583f` | `resumeUpload()` wired. AES key/IV restored from IDB. Re-credential path. File identity check. BLAKE3 re-hash of confirmed chunks. `fetchWithTimeout()` fixes Safari hang. 3× retry. Zip progress capped at 95%. 36/36 tests passing. |

**RU1a do-not-retry:**
- DO NOT use `var(--carbon)` for the active toggle knob — use `#E8E2D8` (Paper literal)
- DO NOT store IDB records without `tier` and `expiryTimestamp`
- DO NOT use bare `fetch()` for chunk uploads — always `fetchWithTimeout()` with `AbortController`

---

## RU2–RU2e — Resumable uploads III–VII (Sep 2026)

| # | Commit | Summary |
|---|--------|---------|
| RU2 | `9fce220` | Resume progress strings wired. Renewal banner deferred to SW-block. |
| RU2a | — | IDB write verification confirmed. Resume card rendering confirmed. Mirror sync gap identified. |
| RU2b | `bd48ad8` | Resume card HTML synced to `refueler-io/src/share/index.njk`. Turnstile never rendered on resume path — root cause. |
| RU2c | `2f348cb`/Worker `0c216a5` | Resume credential uses `resume: true` + `resume_uuid`; Worker R2 HEAD check on chunk `0000`; no Turnstile. |
| RU2d | `2e1604a`/`bc0d597`/`1030572` | Verification loop hang fixed. Resume button fix. CORS fix. WiFi-kill → card → resume → share card ✓. |
| RU2e | `1e33ebe` | 409 detection: clear IDB, show "already completed", repurpose Discard as "New upload". **RU-block closed.** |

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
| HQ1 ✓ | `b66d401` | `blob4` httpProtocol added to AE schema. "Hashing password" copy fix. Auth comment updated. |
| HQ2 ✓ | `9cd2241` | BLAKE3 + HTTP/3 trust band (upgrade page). Plans + Status in share nav. activePage fix. |

---

## NB-series — node bootstrap (pre-B7, gates all B7 code)

**NB-1 can proceed immediately (Opus, no server). NB-2 onwards requires Hetzner commitment.**

| Session | Label | Scope |
|---------|-------|-------|
| NB-1 | Node runbook (Opus, no code) | OS hardening → phoenixd + seed backup → LNbits → cloudflared tunnel → Tor per-service .onion → backup + monitoring → failure modes. |
| NB-2 | Provision + execute | Provision Instance A (CAX21). Follow runbook. Verify phoenixd → bech32 on-chain send. **First Hetzner cost incurred here.** |
| NB-3 | End-to-end test | LNbits invoice → pay → callback → GET re-verify → splice-out liquidation. |
| NB-4 | Node live | Set Worker secrets `LNBITS_URL` + `LNBITS_API_KEY`. Declare node live. B7 code may now start. Article pipeline unlocks. |

---

## TG-block — Traitor's Gate (no Hetzner required)

**Internal name: Traitor's Gate. UI label: "Destroy after download." All tiers for core; tidal window = paid only.**

| Session | Label | Scope |
|---------|-------|-------|
| TG-1 | Design + manifest spec | Manifest fields: `pending_destruction`, `consumed`, `available_from_timestamp`, `available_until_timestamp`. Pre-code confirmation. |
| TG-2 | Worker implementation | `DELETE /transfer/{uuid}` endpoint. `pending_destruction` flag set on final chunk. 410 on consumed manifest. Tidal window check on every download request (423 before open tide, 410 after close tide). Unit tests. |
| TG-3 | Frontend — upload side | Destroy after download toggle UI. Post-upload amber notice to sender. Tidal window datetime pickers (paid tier only). |
| TG-3a | Frontend — download side | Pre-download modal. Post-download confirmation gate → [I've saved it] → triggers `DELETE /transfer/{uuid}`. |
| TG-4 | Execution Dock — dashboard | Harbourmaster dashboard card: amber state, expiry countdown, [Destroy now] button. |
| TG-5 | Tests + smoke | Full round-trip: upload with destroy flag → download → confirm → verify 410. Tidal window boundary tests. |

**TG-block do-not-retry:**
- DO NOT auto-delete R2 on final chunk served — set `pending_destruction: true`, wait for frontend confirmation
- DO NOT use the word "Traitor" in any UI copy, tooltip, or aria-label

---

## TH-series — Tower Hill / OpenTimestamps (no Hetzner required)

**2–3 Opus scoping sessions before build. Cover Share + Pass + Legend together.**

| Session | Label | Scope |
|---------|-------|-------|
| TH-Opus-1 | Share scoping | OpenTimestamps API mechanics. `.ots` proof format. Tier placement. Framing copy. |
| TH-Opus-2 | Pass + Legend scoping | Pass: ticket issuance timestamping. Legend: native `.ots` verification UI. |
| TH-Opus-3 | Build spec | Session plan for build sessions. Endpoint design. Proof storage model. |
| TH-1 | Share build | OpenTimestamps API call at upload completion. `.ots` proof stored in R2. |
| TH-2 | Frontend + tests | Optional toggle on upload. Proof download alongside transfer link. Unit + integration tests. |

---

## B7 session plan — Lightning/LNbits + anonymous paid tier

**All B7 sessions from S74 onwards gate on NB-4 (node live).**

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
| S83a | Paid tier activation I | Re-enable Sovereign. Stripe full smoke test. |
| S83b | Paid tier activation II | Lightning full smoke test against live LNbits. Both rails confirmed live. |
| S84 | B7 security audit I | Lightning invoice creation: expiry enforcement, KV race conditions. |
| S84a | B7 security audit II | Credential farming: entropy audit on payment hash polling. |
| S84b | B7 security audit III | Webhook replay: KV dedup verified under test. |
| S84c | B7 security audit IV | Double-issuance: concurrent callbacks for same payment hash. |
| S84d | B7 security audit V | Findings consolidated. Marketing claim rulings updated. |
| S85 | LNbits ops verification | Post-node-live sanity: wallet API keys scoped, cloudflared healthy, Tor onions resolving. |
| S86 | LNURL-withdraw gift architecture | No code. Design document: gift flow, wallet compatibility, NUT-20 binding potential. |
| S87 | LNbits skinning scope | No code. Keep/strip/brand decisions. Paper/Carbon token mapping. |
| S88 | Silent Drop design session (Opus) | ✓ **Complete** — see SD-block below. |
| S89 | `1a0ac93` | Tier rename locked: Free → Citizen · Creative Premium retired · Production Max → Sovereign (two rails). Crown = brand/institutional only. |
| S90 | Tidy-up II — Stripe objects | Stripe product/price alignment with locked tier model. After S89 confirmed. |
| S91 | CI Level 2 I | Integration suite in GitHub Actions. Lightning mock for webhook tests. |
| S91a | CI Level 2 II | Lightning mock coverage. All passing in CI. |
| S92 | Notes article 6 prep | "Paying anonymously for file transfer" — structure + copy draft. No code. Unlocks after node live. |
| S93 | B7 snag sweep I | Theme toggle in modals. `receiver_ab` A/B event routing fix. |
| S94 | B7 snag sweep II | Manifest-field minimalism audit. UUID/fragment entropy pre-audit. |
| S95 | B7 snag sweep III | Remaining snags. Status tile for admin dashboard. |
| S96 | Context file maintenance | `Share-Master-Context.md` split → working memory (≤350L) + `Share-Archive.md`. |
| S100 | B7 close | Final snag sweep. Context files at target. B8 brief written. SW block brief confirmed. |

**Buffer pool (5 sessions):** S74d · S76e · S84e · S85b · S100a

---

## SD-block — Silent Drop (post-B8, post-NB-4)

**S88 complete · 4 Sep 2026.** All design decisions locked. Full Locke (NUT-11 Mode 2) in place — SD ships after B8, no temp auth builds.

**Prerequisites:** B8 complete (Locke live). NB-4 (node live). Friend-group soft launch (7-day) gates public Sovereign access.

**Locked design decisions (S88):**
- Opaque intake token → KV inbox key. Sender sees a random string; Worker holds the mapping. No stable identifier visible at any layer.
- Lightning rail only. Architectural necessity: no email, no Supabase row, no identity to bind an intake point to. Stripe rail = private inbox (not anonymous) — different product.
- Recipient sets standing-inbox lifecycle and expiry. Execution Dock as optional Quay close mechanism — reclaims storage.
- Lighthouse + up to 10 Sovereign Quays at launch. Primary Quay (first created) anchored visually in dashboard. Ad-hoc Quays 2–10 default to 30-day expiry + Execution Dock on. Defaults teach the pattern; no explanatory copy required.
- One Deed (recovery sheet) per Harbourmaster. One keypair covers Locke + all Quays. 12-word BIP-39 mnemonic. Printed. No copy button. Confirmed by checkbox before proceeding. UI calls it "recovery sheet"; whitepaper infers "the Deed."
- Stripe Sovereign users get a recovery sheet too — offline backup independent of Stripe recovery path.
- Notification at SD launch: polling (professional users) + Business webhook (`cargo_arrived` / `cargo_retrieved`). SimpleX stub card in dashboard, greyed, labelled "available at B9."
- Quay fullness: glanceable storage bar on Harbourmaster login. Storage shown per-Quay + total across all 10.
- Tabletop gate: founder + 2–3 close contacts, 7-day soft launch observation window before public Sovereign access.

**Privacy threat model (locked S88):**
- Application layer: fully blinded — opaque tokens, UUID isolation (separate cargo UUID from upload credential UUID), no metadata stored.
- Payment layer: subscription decouples payment from cargo. Adversary watching node sees one payment per billing period per subscriber — not per file, not per Quay. Amount = tier, not file size. Strong property; state explicitly in whitepaper.
- Network layer: Mullvad multi-hop recommended for sender-side correlation mitigation.
- Payment graph: pseudonymous. Node-level observer sees payment arrived. Future work: BOLT12 blinded paths when node infrastructure supports (post-B9 §Future work).
- PTLCs: inherit automatically when phoenixd/LND supports them. No build session required. B9 whitepaper §Future work, one sentence.
- Submarine swaps: not the right primitive for Share payment layer. Flagged for Pass liquidation privacy post-B9.
- Payjoin v2: not a Share product feature. Relevant to liquidation sweep hygiene at NB-4 (Sparrow supports natively). Flag for Pass architecture.

**Privacy + security audit gates (locked S88):** Mid-block audit at SD4b. Final audit at SD7a before SD8 close. Both are named sessions, not optional.

| Session | Label | Scope |
|---------|-------|-------|
| SD1 | Lighthouse architecture | KV schema design. Opaque intake token → inbox key mapping. One token per Quay. Rotation model. Worker endpoints: `POST /inbox/create` · `GET /inbox/{token}` · `POST /inbox/{token}/upload`. Unit tests. |
| SD1a | Quay issuance | Create up to 10 Quays per Sovereign Lightning credential. Primary Quay flag. Default lifecycle rules (primary: long expiry, Execution Dock off; ad-hoc: 30-day, Execution Dock on). KV schema for Quay index per Harbourmaster. |
| SD1b | Opaque token + UUID isolation | Token entropy audit. Mapping layer: `quay_token_{opaque}` → `{ harbourmaster_id, quay_label, expiry, execution_dock, storage_used }`. Cargo UUID generated separately from upload credential UUID — never reuse across layers. No stable identifier visible to sender at any point. |
| SD2 | Sender upload flow | Sender hits Lighthouse URL. Worker validates token, checks Quay alive, issues one-time upload credential (NUT-00 BDHKE). Quota error deferred to upload attempt — `GET /inbox/{token}` returns consistent response shape regardless of quota state (no 402 at intake check, prevents storage side-channel). Standard encrypted chunk upload. Sender never learns recipient identity. |
| SD2a | Sender upload UI | Minimal send page — no account, no login. File picker, optional passphrase (NUT-11 Mode 1), upload. Cargo arrived event fires on completion. No sender-facing receipt. |
| SD2b | Cargo arrived event | AE datapoint: `quay_id` (opaque), `cargo_size`, `arrived_at`. No sender metadata stored. KV write: `cargo_{uuid}` → `{ quay_token, arrived_at, retrieved: false, expiry }`. UUID is Lighthouse-layer generated — not the upload credential UUID. |
| SD3 | Harbourmaster auth — Locke | NUT-11 Mode 2 P2PK Harbourmaster login. Worker issues nonce. Device signs with Locke private key. Pubkey verified against authorised set in KV. Session token (short TTL) issued on success. No email, no password, no TOTP on Lightning path. **Design constraint:** KV authorised pubkey set is a compulsion surface — state explicitly in Raven for Share and in whitepaper §threat model: "we hold the authorised pubkey list, which we could be compelled to modify; we cannot impersonate a Harbourmaster." |
| SD3a | Deed generation — Lightning path | At Sovereign Lightning onboarding: keypair generated client-side via `crypto.getRandomValues()` only (never Math.random — flag as do-not-retry). Mnemonic generated from same entropy source as keypair (not separately). 12-word BIP-39 displayed. "Write this down — this is your recovery sheet. If you lose your device, this is the only way back in." No copy button. Confirm checkbox before proceeding. One Deed covers Locke + all Quays (same keypair hierarchy). |
| SD3b | Deed generation — Stripe path | Stripe Sovereign users receive a recovery sheet at onboarding: offline backup keypair, independent of Stripe recovery path. Same display treatment. Parallel flow to SD3a. |
| SD3c | Deed recovery flow | User presents 12 words → keypair reconstructed client-side → new Locke bound → old Locke retired in KV authorised set. Smoke test: onboard → lose device → recover → Harbourmaster accessible → Quays intact. |
| SD4 | Harbourmaster dashboard I | Receipt ledger. Rows: Quay label · cargo arrived · cargo retrieved · expiry · storage used. Primary Quay visual anchor (weight, not badge). Glanceable Quay fullness on login: storage bar per-Quay + total across all 10. Storage reclaimed shown on Execution Dock close. |
| SD4a | Harbourmaster dashboard II | Quay management. Create / label / set expiry / toggle Execution Dock. Ad-hoc Quay defaults: 30-day + Execution Dock on. Primary Quay protected from casual deletion (confirm step). Execution Dock closes Quay, triggers R2 + KV cleanup, displays reclaimed storage. |
| SD4b | Harbourmaster dashboard III + mid-block audit | Paper/Carbon tokens. Both themes. IBM Plex Mono for receipt rows. No whisper text. Design sign-off. **Mid-block privacy + security audit: application layer, KV schema, UUID isolation, quota side-channel, pubkey compulsion surface. Fix any findings before SD5.** |
| SD5 | Notification architecture | Polling model documented. Business webhook: `cargo_arrived` + `cargo_retrieved` to registered endpoint (`rfs_whsec_` signed). SimpleX stub card in dashboard: greyed, "SimpleX notification — available at B9." |
| SD5a | Renewal warning banner | 7-day pre-expiry banner for Sovereign Lightning subscribers. SessionStorage-dismiss. Copy: "Your Sovereign access renews on [date]. Your Lighthouse remains active." |
| SD6 | Soft launch gate | No code. Friend-group access enabled (Hetzner live, Lightning rail open). 7-day observation window. Collect: delivery latency, Deed recovery smoke test, Quay lifecycle behaviour, KV edge cases. |
| SD6a | Soft launch findings | Review AE datapoints. Fix any P0/P1 findings. Document new do-not-retry entries. |
| SD7 | Journalist/source-protection copy | **Gated: SD shipped + blinded-relay reviewed + VPN scope stated (B9).** Placeholder — do not pull forward. |
| SD7a | Final audit | Full privacy + security audit before public launch. Payment-layer threat model review. Whitepaper §threat model draft. PTLC + Payjoin §Future work entries written. |
| SD8 | SD close | Snag sweep. TESTING.md additions (Locke auth, Quay lifecycle, Deed recovery, UUID isolation). Context trim pass. B9 brief written — include: payment-layer threat model, BOLT12 blinded paths §Future work, PTLC §Future work, Payjoin v2 ops note for NB-4 sweep. Public Sovereign Lightning access enabled. |

**Buffer pool (3 sessions):** SD1c · SD3d · SD4c

**SD-block do-not-retry (seed list — update after sessions):**
- DO NOT reuse upload credential UUID as cargo UUID — generate separately at Lighthouse layer
- DO NOT return 402 at `GET /inbox/{token}` intake check — defer quota errors to upload attempt
- DO NOT generate BIP-39 mnemonic from a separate entropy source to the keypair — same `crypto.getRandomValues()` call
- DO NOT use Math.random() anywhere in Deed generation — `crypto.getRandomValues()` only
- DO NOT use the word "anonymous" for Stripe-rail Silent Drop — it is private, not anonymous

---

## SW block session plan — white-label + API build (post-TG-block + TH-series, pre-B7)

**SW block moved before B7 in AP-10 resequence. No Hetzner required. Solicitor gate applies to opening Business tier sales, not to building SW code.**

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

## Locked block sequence (revised AP-10 · 3 Sep 2026)

`NB-1 → S89/S90 → snag sweeps → S88 → TG-block → TH-series → SW → B8 → [Hetzner commitment] → NB-2–NB-4 → B7 → SD-block → articles → B9 → B10+`

*(SYNC-1, RU-block, HQ-series complete. S88 complete. TG-block and TH-series are no-cost blocks before SW.)*

---

## Opus-2 · 29 Aug 2026 (uncounted)

B7 resequenced for LNbits/phoenixd. NB-series node bootstrap block created. S74–S76 rewritten for LNbits REST. Webhook model corrected (unsigned callback → authenticated GET re-verify). Phoenixd→LND trigger locked. Instance topology confirmed. SD-block placed post-HQ, pre-SW. SYNC-1 inserted. Blink cleanup checklist produced.

---

## S88 · 4 Sep 2026 — Silent Drop design (Opus, uncounted)

Full SD-block design session. All decisions locked — see SD-block section above. Key outcomes: opaque token architecture confirmed; Lightning-only necessity established; Deed (one keypair, one recovery sheet) covers Locke + Quays; payment-layer threat model analysed (subscription decouples payment from cargo — strong property); PTLCs and Payjoin v2 assessed (inherit/ops, not build sessions); submarine swaps ruled out for Share, flagged for Pass liquidation post-B9; mid-block and final audit gates written into plan.

*"Nothing stops this train."*
