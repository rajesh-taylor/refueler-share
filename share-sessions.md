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

## Share-1 · 11 Sep 2026 — Tier Constants Decoupling

| Item | Detail |
|------|--------|
| Commit | `refactor(share-1): introduce tiers.js enum, wire api→CHARTERED, decouple display from logic keys` |
| Files | `worker/src/tiers.js` (new) · `worker/src/index.js` (6 sites) · `worker/src/webhook_reg.js` (1 site) |
| Tests | 484 — no change (all edits identity-preserving: `TIERS.CHARTERED === 'api'`) |

---

## Share-2 · 11 Sep 2026 — Tidal gate: paid-vs-free

| Item | Detail |
|------|--------|
| Commit | `8f12b4e` on branch `share-2-tidal-gate` |
| Files | `worker/src/manifest_tg.js` (gate + comment only) |

**What was done:** `PAID_TIERS` → `new Set(['creative', 'max'])`. Availability window confirmed as paid-vs-free gate — Citizen and Sovereign both permitted, never rail-gated.

**Deferred to Share-3:** Rewrite `confirm_tg.test.js` (lines 145–147, 151, 474, 478, 482) + `lightning.test.js` (123, 131, 216, 223) + `webhook_reg.test.js` (391) to live wire values (`creative`/`max`) — then merge branch to `main`. `handlers/timestamp.js:30` excludes `'citizen'` from permanent record — latent bug (Citizen is now paid; fix alongside fixtures).

---

## B9-Opus · 12 Sep 2026 — Merkle / MMR / SMT / ZK design lock

| Item | Detail |
|------|--------|
| Session type | Architecture + design, no code produced |
| Output | `merkle-spec-v1.md` (refueler-share repo root) |
| BRIDGE | v9.4 |

Seven decisions locked (D-1…D-7) — full detail in `merkle-spec-v1.md`. Key outcomes:
- RFC 6962 unbalanced BLAKE3 tree, domain-separated, `chunk_count` committed
- Chunk hashes in R2 sidecar `{uuid}/hashes` — never inline in manifest
- Download: sidecar GET → reconstruct root → verify-then-flush per chunk → 409 on mismatch
- Two-roots distinction permanent: `merkle_root` (ciphertext, Worker-verifiable) vs `blake3PlaintextRoot` (recipient-only, permanently barred from Worker + all receipts)
- Due-diligence proof = FCA SYSC 6.3 / MLR reg. 40 (not travel rule). MLRO confirmation required.

---

## SW-MCP-8 · 13 Sep 2026 — npm distribution, Apache 2.0, trust-boundary READMEs

| Item | Detail |
|------|--------|
| Session type | Bounded build — no architecture decisions |
| Repos | `refueler-mcp` (primary) · `refueler-share` (README only) |
| Commits | see commit commands below |

**What was done:**
- `refueler-mcp/package.json` — confirmed: `name: "@refueler/mcp-server"`, `version: "0.1.0"`, `license: "Apache-2.0"`, `private: false`, `engines: { node: ">=18" }`, `files: ["src/", "README.md", "LICENSE"]`. No `scripts.prepublish`. Dependencies: `@anthropic-ai/sdk`, `@noble/hashes`, `@noble/secp256k1`, `dotenv`. DevDependencies: `vitest` only.
- `refueler-mcp/LICENSE` — Apache 2.0 full text, copyright 2026 Rajesh Taylor.
- `refueler-mcp/.npmignore` — excludes `test/`, `scripts/`, `docs/`, `.env*`, `*.test.js`, context files.
- `npm pack --dry-run` verified: 4 files (`LICENSE`, `README.md`, `package.json`, `src/index.js`). Output confirmed clean.
- `refueler-mcp/README.md` — full rewrite: trust-boundary operator document. All honesty constraints applied. No "end-to-end", no "zero-knowledge", no "military-grade", no "proof of delivery". Chunk integrity vs ciphertext storage integrity distinction explicit. D-1 filename caveat scoped to build state.
- `refueler-share/README.md` — full rewrite: public-facing repo README. Architecture prose, tiers table, MCP pointer, stack table, repo layout, licence + patent note, status line. Honest: chunk integrity live, full Merkle-root verification in build (B9).

**Publish command (manual — Rajesh runs when ready):**
```
cd /Users/rajeshtaylor/Documents/refueler-mcp && npm publish --access public
```

**SW-MCP block: complete.** SW-MCP-7 (anonymous rail) gates on B7/NB-4. Next: B8-Opus.

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

## SD-block — Silent Drop (post-B8, post-NB-4)

**S88 complete · 4 Sep 2026.** All design decisions locked. Full Locke (NUT-11 Mode 2) required.

