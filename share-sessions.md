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
| B12-1b | 1 (+1 buffer) | Sonnet | Post-Berlin (moved 25 Sep) |
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

## Share-Soak-1 (25 Sep 2026)
Fixed test-upload.html retry crash (Promise.all(index 3) killing whole run on any chunk network throw) — per-chunk retry/backoff with pause-not-abort on exhausted retries, resilient attempted/succeeded/failed tally, headless Node soak driver (worker/scripts/soak-headless.mjs) for terminal-survivable runs. Also found + fixed TEST-HARNESS-NOT-ROUTED: test-upload.html had never been placed in refueler.io/src/share/admin/ (Eleventy passthrough copies from there, not from refueler-share) — placed, pushed, verified clean with ?inject_fail=1 (16/16 chunks, 0 failed after retries, finalise reached) from https://refueler.io/share/admin/test-upload.html. Real 100 GiB soak launched via headless driver, PID 51432.

## Share-Sync-1 (25 Sep 2026)
Frontend deploy pipeline made enforced, not remembered: one mirrored-file list (`bin/lib/share-mirror.sh`); `bin/ship-frontend.sh` commits, syncs, pushes refueler.io then refueler-share, and proves every mirrored file byte-identical on the public site; `bin/githooks/pre-push` blocks `main` unless refueler.io's pushed `main` matches; CI `mirror-check.yml` (push + 6-hourly; live-byte step dropped — Cloudflare bot protection blocks GitHub runners, live proof stays in ship-frontend.sh) makes `--no-verify` pointless; BLAKE3 `dist/` WASM now committed canonical (was gitignored, unverifiable); `test-upload.html` brought into the pipeline (supersedes Admin-1 rule, intent kept); `refueler-share.pages.dev` retired (delete blocked by Cloudflare deployment count — parked, never deploy there). Spec files moved to docs/ (B12-SR, B8, Share-6). Proven live: raw push blocked, sync-without-refueler.io-push blocked (the DAD-1 case), `--no-verify` caught by CI, ship repaired and verified on refueler.io/share/. Open: delete refueler-share Pages project via Cloudflare delete-all-deployments script (code 8000076); BRIDGE line 42 stale ("GENERATED FILE header", "second push stays manual") — fold into next BRIDGE bump; §Share-DAD-1 / §Share-Bug-2 log entries referenced but missing; Cloudflare JS Detections script injected into refueler.io HTML (privacy review); UPGRADE-CSS likely `upgrade.njk` → `/upgrade.css`.

## Share-CI-1 (25 Sep 2026)
CI Level 1 green (`b96910e`; Mirror workflow untouched). Three causes, all in unit tests: (1) `finishDownload` in `download.js` was never exported, so `dock_b12` imported `undefined` — now `export`ed; (2) `dock_b12.test.js` used `vi.mock('src/…')` where every other test uses `'../src/…'`, so the `nut11` mock never applied (bearer-delete 403) — specifiers fixed; (3) since Share-6-5e moved tests into workerd, bare `@noble/hashes/*` imports failed with `No such module …/esm/x.js` — `resolve.alias` in `worker/vitest.config.js` routes them to the package root files (test-only; `src/` unchanged). 589 passed / 29 skipped, 21 files. Local `npm test` had also been dead: `worker/node_modules` held an empty nested `workerd-darwin-arm64` (partial install 23 Sep) — the "Node v26" diagnosis in the old B12-1b prompt was wrong (same crash on Node 24; CI runs 22); fix is `rm -rf worker/node_modules && npm ci`. Open: 38 ESLint warnings (0 errors; unused vars, 3 auto-fixable) — low-priority cleanup; B12-1b prompt Part 0 corrected (kept on Desktop, run after Berlin).

