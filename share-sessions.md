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
| 16 | 14 Jul | grouped | KV status system: `refueler-share-kv`, `GET /status`, `POST /admin/status`, maintenance banner |
| 17 | 14 Jul | grouped | `src/status.njk`: ops + crypto integrity sections, 60s auto-refresh |
| 18 | 14 Jul | grouped | AE dataset `share_events` (binding `AE`), `logEvent()` helper, `timed()` router wrapper |
| 19 | 14 Jul | grouped | `/admin/metrics`: MRR, subscribers_by_tier, paid_total, churn MTD. RLS deny-all. |
| 20 | 14 Jul | grouped | `double_spend_attempts` table, `credential_uniqueness_rate` metric |
| 21 | 14 Jul | grouped | `frontend/admin/dashboard.html` scaffold: password gate, live metric cards, 60s refresh |
| 22 | 15 Jul | `d1bcb5a`+`f36e385` | `GET /admin/ae-metrics`: AE SQL proxy, CF_AE_TOKEN scoped. CORS `X-Admin-Key` fix. |
| 23 | 15 Jul | `a4bc625` | AE SQL column syntax fix (`double1`/`blob1`). p95/p99 latency + error rate cards. |
| 24 | 15 Jul | `5be5811` | `GET /admin/snapshot`, System Summary dashboard section (6 metric tiles) |
| 25 | 15 Jul | `fc6cba9`+`99afaaa` | Free-to-paid conversion rate, dashboard restructure |
| 26 | 15 Jul | — | B2 close. 10/13 metrics live. Context files updated to v2.1. |

**Permanent do-not-retry (B1–B2):**
- blake3-wasm CDN (esm.sh/unpkg) — local bundle only
- Invisible Turnstile — visible managed widget only
- `secp.Point` — removed in noble v2, use `secp.ProjectivePoint`
- `binding = "R2"` in wrangler.toml — must be `BUCKET`
- BLAKE3 for passphrase hash — must be SHA-256
- AE SQL: use `double1`/`blob1` column names, not `doubles[N]`/`blob[N]` array syntax
- DO NOT await `env.AE.writeDataPoint()` — fire-and-forget
- DO NOT call AE SQL API from Worker — proxy via `/admin/ae-metrics` only
- DO NOT use KV counter for double-spend tracking — race condition; Supabase table only

---

## Sessions 27–29 — B3 Stripe test coverage

| # | Commit | Summary |
|---|--------|---------|
| 27 | `5f3cb8e` | Stripe CLI installed. Root cause of `client_secret` mismatch: `checkout/sessions ui_mode:embedded` incompatible with `stripe.elements()` |
| 28 | `5f3cb8e` | Direct Subscription creation confirmed. 4242 card flow ✓. Webhook handler extended. |
| 29 | `5d8c1ea` | `STRIPE_SECRET_KEY` rotated. Portal `resource_missing` confirmed correct. **B3 closed.** |

**B3 do-not-retry:**
- DO NOT use `checkout/sessions ui_mode:embedded` — use direct Subscription + `expand[0]=latest_invoice.payment_intent`
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
| S42a–S42e | various | `handleLogError` fix. Filename sanitisation. Per-UUID auth rate limit. UUID-bound credential issuance. Turnstile nonce binding. Full B4 audit. |
| S43–S52 | various | B5 design full pass. DESIGN-TOKENS.md applied. Modal build. QR SVG. Receiver landing page. Theme cookie. FSAA streaming download. B5 closed. |

---

## Sessions 53–72a — B6 Testing infrastructure + folder upload

| # | Commit | Summary |
|---|--------|---------|
| S53–S56 | `ca1260c` | Folder upload I–IV. fflate 0.8.2 streaming zip. `sanitisePath`. Smoke test ✓. |
| S57–S58 | `f94a158` | Bearer TTL fix. Token exp = `manifest.expiry`. |
| S60–S64 | `344e32d` | Unit tests I–V. Vitest 2 harness. BDHKE + blake3 + turnstile. Integration harness. 181 passing. |
| S65–S69 | `319225f` | Security regression suite. k6 load tests. All thresholds green. 212 passing / 8 suites. |
| S70–S72a | `319225f` | CI Level 1 green. Lightning admin toggle. Stripe webhook security tests. B6 closed. |

