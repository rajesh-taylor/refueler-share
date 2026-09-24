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

**What was done:**
- `refueler-mcp/package.json` — `name: "@refueler/mcp-server"`, `version: "0.1.0"`, `license: "Apache-2.0"`, `private: false`, `engines: { node: ">=18" }`, `files: ["src/", "README.md", "LICENSE"]`.
- `refueler-mcp/LICENSE` — Apache 2.0 full text, copyright 2026 Rajesh Taylor.
- `refueler-mcp/.npmignore` — excludes `test/`, `scripts/`, `docs/`, `.env*`, `*.test.js`, context files.
- `npm pack --dry-run` verified: 4 files. Output confirmed clean.
- `refueler-mcp/README.md` — full rewrite: trust-boundary operator document. All honesty constraints applied.
- `refueler-share/README.md` — full rewrite: public-facing repo README.

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

`Share-6 block (large-upload direct-to-R2) → B8 build → [Hetzner commitment] → NB-2–NB-4 → B7 → SD-block → B9 build (B9-4…B9-8) → B10+`

*(SW-MCP block complete. SW-MCP-7 anonymous-rail tail gates on B7/NB-4. Share-6 is Priority-1 — SHARE-503 blocks all large uploads — and front-loads B9-1/B9-2/B9-3, so the later B9 build resumes at B9-4. B9-Opus design complete; sequenced in `merkle-spec-v1.md` §9.)*

## B8-Opus · 13 Sep 2026 — NUT-11 Mode 2 (Locke) design lock

| Item | Detail |
|------|--------|
| Session type | Architecture + design, no code produced |
| Output | `B8-spec-v1.md` (refueler-share repo root) |
| BRIDGE | v9.5 |

Seven decisions locked (D-1…D-7) — full detail in `B8-spec-v1.md`. Key outcomes:
- Deed→Locke derivation: **HKDF** (`salt="refueler.locke.v1"`), reduce/reject-sample to valid secp256k1 scalar. Not BIP-32.
- Worker check order: **sig → BDHKE → double-spend** (Supabase INSERT always last).
- Schnorr **BIP-340**, x-only key from the 33-byte P2PK `data`; witness `{signatures:[…]}` verbatim.
- Locke lifecycle: primary Locke Deed-derived + immutable recovery anchor; KV challenge-response login. **This is the SD3 primitive.**
- `hashSecret()` (Mode 1, bare SHA-256) unchanged and independent of Mode 2.
- CDK stays **0.17.2**.
- Build **direct in refueler-share**, B9-style.

**Do-not-retry additions:** see `B8-spec-v1.md` §9.

## Share-6-Opus · 16 Sep 2026 — Large-upload direct-to-R2 architecture lock

| Item | Detail |
|------|--------|
| Session type | Architecture + design, no code produced |
| Output | `Share-6-spec-v1.md` (refueler-share repo root) |
| BRIDGE | v9.6 |

Six decisions locked (D-1…D-6) — full detail in `Share-6-spec-v1.md`. Key outcomes:
- **Upload moves off the Worker edge to R2 direct** via presigned S3 `PutObject` URLs. Worker `initiate`s + `finalise`s only.
- **Not S3 multipart** — per-object PUT preserves `{uuid}/{iiii}` layout.
- **Part size 32 MiB, uniform across tiers.**
- **Cashu verified + spent once at `initiate`** (moved off chunk-0).
- **Integrity moves entirely to download-time (B9-3):** browser writes `merkle_root` + `{uuid}/hashes` at finalise; Worker reconstructs + 409 on download.
- **aws4fetch** (in-Worker SigV4 signer). Presigned expiry 6 days; URL batches of 256.

**Do-not-retry additions:** see `Share-6-spec-v1.md` §10.

## Share-6-3a — POST /upload/{uuid}/finalise (Worker only) · 17 Sep 2026

Worker /finalise: X-Upload-Session auth, HEAD completeness sweep, {uuid}/hashes sidecar (raw N×32), manifest merkle_root + tree_algo + upload_complete:true, session KV spent. Commit: `b6f4dc4`