## Share-Soak-2 (25 Sep 2026) — R2 soak cleanup; delete path fixed (partial scope: cleanup only)
Cleanup only, no soak script changes (`soak-headless.mjs` timeout fix NOT done — still open). Bucket `refueler-share-prod` 10,413 objects / 349 GB / 14 UUIDs → 52 objects. Listing via read-only `GET /admin/orphan-sweep` (wrangler 4.113 has no `r2 object list`). All 14 UUIDs deleted with Rajesh's approval (no customers; all test data) through the Worker owner-delete path (`DELETE /transfer/{uuid}`, `Bearer rfs_owner_x` + `X-Admin-Key`), never `wrangler r2 object delete`.
**Bug found + fixed (`41bcce7`, deployed `00e84da5`):** owner delete set `consumed:true`, then deleted chunks one at a time, then tombstoned. On 3,200/8,000-chunk transfers the Worker died mid-loop, and because `consumed:true` returned 410, a retry could never resume — `7e667647…`, `ba3d0c53…`, `3dcccb35…`, `2c796eba…` stuck half-deleted. Fix in `worker/src/handlers/delete_transfer.js`: shared `destroyTransfer()` for owner + bearer paths; lists `{uuid}/` and deletes in R2 batches of 1000 via `deleteKeys` (8,000 chunks = 8 calls); also removes `hashes`, `date-seal.ots.enc`, stray chunks, KV `root_verified`; tombstone written last and only if every batch succeeded (else `destroyed:false, partial:true, remaining:n`); in-progress state (`consumed:true` + `total_chunks` present) resumes with original `consumed_at`; only a real tombstone returns 410. Partial response shape changed (`destroyed:false`). New `worker/test/delete_resume.test.js` (7 tests); full suite 596 passed / 29 skipped. Re-run after deploy: all four `destroyed:true`.
**Left in bucket (52 objects):** 5 tombstoned UUIDs with residue (41 objects: `hashes` sidecars + 32 chunks on `807d7b77…`) — owner delete returns 410 on them; the report-only sweep residue rule (`orphan-sweep?dry_run=false`, `would_delete_objects: 41`) would clear them. Not run — awaiting Rajesh. `SWEEP_PROTECTED_UUIDS` still hard-excludes `3dcccb35…` (now deleted) — remove with the harness fix. Sweep summary counts (1 complete / 2 incomplete / 1 protected) did not move after the deletes; not trusted.
**Dashboard/billing (verified in code + Rajesh screenshots):** Navy Office "Data stored (90d)" = Analytics Engine upload events (chunk-0), not live R2 — deletes never change it; soak runs mostly not counted. Cloudflare R2 cost ≈ $0.06 (13.1 GB-months, 4 billable, $0.015/GB-mo); all else in free tier; storage metering lags. $4.79 invoice = Workers Paid plan.
**Findings (unverified, by code reading — NOT tested):** `verifyCredential` (`worker/src/nut00.js`) checks only pubkey match + valid curve point + `SHA256(C)` serial; the secret is never sent so `k·H(x)==C` is never checked (`verifyToken` unused); mint pubkey is public → credentials may be forgeable (spend ledger the only other gate). `index.js` ~1173 reads `verified.serial` from a string return. Frontend `_hashToCurve` ≠ NUT-00 hash-to-curve. No DLEQ (NUT-12) anywhere. NUT-11 P2PK read: does not fix this (presupposes the secret is verified); relevant to B8 Mode 2. → **Share-Cred-Opus-1** (`Share-Cred-Opus-1-prompt.md`). Memory: `geata-cashu-reference`, `dleq-roadmap-idea`.
**Ad hoc:** Geata (thesimplekid, Rust Cashu/L402/x402 402-gate proxy) reviewed as reference pattern. Navy Office Execution Dock idea (UUID column; Status Active / Soak-Test / Onboarding) — needs a stored label (e.g. `kind` in `dock_index` written by `/admin/test-credential`); dock rows show UUID "—" today; NOT designed or built. "31 need a nudge" counter not investigated.