**B6 do-not-retry:**
- DO NOT use `fflate.zip()` (buffered) — OOM on large folders. `fflate.Zip` (streaming) only.
- DO NOT load fflate or qr-creator from cdnjs — self-hosted only
- DO NOT hardcode 900s TTL for download tokens — pass `manifest.expiry_timestamp`
- DO NOT call `client.putManifest()` in integration tests — manifest auto-written after final chunk
- DO NOT use `ProjectivePoint.subtract()` — noble v2. Use `.add(point.negate())`

---

## AP-series — Architectural planning sessions (uncounted, compact)

| # | Date | Summary |
|---|------|---------|
| AP-0–1 | 29 Jul | Ad-hoc strategy. Article pipeline locked. |
| AP-2–3a | 30 Jul | API architecture: HMAC, credential issuance, Stripe decoupling, webhook spec, SW block created. |
| AP-4–5 | 1 Aug | Security + crypto strategy (Argon2id, ML-KEM, BIP-85/FROST). Incident response docs. |
| AP-6–7 | 2 Aug | DashBeam competitive analysis. Two-axis framing locked. Article 1 hold cleared. |
| AP-8 | 4 Aug | Nav rewrite + `head.njk` theme script. `rs-theme` cookie. |
| AP-9–9a | 27–28 Aug | B7 re-sequence for LNbits/phoenixd. Lightning identity invariant added. |
| AP-10 | 3 Sep | Roadmap resequenced. TG/TH/SW/B8 require no Hetzner. BRIDGE v6.7. |

---

## Sessions 73–73a — B7 in progress

| # | Commit | Summary |
|---|--------|---------|
| S73 | `4c95cf6` | ~~Pre-B7 Blink checklist.~~ **SUPERSEDED — Blink dead. Replaced by NB-series + LNbits.** |
| S73a | `a19778c` | Dashboard: client errors modal fix. Both themes confirmed. |

---

## RU-block, SYNC-1, HQ-series (complete)

| Session | Commit | Summary |
|---------|--------|---------|
| RU0 | `4b223b1` | Streaming zip — `fflate.Zip` replaces buffered `fflate.zip()`. 1.72 GB smoke test ✓. |
| RU1 | `48ed213` | IDB schema live. `writeChunkState()` / `readResumeState()` / `clearResumeState()`. Resume card HTML. |
| RU1a | `f05583f` | `resumeUpload()` wired. AES key/IV from IDB. Re-credential path. 36/36 tests. |
| RU2–RU2e | `1e33ebe` | Resume card sync. Turnstile-free resume path. WiFi-kill → resume ✓. 409 handling. **RU-block closed.** |
| SYNC-1 | `2d26587` | `bin/sync-share.sh` committed. Embedded git repos gitignored. |
| HQ1–HQ2 | `9cd2241` | HTTP/3 AE logging. BLAKE3 + HTTP/3 trust band. Plans + Status in nav. |

**Do-not-retry (RU/SYNC):**
- DO NOT use `fflate.zip()` — `fflate.Zip` streaming only
- DO NOT require Turnstile on resume credential path — `resume: true` + `resume_uuid` + R2 HEAD check
- DO NOT treat HTTP 409 on resume chunk PUT as generic 4xx — transfer already complete
- DO NOT edit files in `refueler.io/src/share/assets/` directly — GENERATED; edit in `refueler-share/frontend/` then sync

---

## TG-block — Traitor's Gate (complete · 5 Sep 2026)

| Session | Commit | Summary |
|---------|--------|---------|
| TG-1 | — | Design + manifest spec locked. |
| TG-2 | `1c673b1` | Worker implementation. `manifest_tg.js`. 36 unit tests. 355 passing. Deployed `aaa8f521`. |
| TG-3 | `b3b3226` | Frontend upload side: destroy toggle, tidal datetime pickers. |
| TG-3a | `b3b3226` | Frontend download side: pre-download amber modal, post-download confirm gate, tidal countdown. |
| TG-4 | `9258050` | Execution Dock dashboard card. `handleOwnerDelete`. `dock_index` KV write. |
| TG-5 | `0e51385`+`18d2157` | Tests + smoke. 432 passing. **TG-block closed.** |

