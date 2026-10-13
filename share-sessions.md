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

## KV-Fix-2 (9 Oct 2026) — compact (compacted Share-DL-Spike)

| Session | Commit | Summary |
|---|---|---|
| KV-Fix-2 · 9 Oct | deploy `a47404a6` | API keys + credit pools KV → Supabase (`api_keys` hashes only, `api_credit_pools`, atomic `api_credits_spend`; migration `supabase/migrations/20261009_kv_fix_2_api_keys.sql`). `api_store.js` ≤ 60 s cache, Supabase down → 503, no KV fallback; sandbox keys only on `/api/v1/sandbox/*`, refused at issue. `kv_fix_2.test.js` 25. Live check ✓ (revocation 5 s). KV API/sandbox records deleted; two unused Cloudflare tokens deleted. Runbook v1.1. Full narrative in git history. |

## API-Repair-1 (9 Oct 2026) — compact (compacted B12-3)

| Session | Commit | Summary |
|---|---|---|
| API-Repair-1 · 9 Oct | deploys `48476e56` → `8aa38636` → `1d7a9e2a` · `refueler-mcp` initiate signed | `seal.js` + sealed `cref_ct` (no raw key/ref at rest); Chartered initiate HMAC-only (`requireApiAuth`), soak credentials keep their bypass; webhook/DLQ/receipt routing manifest → org → MAC'd `wh_config_{orgtag}`, URL re-validated per send; receipts v2 signed with the client's whsec, owner-only pull; `cargo.accepted` at finalise, `transfer.confirmed` after DAD; hostname cron from `WL_CONFIGS`. `api_repair_1.test.js` 32. Live ✓ via `bin/api-repair-1-live-check.mjs` + named tunnel `wh-sink.refueler.io`. `ADMIN_KEY` rotated at close. Full narrative in git history. |

## X3 naming + Share-JS-Split-2 (9 Oct 2026) — compact (compacted Research-Review-2) · `4405646`, `2b6a359`, ship `67e367b` (refueler.io `4d9d59f`)
X3 names locked: Harbourmaster = SD Quay owner (Locke only); Custom House = Chartered org admin; Execution Dock = Navy Office live view (`auth_ping.js` 403 text rides the next Worker deploy). Frontend split by script, every line placed once: `upload.js` → 10 modules, `download.js` → 6, `crypto.js` → crypto/config/progress/zip/locke; 27 mirrored modules, none over 340 lines, no barrel. Worker 730 ✓; live ✓ Safari (password + DAD, 407.5 MiB folder zip).

## Share-Soak-4 (9 Oct 2026) — compact · `4c7759a`
Soak tools back on the live flow; `--encrypt` / `--decrypt` on the browser's own crypto (KAT self-test, `lib/soak-common.mjs`); 1 GiB round trip ✓ + Safari ✓; 100 GiB run 2 ✓ `fcf80898…` (4 h 56 m, 0 failed). Research notes `docs/Share-research-notes-2026-10.md`.
**Do-not-retry (permanent):** never start a long soak from the Claude Terminal panel — a Claude app auto-update killed 100 GiB run 1 (9 Oct). Use macOS Terminal.app (`caffeinate -i nohup … &`).

## Article-Rewrite-1 (10 Oct 2026) — compact (compacted Research-Review-4) · docs only — subpoena article rewrite (draft 1); agreed Password-Opus (now Link-v3-Opus, row 16b), transparency report (16c), self-hostable node (21), live handoff (22); licence wording (prior art, never "protects").

## Article-Rewrite-2 (10 Oct 2026) ✓ — subpoena article done: draft 2 live (refueler.io `4370f80`), 375 px table + modal ✓, dropped "The host isn't… The key is." (house line kept). Next: Share-DL-Spike (iPhone Safari + Pixel Vanadium) → B12-3 → B12-4a.

## Share-DL-Spike (10 Oct 2026) — SW streaming download proven: 100 GiB Safari, Firefox, iOS 5 GiB; Chrome FSAA timings · scratch `dev/dl-spike/` + spec §12