**Prerequisites:** B8 complete. NB-4 (node live). 7-day friend-group soft launch gates public Sovereign access.

**SD-Opus-pre · 12 Sep 2026** — Quay management + multi-client attribution design locked. Per-client Quay link confirmed. Notification model confirmed (webhook API/MCP; polling Sovereign web). Anonymous API/MCP rail market locked. Harbourmaster design pass required before SD4.

| Session | Label | Scope |
|---------|-------|-------|
| SD1–SD1b | Lighthouse architecture | KV schema. Opaque token → inbox key. Worker endpoints. UUID isolation. |
| SD2–SD2b | Sender upload flow | Worker validates token, one-time credential, cargo arrived AE event. |
| SD3–SD3c | Harbourmaster auth + Deed | NUT-11 Mode 2 login. Keypair + BIP-39 mnemonic. Recovery flow. |
| SD4–SD4b | Harbourmaster dashboard I–III + mid-block audit | Receipt ledger. Quay management. **Design pass required before SD4.** |
| SD5–SD5a | Notification + renewal | API/MCP: webhook (`cargo.accepted` per Quay). Sovereign web: polling + badge. SimpleX stub. |
| SD6–SD6a | Soft launch + findings | 7-day friend-group. P0/P1 fixes. |
| SD7–SD7a | Source-protection copy + final audit | Gated: SD shipped + VPN scope stated. |
| SD8 | SD close | Snag sweep. Context trim. B9 brief. Public Sovereign Lightning access enabled. |

**SD do-not-retry:**
- DO NOT reuse upload credential UUID as cargo UUID — generate separately at Lighthouse layer
- DO NOT return 402 at `GET /inbox/{token}` — defer quota errors to upload attempt
- DO NOT use Math.random() in Deed generation — `crypto.getRandomValues()` only
- DO NOT use "anonymous" for Stripe-rail Silent Drop — private, not anonymous
- DO NOT design a single shared inbox for multi-client practices — one Quay per client relationship

**Buffer pool (3 sessions):** SD1c · SD3d · SD4c

---

## Locked block sequence (updated B8-Opus · 13 Sep 2026)

`B8-Opus → B8 build → [Hetzner commitment] → NB-2–NB-4 → B7 → SD-block → B9 build (B9-1…B9-8) → B10+`

*(SW-MCP block complete. SW-MCP-7 anonymous-rail tail gates on B7/NB-4. B9-Opus design complete; build sessions sequenced in `merkle-spec-v1.md` §9.)*

`Share-6 block (large-upload direct-to-R2) → B8 build → [Hetzner commitment] → NB-2–NB-4 → B7 → SD-block → B9 build (B9-4…B9-8) → B10+`