**TG do-not-retry:**
- DO NOT auto-delete R2 on final chunk served — set `pending_destruction: true`, wait for frontend confirmation
- DO NOT use the word "Traitor" in any UI copy, tooltip, or aria-label
- DO NOT compute `X-P2SH-Secret-Hash` with plain BLAKE3 in tests — use `hashSecret()` from `nut11.js`
- `pending_destruction` flip not reliably observable in local wrangler — test via unit tests only

---

## TH-series — Tower Hill / Permanent Record (complete · 6 Sep 2026)

| Session | Commit | Summary |
|---------|--------|---------|
| TH-Opus-1 | — | Tower Hill / Permanent Record scoped. |
| TH-Opus-2 | — | Legend price locked (£50/mo). Cross-product entitlement. BRIDGE v8.0. |
| TH-Opus-3a | — | Committed-value stress-test. Option B locked (SHA-256(blake3_root ‖ seal_nonce)). |
| TH-1 | `a71f12fe` | Worker OTS relay. `POST /timestamp/submit`. `date-seal.ots.enc` on all deletion paths. |
| TH-2 | `53e3c7fb` | Permanent-record toggle UI. `seal_nonce`. `blake3PlaintextRoot`. Download OTS offer. |
| Share-JS-Refactor | `45a4d3b3` | 5-module split (share/crypto/upload/download/timestamp.js). 324 tests passing. |

---

## NB-series — node bootstrap (pre-B7, gates all B7 code)

| Session | Label | Scope |
|---------|-------|-------|
| NB-1 | Node runbook (Opus, no code) | OS hardening → phoenixd + seed backup → LNbits → cloudflared → Tor .onion → backup + monitoring. |
| NB-2 | Provision + execute | Provision Instance A (CAX21). Follow runbook. Verify phoenixd → bech32 on-chain send. **First Hetzner cost.** |
| NB-3 | End-to-end test | LNbits invoice → pay → callback → GET re-verify → splice-out liquidation. |
| NB-4 | Node live | Set Worker secrets `LNBITS_URL` + `LNBITS_API_KEY`. Declare node live. B7 unlocks. Article pipeline unlocks. |

---

## S88 · 4 Sep 2026 — Silent Drop design (Opus, uncounted)

Full SD-block design. Opaque token architecture confirmed. Lightning-only necessity established. Deed (one keypair) covers Locke + all Quays. Subscription decouples payment from cargo. PTLCs and Payjoin v2 assessed. Submarine swaps ruled out for Share.

---

## S89–S90 — Tier rename

| # | Commit | Summary |
|---|--------|---------|
| S89 | `1a0ac93` | Tier rename: Free → Citizen · Creative Premium retired · Production Max → Sovereign. |
| S90 | — | Stripe product/price alignment. Old price objects archived. |

---

## Opus sessions — compact log (pre-SW block)

| Session | Date | Summary |
|---------|------|---------|
| Opus-2 | 29 Aug | B7 resequenced for LNbits/phoenixd. NB-series created. Blink cleanup. BRIDGE. |
| SW-Opus-1 | 7 Sep | Three-tier model. Rail model. Model B. API v1 features. MCP v1 tools. Sandbox. BRIDGE v8.3. |
| SW-Opus-2 | 7 Sep | Rate card v1.0. Credit blocks. £99/mo identity-API. Sovereign Teams. GTM reframe. BRIDGE v8.4. |
| SW-Opus-3 | 7 Sep | DPA mandatory. AM role. Four-surface disclosure. GDPR framing. BRIDGE v8.5. |
| SW4-Opus | 8 Sep | Webhook signing: Option B (stateless HMAC). `whsec_hash` removed. Dead-letter schema. BRIDGE v8.8. |

---

## SW block — complete ✓ (11 Sep 2026)

| Block | Commit | Summary |
|-------|--------|---------|
| SW1–SW9 | `8b4b4a1` | CF for SaaS · HMAC auth · credential issuance · badge · webhooks · receipts · dashboard · sandbox · hostname health · snag sweep · utils.js extraction. 484 tests passing (467 integration). |