### Next sessions (updated Share-Soak-2 · 25 Sep 2026)
1. ~~**Share-Cred-Opus-1**~~ — done, see below.
2. **Share-Soak-3** (Sonnet) — still open from Soak-2: fix ~30 s fetch timeout in `worker/scripts/soak-headless.mjs` (32 MiB × concurrency 8 cannot finish on home upload); remove `SWEEP_PROTECTED_UUIDS` entry for `3dcccb35…`; run the orphan-sweep residue pass (41 objects) once approved; smoke run, then 100 GiB re-run. Optional: Navy Office Execution Dock UUID + Status column (proposal first).
3. **B12-1b** (Sonnet) — first session back (after Sun 4 Oct); prompt in repo root `Share-B12-1b-prompt.md`. Then **B12-2**. Only small ad hoc sessions until then.
**Supabase rule (from 30 Oct 2026):** every migration that creates a table in `public` must include explicit GRANTs in the same migration. Server-only tables (ledger, auth sessions, magic links, quota) grant `service_role` ONLY — never `anon`/`authenticated`.
## Share-Cred-Opus-1 (25 Sep 2026) — credential verification investigation + NUT-11/NUT-12 design (Opus, no repo code)
Investigation complete; scratch tests only, production never probed. Findings, design note and fix plan are held **off-repo** until the follow-up ships (Rajesh decision) — `docs/Cred-verification-note-v1.md` will be published then. NUT-11 (P2PK) and NUT-12 (DLEQ) read against B8-spec D-3; alignment notes held with the design note and fold into B8-spec at the follow-up. Follow-up sessions queued: **Cred-Fix-1** (Worker), **Cred-Fix-2** (Worker + frontend, post-Berlin, after B12-1b), **MCP-Fix-1** (`refueler-mcp`, before any npm publish). Memory: `cred-fix-tracker`, `dleq-roadmap-idea`.
**Order (Rajesh, 25 Sep):** Cred-Fix-1 Sat 26 Sep → Share-Soak-3 → Berlin → B12-1b → Cred-Fix-2 → B12-2 → KV-Audit-Opus … Cred-Fix-1 prompt is off-repo (see memory `cred-fix-tracker`).

## Cred-Fix-1 (26 Sep 2026) — commitment hardening (Worker only)
Transfer commitment now HMAC-SHA256 under new Worker secret `COMMITMENT_KEY` (`worker/src/commitment.js`, B12-SR encoding: tag ‖ 0x00 ‖ uuid16 ‖ window u64 BE ‖ tier); one shared function replaces the three copies (consumer, API, admin test-credential). Same 64-hex wire shape — no client change. Missing key fails closed (issue 500, initiate 503). `X-Email` tier lookup removed from `/initiate` (all consumer uploads resolve `free` until B12-4a) and from CORS allow-headers. Resume-issue branch of `/credential/issue` removed (`resume:true` → 400; no client sent it). Dead `handleUpload` (retired 6-6b) and its imports removed; `index.js.bak` deleted. Anonymous API rail site unchanged (fails closed), now pinned by a test. New `worker/test/commitment.test.js` (15). Suite 611 passed / 29 skipped. Secret set by Rajesh; deployed `f7dfbe40-3ffa-4b2d-8665-e766976df65b`. Live check (Safari, refueler.io/share/, passphrase + DAD): upload, receiver card, unlock, download, delete all OK.
**Found:** the MIME denylist only ever ran on the retired relay path — no live file-type check since 6-6b. Rajesh: retire the claim (CLAUDE.md updated), don't rebuild it. Chartered uploads via `/initiate` resolve free-tier cap/expiry (pre-existing; B12-4a).
**DAD UX (Rajesh, live test):** (1) pre-download modal copy — drop "Once you confirm…", say it is removed after download + show the size; (2) post-download "Have you saved the file?" / "I've saved it — delete this transfer" — Rajesh wants straight to "Transfer permanently deleted from Refueler's servers." (styled as the question line); (3) a deleted link still shows the filename (fragment) with blank size/expiry and the download button gives "Transfer metadata is incomplete" — should detect the tombstone on load and say the transfer has been deleted.