**Start:** full-day budget; design approved as proposed (scratch page on localhost, link read from the `.link` file into memory only, SW fetches + decrypts parts itself with the browser's own `decryptPart`, `Content-Length = z`, hidden-iframe navigation, ping before navigate, 10 s keep-alive, fetch event held open). iOS first skipped, then added (relay mode + quick tunnel). Lives in `dev/dl-spike/` (beside `dev/share-harness/`), not `spike/dl/`.
**Built (`dev/dl-spike/`, never mirrored or shipped):** `serve.mjs` (loopback only; serves `frontend/crypto.js`/`config.js`/`fragment.js` as-is; classic-SW build by stripping import/export; unknown paths → HTML stand-in like refueler.io's 200-homepage; `POST /log` → `~/.refueler-soak/dl-spike.log`, no key/link; `--relay` on :8788 rewrites `WORKER_URL` to `/relay` and streams `/meta` + `/download` through for a phone on a cloudflared quick tunnel), `sw.js`, `parts.js` (exact length, 120 s stall timeout, 6 attempts 2/5/15/30/60 s, `decryptPart`, 2 in flight), `index.html` (SW + Chrome FSAA + keepExistingData buttons, stall option), `memwatch.sh`.
**Results (spec §12, all SHA-256 ✓ against the uploader log; Mullvad on):** Safari 26.6.2 macOS **100 GiB** `fcf80898` → USB APFS SSD 1 h 37 m 55 s, 17.4 MiB/s, 0 retries, `X-Integrity` ×3,200, WebKit memory flat (peak 2.2 GiB once, then 0.5–1.3 GiB). Firefox 157 5 GiB 5 m 58 s, 14.3 MiB/s; again with a **180 s stall** — survived. iPhone 13 mini Safari 26.6.2 5 GiB via relay 28 m 43 s, 3.0 MiB/s (Mac upload-bound), 3 network retries, AirDropped back ✓. Chrome 154 FSAA 5 GiB APFS 5 m 06 s, `close()` 16.7 s; exFAT disk image 16 m 07 s (image overhead), `close()` 17.2 s; `keepExistingData` re-open 3 ms APFS vs **66 s** exFAT.
**Findings:** D-1 stands. D-8 can relax ("keep Safari open, screen on") after the screen-lock run. Firefox ignores "Always ask where" for this download (open/save only → default folder). Chrome on exFAT shows a 0-byte file under the real name at once. Chrome needs a "Finishing…" state (~17 s per 5 GiB). Quick tunnels expire when idle (restart, new URL).
**Cleanup:** R2 `afa016fe…` (1 GiB) + orphan `f539e9b2…` (~66 GiB) deleted by exact key (`wrangler r2 object delete --remote`, 8 at a time, 3,236 keys, 0 failures; `/meta` 404 both; `root_verified:afa016fe…` KV deleted). Orphan-sweep report: neither UUID present (HTTP 200) ✓. Local test files, the exFAT image, the old 1 GiB soak download and dead link files deleted. `fcf80898…` (100 GiB) and `dbd4cc74…` (5 GiB) left to expire (15 / 16 Oct).
**Side decisions (Rajesh):** served-code integrity — WEBCAT route, plus an installable app (GitHub + signing fingerprint, Obtainium, Zapstore) and the CLI/MCP collector; reproducible builds + published fingerprints first; slower, more structured releases welcomed. OHTTP stays on the roadmap (row 19). Cloud research (served-code integrity + OHTTP) runs after this session. Informational article on the spike: draft `docs/drafts/dl-spike-article-draft.md`, post in about a week.
**Snag noted (Rajesh):** Plans / Status pills feel slow to switch. Measured: HTML 19–26 KB, server 0.14–0.21 s on a warm connection (first connection ~1.2 s with Mullvad: TLS). So not page size — check in Safari Web Inspector (Status live fetch before render? fonts / render-blocking CSS/JS, theme script); fix candidates: prefetch on hover, render shell before data. refueler.io-owned pages; small session.
**Not run (next week, Rajesh):** Pixel 9a Vanadium · iPhone screen-lock · 100 GiB on Firefox/Chrome · Safari stall.
**Next:** cloud research (served-code integrity + OHTTP) → B12-3 → B12-4a. Spike leftovers next week.

## Served-Code-Opus (10 Oct 2026) — compact (compacted Research-Review-4) · docs only — Share to `share.refueler.io` (Block A: X5-Plan → X5-1 → X5-2 → Share-Release-1); Block B V2 beside SD; SRI-only dropped; OHTTP dropped for Nostr relays (six features, rules in row 19); The Gallery = row 23; CLAUDE.md 2.14, BRIDGE v10.1 in six repos.

## B12-3 (11 Oct 2026) — storage quota, Registered-rail Chartered · deploy `605d6991` · migration `20261011_b12_3_quota`

**Task 0 (S6.10):** initiate maps a Citizen upload to **no** subscriber — `resolvedTier` is fixed `'free'`, no email/customer ID/session is read, so nothing can be charged to someone else; but there is no Citizen principal either → Citizen quota waits for B12-4a (Rajesh: build the machinery now, wire Chartered). Client-supplied inputs listed; flagged `parseInt` without safe-integer checks and the KV-compared random session token (S1.3 case 2 → `UPLOAD_SESSION_KEY`).
**Build gate (real R2, scratch Worker via `wrangler dev --remote` on `refueler-share-dev`, nothing deployed):** content-length re-run (live Worker presigner, Rajesh) 6/6 — ±1 byte → 403, full chunk + 1 KiB · create-if-absent (`etagDoesNotMatch: '*'` and `If-None-Match: *`) 5 racers × 10 → one winner, tombstone refuses · `etagMatches` latch 5 × 10 → one winner, stale etag refused · signed `If-None-Match` presigned PUT, full + 1 KiB → absent 200 / exists 412 / header omitted 403 / wrong length 403 (logged for B12-Audit, not adopted). Miniflare matches R2. Test objects deleted; temporary R2 token scrubbed (first one pasted was an old finance key — secret ≠ token value; R2 secret = SHA-256(token value)).
**Built:** migration (2 tables, CHECKs, RLS deny-all, service-role-only `quota_reserve` / `quota_finalise` / `quota_release` / `quota_reconcile` / `quota_provision` / `quota_get` / `quota_now`; lock order account → reservations; lazy expiry at reserve) · `quota_store.js` (`quota_ref` = tagged HMAC of org16 under `QUOTA_REF_KEY`, 5 % `quotaBand`) · `upload_session.js` (`v1.<exp>.<chunks>.<mac>`; session = min(now + 6 d, expiry); URLs expire with it; BLAKE3 session hash) · `seal.js` `qref_ct` = quota_ref ‖ session_hash (fixed 64 B) · `latch.js` (create-if-absent, conditional replace, `updateManifest`, `latchConsumed`, one `releaseHeld`) · initiate (strict ints, 8,000-chunk max, checks → cap → reserve → spend → create-if-absent; every later failure releases; 402 band / 402 not-provisioned / 429 in-flight) · `/urls` + finalise (bound from the MAC, R2 state for spent/deleted, conditional finalise write, `quota_finalise` + 3 retries) · latch on DAD/owner/bearer delete, confirm (now the shared destruction), expiry + orphan sweep, admin purge (now leaves tombstones) · reconcile (03:00 Task 4 + `POST /admin/quota-reconcile`; aborts unwritten on > 900 manifests or an unopenable seal; AE drift counter) · client create provisions 8,000 chunks / 20 in flight; `POST /api/v1/admin/storage-quota` · storage summary `soak` line + Navy Office modal row (refueler.io `navy-office.js`, Rajesh commits).
**Found + fixed:** download-start, timestamp and finalise wrote the manifest unconditionally — a stale copy could undo `consumed:true`, re-open a deleted transfer and let a second path win the latch (double credit-back). All three conditional; race test added.
**Spec deviations (Rajesh approved):** commitment not in the session MAC (no later verifier can check it; UUID binds) · confirm drops its dock "collected" mark (B12-1: absence is the trace) · admin purge leaves tombstones · drift in the user's favour only if reconcile fails for 6 nights running.
**Tests:** `test/b12_3_quota.test.js` 41 (KATs from Node crypto + noble blake3: quota_ref, session MAC, session hash, qref_ct; S1 matrix; every deletion path releases once; resumed partial delete releases nothing; stale-writer race; reconcile skip/abort). Mocks: `_r2_mock.js` etag + `onlyIf` + delimiter; fake Supabase mirrors the SQL. Updated b12-1d, commitment, credential-v2, kv_fix_1a/1b, dock_b12, confirm_tg. **771 pass, 0 fail** — per file, and combined `npm test` (Mullvad off, Rajesh): 36 files, 771 passed, 29 skipped, 13.5 s. S2 matrix unchanged in `kv_fix_1b` (32); one bypass call site (`index.js` `checkTestCredential`).
**Supabase live:** self-test block 22/22 (rolled back); 5 reserves at limit−1 → one winner (may have run sequentially — the row lock is the guarantee); advisor clean for Share tables. Advisor flagged **non-Share** anon-callable SECURITY DEFINER functions (`decrypt_bolt11`, `encrypt_bolt11`, …) → task chip, not touched.
**Live ✓:** `bin/b12-3-live-check.mjs` (Rajesh, Brave): provision, reserve, 402 band, refused credential still works, unsafe header 400, forged/other session 401, tail-index 400, finalise + convert, finalise again 409, in-progress delete cancels, DAD releases once, owner delete after DAD releases nothing, reconcile 0 corrected, soak round trip touches no quota, revoke. Test client's Supabase rows deleted (0 left). Safari: small DAD transfer ✓ and 420 MB zip ✓ (Safari asked where to save — first time).
**Secrets:** `QUOTA_REF_KEY`, `UPLOAD_SESSION_KEY` new. `ADMIN_KEY` typed into a command line (shell history + screenshot) → **rotate** (Rajesh, after charging).
**Next:** research reviews (Opus, one each: `research-split-erasure` → `research-b7-mint-node` → `research-nostr-groundwork` → `research-ark-wavelength`) → B12-4a.

## Research-Review-1 (11 Oct 2026) — compact (compacted Research-Review-4) · docs only — split/erasure reviewed; Link-v3-Opus (password + held key half `K_c` at Hetzner OS) slotted 10a; row 20 sharding opt-in paid after a second way in; relay split default no; padding for everyone; BLAKE3 libs into audit scope.

## Research-Review-2 (11 Oct 2026) — compact (compacted B12-4a-1) · docs only — B7 mint/node reviewed: Worker stays the mint (CDK closed), phoenixd one node per product, LNbits off Share path, no identity row on anon rail, whole `dleq` stripped; B7-Opus 13a; CAX21 €10.49; CLAUDE.md 2.16.

## Research-Review-3 (11 Oct 2026) — compact (compacted B12-4a-1) · docs + `dev/relay-check/` — Nostr reviewed + live relay test: deletion requests not honoured (copy says "expires"), per-job-key AUTH, no cover traffic, Blossom parked, NUT-18 → B7-Opus, Nostr-Opus one session; CLAUDE.md 2.17.

## Research-Review-4 (11 Oct 2026) — Ark + Wavelength reviewed · docs only · Rail-Opus-1 closed

**Checked at source** (bark `851d31a`, wavelength `d4af719`, phoenixd `85d0472`, Second terms/docs/blog, press): Second terms (TwoND, Delaware; co-sign refusal, IP/region block, no VPN) ✓ · 5 Oct exploit 0.75 BTC own funds ✓, no post-mortem, no audits ✓ · Wavelength Google-Form allowlist + private `lumosd`/`swapd` ✓ · Lightning-received coins 1–3 days ✓ · bark pays BOLT11/BOLT12/LNURL ✓. **Corrected:** fix commits 7–9 Oct via `sync-with-deployed` (deployed ahead of source); 3-min inbound hold (missed — breaks node-less Paid Drop); "do nothing" = fee credit + payments rejected above 20k mining fee, so pre-fund stays (over Lightning); collected tag format.
**Decided (Rajesh):** payment-path rule replaces nationality (CLAUDE.md 2.18) · B7 phoenixd + Cashu unchanged; pre-fund over Lightning only (row 13a) · collected key-holder field optional at Nostr-Opus (row 19) · Paid Drop parked, no lab · blinded Quay addresses → SD-Opus · exit note narrowed. Block order unchanged.
**Written:** CLAUDE.md 2.18, Master Context 9.18 (current state, rows 13a / 19, Rail-Opus-1 closed, parked ideas), review box. **Next:** B12-4a.

## B12-4a-1 (13 Oct 2026) — Registered-rail sign-in: Worker + Supabase · deploys `9a692e00` (task 0), `d896df3f` · migration `20261012_b12_4a_auth`

**Decided (Rajesh):** email = **Cloudflare Email Sending** (no new processor — Cloudflare already sees `/auth/magic`), from `signin@mail.refueler.io` (subdomain accepted; own DMARC p=reject; email preview off — it stores live links) · split 4a-1 (Worker/Supabase/email, curl gate) / 4a-2 (sign-in page + Citizen at initiate, Safari gate) · both gate lists · keep 15-min links · `max` stays the wire tier (display Citizen; a rename would touch Stripe keys, rows, manifests, HMAC'd commitments) · 3-month price → Pricing-v2-Opus · `dev@refueler.io` = unpaid test Citizen (`max`); null-email row deleted · vendor split rule: a second vendor only if it stops someone seeing something.
**Task 0 — live billing hole:** `POST /subscription/portal {email}` opened ANY subscriber's Stripe Customer Portal (cancel, invoices, card; email too if editing on); `GET /subscription/status?email=` confirmed subscribers. Both → 410 (Worker), lookup UI removed from refueler.io plans/upgrade (`6f0decb`). Stripe logs: no `billing_portal/sessions` ever — not exploited. Only test rows existed.
**Found:** workers.dev is off (404/1042) and the Stripe webhook pointed there → moved to `api.share.refueler.io/webhook/stripe`, re-enabled (Stripe had disabled it). Stripe Citizen product was named "Sovereign" → renamed, description fixed (100 GB · 7/30/90). Lookup keys must stay `share-max-*` (webhook substring match — a rename would record payers as free; the dashboard edit luckily didn't save). `TIER_CAPS` has no `max` key. Resend (POS) runs on Amazon SES.
**Built:** migration (3 tables, 11 functions, 2 triggers kill sign-in on email change/delete; self-test 30/30 rolled back on live, then applied; advisor clean for Share) · `auth.js` (32-byte secrets as BLAKE3 hashes; HKDF subkeys of `AUTH_PEPPER` for CSRF + rate-limit ids; KATs agree across @noble/hashes, blake3-wasm, Node HKDF) · `auth_store.js` (503 on Supabase failure, no KV, no cache) · `mailer.js` (plain text) · `handlers/auth.js` (5 routes, `requireSession()`, `authCors()`, AUTH_API_HOST only, no-store) · cron Task 5 `auth_sweep` · wrangler: `[[send_email]] EMAIL`, 4 vars. Secret `AUTH_PEPPER` (piped, never shown).
**Tests:** `b12_4a_auth` 13, `b12_4a_routes` 22, `b12_4a_task0` 2 → 808 per file (Mullvad on; combined run needs it off).
**Live gate ✓ (Safari console + curl, Mullvad on):** 202 for known/unknown (320/242 ms), email in Tuta inbox, SPF pass, DKIM pass (`d=mail.refueler.io`), DMARC pass (p=reject, aligned), plain text · unknown email → no token row · token single use (replay 401) · cookie exactly `__Host-rfs_session; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=86400` · session row 60 min / 24 h, minute-rounded, no IP/UA columns · `/chambers/session` returns kind + CSRF, never the Stripe id · sign-out 403 ×5 (no CSRF, wrong CSRF, evil / localhost / no Origin), session survives · sign-out-everywhere kills both sessions, cookie cleared · workers.dev 404 · per-IP 429 after 5. Not live (tests only): per-person silent limit, forced expiry (SQL self-test), log hygiene.
**Logged:** see Master Context §Current state (B12-4a-1) — 4a-2: `TIER_CAPS` max; B12-6: checkout allowlist + plans price IDs + exact lookup map + webhook API version + portal redirect; plans names; Privacy-Share-1 + Incident-Protocol-2 (refueler.io repo); POS mail via Cloudflare SMTP; `fallback.share` DNS warning; Boardroom Brief Wed 14 Oct (Week 2 LOTR) runs here.
**Next:** B12-4a-2 → Share-PreAlpha-1 → X5-Plan.

## B12-4a-2 (13 Oct 2026) — sign-in page + Citizen at initiate + Chartered tier live · Worker `5660bc63` · frontend `aa9f61f`, `1f053c5` · migration `20261013_b12_4a2_citizen`

**Decided (Rajesh):** Citizen is the default when signed in, with one-tap "Send without my account" (Pro Bono, no cookie) · 100 GiB per transfer + 100 GiB held · Chartered `api` tier live now (250 GiB, 90 d, permanent record) · session check on upload-page load · sign-in link page "Welcome." + **Sign in** (no "Enter Chambers" — jargon on a button; the one-click rule is the lock) · copy short, detail in the email ("We'll email you a link." / "If the address has an account, a link is on its way.") · Pro Bono facts line hidden while on the account · Citizen expiry stays 7 days for now (R2 lean; paid options F-10 still hidden) · context limits 700 / 500, compaction at block close only · design sessions: Design-Theory-Opus-1/-2 → Chambers-Design (before B12-4b) → Custom House-Design (with B12-5) → API/MCP pages.
**Built:** migration `citizen_entitlement(ref)` (service role; paid = active + period end in future) · Worker: Citizen session at initiate (`requireSession` stateChanging; non-citizen session 403; unpaid → Pro Bono), `citizenQuotaRefFor` (own tag, KAT), lazy `quota_provision` kind `registered` 3,200 chunks, Citizen 402 exact figures, Chartered resolves `api`, `TIER_CAPS` free/max/api, `CHARTERED_CAP_BYTES` 250 GiB, `initiateCors` (credentials for exact `AUTH_ORIGINS` on `AUTH_API_HOST`), `X-CSRF` allowed, `/chambers/session` returns `tier`, `checkRateLimit` keys by `rlId` (fails open without pepper) · frontend: `src/signin.njk`, `signin.js`, `upload-account.js`, Account row, signed-out / storage-full go back to the chosen file with a sentence · `share-mirror.sh` second page (`SM_C_SIGNIN`, live check of `/share/signin/`) · harness fake Worker auth routes · `bin/b12-4a2-live-check.mjs`.
**Tests:** `b12_4a2_citizen` 19 new + updated ratelimit / b12_4a_routes / manifest / btc_rate; mutation-checked (two deliberate breaks caught). Full run per file green except the intended cap/tier assertions, then updated.
**Live gate ✓:** Safari (Mullvad on) + Brave — email in Tuta (SPF/DKIM/DMARC pass), link → Welcome → Sign in → signed in, fragment gone; upload page shows "Uploading as Citizen", 4 GB line hidden; Citizen uploads charged (2 chunks used, 0 reserved), "without my account" uploads not; receiver + upload page unchanged · curl: cookie no/wrong CSRF → 403, localhost preflight no credentials, `/chambers/session` no cookie 401, KV `rl:` keys pseudonymous · `b12-4a2-live-check.mjs` all ✓ incl. permanent record on Chartered + `transfer.timestamp_submitted` (carried retest closed); test clients' keys/pools/quota rows deleted.
**Found:** first upload-page visit showed nothing — the tab ran modules from before the ship (fresh tab fine; Worker had no session lookup for it) → watch item. Auto mode blocks `npm run deploy` — Rajesh deploys.
**Next:** Share-PreAlpha-1 → X5-Plan.