**SW block do-not-retry:**
- DO NOT store `whsec_hash` in `wh_config_` KV — Option B derives, never stores
- DO NOT derive `rfs_whsec_` without `created_at` in HMAC message — required rotation salt
- DO NOT re-sign dead-letter retries with original `t` — fresh current timestamp at every retry
- DO NOT call `deliverWebhook` (ctx.waitUntil) from inside an existing waitUntil block — use `deliverWebhookInline`
- SIGN_DOMAIN_TAG is `refueler.webhook.v1.sign` — never revert to `refueler.webhook.v1`
- DO NOT re-emit `cargo.discharged` on re-download — `receipt_discharged_guard:{uuid}` KV once-flag is permanent
- DO NOT add BLAKE3 root to any receipt field — Merkle verification blocked until B9
- DO NOT use Ed25519 or a published Worker key for receipts — symmetric HMAC only, load-bearing for anonymous rail
- `api_live_key` / `api_accepted_at` / `api_transfer_ref` stored in manifest for API-tier only — never consumer tier
- DO NOT strip `rfs_sign_` prefix before importing as HMAC key — Worker uses full string via TextEncoder
- `btoa()` in Workers runtime is Latin-1 only — use TextEncoder → binary string → `btoa` for non-ASCII
- DO NOT use `workers.dev` URL for smoke tests — use `api.share.refueler.io`

**Buffer pool:** SW2c · SW5c — **both retired** (no carry-forward work documented against either).

**SW9a carry-forward:**
- Phases 2–3 of `index.js` split: `handlers/stripe_sub.js` + `handlers/timestamp.js` + `handlers/delete_transfer.js`
- `webhook_reg.test.js` handler integration tests (17 failures — pre-existing test file bug, not a source regression)
- `LIGHTNING_BACKEND` env var in `wrangler.toml` → `"lnbits"`
- `lightning_available` string vs boolean cosmetic fix in status response
- HMAC auth boundary + quota 402 + webhook delivery + sandbox integration tests

---

## B8 — NUT-11 Mode 2 (next after SW-MCP)

B8 implements NUT-11 Mode 2: keypair-based Cashu credential authentication to replace the shared-secret passphrase model. This is pure cryptography on the existing Worker — no Hetzner required.

B8 gates the Silent Drop block (SD-block requires full Locke — Mode 2 — no temp auth builds permitted). It also unlocks the `journalist/source-protection` copy and removes the "keypair auth cannot be bypassed via Mode 1" blocked claim from the whitepaper.

**First B8 session must load:** `CLAUDE.md` + `Share-Master-Context.md` + `share-sessions.md` + `TESTING.md` (for the `keypair.js` fixture spec and whitepaper row requirements). The `refueler-ecash-lab` repo decision (separate experiment repo vs. production Worker) must be made at the B8-Opus planning session before any code is written.

---

## SW-MCP-Opus-2 · 10 Sep 2026 (uncounted, planning)

MCP spec v2 produced (`refueler-mcp-spec-v2.md` — replaces v1). All open decisions O-6…O-11 locked; D-1 (filename) and O-2 (Teams × MCP) resolved. Key outcomes:

