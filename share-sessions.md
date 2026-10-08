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

## KV-Fix-1b (8 Oct 2026) — B12-SR S2 test credential in full · deploy `d00ae2c4` · ship `aa3847d` (refueler.io `ad3e1c3`)

**Start:** 2 h budget; plan approved before code. Decisions (Rajesh): test page expiry 2 days; manifest `soak: true` now.
**Worker:** new `src/testcred.js` — `X-Test-Credential: v1.<uuid>.<cap_chunks>.<exp>.<mac>`, HMAC-SHA256 under new secret `TEST_CRED_KEY` (own secret, not a `KV_MAC_KEY` subkey) over `"refueler.share.testcred.v1" ‖ 0x00 ‖ uuid16 ‖ u32be(cap) ‖ u64be(exp)`; strict parse, `timingSafeEqual`, any failure = absent. `handleInitiate` bypass only when the header checks (MAC, exp not passed and ≤ 24 h ahead, cap ≤ 8,000, uuid = path), no manifest in R2, and `testcred_used:{uuid}` unset; flag set at the spend point (TTL exp + 5 min). Bypass skips Cashu verify, spend INSERT and API pool only — **expiry ceiling now applies** (free, 7 d; P2); cap = `cap_chunks × CHUNK_SIZE`; manifest `soak: true`. `test_credential:*` is read nowhere. `/admin/test-credential`: `requireAdmin` + courtesy throttle 10/h/IP, 503 without the secret, `cap_bytes` → chunks (> 8,000 → 400), no KV write, AE `admin.testcred.issued` (count only); response `test_credential` = header value. CORS allows `X-Test-Credential`.
**One call site:** `grep -rn -e "X-Test-Credential" -e "checkTestCredential(" worker/src` → read only at `index.js:1542` (others: CORS list, comments, test page).
**Test page:** `test-upload.html` sends the header; initiate expiry 90 d → 2 d.
**Tests:** `worker/test/kv_fix_1b.test.js` 32 — KAT (independent Python HMAC) + S2 matrix (no header · malformed ×6 · wrong MAC · other key · cap edited · expired · exp > 24 h · cap > 8,000 · other UUID · replay → 409 · flag set without manifest · old KV flag without header · valid token + manifest → 409 · `ADMIN_KEY` as header · tier `soak`/`test` · secret missing) all → normal path, plus bypass (soak:true, ceiling 400, cap 413) and issuance. `b12-1d` + `commitment` moved to the real header. Suite per file (Mullvad on): 666 passed, 0 failed.
**Live ✓:** secret set (Rajesh). Old-flag check: issued credential, planted old-shape `test_credential:{uuid}` (1 h TTL), initiate without header → 401 `Invalid credential`, `/meta` 404. Soak (Rajesh, Safari Mac, Mullvad on, 1 GiB, 32 chunks): 32/32, finalise, download-verify 5/5, 3m 24s; manifest `soak: true`, no `quota_ref`, expiry ≈ 2 d; `testcred_used:` = `1`. Old `test_credential:*` keys: 20 (19 + the probe), inert, left to expire.
**Status read filter (carried from KV-Fix-1a):** saved `status:current` (140 B, sha256 `8d1e5ceb…`, `updated_at` …899, 0 incidents). Put a copy with one incident whose severity was a hostile string, an unknown top-level key, and `updated_at` …900 (marker to beat the ~60 s KV edge cache). `/status` after 75 s: `updated_at` …900, `incidents: []`, no unknown key — both gone. Restored; KV hash matches; `/status` back to …899.
**Next:** Safari slow-link (receiver card load + iPhone upload pace) → MCP-Fix-1 (week of 12 Oct) → KV-Fix-2 → API-Repair-1. Navy Office soak line stays with B12-3.

## Safari-Slow-Link-1 (8 Oct 2026) — receiver card load · iPhone downloads fixed · deploy `5312c5fa` · ships `9568045` (refueler.io via ship) + `f60bcb2` (refueler.io `69a56ef`)

