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
| 29 | `5d8c1ea` | `STRIPE_WEBHOOK_SECRET` rotated. Portal `resource_missing` confirmed correct. **B3 closed.** |

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
- ~~DO NOT require Turnstile on resume credential path — `resume: true` + `resume_uuid` + R2 HEAD check~~ **SUPERSEDED (Cred-Fix-1)** — resume-issue path removed; `resume:true` → 400
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
- ~~DO NOT auto-delete R2 on final chunk served — set `pending_destruction: true`, wait for frontend confirmation~~ **SUPERSEDED (B11-1 / DAD-2)** — deletion starts when the last chunk is served, by design
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

## Opus sessions — compact log (pre-SW block)

| Session | Date | Summary |
|---------|------|---------| 
| S88 | 4 Sep | Silent Drop design locked. Opaque token, Deed, Quay architecture. |
| S89–S90 | — | Tier rename (Free→Citizen, Max→Sovereign). Stripe alignment. |

---

## SW block (complete · 11 Sep 2026)

| Session | Commit | Summary |
|---------|--------|---------| 
| SW1 | `59b8c52` | CF for SaaS. Custom hostname `api.share.refueler.io`. Fallback origin. |
| SW2–SW2c | `3c7e499` | HMAC auth (`rfs_live_` + `rfs_sign_`). Signing middleware. Utils extraction. |
| SW3–SW3a | `7f2a11f` | Credential issuance. `POST /api/v1/credential/issue`. UUID-bound token. |
| SW4–SW4b | `f19d432` | Webhook signing (Option B, stateless HMAC). Dead-letter KV schema. `SIGN_DOMAIN_TAG`. |
| SW5–SW5c | `a8c3b71` | Receipts. Acceptance + collection. Signed envelope. |
| SW6–SW6a | `2d91e04` | Dashboard Lightning cards + badge. `api.share.refueler.io` badge. |
| SW7–SW7a | `c4f1e18` | Sandbox (`rfs_test_` credentials). Smoke test harness. |
| SW8–SW8a | `9f3d827` | Hostname health endpoint. `wl_config.js`. CF for SaaS hostname lookup. |
| SW9 | `8b4b4a1` | Trailing full-stop normalisation. `lightning.js` LNbits wired (stub). **484 tests. SW block closed.** |

---

## SW-MCP planning sessions (uncounted)

| Session | Date | Summary |
|---------|------|---------| 
| Share-MCP-Opus-1 | 9 Sep | MCP architecture framing. Tool names locked. Trust boundary. |
| Share-MCP-Opus-2 | 10 Sep | Full spec locked (v2). Rails, credit model, D-1 filename fix Option B, capabilities contract. BRIDGE v8.4. |
| SW-MCP-W1 | 12 Sep | Capabilities endpoint shape locked (§7.1). Daily reference-rate KV. Admin rate panel. |
| SW-MCP-W2 | 12 Sep | SD-block design: Quay attribution, notification model, anonymous API market locked. BRIDGE v9.4. |

---

## SW-MCP build sessions (complete through SW-MCP-6)

| Session | Commit | Summary |
|---------|--------|---------| 
| SW-MCP-1 | `ab7e010` | MCP server scaffold. Transport + config. `refueler_capabilities` wired. |
| SW-MCP-2 | `c83f214` | Local crypto module. AES-GCM, BLAKE3, fragment helper. `hashSecret()` parity. Unit tests. |
| SW-MCP-3 | `e91b430` | `refueler_quote` + `refueler_balance`. Rate-card cache. Credits vocabulary. |
| SW-MCP-4 | `f20c771` | `refueler_send_file` E2E, identity rail. D-1 filename fix (Option B) — MCP + consumer frontend. Synced via `bin/sync-share.sh`. |
| SW-MCP-5 | `a34d991` | `refueler_check_transfer`. Acceptance + collection pull. State derivation. |
| SW-MCP-6 | `713156a` | 23-Sep demo hardening. Scripted happy path. On-stage honesty script. **228 tests.** |

**SW-MCP do-not-retry (carried):**
- DO NOT use `blake3` npm package — use `@noble/hashes/blake3.js`
- DO NOT import `@noble/hashes/blake3` without the `.js` extension
- DO NOT present `index.js` edits without specifying the full repo path
- DO NOT confuse `refueler-mcp/src/index.js` with `refueler-share/worker/src/index.js`
- DO NOT generate `description: ...` placeholder stubs — literal JS syntax errors
- DO NOT claim "end-to-end file integrity" anywhere in either README
- DO NOT actually run `npm publish` — dry-run only; manual publish by Rajesh

---

## Forward plans — moved to docs/ (Share-Hygiene-1 · 26 Sep 2026)

- **B7 session plan + SD-block plan** (incl. **SD do-not-retry**) → `docs/B7-SD-plan.md`
- **Article-Rewrite-1 brief** ("What a subpoena gets") → `docs/Article-Rewrite-1-brief.md`

---

## Share-1 → Share-6-6a — compact log (11–25 Sep 2026)