**Do-not-retry / wire contract:**
- Auth header is `X-Upload-Session` — never `X-Upload-Session-Token`.
- Finalise body: `{ hashes: [b64url(32B) × N], merkle_root: b64url(32B) }` — hashes is an ARRAY.
- tree_algo pinned `rfc6962-unbalanced-blake3-v1`.
- Sidecar is WRITE-AND-KEEP.

## Build sequence re-chunked · 17 Sep 2026

Model rule: Opus only for first-time crypto; Sonnet for everything specified.

### Navy Office + API & MCP tile (Dash-3 plan)

- Navy Office rename (`dashboard.html` → `navy-office.html`). Chambers h1 fixed. Client-errors modal toggle (Worker 90d / Browser 24h). API & MCP card replacing CPU-time stub. Growth signal card full-width. Dock enrichment live.

## Catch-up: Dash-3 → 6-3c · logged 20 Sep 2026

| Session | Commit | Outcome |
|---------|--------|---------|
| Share-Dash-3 (Sonnet · 18 Sep) | — (reverted) | Rewrote navy-office.html from scratch, destroyed the sidebar. **Git-rolled-back.** |
| Share-Dash-3b (Opus · 19 Sep) | `911eae8` | Recovered genuine navy-office.js (1662 lines); surgical HTML edits. hh-* DORMANT. |
| Share-6-3b (Opus · 19 Sep) | `ec37c17` | `worker/src/merkle.js` — RFC-6962-unbalanced-BLAKE3 tree fn + inline N=1..4 vectors. |
| Share-6-3c (Opus · 19 Sep) | frontend/merkle.js | Browser Merkle twin — WASM BLAKE3, same pinned vectors, selfTest() hard gate. |

## Share-6-3d — upload.js finalise wiring + first real end-to-end send · 20 Sep 2026

Sonnet · frontend only (plus one CORS fix). Wired `POST /upload/{uuid}/finalise`. Body `{ hashes:[b64url(32B)×N], merkle_root:b64url }`, header `X-Upload-Session`; tree_algo NOT sent (Worker pins it). Commit `050998b`.

**First genuine end-to-end send on the live site.** article-a-research-notes.md, 16,818 B, 1 chunk, free tier, password-protected. Manifest: `upload_complete:true` · `tree_algo rfc6962-unbalanced-blake3-v1` · `merkle_root 43 chars` · `blake3_root null` · `file_name "encrypted-payload"`.

**Two latent integration bugs flushed:**
- merkle.js never in `bin/sync-share.sh` → mirror 404. **Rule: new served module ⇒ add to sync-share.sh.**
- `X-Upload-Session` absent from `corsHeaders` → finalise preflight blocked. **Rule: new browser header ⇒ add to corsHeaders.** Commit `f97b7d9`.

## Share-6-4a — upload resume close + folder auto-discard + folder RAM cap (6-4b) · 20 Sep 2026

Opus · `frontend/upload.js`. Folder auto-discard: `record.sourceType === 'folder'` → clear IDB + copy "Folder uploads cannot be resumed". Folder RAM cap: `FOLDER_ZIP_CAP = 2 * 1024 ** 3`; pre-zip input-bytes guard added after live test. `node --check` clean.

## Share-6-5a — Worker download verification (B9-3 server half) · 20 Sep 2026

**Deployed:** Version `f31dc124`. **Files:** `download_verify.js` (new) · `download.js` (new, extracted from index.js) · `index.js` (dispatch stub). 19 unit pass.

Gate predicate (`isVerifiedPath`): `upload_complete === true && typeof merkle_root === 'string' && merkle_root.length > 0 && tree_algo === 'rfc6962-unbalanced-blake3-v1'`. Hybrid threshold: 128 chunks. 409 shapes locked. `X-Integrity: ciphertext-storage-verified` on verified 200. No `verified:true`, no `blake3_root`, no "end-to-end".

## Share-6-5b — download verification: recipient/consumer half (B9-3 client half) · 20–21 Sep 2026

**Commits:** `8761e7c` (refueler-share) · `75d15c5` · `2e8e632` · `237bdb3` (refueler-io).

Consumes `X-Integrity: ciphertext-storage-verified` header + 409 shapes from 6-5a. Surfaces storage-verified state on recipient card. Honesty rails held: "ciphertext storage verified" only, no "end-to-end".