### Next sessions (updated Cred-Fix-1 · 26 Sep 2026)
1. **Share-Soak-3** (Sonnet) — unchanged, see Share-Soak-2 list.
2. **Share-DAD-2** (Sonnet, small, frontend — `frontend/download.js` + `ship-frontend.sh`) — the three DAD UX items above. **Decided (Rajesh, 26 Sep): item 2 = keep the confirm step, reword it** (iOS/macOS saves can fail silently). Items 1 and 3 as proposed. Facts to build on (verified in code 26 Sep): DAD deletes only on the recipient's confirm (`confirm_transfer.js`); `pending_destruction:true` is advisory, so an unconfirmed DAD link stays downloadable until normal expiry — upload/receiver copy must not promise "one download only". Free expiry = 7 days (`FREE_EXPIRY`, Worker ceiling); creative 30 / max 90 are Worker ceilings only — `upload.js` always sends 7 days. Expiry blocks download (410) but does not delete: chunks remain until the R2 lifecycle backstop (92 days); `docs/r2-lifecycle.md` is stale (says free = 5 days; "not requested" wording unverified vs R2 age-from-upload). Check public copy for any "deleted at expiry" claim. **Scheduled pre-Berlin (Rajesh, 26 Sep), after Share-Soak-3.** Scope = make every statement true, no deletion code: (i) the three DAD screen fixes; (ii) upload toggle copy `upload.js:323` ("deleted the moment it is downloaded" — false; deletion is on recipient confirm, else expiry); (iii) read the live rule (`wrangler r2 bucket lifecycle list refueler-share-prod`) and correct `docs/r2-lifecycle.md`; (iv) audit public copy for deletion-at-expiry claims — refueler.io privacy page, notes (what-a-subpoena-gets, nothing-to-collect…), editorial, status, README — list hits + proposed wording, Rajesh approves before any edit. **Refined (Rajesh, 26 Sep):** skip the `docs/r2-lifecycle.md` rewrite — do it once after Share-Expiry-1 to state what runs; in DAD-2 correct only public statements that are false today (minimal). Add sender-assurance copy: before deletion, only ciphertext sits in R2 — key + real filename live in the URL fragment and never reach the Worker; wording must not imply "we store nothing" (manifest keeps size, expiry, chunk count). Wording (Rajesh, 26 Sep): "Our servers store only encrypted data we can't open. We never hold the encryption key."
   → **Done: Share-DAD-2 (26 Sep)** — see log below. Worker deploy pending (after the Safari 100 GiB soak).
2b. **Share-Expiry-1** (post-Berlin, with the B12 deletion-latch work) — actually delete expired transfers (scheduled sweep) via the shared B12-SR release path + identical tombstone. Not before Berlin. Decide cadence there: existing cron is daily 03:00 UTC (≤24 h after expiry) vs hourly; downloads already stop at the expiry second. Then rewrite `docs/r2-lifecycle.md` + public copy to state what runs.
3. **B12-1b** — first session back (after Sun 4 Oct).
4. **Share-MIME-1** (small, after B12-1b, before Cred-Fix-2) — remove unused `MIME_DENYLIST`, grep refueler.io/README/status copy for any file-type-blocking claim and retire it.
5. **Cred-Fix-2** → B12-2 → KV-Audit-Opus … (sequence unchanged).