- **Capabilities endpoint (O-6):** locked shape in spec §7.1. `credit_unit: "sat"`, `rails_available` = live state, `daily_reference_rate` block (floating, from KV), `rate_card` in integer credits, `limits` corrected to decimal GB. `schema_version: "cap.v1"`.
- **Daily reference rate (O-8):** KV key `btc_ref_rate:current`, no TTL, staleness derived. Tier 1: manual + 3am CoinGecko + ±20% guard. Tier 2 (post-B7): 15-min node feed. Failure: serve last-good marked stale; never invent a rate; null `daily_reference_rate` block on cold start.
- **Monthly allocation + reset (O-9):** lazy reset on next `credential/issue`. Identity-API 50k credits/mo + metered overage to ceiling → 402 `overage_ceiling`. Personal API 10k/mo hard stop → 402 `quota_exhausted`. Cancellation: cancel-at-period-end (default) or immediate zero (admin). Transfers persist to own `expiry_timestamp` regardless.
- **Personal Sovereign API (O-7):** £49/mo, 10,000 credits/mo, hard stop, no webhook, no AM, DPA on request. KV plan value `personal_api`. Unlisted.
- **D-1 filename fix (O-10):** Option B locked. `X-File-Name: "encrypted-payload"` constant placeholder to Worker. Real filename in URL fragment inside versioned base64url-JSON blob `{v,k,n,s}`. Applies to MCP send tool AND consumer upload/download in the same session (SW-MCP-4). Legacy fragment fallback during 90-day expiry window; remove after.
- **Teams × MCP (O-2):** Sovereign Teams UI-only confirmed. Firms wanting MCP take a separate API credential relationship; their MCP server distributes internally. Refueler sees one key, one pool.
- **Distribution (O-3):** npm package, Apache 2.0. Operator installs in own infrastructure, config via `.env`. No Anthropic marketplace.
- **Anonymous balance copy (O-4):** `kind: "local_credits"`, `server_blind: true`. User copy: "You hold ~N credits locally — the server can't see this balance."
- **Agent passphrase protocol (O-5):** sending agent computes `hashSecret()` locally, transmits hash only on a channel separate from `share_url`. Parity check: verify `hashSecret()` construction in `nut11.js` at SW-MCP-2 — do not assume bare SHA-256.
- **Terminology (O-11):** "credits" in all user-facing output; precise terms (sats, ecash, Cashu, BDHKE) in implementation notes only. `_credits` suffix on all monetary output fields.
- **Build sequence:** `SW9 → SW-MCP-W1 → SW-MCP-W2 → SW-MCP-1…8 → B8 → NB-2/NB-4 → B7 → SD-block`.
- `refueler-mcp-spec-v1.md` deleted (superseded). `refueler-mcp-spec-v2.md` committed to repo root.

---

## SW-MCP block session plan

| Session | Scope | Gate |
|---------|-------|------|
| **SW-MCP-W1** | Worker: `GET /api/v1/capabilities` locked shape; `btc_ref_rate:current` KV; Tier-1 manual override + 3am CoinGecko cron + ±20% guard; admin rate panel. | SW9 deployed |
| **SW-MCP-W2** | Worker: monthly allocation + lazy reset; identity-API overage ceiling; Personal-API hard stop; `personal_api` plan value in KV. | SW-MCP-W1 |
| **SW-MCP-1** | MCP server scaffold in agent trust domain; transport + config; local key/credit storage; `refueler_capabilities` wired. | SW-MCP-W1 |
| **SW-MCP-2** | Local crypto module: chunk → AES-GCM → BLAKE3 → blinded; fragment grammar v1 helper; `hashSecret()` parity check; unit tests. | SW-MCP-1 |
| **SW-MCP-3** | `refueler_quote` + `refueler_balance`; rate-card cache + degrade; credits vocabulary. | SW-MCP-2 |
| **SW-MCP-4** | `refueler_send_file` E2E; D-1 filename fix for MCP AND consumer frontend (both in this session); full error matrix incl. `overage_ceiling`. | SW-MCP-2 (overage: W2) |
| **SW-MCP-5** | `refueler_check_transfer`; state derivation; optional single re-check. | SW-MCP-4 |
| **SW-MCP-6** | Demo hardening: scripted happy path, failure-mode rehearsal, on-stage honesty script. | SW-MCP-5 |
| **SW-MCP-7** | Anonymous-rail send through the MCP (credit-block spend). | **B7 / NB-4** |
| **SW-MCP-8** | npm package distribution, Apache 2.0; trust-boundary README; no Anthropic marketplace. | SW-MCP-5 |

---

## SD-block — Silent Drop (post-B8, post-NB-4)

**S88 complete · 4 Sep 2026.** All design decisions locked. Full Locke (NUT-11 Mode 2) required — no temp auth builds.

**Prerequisites:** B8 complete. NB-4 (node live). 7-day friend-group soft launch gates public Sovereign access.