## Share-6 live-test diagnostics — 20–21 Sep 2026

**Verified working (live):** Single-file resume ✓ · Folder auto-discard + RAM cap ✓ · Passphrase download in Safari ✓.

**Browser note (do not re-chase):** "CORS / ERR_FAILED" failures in Brave — Brave Shields suspect. Test in Safari before assuming code fault.

**Dead ends ruled out:** finalise HMAC mismatch (false) · Worker missing CORS on `/download` (false — curl confirmed).

## Share-6-5c — 22 Sep 2026 (Road A: Workers Paid + cpu_ms)

Root cause: Worker CPU limit (CF error 1102 → 503) on pure-JS noble BLAKE3 over 32 MiB chunks. Free tier 10 ms cap trips deterministically. Fix: Workers Paid ($5/mo) + `[limits] cpu_ms = 300000`. Commit `ae2d391`. $6 billing budget alert set.

## Catch-up — 6-6b through Orientation · logged 23 Sep 2026

**Share-6-6b · 21 Sep 2026 — SHARE-503 closed.** `418d0c9` · `1ff986b` · `924184db`. Legacy upload route retired. `USE_DIRECT_R2` flag retired. `orphan_sweep.js` with `?dry_run` param. Dry run: 3,166 objects / 126 UUIDs. Live deletion: 869 objects.

**Paid-plan backlog (Workers Paid live).** Durable Objects · Queues · Hyperdrive · Workers Builds. Not a fit: D1, Workers AI, Vectorize, Workers Assets.

**Ops constants:** Share Worker deploy = `npm run deploy` from `worker/`. API host `api.share.refueler.io`. R2 SigV4 secret = SHA-256 of the R2 API Token Value.

## Share — Orientation & Ideas · 22 Sep 2026 (non-coding)

- **`@handle.share` vanity URLs** — Registered/Chartered-rail only. Park it (zero API customers yet).
- **OTS relay (TH-1) is NOT built** — only the TH-0 spike. Committed value `SHA-256(blake3_root ‖ url_fragment_nonce)` locked — do not change.
- **btc++ Berlin (1–3 Oct).** Payments Edition. Rajesh attends as AV volunteer, flies Wed 30 Sep. Direction only — start cold, do not pre-build.

## Share-6-5d — WASM BLAKE3 swap on the verified download path · 23 Sep 2026

**Session type:** Build (Opus). `verifyChunkBody()` → `hashOneShot()` from `worker/src/blake3_wasm.js`. WASM hash byte-for-byte identical to noble. `merkle.js` left on noble by design. New file `blake3_wasm.js` exports `hashOneShot(bytes) → Uint8Array(32)`.

## Share-6-5e — workerd test pool · 23 Sep 2026

**Session type:** Test infrastructure only. **Problem:** CompiledWasm broke plain Node Vitest. **Fix:** `@cloudflare/vitest-pool-workers@^0.5.41` — `npm test` now runs inside workerd. Files: `vitest.config.js` → `defineWorkersConfig`; `package.json` devDep added; `share-6-5d.test.js` workaround reverted. **Result:** 18 test files · 566 passed · 29 skipped. TEST-HARNESS-WASM snag: resolved.

---

## Share-Admin-1 · 23 Sep 2026 — 5 GiB streaming soak test

**Commit:** `35a4808`

**Bugs fixed:**

| Bug | Fix |
|-----|-----|
| Worker CORS rejected localhost | `corsHeaders()` echoes `http://localhost:*` / `http://127.0.0.1:*` |
| Field name `presigned_urls` vs `urls` | Renamed to `urls` (matches `/initiate` response) |
| URL element object not string | Added `.url` suffix |
| `crypto.getRandomValues()` 64 KiB cap | IIFE loop in 65,536-byte increments |
| No retry on 5xx | 3-retry loop with 2s/4s/6s backoff |

**R2 CORS:** wrangler `cors set` broken — set via Cloudflare dashboard.

**Soak result:** 160 / 160 chunks · 5.000 GiB · 30m 7s · Merkle root: `xsuFUutgB9ROLa2HqT7ZO6GD0xEZtnFn-tw59vkf1WA` · UUID: `554b5551-e093-482e-b28d-7464eee7dab1`