| Session | Commit | Summary |
|---|---|---|
| Share-1 · 11 Sep | `refactor(share-1)` | `worker/src/tiers.js` enum; `TIERS.CHARTERED === 'api'`; display decoupled from logic keys. 484 tests. |
| Share-2 · 11 Sep | `8f12b4e` (branch `share-2-tidal-gate`) | `PAID_TIERS` = creative + max; availability window is a paid-vs-free gate, never rail-gated. **Deferred to Share-3:** fixture rewrites in `confirm_tg` / `lightning` / `webhook_reg` tests to live wire values, then merge; `handlers/timestamp.js:30` excludes `'citizen'` from permanent record (latent bug). |
| B9-Opus · 12 Sep | — | Merkle / MMR / SMT / ZK design lock (D-1…D-7). Spec: `merkle-spec-v1.md` (repo root). |
| SW-MCP-8 · 13 Sep | — | `@refueler/mcp-server` 0.1.0, Apache 2.0, `npm pack --dry-run` clean, READMEs rewritten (both repos). Publish is manual: `cd /Users/rajeshtaylor/Documents/refueler-mcp && npm publish --access public`. **SW-MCP block complete**; SW-MCP-7 gates on B7/NB-4. |
| B8-Opus · 13 Sep | — | NUT-11 Mode 2 (Locke) design lock. Spec + do-not-retry §9: `docs/B8-spec-v1.md`. |
| Share-6-Opus · 16 Sep | — | Direct-to-R2 upload architecture lock (presigned PUT, 32 MiB parts, Cashu spent at initiate, integrity at download). Spec + do-not-retry §10: `docs/Share-6-spec-v1.md`. |
| Share-6-3a · 17 Sep | `b6f4dc4` | Worker `/finalise`: HEAD completeness, `{uuid}/hashes` sidecar, `merkle_root` + `tree_algo`, session spent. |
| Share-Dash-3 · 18 Sep | reverted | Rewrote navy-office.html from scratch, destroyed the sidebar — rolled back. |
| Share-Dash-3b · 19 Sep | `911eae8` (refueler-io) | Navy Office + Chambers rename, API & MCP card, client-errors toggle, growth card. |
| Share-6-3b / 6-3c · 19 Sep | `ec37c17` · `frontend/merkle.js` | Worker + browser Merkle (RFC-6962-unbalanced-BLAKE3), pinned N=1..4 vectors, `selfTest()` gate. |
| Share-6-3d · 20 Sep | `050998b` · `f97b7d9` | `upload.js` finalise wiring — first real end-to-end send. Flushed: merkle.js missing from sync, `X-Upload-Session` missing from CORS. |
| Share-6-4a/4b · 20 Sep | — | Single-file resume close; folder auto-discard; `FOLDER_ZIP_CAP` 2 GiB + pre-zip guard. |
| Share-6-5a · 20 Sep | deploy `f31dc124` | Worker download verification (B9-3 server half): `isVerifiedPath`, 128-chunk hybrid threshold, `X-Integrity: ciphertext-storage-verified`, 409 shapes. |
| Share-6-5b · 20–21 Sep | `8761e7c` + refueler-io `75d15c5`/`2e8e632`/`237bdb3` | Recipient card consumes `X-Integrity` + 409s. "Ciphertext storage verified" only. |
| Share-6-5c · 22 Sep | `ae2d391` | CF 1102 CPU limit on noble BLAKE3 → Workers Paid ($5/mo) + `cpu_ms = 300000`. $6 budget alert. |
| Share-6-6b · 21 Sep | `418d0c9` · `1ff986b` (deploy `924184db`) | **SHARE-503 closed.** Legacy upload route + `USE_DIRECT_R2` retired. `orphan_sweep.js` with `?dry_run`. |
| Orientation · 22 Sep | — | `@handle.share` vanity URLs parked (Registered/Chartered only). OTS committed value `SHA-256(blake3_root ‖ url_fragment_nonce)` locked. |
| Share-6-5d · 23 Sep | (in `4e14f37`) | `verifyChunkBody()` → WASM `hashOneShot()` (`worker/src/blake3_wasm.js`); `merkle.js` stays on noble by design. |
| Share-6-5e · 23 Sep | — | `npm test` runs in workerd (`@cloudflare/vitest-pool-workers`). 566 passed. |
| Share-Admin-1 · 23 Sep | `35a4808` | 5 GiB soak via `test-upload.html`: 160/160 chunks. Fixed localhost CORS echo, `urls` field, 64 KiB `getRandomValues` cap, 5xx retry. |
| Share-Admin-2 · 23 Sep | `4e14f37` · `68f1e9b` · `07e5060` | DAD-BUG (`?? null` meta, `waitUntil` flip, explicit null check) · CAP-WARNING-LINK → `/share/plans/` · PHOENIXD-TOGGLE. B10 Navy Office design decisions (now in Master Context §User-facing). |
| Share-B10-1 · 23 Sep | `fea2690` + refueler-io `d55de19`…`fb841dc` | `/admin/btc-price`, `/admin/growth-snapshot`, billable/pro-bono split, `receiver_ab` → AE (closes B7 snag), growth card 90-day view, issuance modal axes. |
| Share-Delivery-1 · 24 Sep | — | File delivery protocol → CLAUDE.md. |
| Share-6-6a · 24–25 Sep | — | 100 GiB soak upload ✓ (3200/3200, 5h 35m). Download-409 → fixed at B10-3. |

**Still open from this range:**
- **BTC-PRICE-503** — CoinGecko unreachable from the Worker; `/admin/btc-price` + `refreshBtcRate` cron 503; BTC overlay never renders; `admin_btc_price 503` rows fill the Worker-90d card. Options: longer last-good cache + back-off, CoinGecko demo key, or node feed (post-B7). Both display and governed rate share it.
- **GROWTH-AXES** — no x date ticks; y max unlabelled (= cumulative Free credentials issued). Add ticks + "credentials issued, cumulative".
- **GROWTH-FLAG-TOOLTIP** — hover cramped; date to the x-axis at the flag's foot, label + note only, fix right-edge clipping.
- Navy Office: OTS aggregate widget (scope decision first) · Sandbox → Live stub (wire KV signal from `sandbox.js`).
- Deferred: rs-theme cookie migration · UPGRADE-CSS · BRAVE-THEME.
- (CLIENT-ERR-TS-1970 fixed — `navy-office.js` renders `r.ts * 1000`.)

**Do-not-retry / wire contract (Share-6):**
- Finalise auth header is `X-Upload-Session` — never `X-Upload-Session-Token`.
- Finalise body: `{ hashes: [b64url(32B) × N], merkle_root: b64url(32B) }` — `hashes` is an ARRAY. `tree_algo` pinned `rfc6962-unbalanced-blake3-v1`, not sent by the browser.
- Sidecar is WRITE-AND-KEEP.
- New served module ⇒ add it to `bin/lib/share-mirror.sh`. New browser header ⇒ add it to `corsHeaders()`.
- DO NOT re-chase: finalise HMAC mismatch (false) · Worker missing CORS on `/download` (false — curl confirmed) · Brave "CORS / ERR_FAILED" (Shields / 503 — test in Safari first).

**Do-not-retry (Share-Admin-1):**
- DO NOT use `wrangler r2 bucket cors set` (wrangler ≤4.137.0) — broken, use the Cloudflare dashboard
- `crypto.getRandomValues()` hard cap is 65,536 bytes per call — always loop for buffers >64 KiB
- ~~NEVER add `test-upload.html` to `bin/sync-share.sh`~~ **SUPERSEDED (Share-Sync-1)** — it is in the pipeline, to `src/share/admin/`
- NEVER serve `/share/admin/test-upload.html` via the public assets mirror

**Model rule (17 Sep 2026):** Opus only for first-time crypto; Sonnet for everything specified.
**Ops constants:** Share Worker deploy = `npm run deploy` from `worker/`. API host `api.share.refueler.io`. R2 SigV4 secret = SHA-256 of the R2 API Token Value. Orphan sweep: `curl -X DELETE "https://api.share.refueler.io/admin/orphan-sweep?dry_run=false" -H "X-Admin-Key: <key>"`.
**Paid-plan backlog (Workers Paid live):** Durable Objects · Queues · Hyperdrive · Workers Builds (CLAUDE.md still bars DO/Queues/D1 for webhooks). Not a fit: D1, Workers AI, Vectorize, Workers Assets.