**Start:** half-day budget; measured before any change (Safari Web Inspector snippets, Mac + iPhone over cable, Mullvad on both; `wrangler tail` alongside).
**Receiver card (Safari Mac):** card at 1.06 s cold / 0.82 s warm. Waits: three module waves (share.js → crypto/fragment/upload/download → timestamp/merkle), all 82 KB of upload code, then `/meta` last (0.3–0.45 s). Fix (frontend): `share-early.js` starts `/meta` (receiver; `window.__rfsMeta`, `download.js` takes it, asks again if it failed) or modulepreloads the upload modules (upload page); `modulepreload` for share/crypto/fragment/download in `index.njk`; `share.js` imports `upload.js` only in upload mode; Turnstile `async`; fflate/qr `defer`. iPhone Network tab after ship: `/meta` initiated by `share-early.js:19` beside the CSS. **Not yet measured after ship on Mac** (snippet A) — next small check.
**iPhone upload pace:** two 100 MB uploads, no stall; the ~49 % stall did not reproduce. Fixed cost per upload on the phone ≈ 4.5 s (issue 0.8, initiate 1.6, finalise 2.0) — later trim, not a fault.
**Found — downloads ≥ 3 parts failed (live, any device, worst on iPhone):** the Worker's verified path buffered each whole 33.5 MB part plus a WASM copy; the browser's 4 parts in flight passed the 128 MB isolate limit and every request on the isolate reset together (tail: response none, exception "Network connection lost."; iPhone stuck 7–11 %, retrying). **Worker fix (`5312c5fa`):** verify, then stream — read 1 hashed piece by piece (`hashStream`, blake3-wasm 2.1.5 web build vendored unchanged in `worker/blake3-wasm-incr/`, byte-identical to the frontend copy), on match read 2 `onlyIf: { etagMatches }` streamed straight out; mismatch or changed object → 409 `integrity_failed` before any byte; cut read → 502. One path for every size: >128-part transfers now also get the clean 409 (F-2 closed); `VERIFY_INLINE_CHUNK_THRESHOLD` and `makeVerifyingStream` removed. Cost: one extra R2 read per part. Tests `worker/test/slow-link-1.test.js` 12 (vectors, = hashOneShot/noble on 32 MiB, heap flat over 200 MiB, 200/409/changed/502/>128/416); all 33 files pass per file (Mullvad on).
**Then the phone itself:** with the Worker fixed (Mac: 4 parts at once all 200), the iPhone on Mullvad still cut 4 × 32 MB parts together (tail: Worker 200, outcome `canceled`; bytes-discarded test also dropped, so not page memory). Rajesh chose option 1: `DL_IN_FLIGHT` 4 → 2 (`download.js`). Adaptive in-flight (start 3, drop after a cut) deferred to per-browser work.
**Rajesh live ✓:** iPhone 13 mini Safari, Mullvad on, 404 MB, 13 parts, every part first time, ~70 s. Mac Safari, Mullvad on: small upload + download, upload page unchanged, 4-parts-at-once test all 200.
**Harness:** `build.sh` now also points `share-early.js` at the fake Worker.
**Next:** MCP-Fix-1 (week of 12 Oct) → KV-Fix-2 → API-Repair-1. Small: Mac snippet-A card timing after ship; adaptive in-flight later.


## MCP-Fix-1 (8 Oct 2026) — the MCP send tool rebuilt on the live upload path · link format v2 · repo `refueler-mcp`

**Start:** half-day budget; gap list read out of the code before any edit, plan approved (option 1: make send actually work, not just swap the fragment). Worked in `refueler-mcp`; `refueler-share` touched only for the capabilities field, the spec and these notes.

**What the gap list found.** "Adopt link format v2" was the small part. The server could not start and the send tool aimed at a route that no longer exists:

- **Startup (5 breakages, none to do with v2):** `@modelcontextprotocol/sdk` was never a dependency though `src/index.js` imports it; `index.js` imported `./api-client.js` (the file is `api.js`) and four `*_TOOL_DEFINITION` names no module exports (only `check.js` has one); `handleSendFile(args, client)` passed the API client where the handler destructures `{ apiClient, … }`; `api.js` had no `post`/`put` for `send.js` to call. A sixth: `@noble/curves` was imported but not declared, resolving from a stray `~/node_modules` — fine on this Mac, broken anywhere else. The 228 tests passed because every one of them mocked the client.
- **`npm test` never ran:** the script said `vitest run`, every test file is `node:test`, and vitest was not installed.
- **Upload path gone:** `send.js` PUT ciphertext to `/upload/{uuid}/{NNNN}` — the Worker-relay chunk path retired at Share-6-6b. No `/initiate`, no presigned PUT, no `/finalise`, so no `{uuid}/hashes` sidecar and no `merkle_root`: every download would have 409'd at the verify-then-stream wall (Safari-Slow-Link-1). Chunk size was 8 MiB against the Worker's 32 MiB, so `/initiate` would have 400'd `chunk_count_mismatch` first. The whole file was encrypted into memory before anything uploaded.
- **Crypto:** `encryptChunk` used K directly with a fresh random 12-byte IV prepended to each stored object. Not nonce reuse, but incompatible with a v2 receiver and 12 bytes longer than the content-length the presigned PUT signs.
- **Link:** `https://share.refueler.io/#frag` — wrong host and no `?uuid=`, so the receiver card would never load.
- **`permanent_record`** minted a seal nonce into the fragment with no OTS pipeline behind it.

**Built.** `src/merkle.js` (port of `frontend/merkle.js`, four pinned roots) · v2 part crypto in `src/crypto.js` (`derivePartKey`/`partNonce`/`partAad`/`encryptPart`/`decryptPart`, `CHUNK_SIZE` 32 MiB, `blake3Root` removed — the Worker reads it nowhere) · `src/fragment.js` replaced with the v2 module verbatim · credential format v2 in `src/crypto.js` (`generateBlindedCredential`/`unblindSignature`, `@cashu/cashu-ts` pinned **4.11.0**, same exact pin as Worker and `bin/vendor-cashu.sh` — upgrade all three together) · `api.js` gains non-throwing `call`/`get` and `putPresigned` · `src/index.js` rewired, `toResult()` normalises the three return shapes the tool modules use · `src/tools/send.js` rewritten: initiate → presigned PUT direct to R2 → `/urls` batches → finalise with per-part digests + ciphertext Merkle root, streamed from disk at **2 parts in flight**, tail URL handled separately (`/urls` never covers N−1), 403 from R2 fatal and never retried, 7-day expiry (every upload still resolves to free at the Worker until B12-4a, so anything longer is a 400), `permanent_record` → `not_supported`. Deps pruned (`@anthropic-ai/sdk`, `dotenv`, `@noble/secp256k1`, vitest all unused): `npm audit` 0 vulnerabilities. `package.json` gains `"type": "module"`, engines ≥ 20.