**Do-not-retry:**
- DO NOT use `wrangler r2 bucket cors set` (wrangler ≤4.137.0) — broken, use Cloudflare dashboard
- `crypto.getRandomValues()` hard cap is 65,536 bytes per call — always loop for buffers >64 KiB
- NEVER add `test-upload.html` to `bin/sync-share.sh`
- NEVER serve `/share/admin/test-upload.html` via the public mirror

---

## Share-Admin-2 · 23 Sep 2026 — Bug board + Navy Office walkthrough + B10 design lock

**Session type:** Bug fixes + design decisions. **Commits:** `4e14f37` · `68f1e9b` · `07e5060`

### Bugs fixed

| Bug | Commits | Root cause + fix |
|-----|---------|-----------------|
| **DAD-BUG** — destroy-after-download not deleting | `4e14f37` | Three causes: (1) `handleMeta` `?? false` collapsed `null` (not DAD) and `false` (armed); fixed to `?? null`. (2) `finishDownload` `putManifest` flip lacked `ctx.waitUntil`; wrapped. (3) Frontend `!!meta.pending_destruction` treated `false` (armed) as non-DAD; fixed to explicit null/undefined check. |
| **CAP-WARNING-LINK** — capacity warning links to `/upgrade.html` | `68f1e9b` | Three `href="/upgrade.html"` → `href="/share/plans/"` in `frontend/index.html`. |
| **PHOENIXD-TOGGLE** — Lightning Availability "Phoenixd" button returned 400 | `07e5060` | `'phoenixd'` missing from `validLightning` array; coercion collapsed non-`'true'` strings to `false`. Fix: added `'phoenixd'`; rewrote coercion to preserve named backend strings (`lv === 'true' ? true : lv === 'false' ? false : lv`). Toggle now correctly stores `lightning_available: 'phoenixd'` and turns green. |

**Also in `4e14f37`:** BLAKE3 WASM swap in `download_verify.js` (Share-6-5d) + `blake3_wasm.js` new file. `handleStatus` default object gains `phoenixd: null`.

### Soak test status (DO NOT sweep until complete)

100 GiB soak (3,200 × 32 MiB, 8 parallel) in progress at session close. Orphan sweep command when complete:
```
curl -X DELETE "https://api.share.refueler.io/admin/orphan-sweep?dry_run=false" -H "X-Admin-Key: <key>"
```

### Navy Office walkthrough — card triage

**Client Errors (Worker-observed 90d):** Five Jan 21 `admin_status` 400s = Phoenixd button clicks (now fixed). `Message` column empty — Worker AE logs don't include message text. B10: remove column.

**Client Errors (Browser-reported 24h):** Five `receiver_ab_downloaded` via `/log/error` — legitimate download-complete events, miscategorised. B7 snag (S93–S95). `Browser: Unknown / Unknown` pre-Aug 2026 (UA field `blob4` only exists from S73/5 Aug). B10: hide/remove column or add tooltip.

**API & MCP card:** 6,307 = ALL Worker requests (6,300 Pro Bono, ~7 Registered). Not API-tier subscriber activity. B10: relabel or filter to Registered+Bearer.

**Credential Issuances card:** Trend chart is placeholder stub. B10: replace with daily AE line graph.

### B10 design decisions locked

**Growth Signal chart — redesign spec:**

1. **Auto-populate from AE.** New endpoint `GET /admin/growth-snapshot` queries AE for cumulative user counts by tier. Manual entry form becomes annotations-only.
2. **BTC/GBP price overlay.** Worker proxy `GET /admin/btc-price` → CoinGecko free API (`https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=gbp`) with **10–15 min KV cache** (key `btc:price:gbp`, TTL 600–900s). No auth required.
3. **D/W/M/Y time-axis toggle.** In-memory only. Default: Month.
4. **Manual entry = annotations only.** `POST /admin/news-events` retained; Free/Paid/API counter fields removed. Entries become vertical tick-mark overlays (date + label) on the chart.
5. **Line graph:** Free (gold) / Paid (green) / API (amber) + BTC/GBP right Y-axis. Annotation ticks with hover tooltip.

**B10 dashboard card punch list:**