---
## Catch-up — B10-2 → B12 · logged 24 Sep 2026

| Session | Commit | Summary |
|---|---|---|
| Share-B10-2 | `bc5e163` (refueler-io) | Navy Office: KV timestamp ×1000 fix; Execution Dock tier display names. Dashboard design decisions locked (Master Context §User-facing). |
| Share-B10-3 | `49399ca` (deploy `b81116e2`) | **Download-409 fixed.** `reconstructAndCheckRoot` ran on every chunk and exhausted `cpu_ms` on >128-chunk transfers → false `integrity_failed`. `readSidecarWithRootCheck()` gates reconstruction behind KV `root_verified:{uuid}` (TTL = expiry). `verifyChunkBody` untouched. Supersedes the open item in Share-6-6a above. |
| Share-B11-1 | `76799ae` (deploy `28d43b55`) | **DAD fixed.** `finishDownload` runs the destruction sequence in `ctx.waitUntil`: consumed guard → chunks → sidecar → `date-seal.ots.enc` → `root_verified` → tombstone. Second download = 410. `dock_index` not cleared on DAD (B12-1 fixes). Open: DAD-ERROR-TEXT ("0%" on error screen). |
| Share-B12 | `cc14d21` | Storage / quota / surfaces / billing design (Opus). `docs/B12-spec-v1.1.md`. |
| Share-B12-1 | `3b1b819` + `3acbbf3` (deploy `9a3630f6`) | PURGED status on sweeps (B12 §6.2) · DAD clears `dock_index` (step 7, all three delete paths now indistinguishable) · X4 stopped (`size_bytes` no longer written to `dock_index`) · S1.10 sweep rules (tombstoned-UUID residue, 7-day orphan chunks, wrong-size objects — report-only until live-verified) · 23 unit tests, sandbox-verified (real `npm test` blocked, see below). New: `worker/src/sweep_rules.js`. Soak UUID `3dcccb35-5463-46ed-9f23-41cf217421d9` hard-excluded from the sweep. Open: `npm test` broken under Node 26 (`@cloudflare/vitest-pool-workers` needs Node 22 LTS) — fix first in B12-1b · live dry-run verify not yet run · `confirm_transfer.js` not checked for DAD-resurrection risk · Navy Office (refueler.io) not yet updated. |
---

## Share-B12-SR · 24 Sep 2026 — Security review of B12 (Opus, no code)

**Commit:** `4564730` · **Spec:** `docs/B12-SR-spec-v1.md` (moved from repo root at Share-Sync-1) · wins over B12-spec-v1.1 on any conflict.

**Verdict:** S1–S7 all locked, no continuation session. Amendments A1–A18 to B12-spec-v1.1.

| Item | Outcome |
|---|---|
| S1 Quota bypass | Presigned URLs didn't bound object size (1 reserved chunk → ~5 GiB). Fix: signed `content-length`, tail URL at initiate only, one 6-day `UPLOAD_WINDOW` clock, bound in session-token MAC, R2 conditional-put latch, optimistic reconcile, new sweep rules. Drift now only in user's disfavour. |
| S2 Test credential | Bypass authorised by a KV flag. Fix: MAC'd `X-Test-Credential` (`TEST_CRED_KEY`); soak shown on its own Navy Office line. |
| S3 Linkage at rest | Raw `quota_ref` → sealed `qref_ct`. `org_dock` single-value KV lost updates could resurrect DAD'd entries. Fix: one sealed KV entry per transfer, `SHARE_SEAL_KEY_<kid>`, AAD binds org + entry + kid. Raw-UUID fallback rejected. |
| S4 Lodgement ref | 6 chars display only; actions on 128-bit handle. No stored per-org key. |
| S5 Differencing | Daily 5 % bands; "<3" floor dropped; day-granular dates; Chartered 402 returns band. |
| S6 Registered auth | Magic link (fragment + click, 15 min, single-use) · Supabase sessions · `__Host-` cookie · CSRF + Origin · exact credentialed CORS · Stripe portal email editing off. Citizen initiate → subscriber mapping must be verified (B12-3 task 0). |
| S7 Sovereign | Refueler never holds the ledger blob. Deed + user-held backup file (device holds `backup_pub` only); QR pairing with 6-digit check code. Same protocol as refueler.io merchants — separate domain tags. |

**Cross-cutting:** X1 KV is write-compromised too · X2 Chartered can be Bearer-rail (follows Sovereign) · X3 "Harbourmaster" triple-booked — auth follows rail · X4 `dock_index` stores `size_bytes` (live leak) · X5 Chambers shares an origin with the whole site · X6 client-chosen UUID at initiate.

