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

*"Nothing stops this train."*