| # | Card | Issue | Fix |
|---|------|-------|-----|
| 1 | Client Errors (Worker 90d) | `Message` column empty | Remove column |
| 2 | Client Errors (Browser 24h) | `Browser` column Unknown pre-Aug 2026 | Hide rows where Unknown / add tooltip |
| 3 | Client Errors (Browser 24h) | `receiver_ab_downloaded` via `/log/error` | Fix routing → AE `logEvent()` (B7 snag S93–S95) |
| 4 | API & MCP | 6,307 = ALL requests, not API-tier | Relabel "Requests (30d)" or filter to Registered+Bearer; add Pro Bono sub-line |
| 5 | Credential Issuances | Trend chart placeholder | Replace with daily AE line graph |
| 6 | Growth Signal | Manual-only; no BTC price; no time toggle | Full redesign per spec above |
| 7 | OTS aggregate | No widget | Scope decision: founder-only aggregate in Navy Office? Confirm before building. |
| 8 | Sandbox → Live | Stub pending | Wire KV signal from `sandbox.js` |

**Deferred (explicitly out of scope for now):**
- rs-theme cookie migration (command-centre `localStorage` → cookie)
- UPGRADE-CSS (`/upgrade` unstyled)
- BRAVE-THEME (non-dashboard pages)

**Next after soak completes:** orphan sweep, then B10 planning session.

---

## Share-B10-1 · 23 Sep 2026 — Navy Office dashboard build + live-review snags

**Session type:** Build (Opus) + live review. **Repos:** `refueler-share` (Worker) · `refueler.io` (Navy Office frontend).
**Commits:** refueler-share `fea2690` (+ junk cleanup `0008a5f`) · refueler.io `d55de19` → `08d8641` → `bdef6bd` → `fb841dc`.

### Built (B10-1 punch list items 1–4)
- **`GET /admin/btc-price`** (new `worker/src/handlers/btc_price.js`) — CoinGecko `simple/price` proxy, KV `btc:price:gbp` TTL 900s + no-TTL `btc:price:gbp:last` backstop, returns `{price_gbp, cached_at, source, stale?}`, X-Admin-Key gated. (Dash-2 design note said no-auth; shipped admin-gated per the session prompt — the chart is behind the admin gate anyway. Distinct from the governed `/admin/btc-rate` reference rate.)
- **`GET /admin/growth-snapshot?range=D|W|M|Y`** (new `worker/src/handlers/growth_snapshot.js`) — AE cumulative credentials-issued per tier (free→Free, creative+max→Paid, api→API), `toStartOfInterval` bucketing, cumulative-within-retained-window. AE-only; operator chose "Year truncated to ~90d" over manual backfill.
- **`api_stats.js`** — added `billable` (identity+anonymous) + `pro_bono` (none) to `requests_30d`; card headline is billable-only with a Pro Bono sub-line.
- **`receiver_ab_*` → AE routing (B7 snag S93–S95, now closed)** — Worker `handleLogError` routes `context:'receiver_ab'` to `logEvent()` (blob1 = the real event from `message`, blob3 = variant) instead of the `client_error` blob. No new browser header/endpoint (consumer frontend unchanged); receiver_ab drops out of the client-errors card within 24h.
- **Navy Office frontend** — growth card redesigned to a single **Last 90 days** view (D/W/M/Y toggle dropped after review), three auto lines + BTC overlay + **annotation flag markers seated on the Free line** with two-way hover highlight (flag ↔ list row), annotations-only form, **Print chart** (landscape one-page archive). Client-errors: Worker-90d Message column removed; Browser column dropped from the 24h table. Credential Issuances modal: real daily AE line with labelled X/Y axes.