*(SW-MCP block complete. SW-MCP-7 anonymous-rail tail gates on B7/NB-4. Share-6 is Priority-1 — SHARE-503 blocks all large uploads — and front-loads B9-1/B9-2/B9-3, so the later B9 build resumes at B9-4. Share-6-vs-B8-build order is Rajesh's call; Share-6 recommended first on the SHARE-503 blocker. B9-Opus design complete; sequenced in `merkle-spec-v1.md` §9.)*

## B8-Opus · 13 Sep 2026 — NUT-11 Mode 2 (Locke) design lock

| Item | Detail |
|------|--------|
| Session type | Architecture + design, no code produced |
| Output | `B8-spec-v1.md` (refueler-share repo root) |
| BRIDGE | v9.5 |

Seven decisions locked (D-1…D-7) — full detail in `B8-spec-v1.md`. Key outcomes:
- Deed→Locke derivation: **HKDF** (`salt="refueler.locke.v1"`), reduce/reject-sample to valid secp256k1 scalar. Not BIP-32.
- Worker check order: **sig → BDHKE → double-spend** (Supabase INSERT always last).
- Schnorr **BIP-340**, x-only key from the 33-byte P2PK `data`; witness `{signatures:[…]}` verbatim; message preimage pinned against cashu-ts vectors at B8-1.
- Locke lifecycle: primary Locke Deed-derived + immutable recovery anchor; devices 2…N fresh-random, authorised by existing Locke; KV challenge-response login (domain-tagged, one-shot). **This is the SD3 primitive.**
- `hashSecret()` (Mode 1, bare SHA-256) unchanged and independent of Mode 2; the two gates coexist.
- CDK stays **0.17.2** (Worker is CDK-independent for BDHKE).
- Build **direct in refueler-share**, B9-style; `refueler-ecash-lab` Mode 2 flag retired (reserved for ML-KEM/B10).

**Do-not-retry additions:** see `B8-spec-v1.md` §9.

**B8-Opus complete. Next: B8 build (B8-1…B8-6, buffer B8-2b · B8-5b). Signs off Pass SD3.**

## Share-6-Opus · 16 Sep 2026 — Large-upload direct-to-R2 architecture lock

| Item | Detail |
|------|--------|
| Session type | Architecture + design, no code produced |
| Output | `Share-6-spec-v1.md` (refueler-share repo root) |
| BRIDGE | v9.6 |

Six decisions locked (D-1…D-6) — full detail in `Share-6-spec-v1.md`. Key outcomes:
- **Upload moves off the Worker edge to R2 direct** via presigned S3 `PutObject` URLs (one object per chunk at `{uuid}/{iiii}`). Worker `initiate`s + `finalise`s only; never in the transfer path. Kills SHARE-503 and the in-RAM `NotReadableError`.
- **Not S3 multipart** — `CompleteMultipartUpload` collapses parts into one object and breaks `merkle-spec-v1.md` §1 (`{uuid}/{iiii}` per-chunk leaf). Per-object PUT preserves the layout, the `/download` path, and resume. Also dissolves the part-number↔AAD off-by-one (all 0-indexed).
- **Part size 32 MiB, uniform across tiers.** 250 GiB = 8,000 objects (20% under the 10k advisory ceiling); 100 GiB = 3,200; 4 GiB = 128. `CHUNK_SIZE` 8→32 MiB. Real Safari/iOS 32-vs-64 test at Share-6-2.
- **Cashu verified + spent once at `initiate`** (moved off chunk-0). Size cap gated on `resolvedTier` (live Supabase), never `issued_tier`. API-tier credit-pool debit also at initiate.
- **Integrity shift (the honest one):** the Worker's upload-time 400-on-mismatch is structurally lost (Worker sees no parts). Integrity moves entirely to download-time (B9-3): browser writes `merkle_root` + `{uuid}/hashes` at finalise; Worker reconstructs + 409 on download. **B9-3 is not built** — block front-loads B9-1/B9-2/B9-3; consumer cutover gated on Share-6-5 green.
- **No confidentiality/privacy change:** AES in-browser before any byte leaves; key in fragment only; filename never reaches Worker; R2 holds keyless ciphertext. New item: an R2 API key as a Worker secret (scope to the two buckets; leak = keyless-ciphertext exposure only).
- **aws4fetch** (in-Worker SigV4 signer, MIT, £0, not Amazon) recommended over hand-rolled. Presigned expiry 6 days; URL batches of 256.

**Build sequence:** Share-6-1 (presigning + initiate) → 6-2 (CORS + direct-PUT loop) → 6-3 (finalise + sidecar, folds in B9-1) → 6-4 (resume + folder cap) → 6-5 (download verify = B9-3, **cutover gate**) → 6-6 (audit + `WORKER_URL` cutover, closes SHARE-503). Buffer: 6-2b · 6-5b. New path built additive alongside the live one until 6-6; every session ends in a real upload/send.

**Do-not-retry additions:** see `Share-6-spec-v1.md` §10.

**Share-6-Opus complete. Next: Share-6-1 (presigning + initiate). Front-loads B9-1…B9-3; B9 build then resumes at B9-4.**

## Share-6-3a — POST /upload/{uuid}/finalise (Worker only) · 17 Sep 2026

Worker /finalise: X-Upload-Session auth, HEAD completeness sweep, {uuid}/hashes
sidecar (raw N×32), manifest merkle_root + tree_algo + upload_complete:true,
session KV spent. index.js + worker/test/share-6-3a.test.js (12 pure pass, 8
integration stubs skipped). Commit: <b6f4dc4>

**Do-not-retry / wire contract (6-3b depends on these):**
- Auth header is `X-Upload-Session` — never `X-Upload-Session-Token`.
- Finalise body: { hashes: [b64url(32B) × N], merkle_root: b64url(32B) } — hashes is an ARRAY, not a concat blob.
- chunk_count comes from manifest.total_chunks — no duplicate field.
- tree_algo pinned `rfc6962-unbalanced-blake3-v1`.
- Sidecar is WRITE-AND-KEEP — contradicts the "delete sidecar on finalise" lock (KEEP).
- Deferred: cargo.accepted receipt not emitted; HEAD sweep needs list()-based check before >~1000 chunks (Share-6-6).

## Build sequence re-chunked · 17 Sep 2026 (supersedes the 6-3→6-6 line above)
6-3b fold + B9-1 tree fn + tests (Opus) · 6-3c wire + send (Sonnet) · 6-4a resume
+ FOLDER-RESUME (Sonnet) · 6-4b folder cap (Sonnet) · 6-5a Worker verify, cutover
gate (Opus) · 6-5b browser verify + download (Sonnet) · 6-6a list() audit + large-N
(Sonnet) · 6-6b WORKER_URL cutover, closes SHARE-503 (Sonnet).
Model rule: Opus only for first-time crypto; Sonnet for everything specified.

| Item | Detail |
|------|--------|
| Session type | Build (Sonnet) · refueler-io only · no Worker changes |
| Repos touched | `refueler-io` only |

### Changes

- **Navy Office rename:** `git mv src/share/admin/dashboard.{html,js,css} → navy-office.{html,js,css}`. Gate h1 reads "Navy Office". Topbar wordmark sub-label reads "Navy Office". Served at `/share/admin/navy-office`.
- **Chambers h1:** confirmed/fixed — reads "Chambers" not "The Chambers". `src/share/chambers/index.html`.
- **Client-errors modal toggle:** two source buttons — "Reported by browser (24h)" (AE · `GET /admin/ae-metrics`) and "Observed by Worker (90d)" (KV · `GET /admin/client-errors-log`). State: in-memory `errorSource` var only, never persisted.
- **API & MCP card:** replaces CPU-time stub (6th card, row 3). Active keys value from `GET /admin/api-stats`. Full modal: active keys / requests 30d / requests by rail / MCP attach rate / sandbox→live (pending honest stub until first Chartered client). `by_rail` `none`/`free` → renders as "Pro Bono".
- **Growth signal card:** full-width below Execution Dock. Three SVG polylines (paid=green / free=gold / api=amber) via `GET /admin/news-events`. Tick marks with hover tooltip for label events. Add-event form (date · label · note · free/paid/api flags). Delete. `POST`/`DELETE /admin/news-events`.
- **Dock enrichment live:** `size_bytes` → `humanBytes()` human-readable. `rail` → Registered / Bearer / Pro Bono display. `merkle_root` → "pending — available at Share-6-5". Download count → "pending".
- **BRIDGE:** already v9.6 from Dash-2. No further bump needed.

**Do-not-retry:** `navy-office.js` logic is now fully inline in the HTML; the `.js` file is a placeholder shim only. Do not split back out.

**Next: Share-6-3b → B9-1 RFC-6962-unbalanced-BLAKE3 tree function (Opus).**

*"Nothing stops this train."*

## Catch-up: Dash-3 → 6-3c · logged 20 Sep 2026 (at Share-6-3d close)

The block above ends on the Dash-3 *plan*; these are the outcomes. Commits shown where confirmed.

| Session | Commit | Outcome |
|---------|--------|---------|
| Share-Dash-3 (Sonnet · 18 Sep) | — (reverted) | Rewrote navy-office.html from scratch, destroyed the sidebar. **Git-rolled-back.** Superseded by Dash-3b. |
| Share-Dash-3b (Opus · 19 Sep) | `911eae8` + follow-up | Real completion. Recovered the genuine navy-office.js (1662 lines) from history; navy-office.html surgical edits (wordmark + gate h1 → "Navy Office", repoint navy-office.{css,js}, CPU-time tile → API & MCP tile, growth card full-width below Execution Dock). Chambers rename in place. hh-* hostname-health block DORMANT (null-guarded, no HTML). Deferred: API & MCP tile sub-line → commercial-only (Registered+Bearer) request count. |
| Share-6-3b (Opus · 19 Sep) | `ec37c17` | worker/src/merkle.js — RFC-6962-unbalanced-BLAKE3 tree fn + inline N=1..4 vectors. Import is a FILE PATH `../node_modules/@noble/hashes/blake3.js` (noble v1 under CDK 0.17.2 exports only `./blake3`, not `./blake3.js` — file path bypasses the exports map, keeps the `.js` the invariant requires). |
| Share-6-3c (Opus · 19 Sep) | frontend/merkle.js | Browser Merkle twin of the worker module — SAME WASM BLAKE3 as the chunk path, same pinned N=1..4 vectors, selfTest() hard gate. Exports frozen before 6-3d. |

## Share-6-3d — upload.js finalise wiring + first real end-to-end send · 20 Sep 2026

Sonnet · refueler-share frontend only (plus one justified Worker CORS fix). Wired POST
/upload/{uuid}/finalise into startUpload's direct-R2 branch at the old "finalise pending"
point. Client-authoritative ciphertext merkle_root via frontend/merkle.js's buildMerkleTree
over chunkHashes (hex → Uint8Array; RAW 32-byte digests — buildMerkleTree applies the
0x00/0x01 domain separation itself; no IV prepend — NONCE trap). Body
`{ hashes:[b64url(32B)×N], merkle_root:b64url }`, header X-Upload-Session; tree_algo NOT sent
(Worker pins it). 200 → existing fragment/share-URL assembly; 409 → surface missing count;
any non-200 → "Finalise failed", NO share URL. Local _bytesToB64url added (unpadded, URL-safe;
fragment.js's encoder isn't exported). Three surgical edits, node --check clean. Commit `050998b`.

**First genuine end-to-end send on the live site.** article-a-research-notes.md, 16,818 B,
1 chunk, free tier, password-protected. Manifest (wrangler r2 object get … --remote --pipe):
upload_complete:true · tree_algo rfc6962-unbalanced-blake3-v1 · merkle_root 43 chars (→32 B) ·
blake3_root null (plaintext root correctly absent) · file_name "encrypted-payload" (D-1 holds).
Fragment grammar v1 decoded clean (v1, 32B key, 12B IV, real filename, no seal_nonce).

**Two latent integration bugs flushed (both now in CLAUDE.md §Frontend change checklist):**
- merkle.js (shipped 6-3c) was never in bin/sync-share.sh → mirror 404'd it → module graph
  collapsed → dead pickers. Added to the JS copy loop. Commits `a00351a` (script), `b8906f9`
  (refueler-io mirror). **Rule: new served module ⇒ add to sync-share.sh.**
- X-Upload-Session read by finalise/urls but absent from corsHeaders Access-Control-Allow-Headers
  (worker/src/utils.js) → finalise preflight blocked. Added + deployed (Version 6a97dc59).
  Commit `f97b7d9`. **Rule: new browser header ⇒ add to corsHeaders.** Same gap would bite /urls
  on transfers >256 chunks.

**Deferred / noted:** manifest `status` stays "uploading" post-finalise (collection path owns
`status`; finalise flips only the upload_complete bool) — eyeball at 6-5. chunks_received:[] is
expected for direct-R2 (chunks bypass the Worker; completeness proven by HEAD). Dock now stores
the real merkle_root as of 6-3d — the "pending" display can show it; "verified" still waits for 6-5.

Share-6-4a — upload resume + FOLDER-RESUME discard fix (Sonnet). BRIDGE unchanged (build session).
Dash-3 leftovers (API & MCP tile sub-line, hh-* keep/strip) deferred to a dedicated end-of-block snag session.

## Share-6-4a — upload resume close + folder auto-discard + folder RAM cap (6-4b) · 20 Sep 2026

Opus · `refueler-share` frontend only (`frontend/upload.js`). Single-file resume was built
pre-session (Sonnet — IDB re-credential, missing-index presign, lazy off-disk re-slice); this
session closes 6-4a by adding the two folder guards the spec (§7) still owed, and folds in 6-4b.
Three surgical edits, `node --check` clean. **No BRIDGE bump** (build session).

**Folder auto-discard (`checkResumeState`, Part C).** A folder is zipped into an in-RAM `File`
that never touches disk, so the picker can't re-select it on resume. New gate — placed **before**
the expiry check — fires when `record.sourceType === 'folder'`: `clearResumeState`, hide the
resume card, hide `resumeNoticeBtn`, and `setDropMsg("Folder uploads cannot be resumed — please
start a new upload.")`, then `return`. Replaces an earlier draft block that *showed* a folder
notice card (which also left an unwired Discard button visible); the new form matches §7's
"folder-originated transfers auto-discard on resume" exactly. True folder-resume (re-zip + skip
sent) remains explicitly out of scope. *Dependency to confirm in the live test: `setDropMsg` must
be present in the helpers object `share.js` passes to `checkResumeState` — if the card hides but
no message shows, that's the one wire to add.*

**Folder RAM cap — 6-4b (`zipAndSelect`).** New named constant `FOLDER_ZIP_CAP = 2 * 1024 ** 3`
(2 GiB) at the top of the folder-helpers section. After the zip Blob is produced, if
`zipBlob.size > FOLDER_ZIP_CAP` → `hideZipCard()` + `setDropMsg("This folder is {size} zipped.
Folders are held in memory during upload and capped at 2 GB. Zip it yourself and lodge the .zip
as a single file — single files stream from disk with no size limit beyond your tier ceiling.")`
and `return` **without** calling `handleFileSelection` (the over-cap zip never enters the upload
path). `{size}` = `formatBytes(zipBlob.size)`. Bounds the pure-RAM-pressure residual risk that the
lazy-slice design (§7) leaves on folders; single files are unaffected (they stream from disk).
Founder-confirmed cap number: 2 GiB (Share-5 RAM failure appeared at ~1.1–1.3 GB).

**Pre-zip input-bytes guard (added after live test).** Live test surfaced that the post-zip cap
above fires too late: a 2.5 GB folder throws an allocation error *during* compression (the whole
folder is read into RAM to zip), before any blob exists, so the user saw only a generic
"Compression failed" — the cap never ran. Fix: a second guard at the top of `zipAndSelect`, on the
summed input bytes (`entries.reduce(... e.file.size)`), before the read loop — over cap → same cap
copy (worded on the pre-compression size, "zipped" dropped) + `return`. Now an over-cap folder gets
the useful "zip it yourself" message, not a cryptic failure. `node --check` clean.

**Live test (Frontend change checklist):** upload a folder, interrupt mid-upload, reload — confirm
the auto-discard message shows and **no** resume button appears; then confirm an over-2 GB folder
is refused with the cap copy and a normal single file still uploads.

## Share-6-5a — Worker download verification (B9-3 server half)

**Deployed:** Version `f31dc124-376f-4368-8dcf-f9712c36368b` · 20 Sep 2026
**Files:** `worker/src/handlers/download_verify.js` (new), `worker/src/handlers/download.js` (new — `handleDownload` fully extracted from `index.js`), `worker/src/index.js` (dispatch stub only), `worker/test/share-6-5a.test.js` (new).
**Tests:** 19 unit pass under Vitest; 12 integration cases staged `describe.skip` for `test:integration`. `merkle.js selfTest()` vectors reproduce.

Implements merkle-spec §3 steps 1–4 in the download handler, behind a per-manifest cutover gate. Tree fn imported from `merkle.js`, not reimplemented. Leaf = BLAKE3 over exactly the stored bytes (no IV prepend). No `verified:true`, no `blake3_root`, no "end-to-end" emitted. Consumer `WORKER_URL` NOT flipped (6-6b).

**Gate predicate (`isVerifiedPath`):** `upload_complete === true && typeof merkle_root === 'string' && merkle_root.length > 0 && tree_algo === 'rfc6962-unbalanced-blake3-v1'`. Per-manifest, not a global flag. False → legacy serve (206 Range allowed, no sidecar read, no 409). Pre-6-3 files never 409.

**Hybrid threshold:** `VERIFY_INLINE_CHUNK_THRESHOLD = 128`. ≤128 → buffer-verify-then-flush (clean 409). >128 → stream + end-of-chunk verify (truncate on mismatch).

**409 body shapes (6-5b depends on these):**
- Root/sidecar failure (steps 2–3): `409 {"error":"integrity_failed"}`
- Per-chunk tamper ≤128: `409 {"error":"integrity_failed","chunk":<i>}` — chunks `0..i-1` already served 200
- Per-chunk tamper >128: no clean status — connection truncates mid-body
- Range on verified: `416`
- Verified 200 header: `X-Integrity: ciphertext-storage-verified`

**On mismatch:** AE logged; R2 object NOT auto-destroyed (preserved for investigation); `date-seal.ots.enc` deletion invariant untouched.

**`verified` still needs (6-5b + B9-4):** collection-receipt `verified` field NOT set here (receipt tail preserved verbatim). B9-4 wires it off this path's result. Plaintext root permanently barred.

**Watch in 6-6 soak:** streaming path holds one 32 MiB chunk in RAM during transit (bounded per-chunk); sidecar re-read once per chunk GET (R2 cache should absorb — measure, don't assume).

**BRIDGE:** no bump.

*"Nothing stops this train — though it pauses for CORS, sync lists, and CLI defaults."*

## Share-6-5b — download verification: recipient/consumer half (B9-3 client half)

**Commits:** `8761e7c` (refueler-share) · `75d15c5` · `2e8e632` · `237bdb3` (refueler-io). **No BRIDGE bump.**

The recipient side of 6-5a. Canonical download flow (`refueler-share/frontend/download.js`, commit
`8761e7c`) consumes the server-half contract 6-5a emits — the `X-Integrity:
ciphertext-storage-verified` header on a verified 200, and the `409 {"error":"integrity_failed"[,"chunk":i]}`
shapes — and surfaces storage-verified state on the recipient card. Mirror + surface commits in
`refueler-io` (`75d15c5` · `2e8e632` · `237bdb3`): `bin/sync-share.sh` mirror of the changed module,
recipient-card / receipt rendering.

**Honesty rails held (unchanged from 6-5a / B9-Opus):** wording stays "ciphertext storage
verified" — no "end-to-end", no `verified:true`, no `blake3PlaintextRoot` anywhere on the client
path. Plaintext-root verification is recipient-local only and permanently barred from any receipt.

**Boundary notes:** consumer `WORKER_URL` is **not** flipped here — that cutover is 6-6b, so
pre-6-3 transfers still take the legacy serve path. Collection-receipt `verified` field is wired
with B9-4, not asserted from this surface. Range requests against a verified object return `416`
(6-5a) — the client requests whole chunks, not ranges, on the verified path.

*(Reconstructed from 6-5a's forward-references + the commit list — confirm the download.js/​card
specifics match what actually shipped and adjust if needed.)*

## Share-6 live-test diagnostics — 20–21 Sep 2026 (pre-6-6a)

End-to-end live testing on refueler.io/share after 6-4a/6-4b. **No build block — findings only.**
Sessions were worked out of numeric sequence (6-4a/6-5a ahead of 6-6b), which is the source of the
one real open item below.

**Verified working (live):**
- **Single-file resume** — uploaded, pulled wifi mid-upload, wifi back, reloaded → resumed from the
  correct chunk (`Uploading from chunk 2 of 5`) and completed. IDB resume path good.
- **Folder auto-discard + folder RAM cap** — folder-origin resume auto-discards with the copy; the
  2 GiB cap + the new pre-zip input-bytes guard steer over-cap folders to "zip it yourself." A
  self-made `.zip` uploads fine as a single file (streams from disk). Folder-vs-zip asymmetry is
  by design (§7): folders are RAM-bound, single files are not.
- **Passphrase download** — small passphrase-protected file, unlock prompt → passphrase → download
  completed, **in Safari**. `download.js` unlock gate is correctly wired (button → unlock screen →
  `POST /auth/{uuid}` → token → chunks with `Authorization: Bearer`). **No bug in download.js.**

**Browser note (do not re-chase):** the "CORS / ERR_FAILED" download failures were seen in **Brave**;
the same link downloaded cleanly in **Safari**. Suspect Brave Shields / an extension blocking the
cross-origin fetch to the Worker host. Test downloads in Safari (or Brave Shields-down) before
assuming a code fault.

**Open item — WORKER_URL on an unfinished hostname (real, carry to 6-6b):**
`frontend/crypto.js` sets `WORKER_URL = 'https://api.share.refueler.io'` — the CF-for-SaaS custom
hostname whose consumer cutover is **6-6b (not done)**. It serves most requests but intermittently
returns **503** (no CORS header on a 503 → browser mislabels it "CORS"). Downloads (heavier verified
path) hit it more than uploads. Fix options: (a) revert consumer to canonical
`https://refueler-share.rt-fc4.workers.dev` — a one-line change, staged but **not placed**; or
(b) finish the 6-6b hostname cutover. Not urgent (transient), but it is the true cause of the
scary-looking download errors.

**Dead ends ruled out (do not re-investigate):**
- ❌ "finalise rejects the new opaque session token (HMAC mismatch)" — **false.** `finalise.js`
  byte-compares the token vs KV, identical to `handleUploadUrls`; fresh uploads finalise 200. The
  one resume-finalise 401 was a transient on the flaky hostname, not a code bug.
- ❌ "the Worker doesn't send CORS on `/download`" — **false.** `index.js` wraps every download
  response (incl. errors + the 500 catch) in `addCors`; OPTIONS preflight returns 204 + CORS. curl
  confirmed `access-control-allow-origin` on the exact "failing" chunk.

**Parked, safe:** folder pre-zip guard (`upload.js`) placed + synced, commit pending. `crypto.js`
WORKER_URL revert staged, not placed. Progress-bar smoothing (cosmetic) — after end-to-end is solid.

## Share-6-5c — 22 Sep 2026 (Road A: Workers Paid + cpu_ms — multi-chunk download fixed)
- DOWNLOAD-MULTI-CHUNK root cause was NOT CORS: Worker hit the CPU limit (CF error 1102 → 503 with no ACAO header → browser mislabels "CORS") running pure-JS noble BLAKE3 over a full 32 MiB chunk per request. Free tier's 10 ms CPU cap trips on the first full chunk, deterministically. Confirmed via `wrangler tail`: "Exceeded CPU Limit".
- Fix (Road A): upgraded to Workers Paid ($5/mo); added [limits] cpu_ms = 300000 to worker/wrangler.toml. Commit ae2d391, Version 37745346-8c1e-4974-ba4c-149c5557588d. Verified GET /download/{uuid}/0000 → 200. $6 billing budget alert set.
- Road B (rejected): presigned-GET straight from R2 — drops serve-time re-hash, relies on browser plaintext BLAKE3 + AES-GCM (the real guarantee). Reasoning banked for later.
- NEXT: Share-6-5d (Opus) — swap verified-path BLAKE3 → WASM (worker/blake3-wasm/ already vendored). Then the 250 GB soak (only remaining 6-6 item; WORKER_URL cutover already closed 6-6b).

## Catch-up — 6-6b through Orientation · logged 23 Sep 2026

Brings the log current past 6-5c. **Supersedes the earlier "Open item — WORKER_URL 6-6b (not done)" note above — 6-6b closed 21 Sep.**

**Share-6-6b · 21 Sep 2026 — SHARE-503 closed, legacy retired.** refueler-share `418d0c9` · refueler-io `1ff986b` · Worker `924184db`. Legacy `PUT /upload/:uuid/:chunk` route retired from index.js (handleUpload body tagged dead code, kept for reference). `USE_DIRECT_R2` flag retired from upload.js — direct-to-R2 is now the unconditional path (upload.js 1598 → 1428). `orphan_sweep.js`: `?dry_run` param (default true); `dry_run=false` deletes stale + sidecar_only R2 objects, **never** orphan_chunks (presigned PUTs may be in flight); delete order chunks → hashes → manifest. Dry run: 3,166 objects / 126 UUIDs (39 complete, 79 stale, 4 sidecar_only, 0 orphan). Live deletion: 869 objects. Admin-key gated via `X-Admin-Key` (value in the `ADMIN_KEY` Worker secret). Small-file smoke (573 KB, passphrase + destroy-after-download): green.

**Open bugs — current board.** DAD-BUG (destroy-after-download not deleting, legacy path) · CAP-WARNING-LINK (`/upgrade` → should be `/share/plans/`) · UPGRADE-CSS (`/upgrade` unstyled) · BRAVE-THEME (non-dashboard pages) · NO-ADMIN-TEST-TIER (→ Share-Admin-1) · PHOENIXD-TOGGLE (Worker `/status` must echo the granular phoenixd value) · command-centre `localStorage` → `rs-theme`.

**Plan of record — forward.** Share-6-5d (WASM hasher swap in `verifyChunkBody` + root reconstruction; `worker/blake3-wasm/` already vendored; Opus) **first and alone** → Share-Admin-1 (test credential + hidden test-upload page) → **250 GB soak** (last remaining 6-6 item; run after 6-5d to measure the fast hasher). Deeper follow-on if WASM alone is insufficient: move ciphertext integrity off the download hot path (verify at finalise + background sweep + serve straight from R2). Model rule unchanged: Opus only for first-time crypto; Sonnet for specified build/wiring.

**Paid-plan backlog (Workers Paid live).** Adopt (Sonnet): Durable Objects (rate-limiting — own design session), Queues (Chartered webhooks + verify-at-rest sweep), Hyperdrive (pool Supabase), Workers Builds (auto-deploy). Not a fit: D1, Workers AI, Vectorize, Workers Assets.

**Ops constants (moved to architecture-invariants).** Share Worker deploy = `npm run deploy` from `worker/` (NOT `npx wrangler deploy` — wrong Worker); API host `api.share.refueler.io`. R2 SigV4 secret = SHA-256 of the R2 API Token Value (`shasum -a 256`), not the raw value.

## Share — Orientation & Ideas · ad-hoc synthesis · 22 Sep 2026 (non-coding)

Snapshot + triage session (no build). Outputs:

- **Identity/routing thread (named, not designed).** `@handle.share` vanity URLs + Chartered namespaces (e.g. `legal.cliffordchance`). A persistent handle is inherently "on the register" — the opposite of Bearer / *in camera* — so likely **Registered/Chartered-rail only, never Sovereign**. Open threads: namespace ownership + uniqueness verification without reintroducing anonymous-rail accounts; resolution/routing without a server-side identity map (= a compulsion surface); squatting/impersonation over firm namespaces; a public handle directory = metadata leak. High scope-gravity, zero API customers hold a namespace yet — park it.
- **OTS relay (TH-1) is NOT built** — only the TH-0 spike (hand-rolled GO; calendars reachable from host; CF egress unconfirmed). Load-bearing for `permanent_record` anchoring, MMR published-root anchoring (B9-6), and the btc++ hackathon idea. Committed value `SHA-256(blake3_root ‖ url_fragment_nonce)` locked at TH-0 — do not change.
- **MMR / reverse-Experian = research thread, not a build** (captured in `merkle-spec-v1.md` §4/§7 + BRIDGE §Merkle). Sharpened hard part: self-anchoring lets a user lie by omission — the "better than Experian" claim depends on solving **who anchors the root**; unsolved, it is self-asserted only (bank-signed leaves before "verified"; MLRO to confirm SYSC 6.3 / MLR reg. 40, not the travel rule). The gate is data depth (18–24 months of leaves), not cryptography.
- **btc++ Berlin (1–3 Oct, Payments Edition, 24h hack, teams ≤ 4; pool 2.5M/1.75M/750k sats + stackable Electrum 1M & Base58 500k).** Payments-edition fit favours the **Cashu payment rail** (idempotent, peer-to-peer ecash capabilities — the Base58 "Most Based Payment Protocol" challenge) over the plain file pipe. Rajesh attends as AV volunteer, flies Wed 30 Sep. Direction only — start cold, do not pre-build.
