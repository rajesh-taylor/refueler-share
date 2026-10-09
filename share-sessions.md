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

## Cred-Fix-2a → Share-Upload-4 — compact log (5–6 Oct 2026, compacted Share-Upload-5 / Share-Crypto-1 / Share-Upload-7)

| Session | Commit / deploy | Summary |
|---|---|---|
| Cred-Fix-2a · 5 Oct | deploy `4c9730b2` | Worker accepts credential format v2 (standard Cashu proof, `verifyProofV2`, `@cashu/cashu-ts` 4.11.0); `keyset_id` + `dleq` at issue; anonymous-rail API issuance 503 until B7. 659 tests. In the workerd pool import cashu-ts after the Worker modules. |
| Cred-Fix-2b · 5 Oct | `ca3972c` (refueler.io `31b4457`) · deploy `a5ac4f5d` | Browser sends v2 via vendored `frontend/cashu-crypto.js` (`bin/vendor-cashu.sh`), DLEQ checked, key not pinned (B7/B8); Worker refuses v1. Public note `docs/Cred-verification-note-v1.md`. Live ✓ Safari. |
| Share-Size-1 · 6 Oct | `27582c7` (refueler.io `0369317`) · deploy `69a99b89` | Exact size in the fragment (`z`); no `total_bytes` in new manifests; `/meta` null for new; receipts `size_bytes: null`. Honest scope: R2 object sizes still give it exactly. `/meta` hard-null from 13 Oct. |
| Share-Upload-2 · 6 Oct | refueler.io `580135c` · `565efd9` (refueler.io `beb611b`) | Share sub-menu (`sections.js`, `section-nav.njk`); upload page B1: one sender sheet, `setView()` views, slip, bytes progress + % tab title, QR canvas, F-23 `share-early.js` (mirrored), F-6 tokens. Preview harness `dev/share-harness/` born. Live ✓ iPhone, Pixel, desktop. |
| Share-Upload-3 · 6 Oct | `4bb3fde` (refueler.io `3c61c32`) + `627c0d0`, `bf0512a` | B2 1–4: F-27 sheet scroll, U-10 Turnstile out of sight + "Checking…", U-11 keep a passed check, U-8 whole-page drop. Resume picker opens before any await (Safari user activation); `loadDeps()` warmed on file choice. Exports removed: `initTurnstile`, `renderTurnstile`. |
| Share-Upload-4 · 6 Oct | `2fb1b30` (refueler.io `66d27d2`) + `fa3b2a1` | F-11: `UploadStop` kinds → §1 copy; fresh + resume share `_carryOn(job)`; same-tab Try again (`#up-retry-btn`, `showStopped(text, retry)`); resume record kept until finalise succeeds. Turnstile full width, redraws on theme change. Harness finalise checks leaves + root. |
| Share-Upload-5 · 7 Oct | `45dde47` (refueler.io `4dab996`) + `2a9f081` | Store-only folder zip (path order, each file's own date + UTC stamp; identical only on the same device timezone — Share-Folder-Resume-1); 2 GB cap on the exact zip size before zipping. Cloudflare check starts at page open, never starts an upload by itself. 28 source-map lines stripped; `sm_check_canon` refuses new ones. |
| Share-Upload-6 · 7 Oct | `9d63880` (refueler.io `2113245`) + `b1eea41` (`1550099`) | iOS root "File Provider Storage" → "On My iPhone" (zip bytes unchanged); resume record keeps `hashes` + `fileModified`, re-check only when the file changed; 0 % pause measured (issue 0.64 s, initiate 1.48 s, first 32 MiB PUT 6.6 s). Live checks run with Mullvad on from here. |
| Share-Crypto-Opus-1 · 7 Oct | — | Encryption review (Opus, design only); detail off-repo. Built in Share-Crypto-1. |
| Share-Crypto-1 · 7 Oct | `493ea4b` (refueler.io `ad063a6`) | Per-part key (`derivePartKey`) + counter IV with last-part flag; link format v2 `{v:2,k,n,s?,z}` (strict parse, `z` required); v0/v1 links still open; known-answer tests `part-crypto.test.js`. Old-link removal on/after 12 Jan 2027. |
| Share-Upload-7 · 7 Oct | `c78cc9d` (refueler.io `64771e5`) + `b081ee7`, refueler.io `8fb9ac2` | Admin test page off esm.sh (vendored BLAKE3 + real NUT-00 blind); `noble-secp256k1.js` removed (ship never deletes dropped mirror files — direct `git rm` in refueler.io). |

Full narrative: git history before Share-Folder-Resume-1 (Share-Upload-2: before Share-Crypto-1; Share-Upload-3/4: before Share-Upload-7; Share-Upload-5: before Share-Progress-1 close; Share-Upload-6 + Share-Crypto-Opus-1: before Share-Folder-Resume-1 close; Share-Crypto-1 + Share-Upload-7: before B12-2 close).

## Share-Progress-1 (7 Oct 2026) — compact (compacted KV-Fix-1a)

| Session | Commit | Summary |
|---|---|---|
| Share-Progress-1 · 7 Oct | `93bde7d` · `a6ac30b` · `dad6a6a` · `c6ea396` (+ pre-ship `a794462`, `73bfedf`, `82bd14f`) | Progress on both pages, retries ≤ 10 s, overlapped downloads, one-box resume. Full narrative in git history. |

## Share-Folder-Resume-1 (7–8 Oct 2026) — compact (compacted Safari-Slow-Link-1)

| Session | Commit | Summary |
|---|---|---|
| Share-Folder-Resume-1 · 7–8 Oct | `a783656` (refueler.io `014ddc1`) + `b942bd7` | Interrupted folder uploads continue: record keeps a folder print (`folderPrint`, never sent); re-pick checks name / list / zip date, re-zips, re-checks every sent part. Live ✓ Safari Mac 427 MB, iPhone 110 MB. Full narrative in git history. |

## B12-2 (8 Oct 2026) — compact (compacted KV-Fix-1b)

| Session | Commit | Summary |
|---|---|---|
| B12-2 · 8 Oct | deploy `d38f4eb0` · `1eac786` · ship `ee024f8` (refueler.io `fae2457`) · refueler.io `617933a` | Navy Office: real vs expected client errors with explanations; Storage & Billing from `GET /admin/storage` (aggregates only); Sign out in header; `upload_stopped:<kind>`; dead A/B ping gone. Navy-Office-Design-Opus → -1 decided. Full narrative in git history. |

## KV-Audit-Opus + KV-Fix-1a (8 Oct 2026) — compact (compacted Safari-Slow-Link-1)

| Session | Commit | Summary |
|---|---|---|
| KV-Audit-Opus · 8 Oct | docs only | Every STATUS_KV prefix vs X1 (`docs/KV-Audit-v1.md`; detail in `refueler-share-private/`): forge → MAC, roll back/delete → Supabase; 20 prefixes sorted; sessions KV-Fix-1a/1b → KV-Fix-2 → API-Repair-1. |
| KV-Fix-1a · 8 Oct | deploy `318772eb` · refueler.io `8fd9fdb` | Status shape + page whitelist; `requireAdmin` on all 26 checks; finalise once; `root_verified` MAC (`KV_MAC_KEY`); Lightning code removed; capabilities honest. `kv_fix_1a.test.js` 27. Full narrative in git history. |

## KV-Fix-1b → MCP-Fix-1 (8 Oct 2026) — compact (compacted API-Repair-1)

| Session | Commit | Summary |
|---|---|---|
| KV-Fix-1b · 8 Oct | deploy `d00ae2c4` · ship `aa3847d` (refueler.io `ad3e1c3`) | B12-SR S2 in full: `src/testcred.js`, MAC'd `X-Test-Credential` under `TEST_CRED_KEY`; bypass skips Cashu/spend/pool only, expiry ceiling applies (P2), manifest `soak: true`; `test_credential:*` read nowhere. `kv_fix_1b.test.js` 32. Live: soak 1 GiB ✓, planted old flag → 401. Full narrative in git history. |
| Safari-Slow-Link-1 · 8 Oct | deploy `5312c5fa` · ships `9568045`, `f60bcb2` (refueler.io `69a56ef`) | Receiver card: `share-early.js` starts `/meta` early, modulepreload, upload code only in upload mode. Downloads ≥ 3 parts were resetting isolates (whole-part buffering) → verify-then-stream with `hashStream` (blake3-wasm-incr), clean 409 for every size. iPhone `DL_IN_FLIGHT` 4 → 2. `slow-link-1.test.js` 12. Full narrative in git history. |
| MCP-Fix-1 · 8 Oct | `refueler-mcp` `95bf142`, `71e0a42` | MCP send rebuilt on the direct-to-R2 path (initiate → presigned PUT → `/urls` → finalise with Merkle root), link format v2 with byte-for-byte parity vectors, credential v2 (cashu-ts 4.11.0), GiB pricing, cap pre-check from the capabilities cache; server actually starts now (5 breakages). 245 tests. Live 40 MiB + Safari receiver ✓. npm publish held. Full narrative in git history. |

## KV-Fix-2 (9 Oct 2026) — API keys and credit pools move from KV to Supabase · deploy `a47404a6`

**Start:** half-day+ budget. Audit table before any edit (forge / roll back / delete), plan approved. Live KV census: 1 `api_client_` (the test record), 0 `api_quota_`, 5 `sandbox_client_`, 5 `sandbox_meta_` (held the **raw** test live key), 1 `sandbox_quota_`. All four API/sandbox families failed forge and roll back; delete only refused service.
**F6 confirmed in code:** sandbox credential issue unreachable (`requireApiAuth` read only `api_client_`; `lookupSandboxClient` imported, never called) — and had an `api_client_` record existed for an `rfs_test_` key, it would have signed on the production mint key. Rajesh: refuse outright.
**Supabase (migration `supabase/migrations/20261009_kv_fix_2_api_keys.sql`, applied via MCP):** `api_keys` (hashes only; `rail = 'identity'` unless sandbox; `grace_until` for future rotation; `expires_at` for sandbox) + `api_credit_pools` (one per `org_account_id`, unix-second periods). RLS on, no grants; SECURITY DEFINER functions, execute for `service_role` only. `api_credits_spend` = `applyQuotaSpend` line for line under a row lock; `api_credits_refund`; `api_pool_provision/cancel/get/stats`; `api_key_lookup/create/revoke/org`. 20 SQL checks in a rolled-back transaction (month clamp, overage + ceiling, refund order, personal hard stop, lazy reset, cancelled-no-reset, sandbox-no-reset, revoke / grace / expiry, anonymous-production CHECK, privileges).
**Worker:** `api_store.js` (RPC wrappers, ≤ 60 s isolate key cache, `StoreUnavailable` → 503, no KV fallback). `requireApiAuth(…, { sandbox })` — prefixes and stored flag must agree, so sandbox keys pass only `/api/v1/sandbox/*`. Credential issue: sandbox 403 `sandbox_issue_unavailable` before auth; atomic spend awaited before the blind signature; refund if signing fails; mint key fixed to `MINT_PRIVATE_KEY`. Initiate: pool pre-check (advisory) → Cashu spend INSERT → atomic debit; a debit lost to a race or an outage deletes the `spent_tokens` row (credential not burnt) and refuses. Admin: `POST /api/v1/admin/api-client` (unbiased base58 keys, shown once, no-store) and `/revoke`; quota provision/cancel moved to `handlers/api_admin.js` on the pool table. `auth_ping` drops its second KV read and the literal `'api'` (F8). Capabilities `quota.model` `kv_pool` → `server_pool`. `api_stats` from `api_pool_stats` (field `kv_available` kept: Navy Office reads it). Sandbox rewritten onto the same tables; the raw live key is stored nowhere. P3 (pool chosen by the plain `X-Api-Live-Key` header at initiate) left for API-Repair-1 as locked.
**Tests:** `worker/test/kv_fix_2.test.js` 25 (fake Supabase in fetch; planted KV client/balance ignored; 60 s revocation with mocked clock; 503 no fallback; sandbox/prod separation; issue spend/402/503/refund/403; initiate debit order, race un-spend, unknown key; admin no-KV; sandbox flow). `quota.test.js` reworked (provisionParams, sandbox plan), `btc_rate.test.js` mocks the pool. All 34 files pass per file (719 + 29 skipped as before).
**Deploy `a47404a6`** — also carries MCP-Fix-1's held `limits.max_transfer_bytes` (Rajesh). **Live ✓ (Rajesh, Mullvad on, `bin/kv-fix-2-live-check.mjs`):** create 201 → ping 200 remaining 10000 → capabilities `server_pool`, `max_transfer_bytes` 4294967296 → issue 200 remaining 9999 → immediate cancel → issue 402 `account_cancelled` → revoke 200 → refused after **5 s** (other isolates bounded at 60 s). Test rows deleted; both tables empty.
**KV cleanup:** 1 `api_client_` + 11 `sandbox_*` deleted; 0 left in all three prefixes.
**Docs:** `ONBOARDING-RUNBOOK.md` v1.1 (Step 2 = admin endpoint, Step 3 retired, Step 4 signing + "not live until API-Repair-1", Step 6 via ping, rotation = AM revoke + reissue until `/keys/rotate` exists), `CLAUDE.md` pool line + KV-Audit bullet, `refueler-mcp-spec-v2.md` §3.1/§7.4 (copied to `refueler-mcp`), Master Context Supabase table + do-not-retry, `docs/KV-Audit-v1.md` §5.
**Cloudflare tokens (scope item 5, Rajesh 9 Oct):** user token "Edit Cloudflare Workers" (Workers KV Storage:**Edit** among 10 Edit scopes, never used) **deleted**; "Cloudflare Agent Token – 2026-08-08" (read-only incl. KV Storage:Read — could read raw `upload_session` tokens until B12-3; never used) **deleted**. Kept: 2 tunnel tokens (Cloudflare One), `refueler-share-saas` (Zone SSL), `refueler-share-ae-read` (AE read). Account tokens: `refueler-share-presign` (R2 Bucket Item Write — the Worker's presign key) and `refueler-finance-local` (R2) — no KV, kept. No token now carries KV write; `wrangler login` is the only KV-write path, as decided.
**Next:** API-Repair-1 (webhooks + receipts from R2 via sealed `cref_ct`, HMAC'd Chartered initiate closing P3, `wh_config_`/`wh_dlq_` MAC). Small carried: `/api/v1/keys/rotate` (store ready: `grace_until`); rename `kv_available` with the next Navy Office change; `spatial_ref_sys` RLS advisory (refueler.io, hidden from PostgREST).

## API-Repair-1 (9 Oct 2026) — webhooks and receipts that work, without KV routing; HMAC'd Chartered initiate · deploys `48476e56` → `8aa38636` → `1d7a9e2a`

**Start:** full-session budget; every client-identification point listed from the code, plan approved with three calls (Rajesh): qref info amended to the global encryption rule; `wh_config_` keyed by org not key hash; receipts need a registered webhook.
**Identification map (before):** `X-Api-Live-Key` (unauthenticated) chose the pool at initiate (P3) and was stored raw as `manifest.api_live_key` (F2); `dock_index.api_key_hash` routed every webhook but nothing wrote it (F3); `wh_config_`/`wh_dlq_` unMAC'd (P4/P5); receipt pull had no owner check (F4).
**Found beyond the audit:** receipts signed with a key derived from the **raw** live key while registration handed out one from its hash — no receipt was ever verifiable; receipt envelope signed with the raw master key; no-webhook receipts stored `pending` forever; the MCP sent the live key unsigned; DAD (since DAD-2) destroys at the last chunk, so `/confirm` always 410'd and `transfer.confirmed` could never fire; admin soak credentials are Chartered-tier (an HMAC requirement would have broken Soak-4); the hostname-health cron read a KV field nothing wrote.
**Built:** `seal.js` — shared seal helper (B12-SR S3(a) construction; info = `utf8(tag) ‖ 0x00`; AAD binds uuid16 + kid; fresh nonce; KAT). Manifest `cref_ct` = seal(org16 ‖ transfer_ref) under `SHARE_SEAL_KEY_1` (`SHARE_SEAL_CURRENT = "1"`); no raw key or ref at rest; tombstone strips it (keeps two fields only). Initiate: Chartered tier → `requireApiAuth` (production keys), pool = signer's, seal before any spend (missing key → 503); a valid MAC'd test credential keeps its bypass with no auth, debit or `cref_ct`. `webhook_delivery.js` rebuilt: manifest → `openCref` → org → `wh_config_{orgtag}` (orgtag = keyed `KV_MAC_KEY` subkey `orgtag`); record MAC'd (`whcfg`, key name inside); URL re-validated per send (+ IPv6 literals, `.localhost`, `redirect: 'manual'`); whsec v2 = HKDF(master, `refueler.share.whsec.v2` ‖ 0x00 ‖ org16 ‖ BE64(created_at)); one v0 envelope for webhooks and receipts. DLQ `wh_dlq_{orgtag}_{rand}` (no uuid in the name), MAC'd (`whdlq`), retry re-derives the event from R2 / the MAC'd receipt and drops what it can't confirm. Receipts v2 (`org_account_id` replaces `live_key`), signed with the client's whsec, stored MAC'd (`rcpt`) with an owner tag — pull 404 unless the caller owns it (not from the manifest: DAD tombstones strip `cref_ct` as `cargo.discharged` fires). `cargo.accepted` at finalise; `transfer.confirmed` after DAD destruction completes. `findApiKeyHashForUuid` and every `dock_index.api_key_hash` read gone. Hostname cron reads `WL_CONFIGS` (code), not KV. Failed sends log `event → status` (never the URL).
**MCP (`refueler-mcp`):** initiate signed (`auth: true`), `X-Api-Live-Key` dropped; spec §2/§3 text; 243 pass.
**Tests:** `api_repair_1.test.js` 32 (KAT ×4 from Node crypto, initiate matrix, e2e finalise → signed accepted receipt → owner-only pull, KV forgery/move, URL re-check, DLQ ×5); shared fake Supabase → `test/helpers/api-fake.js`; `webhook_reg`, `kv_fix_1b`, `kv_fix_2`, `dock_b12`, `share-size-1` updated. `kv_fix_1b` "wrong MAC" was flaky since KV-Fix-1b (flipping the last b64url char of a 32-byte MAC hits padding bits) — fixed. All 35 files pass per file (730).
**Live ✓ (Rajesh, Mullvad on, `bin/api-repair-1-live-check.mjs`):** unsigned initiate 401 · signed 200, pool 9999 → 9889 · finalise → `cargo.accepted` · download (DAD) → `cargo.discharged` + `transfer.confirmed` · every v0 envelope and receipt sig verified with the whsec · receipt pull owner 200 / other 404 · DLQ 0. Capabilities `webhook`/`receipts` + `WL_CONFIGS.webhooks` → true (deploy `1d7a9e2a`). Three runs' test clients deleted from Supabase (0 left).
**Webhook sink:** quick tunnels never connected through Mullvad (port 7844 blocked → edge 530). Named tunnel `refueler-wh-sink` (id `1d9545f8…`, DNS `wh-sink.refueler.io`, added by Rajesh), `bin/lib/wh-sink.mjs` (on demand only, random per-run path, 404 otherwise), `--protocol http2`, `cloudflared` excluded in Mullvad split tunnelling (re-add the Cellar path after a brew upgrade).
**Secrets:** `SHARE_SEAL_KEY_1` new. `ADMIN_KEY` was weak and exposed in screenshots — rotated once mid-session (also exposed); final rotation at close.
**Known, not fixed:** `transfer.timestamp_submitted` unit-tested only — the timestamp route refuses tier `free`, which every initiate resolves to until B12-4a. `worker/tests/unit/` is an old directory vitest never runs (tidy). 15 dead imports in `index.js` (tidy).
**Next:** X3 naming + Share-JS-Split-2 → Share-Soak-4 (→ Share-DL-Spike if a day is free) → B12-3 → B12-4a.

## X3 naming + Share-JS-Split-2 (9 Oct 2026) — one meaning per name; frontend split into one-job modules · `4405646`, `2b6a359`, ship `67e367b` (refueler.io `4d9d59f`)

**X3 (Rajesh, option A):** **Harbourmaster** = the Silent Drop Quay owner, Locke sign-in only. Chartered org admin (B12 §3, B12-5) = **Custom House** (one Chartered surface: org admin + API/MCP; sign-in follows the rail). Navy Office live-transfer view = **Execution Dock**. Applied in BRIDGE (v10.0; other repos' copies sync on their next bump), B12 spec, B12-SR (X3 marked resolved), CLAUDE.md, Master Context, Brand-Terminology, Upload-1 build list, MCP spec, `auth_ping.js` (comment + 403 text "Custom House dashboard" — **rides the next Worker deploy**, held), `execution_dock.js` header. B8/SD/whitepaper "Harbourmaster" already meant the Quay owner: unchanged.
**Split (moves only, map approved before any move):** `upload.js` 1,705 → upload, upload-turnstile, -options, -folder, -start, -send, -resume, -store, -net, -stop (≤ 322 lines each). `download.js` 901 → download, download-fetch, -save, -sheets, -time, -notes. `crypto.js` 693 → crypto (crypto only, 250), config, progress, zip, locke (B8 sign side; loaded by no page yet). Done by script from HEAD line ranges: every source line placed exactly once. Glue (agreed): `setPressUpload`, `pressWhenChecked`/`keepTurnstile` (Turnstile state stays private), `helpers.resetRows` into `zipAndSelect` (no import cycle). Importers point at the right module (no barrel), so zip/Locke never load on the receiver. `index.njk` modulepreloads the receiver modules; `share-early.js` preloads the upload ones. `SM_JS` lists all 27. Harness `build.sh` follows `config.js`/`download-notes.js`/`progress.js` (its retry rewrite had been a no-op since Share-Progress-1).
**Tests:** eslint no-undef/unused per module (only the 7 pre-existing unused warnings carried); node import of all 24 modules; full worker suite 35 files / 730 pass, 29 skipped (Mullvad off); `tests/resume.test.js` 45. Harness: upload, receiver blob download byte-identical (70 MB, 3 parts), Stopped → fresh Try again, stop at part 1 → refresh → resume card → link, folder zip.
**Live ✓ (Rajesh, Safari, Mullvad on):** small file with password + DAD; dragged 4-file folder with subfolder (407.5 MiB) with password + DAD — receiver "A folder for you", modal, unlock, Downloaded + Notes card; zip opened, files and subfolder intact.
**Next:** Share-Soak-4 (→ Share-DL-Spike if a day is free) → B12-3 → B12-4a. Worker `index.js` split (router vs handlers) belongs in the Tidy block before the internal review.

## Share-Soak-4 (9 Oct 2026) — encrypted soak tools: real v2 links, decrypt-and-check downloader

**Start:** half-day budget; design approved as proposed. Rajesh's aside: BLAKE3 vs SHAKE256 in regulated tenders → memory `tender-crypto-agility` (watch item; browser-side FIPS swap would be SHA-256, WebCrypto has no SHA-3).
**Found:** `soak-headless.mjs` had not worked against the live Worker since B12-1c / KV-Fix-1b (no `X-Test-Credential`, no `tail_url`, parts not +16 B, 90-day expiry over the 7-day ceiling). Brought up to `test-upload.html`'s flow in both modes.
**Built (`worker/scripts/`):** `lib/soak-common.mjs` — imports the browser's own `frontend/crypto.js` / `fragment.js` / `config.js` (Node 26 loads them as-is; run with `--disable-warning=MODULE_TYPELESS_PACKAGE_JSON`), self-test against `part-crypto.test.js` vectors (T2, T4, BLAKE3 "abc") — both tools refuse to run on a mismatch; plaintext generator part i = SHAKE256(`"refueler.share.soak.plain.v1" ‖ 0x00 ‖ seed16 ‖ BE32(i)`) (test data, not a cipher; 54 ms / 32 MiB vs 500 ms noble BLAKE3 XOF); seed travels in the link filename `refueler-soak-<seed>.bin`. `soak-headless.mjs --encrypt` — fresh K per run, `derivePartKey` + `encryptPart` (counter nonce + last flag), retries resend the same ciphertext buffer, `X-File-Name: encrypted-payload`, `X-Total-Bytes` = plaintext, ciphertext Merkle root, plaintext SHA-256 logged (pre-pass), link → `~/.refueler-soak/<uuid>.link` (0600, dir 0700), never logged; admin key from env `SOAK_ADMIN_KEY` (paste markers/whitespace stripped, length logged only). `soak-download.mjs --decrypt` — link on stdin only, v2 only, `ceil(z / CHUNK_SIZE) == total_chunks` before any part request, exact ciphertext lengths from z, `decryptPart` failure = fatal integrity failure (never retried), plaintext compared with the regenerated soak part, whole-file SHA-256 at the end; progress file holds no key or link. Raw mode: parts now CHUNK_SIZE + 16 at ciphertext offsets (old plaintext-size geometry and `meta.total_bytes` are gone).
**Tests:** offline — round trip, swapped index / truncation (last flag) / extension / wrong key all refused. **Live 1 GiB (Mullvad on):** upload `afa016fe…` 32/32 at 5.66 MiB/s, finalised; decrypt download 32/32 at 13.2 MiB/s, `X-Integrity` ciphertext-storage-verified ×32, local root = finalised root, plaintext SHA-256 `589228da…0145` = uploader log = `shasum`; re-run resumed 32/32 and re-matched; link with wrong z refused before any part request. **Safari ✓ (Rajesh, Mac, Mullvad on):** receiver card (name, 1.00 GB, available until Thu 15 Oct 18:16), Download → Downloaded, 32 parts in DevTools, file 1,073,741,824 B, SHA-256 `589228da…0145` ✓. Note for Share-Receiver-3: card shows GiB labelled "GB" (Finder says 1.07 GB).
**Overnight:** 100 GiB encrypted upload started 18:35 BST, UUID `f539e9b2-f19f-455e-b5f2-ae2aa32c0d34`, plaintext SHA-256 `b7409e94…9246`, log `~/.refueler-soak/upload-100g-1791567307.log`, expires 15 Oct 17:38 UTC. Expected finish ≈ 23:30–00:15 BST. Its download (SSD) belongs to DL-Spike / DL-Soak.
**Cleanup owed:** delete `afa016fe…` (1 GiB) after the Safari check; `f539e9b2…` after DL-Spike, or let it expire 15 Oct.
**Next:** Share-DL-Spike if a day is free → B12-3 → B12-4a.