### B10 live-review snags (found post-deploy — DO NOT FIX until B10 sessions)
1. **BTC-PRICE-503 — CoinGecko unreachable from the Worker.** `GET /admin/btc-price` (and the `refreshBtcRate` cron on `/admin/btc-rate`) return 503 live — CoinGecko unreachable from the CF Worker with empty cache. Effect: the growth-chart **BTC/GBP overlay never renders**, and the Worker-90d client-errors card fills with `admin_btc_price 503` rows. Likely CoinGecko free-API rate-limiting/blocking Worker egress IPs (or a demo-key requirement now). B10: confirm via `wrangler tail`; options — longer last-good cache + back-off polling, a CoinGecko demo key, or move the BTC feed to the node (Tier-2, post-B7). Both btc-price (display) AND btc-rate (governed rate card) share this dependency.
2. **CLIENT-ERR-TS-1970 — Worker-90d timestamps show "21 Jan 1970".** `appendClientError` stores `ts` in unix **seconds**; `navy-office.js` KV-table render does `new Date(r.ts)` (expects **ms**) → seconds read as ms → every row collapses to ~21 Jan 1970 18:16. Fix: `new Date(r.ts * 1000)` in the KV client-errors row render only. (The AE/24h table uses `double1` in ms and is correct — do not touch.)
3. **GROWTH-AXES — main growth chart has no readable axes.** No x-axis date ticks (doesn't read as "90 days"); the y-axis max (e.g. 156) is unlabelled. 156 = the top of the Free cumulative line = cumulative Free-tier credentials issued (≈ upload sessions started) over the retained window. B10: add x date ticks/gridlines + a labelled y-axis ("credentials issued, cumulative"), matching the issuance-modal chart's axes.
4. **GROWTH-FLAG-TOOLTIP — hover overlay cramped.** date+label+note stack and wrap one-word-per-line against the right edge. B10 (founder-preferred design): move the **date onto the x-axis** at the flag's foot; show **only label + note** in the hover; widen the tooltip and fix right-edge positioning/clipping.

**Delivery process note (not product):** desktop `.js` downloads fail ("This file type cannot be opened"); repo-folder saves landed in a stray `Claude outputs/` folder with `-1` suffixes; bridge `device_commit_files` silently no-op'd one JS write (reported success, bytes unchanged) — byte-verify every bridge write. Dedicated file-delivery-workflow session queued before further Navy Office work.

## Share-Delivery-1 · 24 Sep 2026 — File delivery protocol

Protocol: code→bridge write+byte-verify+diff; docs→SendUserFile; escape-hatch→.zip. Written to CLAUDE.md §File delivery protocol.

## Article-Rewrite-1 — "What a subpoena gets" rewrite (planned, post-B8 build)

**Slot:** After B8 build sessions, before Hetzner/NB-2. Target: complete before Berlin (30 Sep 2026).
**URL:** https://refueler.io/notes/what-a-subpoena-gets/
**Source file:** refueler.io repo — locate via grep.

### What's wrong with the current version

- Opening line is a cliché ("Most privacy policies are written by lawyers…"). Cut entirely.
- Stacked aphorisms ("The flag is not the architecture" + "Architecture protects your content. Jurisdiction shapes the paperwork") — too many, kills the dry wit.
- Mullvad aside appears out of nowhere mid-analysis — reads as virtue-signalling, not serving the reader.
- "the gap between 'they say so' and 'we can check' is where legal risk lives" — calculated rhythm, performed insight.
- Tables have verbose "Notes" column doing work the body text should do. Wasted space.
- Competitor set (WeTransfer, Smash, SwissTransfer, Wormhole, Tresorit, Proton Drive) is stale — needs current landscape check before session.

### What to keep

- Structure is sound. The section headings are good.
- Technical analysis is accurate.
- "What a Court Order Gets from Refueler Share" section — specific, honest, earns trust. Keep the tone of that section everywhere.
- The Proton 2021 case reference — well-used, keep.
- Full analysis table at the end — restructure to compact tick/cross format (see screenshot, Share-Delivery-1 session), not prose Notes column.

### Rewrite objectives

1. **New opening:** plain statement of what the article does. No cliché warm-up.
2. **Compact tick/cross tables** — two tables: (a) mainstream services (legal-exposure angle), (b) technical privacy competitors (direct feature comparison, compact format with ✅/❌/upcoming). "Upcoming" rows honest for Lightning + ML-KEM.
3. **Competitor set audit** — verify each service is still live and claims are current before session. Note: Crypt.fyi has ML-KEM live (B10 target for us). Self-hostable ❌ for Share gets one honest sentence — don't bury it.
4. **Voice:** plain declarative sentences. One dry line per piece, earned. Let tables do the persuasion. See CLAUDE.md §Editorial voice.
5. **Dry wit:** one line, one place. Don't schedule it.


*"Nothing stops this train."*

## Share-6-6a · 24–25 Sep 2026 — Soak result + open Download-409 bug

**Soak result (100 GiB):**
- Upload: ✅ PASS — 3200/3200 chunks, 5h 35m, 5.09 MiB/s
- Transfer UUID: 27038a69-54d8-468d-a9fd-829de9c1aedf
- Merkle root: hJjM8BR0CNETLlAYZOEALbhLGrOzuPlHKAAo39DAB4c
- Download-verify: ❌ FAIL — 5/5 sample chunks HTTP 409

**409 diagnosis (not yet fixed):**
- Not a payment gate (B8/Locke not built). Likely Worker state-machine blocks downloads on transfers in FINALISED state, or download endpoint requires a token the test harness doesn't send.
- Check download handler: what transfer state does it require? Is FINALISED → READY transition missing?

**Remaining before Share-6 closes:**
1. Diagnose and fix 409 — rerun download-verify against existing UUID
2. Run orphan sweep: `curl -X DELETE "https://api.share.refueler.io/admin/orphan-sweep?dry_run=false" -H "X-Admin-Key: <key>"`
3. Close Share-6 block

---

## Catch-up — B10-2 → B12 · logged 24 Sep 2026

| Session | Commit | Summary |
|---|---|---|
| Share-B10-2 | `bc5e163` (refueler-io) | Navy Office: KV timestamp ×1000 fix; Execution Dock tier display names. Dashboard design decisions locked (Master Context §User-facing). |
| Share-B10-3 | `49399ca` (deploy `b81116e2`) | **Download-409 fixed.** `reconstructAndCheckRoot` ran on every chunk and exhausted `cpu_ms` on >128-chunk transfers → false `integrity_failed`. `readSidecarWithRootCheck()` gates reconstruction behind KV `root_verified:{uuid}` (TTL = expiry). `verifyChunkBody` untouched. Supersedes the open item in Share-6-6a above. |
| Share-B11-1 | `76799ae` (deploy `28d43b55`) | **DAD fixed.** `finishDownload` runs the destruction sequence in `ctx.waitUntil`: consumed guard → chunks → sidecar → `date-seal.ots.enc` → `root_verified` → tombstone. Second download = 410. `dock_index` not cleared on DAD (B12-1 fixes). Open: DAD-ERROR-TEXT ("0%" on error screen). |
| Share-B12 | `cc14d21` | Storage / quota / surfaces / billing design (Opus). `docs/B12-spec-v1.1.md`. |

---

## Share-B12-SR · 24 Sep 2026 — Security review of B12 (Opus, no code)

**Commit:** `4564730` · **Spec:** `B12-SR-spec-v1.md` (repo ROOT, not docs/) · wins over B12-spec-v1.1 on any conflict.

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
| B12-1 · B12-1b · B12-2 | 3 (+1 buffer) | Sonnet | Pre-Berlin |
| KV-Audit-Opus → KV fixes · X3 naming · X5 app origin | 1 + 4–5 | Opus + Sonnet | Week 1 post-Berlin |
| B12-3 quota | 3 (+1) | Sonnet | Week 2 |
| B12-4a auth | 2 (+1) | Sonnet | Week 2 |
| B12-4b Chambers · B12-6 billing + 3 open bugs | 3 | Sonnet | Week 3 |
| B12-Audit (built quota + auth) | 1 + 1 | Opus + Sonnet | Week 3 |
| B12-5 Harbourmaster | 2 | Sonnet | When a Chartered client is in sight |
| B12-4c Sovereign ledger | 2–3 | Sonnet | With SD-block (needs B8-1 + B7) |

## Locked block sequence (updated Share-B12-SR · 24 Sep 2026)

`B12-1 → B12-1b → B12-2 → [Berlin 30 Sep–3 Oct] → KV-Audit-Opus + fixes · X3 · X5 → B12-3 · B12-4a · B12-4b · B12-6 · B12-Audit → B8 build → [Hetzner] → NB-2–NB-4 → B7 → SD-block (+ B12-4c) → B9 build (B9-4…B9-8) → B10+`
```

---