| Session | Label | Scope |
|---------|-------|-------|
| SD1–SD1b | Lighthouse architecture | KV schema. Opaque token → inbox key. Worker endpoints. UUID isolation. |
| SD2–SD2b | Sender upload flow | Worker validates token, one-time credential, cargo arrived AE event. |
| SD3–SD3c | Harbourmaster auth + Deed | NUT-11 Mode 2 login. Keypair + BIP-39 mnemonic. Recovery flow. |
| SD4–SD4b | Harbourmaster dashboard I–III + mid-block audit | Receipt ledger. Quay management. **Mid-block privacy + security audit at SD4b.** |
| SD5–SD5a | Notification + renewal | Polling + Business webhook. SimpleX stub card (B9). Renewal banner. |
| SD6–SD6a | Soft launch + findings | 7-day friend-group observation. P0/P1 fixes. |
| SD7–SD7a | Source-protection copy + final audit | Gated: SD shipped + VPN scope stated. Full privacy + security audit. |
| SD8 | SD close | Snag sweep. Context trim. B9 brief. Public Sovereign Lightning access enabled. |

**SD do-not-retry:**
- DO NOT reuse upload credential UUID as cargo UUID — generate separately at Lighthouse layer
- DO NOT return 402 at `GET /inbox/{token}` — defer quota errors to upload attempt
- DO NOT use Math.random() in Deed generation — `crypto.getRandomValues()` only
- DO NOT use "anonymous" for Stripe-rail Silent Drop — it is private, not anonymous

**Buffer pool (3 sessions):** SD1c · SD3d · SD4c

---

## B7 session plan — Lightning/LNbits + anonymous paid tier

**All B7 sessions from S74 gate on NB-4 (node live).**

| Session | Label | Scope |
|---------|-------|-------|
| S74–S74c | Lightning adapter + Invoice creation I–III | `worker/src/lightning.js`. `POST /subscription/lightning`. LNbits BOLT11. KV 25h TTL. |
| S75–S75c | Webhook endpoint I–IV | `POST /webhook/lightning`. KV lookup. Re-verify GET. Settled-flag dedup. Integration test. |
| S76–S76d | Credential issuance I–V | NUT-00 BDHKE on settlement. KV 10-min TTL. Poll endpoint. Tier cap. Unit tests. |
| S77–S77b | Upgrade page rail split I–III | Two-rail structure. Lightning + Stripe cards. Visual parity. |
| S78–S79a | Frontend Lightning flow I–VI | QR. BOLT11 copy. Countdown. Live GBP/credits rate. Credential poll. Error states. |
| S80–S80b | Payment privacy table I–III | JSON data. Eleventy partial. Collapsible on upgrade page. |
| S81–S81b | Dashboard Lightning cards I–III | AE datapoint at settlement. Stub cards. Design pass. Unit tests. |
| S82–S82a | KV Lightning admin toggle | `lightning_available` flag. Dashboard toggle. Graceful degradation. |
| S83–S83b | Renewal banner + paid tier activation | 7-day pre-expiry banner. Both rails confirmed live. |
| S84–S84d | B7 security audit I–V | Invoice expiry. KV races. Credential farming. Webhook replay. Double-issuance. |
| S85–S87 | LNbits ops verification + LNURL-withdraw + LNbits skinning | Post-node sanity. Gift architecture design. Paper/Carbon decisions. |
| S91–S92 | CI Level 2 + Article 6 prep | Integration suite in GitHub Actions. "Paying anonymously for file transfer" structure. |
| S93–S95 | B7 snag sweeps I–III | Theme toggle in modals. `receiver_ab` AE routing fix. Manifest-field minimalism. |
| S96 | Context file maintenance | `Share-Master-Context.md` split → working memory (≤350L) + `Share-Archive.md`. |
| S100 | B7 close | Final snag sweep. Context files at target. B8 brief. |

**Buffer pool (5 sessions):** S74d · S76e · S84e · S85b · S100a

**B7 open snags (resolve at S93–S95):**
- Theme toggle absent from modals
- `receiver_ab_shown` / `receiver_ab_downloaded` events routed to `/log/error` instead of AE

---

## Locked block sequence (updated Share-MCP-Opus-2 · 10 Sep 2026)

`SW9 → SW-MCP → B8 → [Hetzner commitment] → NB-2–NB-4 → B7 → SD-block → articles → B9 → B10+`

*(SW-MCP anonymous-rail tail (SW-MCP-7) waits for B7/NB-4 — does not block B8.)*

*"Nothing stops this train."*
