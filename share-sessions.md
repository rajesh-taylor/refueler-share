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
| B12-1c | 1–2 | Sonnet | S1.1 build, re-scoped (Worker + frontend) — slot TBD by Rajesh |
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

## Share-MCP-Chat-1 (26 Sep 2026) — ad hoc discussion: MCP direction, agents, pricing (no code)
Discussion only; nothing locked. Draft plans page saved to `docs/drafts/` (see its README).
**Rajesh's calls:**
- **Agents/MCP first**, consumer-assistant market second (stay open to it). MCP and Chartered expected to merge over the next few years. Lead the agent pitch with bearer credits as a spending cap by design ("your assistant can't spend more than you gave it").
- **Silent Drop before receiver-pays.** The "prepaid request link" idea (receiver's agent puts credits in a one-use upload link; sender needs no account) waits until after SD — no paying customers for a while.
- **Cashu credits are internal to Share only** — never public or monetary; closed loop, no cash-out. Rajesh: no regulatory issue on that basis.
- **Don't compete on price** with Dropbox / Smash / WeTransfer if they enter MCP; compete on the privacy stack.
- **Rate card v2 needs 1–2 Opus sessions (Pricing-v2-Opus)**: price holding time (occupancy) as well as throughput; bill per 32 MiB block, not `ceil(GB)` (today a 2 MB send is charged as 1 GB). Possibly price in GBP and convert to credits. Credit-block pricing undecided (1 credit = 1 sat as the unit, not necessarily the price). Watch the gap between metered cost and the £24 plans.
- **Personal agent key** (Citizen/Sovereign member's own assistant spends from their allowance, daily limit; on Sovereign the key holds a small credit stack) — wanted, switched on when an MCP is plugged in, with an onboarding story. Conflicts with the locked `Sovereign ⊅ API` → decide at an Opus.
- **Pro Bono × agents:** open — a free agent path (agents can't do Turnstile) or no agent access on Pro Bono.
- **Plans page rewrite:** after Berlin and B12-4a. Live page still shows Skint Tog / Creative £12 / Production Max £24, a stale feature list, "End-to-end encrypted", and no API/MCP. Draft B (Agents first) preferred: register first, code snippet below it; use live Share Paper/Carbon tokens.
**MCP ideas on file (not scheduled):** `refueler_fetch(share_url)` — free, keyless collect + verify + decrypt in the agent; no SD/B8/node dependency; acts as a funnel. The `payment.offer` slot could carry "Share credits accepted (keyset id) + top-up link" (NUT-24-style 402) instead of BOLT12 — the agent presents a prepaid voucher, so inline Lightning isn't needed. Distribution: a local npm server doesn't reach cloud/phone assistants — revisit (desktop extension, sandbox-side encryption, or web hand-off) without breaking the ciphertext-only rule.
**Safari 100 GiB soak ✓ (26 Sep 2026, `test-upload.html`):** UUID `3a4d8828-6812-4eb9-9b5d-e31b60c72fac` · 3200/3200 chunks, 0 failed after retries, finalise reached · 6h 30m · 4.37 MiB/s · download-verify 5/5 sampled chunks (0/640/1280/1920/2560) `ciphertext-storage-verified`, WASM BLAKE3 GREEN. Sample check, not a full-file download. Unblocks the Worker `8b19a65` deploy (DAD-2 fix).
**Stripe checkout — not paused (Rajesh, 26 Sep):** paid cards are greyed out ("Coming Soon") on the live plans page, so no one can pay. Closes the Cred-Fix-1 open question.
**Worker `8b19a65` deployed (26 Sep 2026, after the soak):** version `9bb4920a-074d-452f-9250-6796167dab43`. Pre-deploy DAD test (old Worker, Safari, first open): file landed in Downloads, but the page showed "This link is no longer active" instead of the "Transfer permanently deleted…" line. No code path in `download.js` does that after a successful download; the likely cause is the page reloading after the download. Retest on the new Worker is pending. **Noticed:** the deploy still binds stale vars `BLINK_WALLET_ID`/`BLINK_API_KEY` (Blink is dead) and `PRICE_CREATIVE_*` (£12, a retired tier) — clean up in `wrangler.toml` post-Berlin.
**DAD retest ✓ on Worker `9bb4920a` (Safari, Rajesh, 26 Sep):** calm pre-download dialog → Download → "Complete 100%" + "Transfer permanently deleted from Refueler's servers." + file in Downloads; reopening the link → "This link is no longer active". The earlier odd result was on the old Worker; treat it as closed unless it recurs. `curl /meta` 410 check not run (placeholder UUID); the reopen screen is the functional proof.

## Share-Download-Opus (27 Sep 2026) — large-download design + raw 100 GiB download test (Opus, no Worker/frontend code)
**Spec (PROPOSAL, awaiting Rajesh):** `docs/Share-Download-spec-v1.md`. Safari/Firefox: service-worker streaming download replaces the RAM blob (blob capped 1 GiB); Chromium FSAA hardened (ordered parallel fetch, exact-length check, 6-attempt budget + pause-and-wait); no cross-session resume in browsers (`.crswap` discarded on crash; `keepExistingData` copies the file); full resume in a collector (MCP `refueler_fetch` + `refueler-collect` CLI, link via prompt/stdin, never argv); pre-download size / FAT32 / NTFS-on-Mac panel; `soak-headless --encrypt` harness. Decisions D-1…D-9 (§9), sessions Soak-4 → DL-Spike → DL-W1 → DL-1/DL-2 → DL-3 → DL-Soak, with DL-Soak green before paid cards open (D-7).
**Findings (code reading, not tested live):** F-1 on >128-chunk transfers DAD starts deleting when the tail chunk's response is *created*, before its body is streamed/verified — a tail mismatch still deletes (contradicts merkle-spec §3.4) and a tail disconnect leaves nothing to retry (fix D-DAD-2, Share-DL-W1). F-2 a mid-body cut (integrity failure) on large files is retried as a network error and ends "Download failed after several attempts"; only `byteLength === 0` is guarded. F-3 FSAA retry budget ≈ 7 s per chunk. Pro Bono 4 GiB in Safari/Firefox already needs ~8 GiB RAM (blob path). Download path never recomputes `blake3PlaintextRoot`; truncation via a lying `total_chunks` is undetected (D-9 → fragment-grammar owner).
**Part 1:** `soak-download.mjs` written + scratch-tested (mock with 409/503/429/mid-body abort, kill-and-resume byte-identical, altered sidecar hash → chunk refused, DAD-armed refusal). Uses the Worker's vendored WASM BLAKE3 in Node (674 MiB/s, matches noble; noble alone 48 MiB/s). Transfer `3a4d8828…` confirmed DAD **off** (`pending_destruction: null`), no passphrase, expiry 1798208932. Target: "Portable 001" (APFS, USB, 750 GiB free). **Run ✓ (13:25–15:02 UTC):** 3200/3200 chunks, 100.00 GiB in 97.2 min, 17.6 MiB/s, `X-Integrity` verified on all 3200, 0 × 409/429/5xx/aborts/mismatches, 1 retry (chunk 2746 silent 300 s stall → spec adds a browser stall timeout). Local Merkle root = manifest root. Transfer still live after (DAD off) — delete only on Rajesh's yes. Script committed `3b801c2`.
**Rajesh decisions (27 Sep):** D-1…D-9 all as recommended; D-2 discussed (Pro Bono stays 4 GiB; receiver card warns before download). Receiver: **one card**, "Download / Not now" dialog removed, DAD line only when armed, no large-file panel, expiry shows countdown + exact local date/time, bottom line "No account or email needed." (drops "No history. Your data. Not ours."), Paper/Carbon themed. One card for all tiers — a tier-specific card would tell link holders whether the sender is an identified customer. Security baseline stays first even for agents (B12-1b, Cred-Fix-2, MCP-Fix-1, KV audit); MCP focus to be re-sequenced at a post-Berlin planning Opus. Interim Safari/Firefox memory fix: not wanted.
**Design canvas (private):** https://claude.ai/artifact/5RgC1FFAjpvrVy7mUAcH2j — receiver A (now) vs B (one card); homepage hero draft (not liked; homepage to be designed in a fresh session with the refueler.io repo).
**Cleanup (27 Sep):** `3a4d8828…` owner-deleted (`destroyed:true`, `/meta` 410). Brave 250 GiB soak `3dcccb35…` already gone since Share-Soak-2 (`/meta` 410). Read-only bucket audit: 71 objects / 26 UUIDs — 4 complete, 2 incomplete (in flight), 6 tombstone residue (12 objects would be swept), 1 wrong-size (reported only). No large soak data left in R2. Sweep still not run (post-Berlin, with the `SWEEP_PROTECTED_UUIDS` cleanup).

## Share-Receiver-1 (27 Sep 2026) — receiver page design (mock only, no code changed)
Carbon-first redesign of the page a recipient lands on. Mock v5 approved by Rajesh: https://claude.ai/artifact/1HRgQc8hxtcpod7ZKqE66t (copy `docs/drafts/share-receiver-mock-v5.html`). Build list with decisions R-1…R-14, findings F-1…F-5 and sessions N-1…N-4: **`docs/Share-Receiver-1-build-list.md`**.
**Key decisions:** three-role type rule (serif headline / mono labels / DM Sans for reading); "Download" verb; "No account or email needed."; DAD dialog dropped for the line "Deleted as soon as the download finishes. The link works once." (gated on Share-DL-W1); "password" never "passphrase" in copy; no date seal for recipients; finished screen shows the **newest Notes article** card + "Send your own file, free up to 4 GB →" (update if the free cap ever drops below 4 GB); whole refueler.io site defaults to Carbon.
**Findings:** F-1 date seal commits to SHA-256(BLAKE3 root ‖ seal_nonce), so opentimestamps.org can't match it to the file, and the recipient never keeps the nonce; live "Verify with opentimestamps.org" copy is false (unreachable today, paid-only). F-2 refueler.io status page says the password "never travels the wire"; the recipient's unlock POSTs it (over TLS). F-3 `frontend/index.html` is stale; `src/index.njk` is the mirrored page. F-4 timed availability is one from/until window (paid-only), not daily hours.
**Next:** N-1 Notes-List-1 (refueler.io, tonight; prompt `Notes-List-1-prompt.md`) → N-2 Share-Receiver-2 (medium, Rajesh decides pre/post Berlin) → N-3 Share-Theme-1 → N-4 copy fixes.

## Share-Receiver-2a (27 Sep 2026) — receiver page build, items 1–9 (N-2a) · shipped `82105b4` (refueler.io `8c9986c`)
Files: `src/index.njk` (receiver markup, `wordmarkSection: "Share"`, Source Serif 4 link), `frontend/share.css` (`.rx-*`; old `rc-*`/unlock/usp/signoff/integrity-card CSS removed), `frontend/download.js`. No Worker change. One sheet at a time: `#receiver-card` → `#unlock-screen` → `#download-card` → `#rx-done`, or `#rx-notice`; `.rx-mode` on `<html>` hides nav links, Plans · Status, HTTP/3 line, badge.
**Built:** ready/password/folder cards (ledger, R-5 expiry refreshed each minute + on tab return + exact open/close moments); timed window not-yet-open (Opens/Closes, "Download from HH:MM", full date if not today, auto-unlock) and closed-on-arrival (new); big-% downloading with "X MB of Y MB", "Preparing file" on the Safari/Firefox pass; finished screen with DAD line, Notes card (fetched after download from `refueler.io/notes/latest.json`, `credentials:'omit'`, `referrerPolicy:'no-referrer'`, 4 s timeout, schema + field + `https://refueler.io/notes/` checks, no card on any failure, none if a date seal is offered) and send line with R-12 comment.
**Rajesh decisions (27 Sep):** Source Serif 4 loaded for the Share page tonight (remove at N-3); keep DAD line "Transfer permanently deleted…" (checked: Worker `8b19a65` locks the link on the last piece and deletes everything in `waitUntil`, normally seconds; a failed batch leaves encrypted residue until a manual `/admin/orphan-sweep` — the sweep isn't on the cron); password row "Needed to download"; errors "Stopped" / "The download stopped." + today's message; wordmark "Refueler / Share"; footer (R-14) left for later.
**Fixed in passing:** Chrome/Edge — cancelling the save dialog left a dead Download button; Safari/Firefox — a network error mid-download hung on "Downloading" (now "Stopped"). `/meta` field names confirmed on a live link (`available_from_timestamp`, `available_until_timestamp`, `passphrase_protected`, `pending_destruction`); folder = `.zip` name from the fragment, never a manifest field.
**Caught by Rajesh in the local preview, fixed before ship:** `.rx-sheet{display:flex}` overrode `hidden` outside `.rx-mode`, so every receiver sheet showed on the upload page; and "/ Share" collided with the full nav at 961–1040 px (hidden there on the upload page). Lesson: after receiver changes, always check the upload page too.
**Live check (Claude, in-app Chromium, not Safari):** upload page clean (no sheets, no h-scroll); password link card + password screen, Paper + Carbon, phone width; deleted link → "Link closed". **Not tested live:** a real download end-to-end + live Notes card, folder link, Safari, password unlock (Rajesh types it), timed links (paid only), DAD. Preview harness (fake Worker, all states) was scratch only, not committed.
**Safari check ✓ (Rajesh, 27 Sep, after ship):** file link and folder link, each with password and delete-after-download: both downloaded correctly and failed correctly on second use.
**Findings logged in the build list:** F-6 `share-tokens.css` not loaded on refueler.io (upload-page `var(--mono)` etc. empty live); F-7 theme pill label wrong on load in Carbon; F-8 wordmark band.
**Next:** N-2b Share-Receiver-2b — items 10, 11, 12, 14, 15 (13 gated on Share-DL-W1).

## Share-Receiver-2b (28 Sep 2026) — receiver page build, items 10–12, 14 (N-2b) · shipped `22689ef` (refueler.io `8516a9a`)
Files: `frontend/download.js`, `frontend/share.css`, `src/index.njk`. No Worker change.
**Built:** item 10: date-seal offer removed (`_offerOtsDownload`, `decryptOts` import, seal-nonce plumbing); the Notes card is always tried on the finished screen. Item 11: "This link is no longer active." + new lede + send line (`#rx-notice-send`, dead link only; R-12 comment covers both send lines). Item 12: "This file didn't pass its check." + new lede (storage integrity only). Item 14: arrival motion: visible lines settle 170 ms apart, button last, once per sheet (class removed on a timer, so no replay after a cancelled save dialog, wrong password or the minute refresh, and nothing stuck faint in a background tab); downloading sheet never animates; Notes card settles in on arrival; `prefers-reduced-motion` turns it off.
**Local preview (scratch harness, fake Worker, in-app Chromium):** every state in Paper + Carbon, desktop + phone; permanent-record link makes no `/timestamp/seal` request; failed check on both download paths; plain upload page clean. Reduced-motion rule present, not toggled.
**Live check (Claude, in-app Chromium):** `✓ SHIPPED`; live `download.js` has no date-seal code; a random-UUID link on the real Worker shows the new dead-link notice + send line (Carbon). **Item 15 Safari ✓ (Rajesh, 28 Sep, phone width):** small folder with password + delete-after-download downloaded fine; Notes article link opened; Carbon → Paper switch worked; second use of the link showed "Link closed / This link is no longer active." with the new lede.
**Found:** F-9 (build list): the sender never gets the date-seal file either, so after item 10 no one can download a seal through the UI. `/timestamp/seal/{uuid}` (Worker) and `decryptOts` (`timestamp.js`) now have no caller; kept for the future checker. Live since 2a: the upload page header read "Refueler / ShareSHARE" at ≤640 px (wordmark "/ Share" + the active nav link).
**Header fix (after 2b, 28 Sep, Rajesh's go-ahead):** the double "Share" is only at ≤640 px, where global.css keeps just the active nav link; `share.css` hides that link on the upload page (641–960 px it's a real menu item, kept). Previewed 375 / 560 / 700 / 1000 px, no side-scroll. Shipped by Rajesh after this entry.
**Header fix shipped:** `3671e93` (refueler.io `55e4bf0`); Rajesh confirmed on phone: "Refueler / Share", menu button, theme pill.
**Share-Upload direction (Rajesh, 28 Sep):** remove the lock message; upload card like the homepage code card; A/B mock (variant A = code card); a Share sub-menu (Send · Plans · Status, room for sign-in later) under the header on every Share page, with Plans/Status taken out of the top nav; each product section a mini site, built with Eleventy data + one include. Claude recommends "Encrypted in your browser" for "End-to-end encrypted" (decide in Upload-1). Found: Plans/Status use a separate `share-nav.njk` header, so three headers for one product. **Share-Upload-1** (design + A/B mock, no code) Tue 29 Sep; **Share-Upload-2** (build, two repos) Tue 29 Sep evening if Upload-1 is complete and there's time, otherwise after B12-1b (Rajesh, 28 Sep). **Share-Cleanup-1** (N-4 copy fixes, N-3 Carbon default, F-3 stale pages) after Upload-1, not in parallel with Upload-2: prompt `Share-Cleanup-1-prompt.md`. MCP work starts the week of 12 Oct. Prompt + Upload-2 notes: `Share-Upload-1-prompt.md`.
**Design ideas listed for Rajesh (not built):** fix the double "Share" (done, above); curly apostrophes in copy; link-preview title/description (drop lowercase "refueler share" and "No history"); tab title by state (never the file name); later in refueler.io: preview image, Safari toolbar tint (N-3).

## Share-Upload-1 (28 Sep 2026) — upload page + Share sub-menu design (mock only, no code changed)
Mock v1 A/B (A = homepage code card, B = open sheet) → Rajesh chose B → v2 → v3 approved: https://claude.ai/artifact/MAQmeQhhM3KieZo1Cr2FYg (copy `docs/drafts/share-upload-mock-v3.html`). Build list with decisions U-1…U-11, findings F-10…F-21, Upload-2 build items: **`docs/Share-Upload-1-build-list.md`**.
**Key decisions:** open sheet, no card; setup in one hairline box, the "empty ledger" (File / Size / Available until rows fill in place; facts row at its foot: "No account or email needed · Encrypted in your browser · Free up to 4 GB"); "Choose a file" filled + "or a folder" link; whole page takes a drop ("Release to add."); phones get button + link only; "Choose another" for a wrong file (keeps settings and the passed check); Turnstile `interaction-only`, full width when it shows, button queues "Checking…"; sub-menu Send · Plans · Status as one centred segmented pill ("Subscriber sign-in" added only when sign-in exists); link first on "Link ready", QR on request, sharp, dark on light; HTTP/3 line and badge removed; page follows the theme.
**Findings:** F-10 paid options unreachable (`tier: 'free'` hard-coded, visibility set after the card hides); F-11 upload errors silent (page freezes); F-12 status banner → `/status.html` (homepage); F-13 cap link → legacy `/upgrade`; F-14 stray public `/share/-includes/share-footer/`; F-15 ≤640 px double label also on `/legend/`; F-16 QR inverted in Carbon; **F-19 live QR blank** (qr-creator canvas inside an SVG, 0 × 0, checked live); **F-20 Vanadium (GrapheneOS) likely can't send or receive** (JIT off → no WASM → `loadDeps()` rejects; untested); **F-21 every Share page imports `@noble/secp256k1` from esm.sh at runtime** (no SRI, no CSP; receiver loads it and WASM BLAKE3 for nothing).
**Next:** **Share-Deps-1** (F-20, F-21; prompt given in chat) → **Share-Upload-2** (build, two repos, refueler.io first) → Rajesh tests on iPhone 13 mini (Safari) and Pixel 9a (Vanadium, defaults). GrapheneOS Notes article after Deps-1 proves Share works on Vanadium's defaults.

## Share-Deps-1 (28 Sep 2026) — no more esm.sh; Share works on GrapheneOS Vanadium · shipped `b8673e2` (refueler.io `d9acaab`)
Files: `frontend/crypto.js`, `download.js`, `upload.js`, `merkle.js` (comments), new vendored `frontend/noble-secp256k1.js` + `frontend/noble-blake3.js`, `bin/lib/share-mirror.sh` (both in `SM_VENDOR`), `docs/Share-CSP-1-notes.md`. No Worker change.
**Built:** `@noble/secp256k1` 1.7.2 vendored from the npm tarball (sha512 = npm integrity; one line changed: Node `crypto` import → `undefined`), replacing the runtime esm.sh import (F-21). Receiver mode no longer calls `loadDeps()` (uses neither lib). BLAKE3: WASM first, checked against BLAKE3("abc"); if WebAssembly is missing, won't compile or answers wrong → vendored pure-JS `@noble/hashes` 1.7.2 blake3 (esbuild bundle), loaded only when needed (F-20). `loadBlake3()` / `loadSecp()` / `blake3Impl()`. If loading still fails: receiver "Stopped / Share couldn't start in this browser." notice, upload the same line in the progress text (rest of F-11 stays for Upload-2).
**Scratch-tested:** official BLAKE3 vectors 35/35 in WASM, no-WASM, WASM-blocked and `node --jitless`; WASM vs JS identical chunk digests, plaintext root and Merkle root on a 3 × 32 MiB + tail encrypted file; merkle `selfTest()` pinned roots; NUT-00 blind/unblind. JS BLAKE3 with no JIT: 2.5 MiB/s (M-series Mac); NUT-00 25 ms. **Live (in-app Chromium):** `blake3Impl() === 'wasm'`, fallback file not fetched, no esm.sh request in either mode; receiver goes straight to `/meta`.
**Device tests (Rajesh, 28 Sep):** iPhone 13 mini: Mac → iPhone file (DAD) and 104 MB folder (DAD) in Brave, small file in Safari (no DAD, opened twice) — all fine; iPhone Safari → Mac (DAD) fine, second open "Link closed". **Pixel 9a, Vanadium, defaults: Mac → Pixel 7.9 KB received (Carbon, Android save picker) and Pixel → Mac sent — F-20 fixed.** Which BLAKE3 Vanadium ran is unknown; a large Pixel send is untested.
**Found:** F-22 download bar jumps 15 % per 32 MiB chunk (whole-chunk `arrayBuffer()`; update as bytes arrive); F-23 upload page flashes ~½ s before the receiver card (→ Upload-2); F-24 damaged-key link gets the "couldn't start" wording; F-25 admin `test-upload.html` still imports from esm.sh; F-26 permanent record POSTs to the OTS calendars from the browser, not via the Worker. Rajesh's iPhone opens Mail links in Brave (default browser): open Safari explicitly for Safari tests. GrapheneOS Notes idea added as article 15.
**Next (Rajesh, 28 Sep):** Share-Cleanup-1 (Tue 29 Sep) + small extras if time → fresh session on the btc++ hackathon brief → Berlin 30 Sep–4 Oct → **Share-Upload-2 after Berlin** (build list items + F-23) · Share-CSP-1 later (draft in `docs/Share-CSP-1-notes.md`, after F-25 and the inline scripts move out).

## Share-Cleanup-1 (28 Sep 2026) — N-4 copy, N-3 Carbon default, F-3 stale pages + F-12/F-13/F-14 · refueler.io `e4463bb`, `4acc358` · shipped `d1bacad` (refueler.io `27d90c0`) · `7c9c692`
**N-4 (refueler.io `e4463bb`):** Plans ×2 + legacy `/upgrade.html`: "Passphrase download gate" → "Password-protected downloads" (R-7). Status card: "SHA-256 password hash" / "✓ Optional password lock" / "…Only a hash of the password is stored. When the recipient unlocks, the password is sent over an encrypted connection, checked, and not kept." (F-2; Worker `/auth` checked: hashes, compares, never logs or stores). No other reader-facing "passphrase" on refueler.io or in Share JS.
**N-3 (refueler.io `4acc358`):** `head.njk` default Carbon + Source Serif 4 site-wide (F-5) + pill label re-set on `DOMContentLoaded` (F-7); pill markup starts "Carbon / Paper" (`nav.njk`, `share-nav.njk`). Chambers default Carbon. `global.css` header comment. `dev/index.html` already Carbon (own localStorage), unchanged. POS tablet (`merchant-tablet-logic.js`) left out (own `rfTheme`, Rajesh). **Also found + fixed:** `notes.js` replaced the site `toggleTheme` with its own that updated a non-existent `#theme-btn`, so the Notes pill never changed — its theme block removed (head.njk owns it); Chambers cookie regex `'\s*'` in a plain string = `s*`, so a saved theme was ignored unless `rs-theme` was the first cookie — fixed. **F-14:** stray `src/share/-includes/` deleted (now 200 + homepage).
**Share part (shipped `d1bacad`, Rajesh):** Share-only Source Serif `<link>` removed from `src/index.njk`; banner → `/share/status/` (F-12); cap link → `/share/plans/` (F-13, link only — "Creative Premium supports transfers up to 100 GB" text waits for Upload-2 copy); `share-tokens.css` header comment.
**F-3 (`7c9c692`):** deleted `frontend/index.html`, `status.html`, `upgrade.html` and `src/status.njk`, `src/upgrade.njk` (refueler.io owns Status/Plans/`/upgrade.html`). Eleventy output stays `frontend/` (the `src/blake3` → `frontend/blake3` passthrough feeds the mirror check); `frontend/index.html` gitignored, still built for local preview. `src/_includes` kept (local preview), synced to Carbon + Source Serif. CLAUDE.md lines updated.
**Checked:** local build of refueler.io (in-app Chromium): no cookie → Carbon + correct pill on home, Notes, a Notes article, Share, Plans, Status, Legend, Privacy, Chambers, `/upgrade.html`; host cookie `paper` → Paper everywhere incl. Chambers; Notes pill toggles; Status + Plans copy at 375 px. Live: every page has the font link, pill markup and new copy; Notes pill toggles both ways; `/share/` loads Source Serif 4 from the site-wide link only; banner/cap links live. **Safari ✓ (Rajesh, 28 Sep):** private window first visit → Carbon, pill "Carbon / Paper"; Paper survives reload; receiver headline in Source Serif; phone width fine. (A new *private* tab starts Carbon again: Safari gives each private tab its own cookies — expected.)
**Extras after close (28 Sep, Rajesh's go):** browser toolbar tint (`theme-color`) follows the page's `--bg` on load and on switch, and F-15 (≤640 px: hide the active nav link when the wordmark names the section, e.g. `/legend/`) — refueler.io `15646f8`; Share link-preview title/description → "Refueler Share — encrypted file transfer" / "Encrypted file transfer. Files are encrypted in the browser before upload. No account or email needed." (Upload-1 defaults) — shipped `104c048` (refueler.io `6ba5c9a`); this file trimmed 496 → 473 lines (25–26 Sep entries compacted, open items carried).
**Desktop-chat memory import (28 Sep):** Rajesh exported the claude.ai Share project (145 items; chats reach only 7–21 Jul, Aug–Sep from its memory files; export kept off-repo in `~/Downloads`). Swept against both repos, git and live: most done or already recorded; leftovers → `Share-Master-Context.md` §Backlog imported from desktop-chat memory. Also: CLAUDE.md + Master Context no longer announce the open B12-1b issue in public wording; `@refueler/mcp-server` publish held until MCP-Fix-1 (not on npm); admin test-credential route confirmed 401 without key; stale CORS note, Share-6 finalise contract note, `DESIGN-TOKENS.md` (marked superseded), Notes article 4 caveat (+ `share.refueler.io` → `refueler.io/share/`), Upload-2 info-card note. refueler.io project export next.
**Left over (not done):** `frontend/upgrade.css` now unused (`SM_CANON_ONLY` in `share-mirror.sh`); legacy refueler.io `/upgrade.html` (Stripe form, retired tier names, `/upgrade.css` 404) still live — both for Upload-2 / plans draft B.

## Share-B12-1b (5 Oct 2026) — test gate + S1.1 R2 enforcement gate (split session) · deploy `0d2f94d9`

**Part 0 ✓:** `npm test` clean on unmodified `main` (618 passed, 25 files) — no `npm ci` needed, Share-CI-1 held.
**Split at Step 0 (Rajesh, option 2):** the code differs from S1.1's premise in two ways, so only the gate ran here:
1. `/initiate` writes `total_bytes` into the R2 manifest (`createManifest`), and `/meta` + download (receiver card size, progress) read it. "Tail length never stored" does not hold today; removing it changes the receiver card. Decision for the re-scoped session, not a silent fix.
2. Tail URL at initiate needs frontend work: `upload.js` fresh path (>256 chunks, tail outside first batch), the IDB resume path (tail URL must be saved, `/urls` won't remint it), and `admin/test-upload.html`. `refueler-mcp` doesn't call `/urls`.
**Built:** `presign(key, { contentLength })` in `r2_presign.js` — optional; omitted = byte-identical host-only URL (pinned signature test). Admin `/admin/r2-presign-test` accepts `content_length` (dev bucket forced). 3 tests → 621 passed. `/initiate` and `/urls` unchanged.
**R2 gate ✓ (live, dev bucket, Rajesh ran curl):** URL signed for 16 B — 17 B → 403 · chunked 17 B / 1 MiB / 64 MiB → 403 · 16 B → 200. Dev key `b12-1b-gate/run2/0000` absent afterwards (nothing written). A chunked body of the *correct* length → 200 (edge sends a Content-Length; not a bypass). **R2 enforces signed `content-length`; S1.1 is buildable.**
**Re-scoped S1.1 build (B12-1c) carries:** checklist items 1, 2, 4, 5 from `Share-B12-1b-prompt.md`; the `total_bytes`-in-manifest decision; frontend tail-URL handling (fresh + resume + test-upload) via `ship-frontend.sh`. Reuse `wrongSizeSegments` (`sweep_rules.js`) for the finalise size check.
**Also:** `worker/.dev.vars` (gitignored, never committed) had a pasted heredoc wrapper (`cat > … << 'EOF'` / `EOF`) as first/last lines — removed; values untouched.
