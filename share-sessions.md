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
| AP-9 | 27 Aug | B7 re-sequence. Lightning infra added. Silent Drop confirmed Sovereign only. B7 budget 25→50. |
| AP-9a | 28 Aug | Lightning identity invariant added. Journalist/source-protection hero copy gating rule added. |
| AP-10 | 3 Sep | Roadmap resequenced. TG-block, TH-series, SW, B8 require no Hetzner. Traitor's Gate internal vocab locked. Tower Hill / OpenTimestamps: 2–3 Opus scoping sessions. Execution Dock: 48h Three Tides grace. Dragon status vocabulary locked. BRIDGE v6.7, Master-Context v7.0. |

---

## Sessions 73–73a — B7 in progress

| # | Commit | Summary |
|---|--------|---------|
| S73 | `4c95cf6` | ~~Pre-B7 Blink checklist.~~ **SUPERSEDED Opus-2 — Blink dead. Replaced by NB-series + LNbits.** |
| S73a | `a19778c` | Dashboard: client errors modal fix. Strip `.modal-sparkline-stub` on open; hide static section titles + CSV btn; restore on close. Both themes confirmed. |

---

## AD-1 — Admin dashboard migration

Share admin dashboard frontend migrated to `refueler-io` at `src/share/admin/`. Theme fixed to rs-theme cookie / dataset.theme. Worker endpoints unchanged.

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
| RU1 ✓ | `ae78b81`→`48ed213` | IndexedDB schema live — `idbOpen()`, `writeChunkState()` (every 200 ACK), `readResumeState()`, `clearResumeState()`. `checkResumeState()` on page load with 8-day stale guard. Resume card HTML in `index.njk`. Discard wired. |

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
| TG-1 | Design + manifest spec | Manifest fields: `pending_destruction`, `consumed`, `available_from_timestamp`, `available_until_timestamp`. Tier gate, status matrix, deletion sequence all locked. Pre-code confirmation. |
| TG-2 ✓ | Worker implementation | `DELETE /transfer/{uuid}`. `consumed`/tidal checks on `GET /download` + `POST /auth`. Tidal headers on chunk-0 upload. `manifest_tg.js` (5 pure fns). `destroy.test.js` (36 unit). Security integration tests (8 TG rows). **355 passing.** Commit `1c673b1`. Deployed `aaa8f521`. |
| TG-3 ✓ | Frontend — upload side | Destroy after download toggle UI. Post-upload amber notice to sender. Tidal window datetime pickers (paid tier only). Commit `b3b3226`. |
| TG-3a ✓ | Frontend — download side | Pre-download amber modal. Post-download confirm gate → [I've saved it] → `DELETE /transfer/{uuid}` (passphrase) or `POST /confirm/{uuid}` (open). Tidal countdown. Commit `b3b3226`. |
| TG-4 ✓ | Execution Dock — dashboard | `handleExecutionDock` + `GET /admin/execution-dock`. `dock_index` KV write on chunk-0. `handleOwnerDelete` replacing 501 stub. Execution Dock KPI card in System Summary (amber count from `badge_count`). Commit `9258050`. |
| TG-5 ✓ | Tests + smoke | `tg-round-trip.test.js` (16 integration tests). `supabase-mock.js` + `/_test/seed-subscriber` HTTP endpoint. `client.js` TG methods. `tg-smoke.sh` 10/10 production smoke. TESTING.md v0.7. **432 passing.** Commit `0e51385`. |

**TG-block do-not-retry:**
- DO NOT auto-delete R2 on final chunk served — set `pending_destruction: true`, wait for frontend confirmation
- DO NOT use the word "Traitor" in any UI copy, tooltip, or aria-label
- DO NOT compute `X-P2SH-Secret-Hash` with plain BLAKE3 in tests — use `hashSecret()` from `nut11.js`
- Owner-scoped DELETE (TG-4) ✓ shipped — `handleOwnerDelete` live at commit `9258050`
- `pending_destruction` flip is fire-and-forget unhandled promise — not reliably observable in local wrangler. Test via unit tests (`destroy.test.js`, `confirm_tg.test.js`), not integration. Production behaviour verified via smoke.
- `available_from` must be >= `created_at` (Worker processing time) — use `nowSeconds() + 1` minimum in tests, never `nowSeconds() - N`
- Supabase mock `seedSubscriber()` is only callable within the same process — use HTTP `POST /_test/seed-subscriber` from test files (globalSetup runs in a separate process)

---

## TH-series — Tower Hill / Permanent Record (no Hetzner required)

**All design locks in Share-Master-Context.md §TH-series.**
**OTS wariness on record. TH-0 spike gates TH-1 build commitment.**

| Session | Label | Scope |
|---------|-------|-------|
| TH-Opus-1 ✓ | Share scoping | OTS mechanics. Proof format. Tier placement. Framing copy. Sovereign cap 250→100 GB locked. Legend entitlement model locked. Permanent record / date seal names locked. |
| TH-Opus-2 | Pass + Legend scoping | Legend price setting. Cross-product entitlement architecture. Pass: credential issuance timestamps. Legend: native verifier design. 1–2 sessions. |
| TH-Opus-3 | Build spec | Session plan. Relay endpoint design. Deletion-path integration with TG-block. TH-0 spike defined. TH-1/TH-2 split confirmed. |
| TH-0 | Bundle spike | `javascript-opentimestamps` in-browser. Bundle size. Calendar endpoint paths. Go/no-go for TH-1. |
| TH-1 | Share build | `POST /timestamp/submit` + `GET /timestamp/upgrade` relay. `date-seal.ots.enc` R2 write. Manifest fields. Deletion path integration. |
| TH-2 | Frontend + tests | Opt-in toggle (Sovereign only). Proof in download bundle. Lazy upgrade on recipient download. Unit + integration tests. |

---

## S88 · 4 Sep 2026 — Silent Drop design (Opus, uncounted)

Full SD-block design session. All decisions locked. Key outcomes: opaque token architecture confirmed; Lightning-only necessity established; Deed (one keypair, one recovery sheet) covers Locke + all Quays; payment-layer threat model analysed (subscription decouples payment from cargo — strong property); PTLCs and Payjoin v2 assessed (inherit/ops, not build sessions); submarine swaps ruled out for Share, flagged for Pass liquidation post-B9; mid-block and final audit gates written into plan.

---

## S89–S90 — Tier rename (Sep 2026)

| # | Commit | Summary |
|---|--------|---------|
| S89 | `1a0ac93` | Tier rename locked: Free → Citizen · Creative Premium retired · Production Max → Sovereign (two rails: Stripe + Lightning). Crown = brand/institutional only. |
| S90 | — | Stripe product/price alignment with locked tier model. Archived old price objects. |

---

## SD-block — Silent Drop (post-B8, post-NB-4)

**S88 complete · 4 Sep 2026.** All design decisions locked. Full Locke (NUT-11 Mode 2) in place — SD ships after B8, no temp auth builds.

**Prerequisites:** B8 complete (Locke live). NB-4 (node live). Friend-group soft launch (7-day) gates public Sovereign access.

**Locked design decisions (S88):**
- Opaque intake token → KV inbox key. No stable identifier visible at any layer.
- Lightning rail only. Stripe rail = private (not anonymous) — different product.
- Lighthouse + up to 10 Sovereign Quays at launch. Primary Quay anchored visually. Ad-hoc Quays 2–10 default to 30-day expiry + Execution Dock on.
- One Deed per Harbourmaster. One keypair covers Locke + all Quays. 12-word BIP-39. No copy button. Confirmed by checkbox.
- Stripe Sovereign users get a recovery sheet too — offline backup independent of Stripe recovery.
- Notification at SD launch: polling + Business webhook. SimpleX stub card greyed "available at B9."
- Tabletop gate: 7-day soft launch before public Sovereign access.

**Privacy threat model (locked S88):**
- Application layer: fully blinded — opaque tokens, UUID isolation, no metadata.
- Payment layer: subscription decouples payment from cargo. Amount = tier, not file size. State in whitepaper.
- Network layer: Mullvad multi-hop recommended for sender-side correlation.
- Payment graph: pseudonymous. BOLT12 blinded paths = B9 §Future work.
- PTLCs: inherit when phoenixd/LND supports. B9 whitepaper §Future work, one sentence.
- Payjoin v2: liquidation sweep hygiene, not a product feature. NB-4 ops note.
- Submarine swaps: not applicable to Share. Flagged for Pass liquidation post-B9.

**Privacy + security audit gates:** Mid-block at SD4b. Final at SD7a. Both mandatory before SD8 close.

| Session | Label | Scope |
|---------|-------|-------|
| SD1 | Lighthouse architecture | KV schema. Opaque token → inbox key. Worker endpoints: `POST /inbox/create` · `GET /inbox/{token}` · `POST /inbox/{token}/upload`. Unit tests. |
| SD1a | Quay issuance | Up to 10 Quays per Sovereign Lightning credential. Primary Quay flag. Default lifecycle rules. KV Quay index per Harbourmaster. |
| SD1b | Opaque token + UUID isolation | Token entropy audit. Mapping layer. Cargo UUID generated separately from upload credential UUID. |
| SD2 | Sender upload flow | Worker validates token, issues one-time upload credential. Quota error deferred to upload attempt. Sender never learns recipient identity. |
| SD2a | Sender upload UI | Minimal send page. File picker, optional passphrase. No sender-facing receipt. |
| SD2b | Cargo arrived event | AE datapoint: `quay_id` (opaque), `cargo_size`, `arrived_at`. KV write: `cargo_{uuid}`. |
| SD3 | Harbourmaster auth — Locke | NUT-11 Mode 2 P2PK login. Session token issued on success. No email, no password. |
| SD3a | Deed generation — Lightning path | Keypair + BIP-39 mnemonic from `crypto.getRandomValues()`. Display only — no copy button. |
| SD3b | Deed generation — Stripe path | Recovery sheet at Stripe Sovereign onboarding. Parallel flow to SD3a. |
| SD3c | Deed recovery flow | 12 words → keypair reconstructed client-side → new Locke bound → old Locke retired. |
| SD4 | Harbourmaster dashboard I | Receipt ledger. Storage bar per-Quay + total. |
| SD4a | Harbourmaster dashboard II | Quay management. Create / label / set expiry / toggle Execution Dock. |
| SD4b | Harbourmaster dashboard III + mid-block audit | Paper/Carbon tokens. Both themes. **Mid-block privacy + security audit.** |
| SD5 | Notification architecture | Polling model. Business webhook: `cargo_arrived` + `cargo_retrieved`. SimpleX stub card. |
| SD5a | Renewal warning banner | 7-day pre-expiry banner. SessionStorage-dismiss. |
| SD6 | Soft launch gate | No code. 7-day friend-group observation window. |
| SD6a | Soft launch findings | AE review. Fix any P0/P1 findings. |
| SD7 | Journalist/source-protection copy | **Gated: SD shipped + blinded-relay reviewed + VPN scope stated.** |
| SD7a | Final audit | Full privacy + security audit. Payment-layer threat model review. Whitepaper §threat model draft. |
| SD8 | SD close | Snag sweep. TESTING.md additions. Context trim. B9 brief. Public Sovereign Lightning access enabled. |

**Buffer pool (3 sessions):** SD1c · SD3d · SD4c

**SD-block do-not-retry (seed list):**
- DO NOT reuse upload credential UUID as cargo UUID — generate separately at Lighthouse layer
- DO NOT return 402 at `GET /inbox/{token}` intake check — defer quota errors to upload attempt
- DO NOT generate BIP-39 mnemonic from a separate entropy source to the keypair — same `crypto.getRandomValues()` call
- DO NOT use Math.random() anywhere in Deed generation — `crypto.getRandomValues()` only
- DO NOT use the word "anonymous" for Stripe-rail Silent Drop — it is private, not anonymous

---

## SW block session plan — white-label + API build (post-TG-block + TH-series, pre-B7)

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
| SW9 | SW close | Snag sweep. TESTING.md additions. Context trim. B8 brief. Buffer review. |

**Buffer pool (2 sessions):** SW2c · SW5b

---

## B7 session plan — Lightning/LNbits + anonymous paid tier

**All B7 sessions from S74 onwards gate on NB-4 (node live).**

| Session | Label | Scope |
|---------|-------|-------|
| S74 | Lightning adapter | `worker/src/lightning.js` — `createInvoice()` / `getInvoiceStatus()` over LNbits REST. Unit tests. |
| S74a–S74c | Invoice creation I–III | `POST /subscription/lightning`. LNbits BOLT11. KV write 25h TTL. Unit tests. Smoke test. |
| S75–S75c | Webhook endpoint I–IV | `POST /webhook/lightning`. KV lookup. Re-verify via authenticated GET. Settled-flag dedup. Integration test. |
| S76–S76d | Credential issuance I–V | NUT-00 BDHKE on settlement. KV 10-min TTL. Poll endpoint. Tier-cap enforcement. Unit tests. |
| S77–S77b | Upgrade page rail split I–III | Two-rail structure. Lightning + Stripe cards visible. Visual parity. |
| S78–S79a | Frontend Lightning flow I–VI | QR. BOLT11 copy. Countdown. Live GBP/sats rate. Credential poll. Receipt → browser memory. Error states. Smoke test. |
| S80–S80b | Payment privacy table I–III | JSON data. Eleventy partial. Collapsible on upgrade page. |
| S81–S81b | Dashboard Lightning cards I–III | AE datapoint at settlement. Stub cards. Design pass. Unit tests. |
| S82–S82a | KV Lightning admin toggle | `lightning_available` flag. Dashboard toggle. Graceful degradation. |
| S83–S83b | Renewal banner + paid tier activation | 7-day pre-expiry banner. Stripe smoke. Lightning smoke. Both rails confirmed live. |
| S84–S84d | B7 security audit I–V | Invoice expiry. KV races. Credential farming. Webhook replay. Double-issuance. Findings + claim rulings. |
| S85 | LNbits ops verification | Post-node-live sanity: wallet API keys, cloudflared, Tor onions. |
| S86 | LNURL-withdraw gift architecture | Design document only. No code. |
| S87 | LNbits skinning scope | Keep/strip/brand decisions. Paper/Carbon token mapping. No code. |
| S91–S91a | CI Level 2 I–II | Integration suite in GitHub Actions. Lightning mock. All passing in CI. |
| S92 | Notes article 6 prep | "Paying anonymously for file transfer" — structure + copy. No code. Unlocks after node live. |
| S93–S95 | B7 snag sweeps I–III | Theme toggle in modals. `receiver_ab` AE routing fix. Manifest-field minimalism. UUID/fragment entropy pre-audit. |
| S96 | Context file maintenance | `Share-Master-Context.md` split → working memory (≤350L) + `Share-Archive.md`. |
| S100 | B7 close | Final snag sweep. Context files at target. B8 brief. SW block brief confirmed. |

**Buffer pool (5 sessions):** S74d · S76e · S84e · S85b · S100a

**B7 open snags (resolve at S93–S95):**
- Theme toggle absent from modals
- `receiver_ab_shown` / `receiver_ab_downloaded` events routed to `/log/error` instead of AE

---

## Locked block sequence (revised AP-10 · 3 Sep 2026)

`NB-1 → S89/S90 → snag sweeps → S88 → TG-block → TH-series → SW → B8 → [Hetzner commitment] → NB-2–NB-4 → B7 → SD-block → articles → B9 → B10+`

(SYNC-1, RU-block, HQ-series, S88, S89/S90 complete. TG-2 ✓ TG-3 ✓ TG-3a ✓ TG-4 ✓. Next: TG-5 — tests + smoke.)*

---

## Opus-2 · 29 Aug 2026 (uncounted)

B7 resequenced for LNbits/phoenixd. NB-series node bootstrap block created. S74–S76 rewritten for LNbits REST. Webhook model corrected (unsigned callback → authenticated GET re-verify). Phoenixd→LND trigger locked. Instance topology confirmed. SD-block placed post-HQ, pre-SW. SYNC-1 inserted. Blink cleanup checklist produced.

## TH-Opus-3a · Sep 2026 (uncounted, design)

Committed-value stress-test. Locked Option B: commitment = SHA-256(blake3_root ‖ seal_nonce).
Dedicated 16-byte fragment seal_nonce chosen over reused AES-GCM IV (entanglement risk).
blake3_root re-derived by Legend (never shipped). Hashlock: x = commitment, H = SHA-256(x);
two-phase `after` (real anchor height, no estimation). Upgrade path moves to Legend — amends
TH-Opus-1, drops GET /timestamp/upgrade from Share Worker. No TH-Opus-3b. TH-1 = 3
confirmations (fragment wiring, calendar egress, .ots byte layout).

*"Nothing stops this train."*