## Share-DAD-2 (26 Sep 2026) — DAD screens tell the truth; dead-link page; filename hidden
**Premise corrected:** the Cred-Fix-1 note "DAD deletes only on the recipient's confirm" was wrong. Since Share-B11-1 the Worker starts deleting when the **last chunk is served** (`finishDownload`, pinned by `dock_b12.test.js`); `/confirm` then answered 410 and the page showed "Could not confirm deletion — the transfer will expire naturally" (false). Rajesh chose **A**: drop the confirm step, say what happens. `upload.js` toggle copy ("deleted the moment it is downloaded") was already true.
**Frontend (shipped `08a9545`, `b68d10f`, ✓ SHIPPED both):** pre-download modal "This transfer is deleted after download" + size; post-download line "Transfer permanently deleted from Refueler's servers." (no button); receiver card shows "Encrypted file" + **Show name / Hide name** (Rajesh: hidden until asked, glancing eyes); one **"This link is no longer active"** page (no filename/size/expiry) for `/meta` 404/410, tombstone (all-null meta) and passed expiry; mid-download 410 → "expired or been deleted"; amber DAD notice → "**Once downloaded, the recipient cannot download again.** Our servers store only encrypted data we can't read as we never hold encryption keys." Live (Safari Private, Rajesh, 2nd round): amber notice (new wording) ✓, share link ✓, "Encrypted file" + Show/Hide name ✓, post-download line ✓; dead-link page ✓ (in-app browser, 404 path). Reopening a DAD'd link still showed the card → needs Worker 4a (below).
**3rd ship (`9c000b1`, ✓ SHIPPED; not yet eyeballed by Rajesh):** pre-download dialog made calm — was unreadable because `--card-bg` is 4 % alpha on a 72 % black scrim; now solid `--bg` card, 28 % scrim, no ⚠️, no body text (Rajesh: not needed), buttons "Download" / "Not now" (returns to the card, button re-armed); zip transfers hidden as "Encrypted folder" (Show name reveals the zip's name only — contents are never listed); a 410 mid-download now shows the same "no longer active" page instead of the Error text. Preview-checked in Paper and Carbon.
**Public copy (refueler.io `0414e9a`, live):** status page "✓ Files delete themselves" → "✓ Expired files can't be downloaded … cleared by Cloudflare's storage layer no later than 92 days after upload"; what-a-subpoena-gets expiry sentence corrected the same way. Live R2 rule read: `expiry-backstop` 92 days + multipart aborts. Privacy page (refueler.io POS) and README DAD line checked — true, unchanged. `src/status.njk` (refueler-share copy) aligned.
**Worker (`8b19a65`, NOT DEPLOYED — deploy after the soak, Rajesh):** live test showed a DAD'd link still returning size + expiry — the B11-1 inline sequence deleted chunks one-by-one and never awaited tombstone/hashes/seal/dock writes (fits Soak-2's tombstone residue). Fix: `finishDownload` calls the shared `destroyTransfer` (batched, awaited, tombstone last, resumable); `destroyTransfer` awaits the dock delete; `GET /meta` on `consumed:true` → 410 `{error:'deleted'}`. +6 tests; 618 passed / 29 skipped. **After deploy:** DAD a small file in Safari, reopen link → "no longer active"; `curl /meta/{uuid}` → 410.
**Open / found:** `/share/assets/*` served `max-age=14400` (Cloudflare zone browser TTL, not `_headers`) — browsers can run old modules up to 4 h after a ship; background task queued. `confirm_transfer.js` still has its own one-at-a-time delete loop (unused by the frontend now; API/TESTING still reference `/confirm`) — fold into Share-Expiry-1 / B12 latch. plans/upgrade pages offer "1 / 7 (/30/90) day expiry" but `upload.js` always sends 7 days — B12-4a.

## Share-Cache-1 + Share-Hygiene-1 (26 Sep 2026, ad hoc during the Safari soak)
**Cache-1 (`623aa56`, `31ebb3c`):** `/share/assets/*` was served `max-age=14400` — the refueler.io zone Browser Cache TTL overrode Pages' `max-age=0`, so browsers could run old/mixed ES modules for 4 h after a ship. Fix: Cloudflare Cache Rule `(http.host eq "refueler.io" and starts_with(http.request.uri.path, "/share/assets/"))`, Browser TTL = Respect origin TTL (dashboard, Rajesh). Verified live: all mirrored JS/CSS + blake3 + vendor now `max-age=0, must-revalidate`; `/share/` HTML unchanged. `sm_live_cache` in `bin/lib/share-mirror.sh` fails `ship-frontend.sh` / `sync-share.sh --live` if it regresses. No cost (Free plan rule; static Pages requests free). Rule recorded in CLAUDE.md.
**DAD-2 3rd ship eyeballed (Rajesh, Brave):** calm dialog, Not now, Encrypted file/folder, Show/Hide name, post-download line — all ✓. Reopened DAD'd link still shows size + expiry → expected until Worker `8b19a65` deploys (post-soak check). "6 days remaining" on a fresh 7-day transfer kept as is (Rajesh).
**Hygiene-1:** `share-sessions.md` 775 → ~420 lines (Share-1…Share-6-6a compacted, do-not-retry kept); B7/SD plans → `docs/B7-SD-plan.md`, Article-Rewrite-1 brief → `docs/Article-Rewrite-1-brief.md`; three stale do-not-retry lines marked SUPERSEDED (RU resume-Turnstile, TG final-chunk delete, Admin-1 test-upload sync). Master Context: 6-4a/4b commits filled, roadmap rows point at the new docs.
**Noticed, not resolved:** the 22 Sep Orientation note said "OTS relay (TH-1) is NOT built — only the TH-0 spike", which conflicts with the TH-1 row (deployed `a71f12fe`). The sentence was dropped in the compaction (in git history before this commit) — check the Worker before relying on either.