**GiB, not GB (Rajesh).** `rate-card.js` divided by 1e9 "matching spec §2.2"; the Worker's `computeTransferCost` divides by 1024³ and that is what `/initiate` debits. A 1.0 GiB file quoted 210 credits and was charged 110. Rajesh: match what the Worker actually charges. `BYTES_PER_GB` → 1024³, boundary tests rewritten on GiB plus one pinning that 1e9 bytes is **one** band, spec §2.2 and the "≈ 490 GiB" line corrected. The two constants move together or not at all.

**Cap.** Spec §7.1 locked `limits.max_transfer_bytes`; the Worker only ever emitted `max_file_size_gb`, and the MCP fixture invented 250 GB. Worker now emits both from `CHARTERED_CAP_BYTES` (4 GiB until B12-4a, KV-Fix-1a); fixture and spec corrected; `send.js` refuses an over-cap file before the credential is issued (a 413 at `/initiate` costs nothing at the Worker but the API credit is already gone).

**Parity — byte-for-byte.** `test/part-crypto.test.js` carries the known-answer vectors from `worker/test/part-crypto.test.js`, which were produced by the browser's own `frontend/crypto.js`: HKDF info, the part key for K = 00…1f, T1's three ciphertexts for N = 3, T2's last-flag on index 0, T3's full 32 MiB part (length 33,554,448 · sha256 · tag), T4's fragment blob. All match. Three further tests run it the other way — the browser's `decryptPart` opening an MCP-encrypted part, the two `CHUNK_SIZE` constants, the two `assembleFragment` outputs — skipped unless `REFUELER_SHARE_DIR` is set, so a clean CI without the sibling repo still passes. `test/merkle.test.js` gates on the four shared roots. Recorded in the MCP repo's `PARITY.md`.

**Tests:** `test/fragment.test.js` deleted (v1 only; superseded by part-crypto §3), `crypto.test.js` trimmed to what survives, `send.test.js` rewritten against a harness that stands in for the three endpoints and R2. **242 passed, 0 failed.** Worker `btc_rate.test.js` 50/50 after the capabilities change (the only Worker file touched).

**Soak path, not in `src/`:** `scripts/soak-send.js` sends on the X-Admin-Key route (`/admin/test-credential` → MAC'd `X-Test-Credential`, KV-Fix-1b) by injecting a credential provider through `handleSendFile`'s `issueCredential` hook. `src/` keeps only the production HMAC path — an admin key has no place in a published package. `--verify` downloads every part back, decrypts with the key from the fragment and compares sha256. `scripts/demo-send.js` was broken the same way `index.js` was (reaching for `handler`/`default` exports that do not exist, wrong config shape); rewired.

**Live ✓ (Rajesh, Mullvad on, 40 MiB / 2 parts, 12.4 s):** uuid `595a53d9…`; part 0 33,554,448 ciphertext bytes (= 32 MiB + 16), tail 8,388,624 → 8,388,608; merkle_root `af82463c…` accepted at finalise and **the download served**, so the Worker reconstructed the root and matched — the 409 wall is cleared from this path. sha256 round-tripped byte-identical. `/meta` `file_name` = `encrypted-payload` (D-1 holds). Fragment decoded: `{"v":2,"k":…,"n":"soak-40mib.bin","z":41943040}`, key order `v, k, n, z`, no `i`, 32-byte key, `ceil(z / 32 MiB) = 2` = stored part count. Cost 110 credits, expiry 7 days. First failed run was the placeholder admin key — failed closed at 401 with nothing spent, which is the right shape.
**Safari live check ✓ (Rajesh, Safari Mac):** the MCP link opened the receiver card — `soak-40mib.bin`, 40.0 MB, expiry Thu 15 Oct — and downloaded both parts; the file Safari wrote is sha256 `98015626…`, byte-identical to the source. So the browser receiver parses an MCP-written v2 fragment, reads `z`, checks the part count against the Worker and reassembles. Separately, a browser-made transfer (265 KB, destroy-after-download) still works end to end through "This link is no longer active" — the upload page is unaffected by this session.

**Not shipped:** the Worker capabilities change (`max_transfer_bytes`) needs `npm run deploy` from `worker/` — additive, nothing reads the old shape, and not needed by the send path. npm publish stays held.

**Next:** KV-Fix-2 (API keys + credits → Supabase) → API-Repair-1. Carried: Share-JS-Split-2 after this; Mac snippet-A card timing.