**Rajesh decisions (in-session):** fix KV (X1); welcomes Bearer-rail Chartered inheriting Bearer features (X2); agrees X3–X5; **B12-1b squeezed in before 30 Sep**; 250 GiB soak left running in Brave (S2 doesn't invalidate it), Safari 100 + 250 GiB repeats to follow, Brave 250 GiB transfer deleted after Safari passes.

**New Worker secrets (planned, not set):** `QUOTA_REF_KEY` · `SHARE_SEAL_KEY_1` (+ var `SHARE_SEAL_CURRENT`) · `TEST_CRED_KEY` · `UPLOAD_SESSION_KEY` (conditional) · `AUTH_PEPPER` · email-provider key.

**Cross-spec flags:** B8 §4 Locke pubkey set needs a MAC (reopens B8 — fold into KV-Audit-Opus). Other KV-authorising records to audit: `api_quota_*`, `rfs_live_` → org map.

**Do-not-retry (B12-SR):**
- DO NOT let any KV value authorise access / lift a limit / select a privileged branch without a Worker-secret MAC.
- DO NOT sign presigned PUTs `host`-only.
- DO NOT persist `size_bytes` in `dock_index`.
- DO NOT store a Chambers/ledger blob server-side.
- DO NOT offer magic links to Bearer principals.
- DO NOT act on the 6-char `LR-` display ref.
- DO NOT write raw `quota_ref` into manifests or KV keys.

### B12 build plan (sessions)

| Block | Sessions | Model | When |
|---|---|---|---|
| B12-1 | 1 (done) | Sonnet | Pre-Berlin |
| B12-1b | 1 (done) | Sonnet | 5 Oct — Part 0 + R2 enforcement gate only (split) |
| B12-1c | 1 (done) | Sonnet | 5 Oct — Part 1 frontend only (split); `413b714` ✓ SHIPPED |
| B12-1d | 1 (done) | Sonnet | 5 Oct — S1.1 Worker + tests + live verify; deploy `1c6c7985` |
| B12-2 | 1 (+1 buffer) | Sonnet | Post-Berlin (moved 25 Sep) — no prompt yet; needs Navy Office files from Rajesh |
| KV-Audit-Opus → KV fixes · X3 naming · X5 app origin | 1 + 4–5 | Opus + Sonnet | Week 1 post-Berlin |
| B12-3 quota | 3 (+1) | Sonnet | Week 2 |
| B12-4a auth | 2 (+1) | Sonnet | Week 2 |
| B12-4b Chambers · B12-6 billing + 3 open bugs | 3 | Sonnet | Week 3 |
| B12-Audit (built quota + auth) | 1 + 1 | Opus + Sonnet | Week 3 |
| B12-5 Harbourmaster | 2 | Sonnet | When a Chartered client is in sight |
| B12-4c Sovereign ledger | 2–3 | Sonnet | With SD-block (needs B8-1 + B7) |

**Split-session policy (Share-B12-1, 24 Sep 2026):** Sonnet build sessions run too much scope when cryptographic/security-sensitive work is bundled — split proactively at session-close, don't cram. Applies going forward to all B12-* sessions and beyond.

## Locked block sequence (updated Share-B12-SR · 24 Sep 2026)

`B12-1 ✓ → [Berlin 30 Sep–3 Oct; back Sun 4 Oct; small ad hoc sessions only until then] → B12-1b → B12-2 → KV-Audit-Opus + fixes · X3 · X5 → B12-3 · B12-4a · B12-4b · B12-6 · B12-Audit → B8 build → [Hetzner] → NB-2–NB-4 → B7 → SD-block (+ B12-4c) → B9 build (B9-4…B9-8) → B10+`

---

## Share-Soak-1 → Share-Hygiene-1 — compact log (25–26 Sep 2026, compacted Share-Cleanup-1)

| Session | Commit / deploy | Summary |
|---|---|---|
| Share-Soak-1 · 25 Sep | — | `test-upload.html` per-chunk retry (pause, not abort); headless soak driver `worker/scripts/soak-headless.mjs`; `test-upload.html` placed in refueler.io `src/share/admin/`. |
| Share-Sync-1 · 25 Sep | — | Frontend pipeline enforced, not remembered: one list `bin/lib/share-mirror.sh`, `ship-frontend.sh`, pre-push hook, CI `mirror-check.yml`; BLAKE3 `dist/` committed; `test-upload.html` in the pipeline; pages.dev retired (see CLAUDE.md). |
| Share-CI-1 · 25 Sep | `b96910e` | CI green: `finishDownload` exported; `vi.mock` specifiers fixed; `resolve.alias` for `@noble/hashes` in workerd. Dead local `npm test` = broken `worker/node_modules` → `rm -rf worker/node_modules && npm ci` (not a Node-version problem). |
| Share-Soak-2 · 25 Sep | `41bcce7` (deployed `00e84da5`) | R2 cleanup 10,413 → 52 objects, owner-delete path only. Owner delete made resumable: shared `destroyTransfer()`, R2 batches of 1000, tombstone last (`destroyed:false, partial:true` until done). Navy Office "Data stored (90d)" counts Analytics Engine upload events, not live R2. Found a credential issue → Share-Cred-Opus-1. |
| Share-Cred-Opus-1 · 25 Sep | — | Credential investigation + NUT-11/NUT-12 notes, held off-repo until fixed (memory `cred-fix-tracker`). Follow-ups Cred-Fix-1, Cred-Fix-2, MCP-Fix-1. |
| Cred-Fix-1 · 26 Sep | deployed `f7dfbe40` | Commitment HMAC under `COMMITMENT_KEY` (fails closed); `X-Email` and the resume-issue branch removed; dead `handleUpload` removed. MIME denylist claim retired (CLAUDE.md). |
| Share-DAD-2 · 26 Sep | `08a9545`, `b68d10f`, `9c000b1`; Worker `8b19a65` (deployed `9bb4920a`); refueler.io `0414e9a` | DAD deletes when the last chunk is served (since B11-1), so the confirm step went; "Transfer permanently deleted…" line; Show/Hide name; one "no longer active" page; calm dialog. Worker: `finishDownload` → `destroyTransfer`, `/meta` 410 when consumed. Status + Notes expiry copy corrected (92-day R2 backstop). DAD retest ✓ Safari 26 Sep. |
| Share-Cache-1 · 26 Sep | `623aa56`, `31ebb3c` | Cache Rule for `/share/assets/*` (Respect origin TTL); `sm_live_cache` guards it (CLAUDE.md). |
| Share-Hygiene-1 · 26 Sep | — | This file 775 → ~420 lines; B7/SD plans + Article-Rewrite-1 brief → `docs/`; stale do-not-retry lines marked SUPERSEDED. |

**Rules from these sessions (keep):**
- **Supabase (from 30 Oct 2026):** every migration that creates a table in `public` must include explicit GRANTs in the same migration. Server-only tables (ledger, auth sessions, magic links, quota) grant `service_role` ONLY — never `anon`/`authenticated`.
- Test/owner deletes go through the Worker (`DELETE /transfer/{uuid}`), never `wrangler r2 object delete`.

**Carried open items (from these sessions):**
- **Share-Soak-3:** `soak-headless.mjs` ~30 s fetch timeout; remove `SWEEP_PROTECTED_UUIDS` entry `3dcccb35…`; orphan-sweep residue pass (awaiting Rajesh; sweep summary counts not trusted). Memory `soak3-plan-27sep`.
- **Share-Expiry-1** (post-Berlin, with the B12 deletion latch): actually delete expired transfers via the shared release path + identical tombstone; decide daily 03:00 UTC vs hourly; then rewrite `docs/r2-lifecycle.md` + public copy. Fold in `confirm_transfer.js`'s one-at-a-time delete loop (unused by the frontend; API/TESTING still reference `/confirm`).
- **Share-MIME-1** (after B12-1b, before Cred-Fix-2): remove unused `MIME_DENYLIST`; retire any file-type claim in public copy.
- **B12-4a:** Chartered `/initiate` resolves free-tier cap/expiry; Plans/Upgrade offer 1/7/30/90-day expiry but `upload.js` always sends 7 days.
- `wrangler.toml` still binds stale `BLINK_WALLET_ID`/`BLINK_API_KEY` and `PRICE_CREATIVE_*` (post-Berlin cleanup).
- 38 ESLint warnings (0 errors), low priority.
- Cloudflare JS Detections script injected into refueler.io HTML — privacy review.
- BRIDGE line 42 stale ("GENERATED FILE header", "second push stays manual") — next BRIDGE bump. §Share-DAD-1 / §Share-Bug-2 entries referenced but missing.
- Navy Office: Execution Dock UUID + Status column idea (needs a stored label, e.g. `kind` in `dock_index`); "31 need a nudge" counter not investigated.
- ~~TH-1 built or not?~~ Answered 28 Sep (chat import sweep): the Worker has the relay (`POST /timestamp/submit`, `handlers/timestamp.js`), but the browser posts to the OTS calendars directly (F-26), so the relay is unused today.
- Full narrative of these entries: git history before this compaction.

## Share-MCP-Chat-1 → Share-Cleanup-1 — compact log (26–28 Sep 2026, compacted Cred-Fix-2b)
| Session | Commit / deploy | Summary |
|---|---|---|
| Share-MCP-Chat-1 · 26 Sep | — | MCP/agents/pricing discussion, nothing locked (memory `agents-pricing-direction`; draft plans page in `docs/drafts/`). Safari 100 GiB soak ✓ via `test-upload.html`. Worker `8b19a65` deployed `9bb4920a`; DAD retest ✓ Safari. Stripe checkout not paused (paid cards greyed out). |
| Share-Download-Opus · 27 Sep | `3b801c2` (`soak-download.mjs`) | Large-download spec `docs/Share-Download-spec-v1.md` (D-1…D-9 approved). Raw 100 GiB download ✓ 97 min, 3200/3200 verified, 1 stall retry. Soak transfers deleted; bucket audited. |
| Share-Receiver-1 · 27 Sep | — | Receiver page mock v5 approved; decisions R-1…R-14, findings F-1…F-5: `docs/Share-Receiver-1-build-list.md`. |
| Share-Receiver-2a · 27 Sep | `82105b4` (refueler.io `8c9986c`) | Receiver build items 1–9 (one sheet at a time, `.rx-mode`). Lesson: receiver CSS broke the upload page in preview → always re-check upload mode (memory `share-page-two-modes`). Safari ✓. |
| Share-Receiver-2b · 28 Sep | `22689ef` (refueler.io `8516a9a`), header fix `3671e93` | Items 10–12, 14: date-seal offer removed (F-9: no one can fetch a seal via the UI now), dead-link + failed-check copy, arrival motion. Safari ✓. Upload direction set → Share-Upload-1. |
| Share-Upload-1 · 28 Sep | — | Upload page mock v3 (open sheet, "empty ledger", Send · Plans · Status sub-menu); U-1…U-11, F-10…F-21: `docs/Share-Upload-1-build-list.md`. |
| Share-Deps-1 · 28 Sep | `b8673e2` (refueler.io `d9acaab`) | No more esm.sh: vendored `noble-secp256k1.js` + `noble-blake3.js` (JS fallback when no WASM); receiver loads neither. Vanadium (GrapheneOS) send + receive ✓ (F-20). F-22…F-26 in the Upload-1 build list. |
| Share-Cleanup-1 · 28 Sep | `d1bacad`, `7c9c692`, `104c048` (refueler.io `e4463bb`, `4acc358`, `27d90c0`, `15646f8`, `6ba5c9a`) | "password" copy (N-4), Carbon default site-wide (N-3), stale pages removed (F-3), F-12/F-13/F-14/F-15, link-preview text. Safari ✓. Desktop-chat memory import → Master Context §Backlog. Left over: unused `frontend/upgrade.css`; legacy refueler.io `/upgrade.html` (Upload-2 / plans draft B). |

Full narrative of these entries: git history before `Cred-Fix-2b`.

## Share-B12-1b → B12-1d — compact log (5 Oct 2026, compacted Share-Upload-4)

| Session | Commit | Summary |
|---|---|---|
| B12-1b | deploy `0d2f94d9` | Optional `presign(key, { contentLength })` + admin presign test; R2 gate ✓ live (wrong length → 403, nothing written). 621 passed. |
| B12-1c | `413b714` | Frontend half of S1.1: `tail_url` for index N−1, `/urls` below it, `tailUrl` in the resume record, tail-only resume skips the probe; admin page PUTs `chunk + 16`. Safari gate ✓. |
| B12-1d | deploy `1c6c7985` | Worker half: `/initiate` chunk-count check, every URL signs `content-length`, finalise `wrong_size` 409 + `waitUntil` delete. 639 passed. Live ✓ incl. 8.5 GiB soak. Combined `npm test` flake → Test-Harness-1 (Mullvad). |

Full narrative: git history before Share-Upload-4.

## Cred-Fix-2a → Share-Size-1 — compact log (5–6 Oct 2026, compacted Share-Upload-5)

| Session | Commit / deploy | Summary |
|---|---|---|
| Cred-Fix-2a · 5 Oct | deploy `4c9730b2` | Worker accepts credential format v2 (standard Cashu proof, `verifyProofV2`, `@cashu/cashu-ts` 4.11.0); `keyset_id` + `dleq` at issue; anonymous-rail API issuance 503 until B7. 659 tests. In the workerd pool import cashu-ts after the Worker modules. |
| Cred-Fix-2b · 5 Oct | `ca3972c` (refueler.io `31b4457`) · deploy `a5ac4f5d` | Browser sends v2 via vendored `frontend/cashu-crypto.js` (`bin/vendor-cashu.sh`), DLEQ checked, key not pinned (B7/B8); Worker refuses v1. Public note `docs/Cred-verification-note-v1.md`. Live ✓ Safari. |
| Share-Size-1 · 6 Oct | `27582c7` (refueler.io `0369317`) · deploy `69a99b89` | Exact size in the fragment (`z`); no `total_bytes` in new manifests; `/meta` null for new; receipts `size_bytes: null`. Honest scope: R2 object sizes still give it exactly. `/meta` hard-null from 13 Oct. |

Full narrative: git history before Share-Upload-5.

## Share-Upload-2 (6 Oct 2026) — Share sub-menu + upload page redesign (B1) · refueler.io `580135c` · shipped `565efd9` (refueler.io `beb611b`)

**Scope check:** F-12/13/14 (Cleanup-1) and F-20/21 (Deps-1) confirmed against the code. Rajesh agreed: C3 (download % at half) moves to the download track with F-22; C4, C9 and the Turnstile `?onload=` fold into the build; Part B split B1 (look/copy/structure) + B2 (behaviour); "Try again" in the same tab reuses the held file ("Try again carries on from 42%."); receiver A/B brand mock = its own session.
**Part A (refueler.io `580135c`, own git):** `_data/sections.js`, `share/share.11tydata.json`, `section-nav.njk` (centred segmented pill, current item from `page.url`), Plans/Status out of `nav.njk`, Plans + Status on the shared header/footer (back links gone), `share-nav.njk`/`share-footer.njk` retired, Plans "Encrypted in your browser" ×3, Status title. Pill colours mixed from `--fg` so `share-tokens.css` can't change them. Live ✓ (Rajesh: Safari, Brave, iPhone, Pixel).
**Part B1 (`565efd9`):** one sender sheet on the receiver's parts, `data-view` set by `share.js` `setView()` (empty · zipping · chosen · over · uploading · ready · stopped); the slip (U-7), facts row, "Choose a file" / "or a folder", drop line only on `(hover: hover) and (pointer: fine)`; copy per build list §1; bytes-based progress + `%` tab title (C4); "Stopped" view for the failures that already had a message (full F-11 = B2); QR = real canvas, dark on light, whole pixels per module, decodes to the link (F-16/F-19); simple "Choose another"; F-23 `frontend/share-early.js` (new mirrored file, `SM_JS`); receiver tokens page-wide + leftover `--card-*` mapped (F-6); F-8/F-15 rules removed (F-18: "/ Share" fits); `upgrade.css` + `status-back-link` CSS removed; local `nav.njk` stub refreshed, `section-nav.njk` stub added; password input 16 px (iOS zoom). `showSharePanel(url, info)` signature change (internal). No new exports, no new request headers. Folders over 4 GB now get the 2 GB folder message.
**Harness:** `dev/share-harness/` (new): refueler.io copy + canonical page + fake Worker (real `nut00.js` signing, fault injection) + Turnstile stub. Every state previewed Carbon/Paper, 375–1280 px.
**Live ✓ (Rajesh):** iPhone 13 mini Safari both themes; folder from Files (long-press to pick a folder — iOS behaviour; "or a folder" stays on iOS); password + DAD; Pixel 9a received, dead link on second open; desktop link ready + QR scanned by iPhone → dead link.
**Found:** after a view change the page keeps its scroll position, so on a phone the % sits under the header and the eyebrow/headline are off-screen (also desktop "link ready") → B2: bring the sheet top into view on every view change. Mail-app link previews (Tutamail: title + domain + R icon only) = branding opportunity → Share-Receiver-3. Receiver password input 15 px (iOS zoom) → Share-Receiver-3.
**Next:** Share-Upload-3 (B2 + Part C; prompt `Share-Upload-3-prompt.md`) → B12-2 (refueler-io) → KV-Audit-Opus. Share-Receiver-3 (A/B brand mock) as its own session.

## Share-Upload-3 (6 Oct 2026) — upload page B2, items 1–4 · shipped `4bb3fde` (refueler.io `3c61c32`) + `627c0d0`

**Scope (Rajesh, 3 h budget):** B2 items 1–4 this session; item 5 (F-11 errors + Try again) and Part C → Share-Upload-4.
**1 · F-27 (`4bb3fde`):** `share.js` `setView()` calls `revealSheet()` on every view change: if the sheet top is under the pinned header (+ status banner) or off-screen, scroll it to 16 px below the header; smooth, instant when the tab is hidden or reduced motion is on. Not via `requestAnimationFrame` (hidden tabs never run it).
**2 · U-10 (`4bb3fde`):** Turnstile `appearance: 'interaction-only'`, `size: 'flexible'`; `#turnstile-wrap` shown only by `before-interactive-callback`, hidden when the token lands. Button greyed only for visible reasons (no file, empty password); pressed early it reads "Checking…" and `startUpload` runs from the token callback. Failure while queued: button back + "The security check didn't go through. Try again." + `turnstile.reset`. Token single-use: cleared + widget reset in a `finally` round `/credential/issue`. `?onload=onTurnstileLoad` → `?render=explicit`. **Exports removed:** `initTurnstile`, `renderTurnstile` (internal now; no other importers). No new headers, no new mirrored files.
**3 · U-11 (`4bb3fde`):** widget drawn once (first file chosen); "Choose another" and new files keep a passed check; reset only after a failure; Cloudflare's auto-refresh handles expiry. Queued start cancelled by "Choose another" or a new file.
**4 · U-8 (`627c0d0`):** dragover/drop on `document` (upload mode only; `enterUploadMode` never runs on a link), views empty/chosen/over. `dragover` timer (250 ms) instead of `dragleave` (mock v3 method; Safari-safe). `html.up-dragging body::after` = 1 px accent frame, 6 px inset; slip accent; File row "Release to add." in any droppable view. Two or more files: "One file or one folder at a time." A file dropped in other views is swallowed (`preventDefault`), so the browser never opens it over a running upload.
**Harness:** stub gained `?ts=fail` (first check fails, passes after `reset()`) and a working `reset()`. Checked: pass / slow ("Checking…" → auto-start) / click / fail; scroll at 375 + 1280; drag frame Carbon + Paper; receiver unchanged. e2e: "link ready" waits 30 → 90 s (test 1 + 2), since the button no longer waits for the check.
**Live:** refueler.io loads `api.js?render=explicit`, no console warning; the in-app (automated) browser got the click check — line + full-width widget, button enabled. **Rajesh, iPhone Safari + Brave:** the widget asked for a tick (fine, "professional") but the button stayed grey until the tick → that tab ran pre-ship code (live bytes + live Chromium show the button enabled). **Fresh-tab retest ✓ (Rajesh, 6 Oct).**
**Noted:** the widget takes the theme when first drawn; a later Carbon/Paper switch keeps the old colours (only visible when Cloudflare asks). After the token is spent the reset may ask again inside the hidden options card; item 5's "Try again" must show it.
**Extras (`bf0512a`, after Rajesh's Safari desktop test — files + folders fine, short "Preparing" pause at 0 %):** (a) `resumeUpload` opens the file picker before any `await` on the success path (deps + key import moved after the file is validated; card stays up while the picker is open) — harness: `navigator.userActivation.isActive` true at `input.click()`, 130 MB resume → link ready → receiver OK; **Safari desktop ✓ (Rajesh)**. (b) `loadDeps()` warmed (cached, silent on failure) when a file is chosen and when the resume card shows — harness: BLAKE3/cashu bundles fetched before the button press. (c) QR caption "Scan with a phone's camera to download it there." (Rajesh). Decided: "Send another file" stays a quiet link (it reloads the page and the link is gone; a third button beside "Copy link" invites that mis-tap; approved mock).
**Found (Rajesh, Safari desktop, after `bf0512a`):** folder resume refused (by design, S-031); 160 MB upload "felt hung" — bar moves per 32 MiB chunk, two chunk PUTs failed (no status, ~3 s) and retried OK (Mullvad off throughout), console 401 on a long URL (likely Turnstile PAT probe); download bar same (F-22) → Share-Progress-1 proposed (Master Context backlog 11–12).
**Next:** Share-Upload-4 (F-11 + Try again, then Part B; prompt `Share-Upload-4-prompt.md`) → Share-Progress-1 (Rajesh, 6 Oct) → Share-Folder-Resume-1 (S-031; store-only zip lands in Share-Upload-4) → B12-2 (refueler-io) → KV-Audit-Opus. MCP-Fix-1 week of 12 Oct.

## Share-Upload-4 (6 Oct 2026) — upload errors + Try again (F-11), Cloudflare widget · shipped `2fb1b30` (refueler.io `66d27d2`) + `fa3b2a1`

**Start:** both Share-Upload-3 retests already ✓ (`abcead0`). Two chunk PUTs failing after ~3 s = network, not code (60 s timeout, sequential PUTs; Safari "Load failed"; retry worked). Console 401 not confirmable from Chromium → Rajesh checks the host in Safari Web Inspector (if `challenges.cloudflare.com`, Turnstile's PAT probe, harmless). Scope (Rajesh, tired): Part A 1–2 (3–4 folded in, Try again needs them), then the widget.
**A1–4 (`2fb1b30`):** `upload.js` — `UploadStop` (internal) with kinds network · check · refused · missing · unfinished · gone · browser; every throw in a fresh upload or a resume lands in `_stopped` → §1 copy (Rajesh approved three extra lines: network before any send "Refueler couldn’t be reached. Nothing was shared. Try again."; finish failed with all parts sent "The upload didn’t finish. Everything was sent; Try again finishes it."; unexpected "Something went wrong in this browser. Try again; if it keeps happening, check the Status page."). % in "carries on from N%" is the real stop point. Fresh upload and resume now share one send/finish path (`_setUp` → `_carryOn(job)`; `resumeUpload` = picker + `_carryOn`, export signature unchanged). Try again: nothing sent yet → back to the slip, `pressUpload()` ("Checking…", widget shows if Cloudflare wants a click), new pass; parts sent → carries on in the same tab with the held file, held hashes (no re-hash), fresh URLs; finalise 409 (`missing` / `wrong_size` `segments`) → resends from the first bad part; finalise network/5xx → finalise only; 401/404/`/urls` 401·409 → "can’t be resumed". Password field cleared only when the link is ready. **Resume record now kept until finalise succeeds** (was cleared just before it). `share.js` `showStopped(text, retry)` (optional 2nd param; one press per stop); `index.njk` `#up-retry-btn` beside "Start over" (Start over full width when Try again is absent). No new exports, headers or mirrored files; e2e ids unchanged.
**Widget (`fa3b2a1`; size reverted `4398cf7`):** tried `size: 'normal'` (300 px) — Rajesh preferred full width (wanted the button's width and height; Cloudflare fixes the height at 65 px, so `flexible` it stays); `MutationObserver` on `data-theme` redraws in the new theme when no token is held, else after the token is spent or expires. Cloudflare offers light/dark only — no colour matching (Rajesh asked; CSS filters would break their rules). Live ✓ in-app browser + Rajesh (Mac Brave, iPhone Brave): redraws within a second of a theme switch.
**Rajesh live tests (6 Oct):** 1000.8 MB folder upload with Wi-Fi off/on — chunk 3 PUT failed twice, the retry carried it (no Stopped needed), link worked; download in another tab, Wi-Fi off mid-way → "The download stopped. Download failed. Please try again." (old download copy, F-22 track); reopening the link (DAD on) restarted the download from zero and finished — the failed attempt didn't burn the link. Apple Mail link preview = title + domain + R icon (→ Share-Receiver-3). Offline `share.js:219` errors = `/log/error` reports failing while offline, harmless.
**Harness:** fake Worker finalise now checks every leaf (BLAKE3 of stored bytes) and the Merkle root like the real Worker, plus missing parts; `build.sh` shortens chunk retries to 0.2 s. Checked: chunk:N → Try again (only unsent parts re-PUT, password kept, receiver unlocked + downloaded); issue (check) / initiate (refused) → fresh retry; `?ts=click` retry; finalise 500 / 409 / wrong_size; refresh mid-upload → resume (re-hash + tail-only) → strict finalise 200; Carbon + Paper, 375 + desktop. Live: new bytes load, no console errors (no live upload by Claude — the check may ask for a click).
**Not done (→ Share-Upload-5):** A5 F-24; Part B 1–6 (store-only folder zip first).
**Next:** Share-Upload-5 (Part B; prompt `Share-Upload-5-prompt.md`) → Share-Progress-1 → Share-Folder-Resume-1 → B12-2 (refueler-io) → KV-Audit-Opus. MCP-Fix-1 week of 12 Oct.

## Share-Upload-5 (7 Oct 2026) — store-only folder zip, Cloudflare wait, source maps · shipped `45dde47` (refueler.io `4dab996`) + `2a9f081` (refueler.io `0fd7cd9`)

**Start:** Pixel 9a (Vanadium): Cloudflare took ~10 s to show its box (hardened browser, not file size); the queued press then started the upload on the tick — Rajesh: never start without the sender pressing. DAD second open → dead link ✓. Session split agreed (Rajesh, 2 h): this session = item 1 + 6 + Cloudflare; resume timing items → Share-Upload-6; admin page → Share-Upload-7.
**Zip (`45dde47`):** folders zip store-only (`ZipPassThrough`), entries sorted by path (code-unit order), each file's own `lastModified` in the zip date field **and** an extended UTC timestamp (`0x5455`); unknown/out-of-range dates (zip fields 1980–2038) → 1 Jan 1980. Rajesh rejected one fixed date: editors sort by file dates, and changed dates read as "we changed your data". Was: every file stamped with the zipping time. 2 GB cap checked once, before zipping, on the zip's exact size (`_zipSize`: files + 110 B per file + name twice + 22 B); post-zip check removed; skip-list removed. Harness: same folder read in reverse order 2.5 s later → same BLAKE3; round trip same BLAKE3; real extraction: Info-ZIP restores exact UTC seconds, Archive Utility uses the DOS field (2 s steps, an hour off across a DST change — standard zip limit). Rajesh live ✓: 663 MB folder, unzipped dates match the originals (30 Jul 2026 21:07). Re-zip is identical only on the same device timezone (DOS field is local) — note for Share-Folder-Resume-1.
**Cloudflare (`45dde47` + `2a9f081`):** the check starts when the upload page opens (it already ran inside a hidden wrap); "Checking…" past 2 s shows the line; copy now "A quick check by Cloudflare that you’re a person." ("Not an account." dropped, Rajesh). When Cloudflare's box appears, a queued press is dropped and the button greys until the tick; a tick never starts an upload. An invisible pass after a press still starts it (one press). Pressing after a failed check resets the widget. Rajesh live ✓ Pixel (single file + folder "much more elegant") and iPhone.
**Source maps (`45dde47` + `2a9f081`):** 28 `sourceMappingURL` lines stripped (`src/blake3` → `frontend/blake3`) plus `qr-creator.min.js` (Rajesh's console); `sm_check_canon` now fails on any `sourceMappingURL` in `src/blake3` or a shipped asset, with the strip command (commits `b557fb2`, `d4b1b0d`). Worker `zip-streaming.test.js` rewritten for the new rules (12 tests).
**Found:** iPhone folder from iCloud Files is named "File Provider Storage.zip" (iOS gives that root in `webkitRelativePath`) → Share-Upload-6. iPhone download of 97 MB took 5–10 s to start → Share-Progress-1 (visible) + DL track (cause); Rajesh: keep the order, no real users yet. A `/log/error` fired at the end of a Mac download (12:05, 7 Oct) — non-fatal per Rajesh; the Client errors split is planned (B12-2). Console 401 not seen again; the `challenges.cloudflare.com` frame line is Turnstile noise → question closed. DAD dialog stays until DL-W1 (R-6, decided 27 Sep; Rajesh agreed, no press-twice button).
**Next:** Share-Upload-6 (iOS folder name, resume card delay, "Preparing" pause, resume re-hash; prompt `Share-Upload-6-prompt.md`) → Share-Upload-7 (admin page off esm.sh = F-25 + `noble-secp256k1.js` removal + stats/header) → Share-Progress-1 → Share-Folder-Resume-1 → B12-2 (refueler-io) → KV-Audit-Opus. MCP-Fix-1 week of 12 Oct.

## Share-Upload-6 (7 Oct 2026) — iOS folder name, resume timing, re-hash · shipped `9d63880` (refueler.io `2113245`) + `b1eea41` (refueler.io `1550099`)

**Start:** no phone problems since Share-Upload-5. All four items (Rajesh). **Live checks now run with Mullvad on** (Rajesh: nearly all users use a VPN).
**1 · iOS folder name (`9d63880`):** `_handleFolderFiles` maps the root `File Provider Storage` (iOS "Open" at the top of On My iPhone) to "On My iPhone" for the zip name + slip. Entry paths already drop the root, so zip bytes are unchanged — harness: iOS root and a desktop root give the same SHA-256.
**2 · Resume card delay — not reproduced, closed.** Safari: scripts run at 0.30–0.54 s, IndexedDB opens in 3–5 ms — plain load, Mullvad on with an empty cache (Cloudflare `api.js` 63 ms), refresh mid-upload. Likely gone with `4bb3fde`/`bf0512a` (6 Oct evening). Reopen if seen.
**3 · 0 % pause — measured, no frontend change.** 404 MB, Safari: `/credential/issue` 0.64 s · `/initiate` 1.48 s · first part encrypt 0.56 s · first 32 MiB PUT 6.6 s before the bar moves · finalise 2.7 s. Download: password `/auth` 0.78 s · first part 4.4 s. The visible fix is Share-Progress-1 (setup steps + byte progress). `/initiate` runs rate-limit KV → manifest get → Supabase spend → manifest put → session KV put → presign in series; the last three could run together after the spend (≈0.3–0.5 s) → backlog (own Worker session).
**4 · Resume re-hash (`b1eea41`):** the resume record keeps each sent part's ciphertext hash (`hashes`) and the file's `lastModified` (`fileModified`); a resume with the same file, unchanged, skips re-encrypting the sent parts. Otherwise (date differs, old record, bad entry) it re-checks as before, so a changed file still fails at finalise rather than mixing parts. Was ≈0.2 s per sent 32 MiB part. Harness: refresh at 4/5 → no check, fake-Worker strict finalise 200; same bytes + new date → re-check → 200; receiver OK. **Rajesh live ✓** (404 MB, ⌘R at 32 %, carried on, link, download). No new exports, headers or mirrored files.
**Found:** Safari "This web page was reloaded because a problem occurred" once, on ⌘R during an upload (record survived, resume worked; Rajesh has seen it a few times) → backlog. A `/log/error` fires at the end of a download (again; payload not captured) → backlog. "Fetch API cannot load …/log/error due to access control checks" after a refresh = the old page's report cut off; Worker CORS checked fine. `e.useCache` rejection + `ewe-content-main.js` = Cloudflare widget / an ad-block extension, not Share. Resume screen shows the card **and** the empty sheet — calmer: one box (card only; Discard brings the sheet back) → Share-Progress-1 (Rajesh).
**Decided:** an encryption review runs next — Share-Crypto-Opus-1 (Opus), ahead of Share-Upload-7, Share-Progress-1 and MCP-Fix-1 (Rajesh). Notes off-repo.
**Next:** Share-Crypto-Opus-1 → its build → Share-Upload-7 (prompt `Share-Upload-7-prompt.md`) → Share-Progress-1 → Share-Folder-Resume-1 → B12-2 (refueler-io) → KV-Audit-Opus. MCP-Fix-1 after the encryption build.

## Share-Crypto-Opus-1 (7 Oct 2026) — Encryption review (Opus, design only)

Encryption review: design decided; detail kept off-repo (Rajesh's private folder). No code changed, nothing shipped. Decisions cover the build, link format, unfinished uploads, the MCP send tool and test transfers in storage. Public wording after the build: Rajesh decides at its close.
**Next:** Share-Crypto-1 (build; prompt given in chat) → Share-Upload-7 (prompt `Share-Upload-7-prompt.md`) → Share-Progress-1 → Share-Folder-Resume-1 → B12-2 (refueler-io) → KV-Audit-Opus. MCP-Fix-1 after Share-Crypto-1; `refueler-mcp` stays unpublished until then.
