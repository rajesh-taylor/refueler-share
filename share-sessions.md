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
| 16 | 14 Jul | grouped | KV status system: `refueler-share-kv` (binding `STATUS_KV`), `GET /status`, `POST /admin/status`, maintenance banner (`sessionStorage` dismiss) |
| 17 | 14 Jul | grouped | `src/status.njk`: ops + crypto integrity sections, 60s auto-refresh, banner-linked only |
| 18 | 14 Jul | grouped | AE dataset `share_events` (binding `AE`), `logEvent()` helper, `timed()` router wrapper |
| 19 | 14 Jul | grouped | `/admin/metrics`: MRR, subscribers_by_tier, paid_total, churn MTD. RLS deny-all on ledger tables. `cancelled_at` added to `subscribers` |
| 20 | 14 Jul | grouped | `double_spend_attempts` table, `credential_uniqueness_rate` metric |
| 21 | 14 Jul | grouped | `frontend/admin/dashboard.html` scaffold: password gate, live metric cards, 60s refresh |
| 19-plan | 14 Jul | — | Roadmap S19–S120 drafted. Critical chains recorded in Share-Master-Context.md |
| 22 | 15 Jul | `d1bcb5a`+`f36e385` | `GET /admin/ae-metrics`: AE SQL proxy, CF_AE_TOKEN scoped. CORS `X-Admin-Key` fix. |
| 23 | 15 Jul | `a4bc625` | AE SQL column syntax fix (`double1`/`blob1` not array syntax). p95/p99 latency + error rate cards. |
| 24 | 15 Jul | `5be5811` | `GET /admin/snapshot`, System Summary dashboard section (6 metric tiles) |
| 25 | 15 Jul | `fc6cba9`+`99afaaa` | Free-to-paid conversion rate, dashboard restructure |
| 26 | 15 Jul | — | B2 close. 10/13 metrics live. Context files updated to v2.1. |

**Permanent do-not-retry (B1–B2):**
- blake3-wasm CDN (esm.sh/unpkg) — local bundle only
- Invisible Turnstile — visible managed widget only
- `secp.Point` — removed in noble v2, use `secp.ProjectivePoint`
- `binding = "R2"` in wrangler.toml — must be `BUCKET`
- BLAKE3 for passphrase hash — must be SHA-256
- `wrangler r2 bucket lifecycle set --rule` inline JSON — use `add` subcommand; `lifecycle get` → `lifecycle list`
- AE SQL: use `double1`/`blob1` column names, not `doubles[N]`/`blob[N]` array syntax
- DO NOT await `env.AE.writeDataPoint()` — fire-and-forget
- DO NOT call AE SQL API from Worker — proxy via `/admin/ae-metrics` only
- DO NOT use KV counter for double-spend tracking — race condition; Supabase table only
- `spatial_ref_sys` RLS is false — PostGIS system table, leave alone
- `sessionStorage` only for banner dismiss (not localStorage)
- DO NOT add `/status` to nav — banner-linked only

---

## Sessions 27–29 — B3 Stripe test coverage (16–20 July 2026)

| # | Commit | Summary |
|---|--------|---------|
| 27 | `5f3cb8e` | Stripe CLI installed. 4 test prices created. Root cause of `client_secret` mismatch identified: `checkout/sessions ui_mode:embedded` incompatible with `stripe.elements()` |
| 28 | `5f3cb8e` | Direct Subscription creation pattern confirmed. 4242 card flow ✓. Webhook handler extended with `customer.subscription.created`. |
| 29 | `5d8c1ea` | `STRIPE_SECRET_KEY` rotated to `sk_live_...ZehD`. Portal `resource_missing` confirmed correct (no active sub). Cancellation code-complete. **B3 closed.** |

**B3 do-not-retry:**
- DO NOT use `checkout/sessions ui_mode:embedded` — use direct Subscription + `expand[0]=latest_invoice.payment_intent`
- DO NOT `decodeURIComponent` Stripe `client_secret` — already decoded
- DO NOT attempt Customer Portal without active subscription — Stripe returns `resource_missing`
- 4242 card is test-mode only — never works in live mode

**B3 gap (deferred to B11):** Full cancel → webhook → Supabase loop requires a real live subscriber. `cus_UtlpRELAdcZXk2` has no active subscription.

---

## Sessions 34–36b — B4 Security hardening (20–21 July 2026)

### S34 — BLAKE3 WASM Worker integration
**Commit:** `7738450f` (version)

- Rust toolchain (rustup 1.29.0, cargo 1.97.1), wasm-pack 0.13.1
- BLAKE3 v1.8.5 compiled via `wasm-pack --target bundler` → `worker/blake3-wasm/` (23K, wasm-opt applied)
- `blake3_worker.js` — Workers WASM init wrapper (manual `WebAssembly.instantiate`, `__wbg_set_wasm`)
- `blake3.js` — `verifyChunkHash()` now computes real server-side BLAKE3, constant-time compare, 400 on mismatch
- `wrangler.toml` `[[rules]]`: `type="CompiledWasm"`, `globs=["**/*.wasm"]`, `fallthrough=false`
- **Integrity gap: CLOSED.**

**Do not retry:**
- Paths in `blake3_worker.js` must be `../blake3-wasm/...` (not `./`)
- DO NOT use wasm-pack bundler output directly — Workers requires manual `WebAssembly.instantiate`
- DO NOT omit `fallthrough = false` on `[[rules]]`

### S35-emergency — Soft launch prep (uncounted)
**Commits:** `c9bd344` → `e5bd4c3` → `95a12b4`

- Paid tier cards greyed out (opacity 0.35, pointer-events none). Coming Soon tag punches through via `opacity: calc(1/0.35)`.
- Payment section hidden. Soft-launch notice in header.
- DO NOT re-enable paid tiers without explicit instruction from Rajesh.

### S35 — AAD overflow fix
**Commit:** `ab01388`

- `new Uint8Array([i])` → `DataView.setUint32(0, i, false)` into 4-byte buffer. Applied at both encrypt + decrypt in `src/index.njk`.
- **Do not retry:** AAD is always 4-byte big-endian uint32. `new Uint8Array([i])` wraps silently at chunk 256.

### S36 — Rate limiting
**Commit:** `b877c76`

- `worker/src/ratelimit.js` — KV-backed sliding window, per-IP, fails open on KV error. Uses STATUS_KV (no new resource).
- Limits: `credential_issue` 10/60s · `upload` 120/60s · `auth` 5/60s. All 429s logged to AE.
- **Do not retry:** Sub-100ms synthetic load will not trigger KV rate limiter — KV eventual consistency. Use `sleep 0.5` between requests.

### S36b — Frontend error reporting
**Commit:** `0cc4de9`

- `reportError(context, message, detail)` helper in `src/index.njk` — fire-and-forget POST to `/log/error`, never blocks flow, never shown to user.
- `POST /log/error` Worker endpoint — rate-limited 20/60s per IP (STATUS_KV), always returns 200, writes AE event: `blobs=['client_error', context, message]`.
- Six capture points: `credential_issue`, `upload_chunk`, `blake3_hash`, `download_chunk`, `decrypt`, `manifest_fetch`.
- UUID truncated to 8 chars. detail truncated to 200 chars. No filename, no full UUID, no user identity.
- Smoke test: rate-limited on first hit (correct — KV window from deploy). Endpoint confirmed live.

### S36c — Dashboard legibility pass (extended)
**Commits:** `f909d96` → `9d8dbf7` → `2db7b08`

- Satoshi → Source Serif 4 body, Playfair Display 700 figures (revisit B5)
- Snapshot strip: single surface, hairline dividers, two rows (6 primary + 4 secondary)
- Row 1 order: Revenue · Paying customers · Uploads started · Data stored · Server errors · Token security
- Row 2: Upload speed p95 · Download speed p95 · Download success · Churn
- card-note removed entirely. No duplicate card sections.
- Paper/Carbon toggle: cookie scoped to `.refueler.io`
- Modal stub on every metric: full viewport, ← Back button, CSV placeholder
- "Credential uniqueness" → "Token security" / "No double-spends"
- p99 blocks and third row to be added S36c continuation in new chat
- Modal full build deferred to B5 (own session allocation needed)
- Rogue secret names in wrangler secret list to be cleaned: `sk_live_...ZehD`, `whsec_70W1...`, `whsec_MAd6...`

### S37 — Dashboard completion
**Commits:** `fb22a29` → `7684118`

- Playfair Display dropped — figures font reverted to Satoshi 700 throughout (strip cells + modal value).
- Bunny Fonts link updated (Playfair removed).
- Row 2 expanded to 6 cells: Upload p95 · Download p95 · Upload p99 · Download p99 · Download success / Last 24 hours · Churn.
- Row 2 label cleanup: p95/p99 cells have no plain-English sub-line. Download success label no longer truncates. Churn label simplified, sub-line removed.
- Row 3 added (3-column, stretches full width): Free users · Client errors (24h) · Lightning settlement (greyed out, deferred B7).
- `client_errors_24h` field will show n/a until AE SQL query in `/admin/ae-metrics` is extended — flagged for S38 or snag session.
- Free users populates immediately from existing `subscribers_by_tier.free` in `/admin/metrics`.
- Modal MODAL_DEFS and switch cases updated for all new keys: `upload-speed-p99`, `download-speed-p99`, `free-users`, `client-errors`. Churn modal sub updated to "cancelled" (no timeframe — modal will carry that in B5).
- Secret cleanup (3 rogue names) — pending confirmation of `wrangler secret list` output.
- Third row deferred discussion: row 3 will gain Lightning settlement cell live data at B7. No further rows until B7.

**Do not retry:**
- DO NOT await `reportError` fetch — `.catch(() => {})` must be present
- DO NOT send full UUID — first 8 chars only

**Roadmap additions (uncounted):**
- S36c — Dashboard legibility pass: larger fonts, plain-English sub-labels, minimum 16px sub-text

### S38 — AE SQL client_errors_24h + secret hygiene + wrangler update
**Commit:** `20da7d4`

- `client_errors_24h` added to `fetchAeMetricsData`: sixth query in `Promise.allSettled`, counts AE events where `blob1 = 'client_error'` in last 24h. Parse block + return field added. Dashboard cell was already wired from S37 — no dashboard changes needed.
- Three rogue secrets deleted from Worker: `sk_live_...ZehD`, `whsec_70W1...`, `whsec_MAd6...` — key values had been stored as secret names, not aliases. Clean list now 9 entries.
- Wrangler updated 3.114.17 → 4.112.0 (`npm install --save-dev wrangler@4` in `worker/`).
- Smoke test: `client_errors_24h: 0` confirmed in AE response. `latency_note` 422 error pre-existing (quantilesTDigest snag, unchanged).

### S39 — Server-side tier enforcement
**Commit:** `ab4fc98`

- `CHUNK_SIZE_MAX` constant: 10 MB hard cap per chunk. Checked against `Content-Length` header before body read, and again against actual `chunkBody.byteLength` after read. 413 + AE log on either violation.
- Tier resolved server-side from Supabase `subscribers` table via `X-Email` header. `X-Tier` header no longer trusted. Falls back to `free` on any Supabase error, missing email, or no active subscriber found.
- KV byte counter `upload_bytes:{uuid}` in `STATUS_KV`: read before every chunk write, incremented after write, deleted on `upload_complete`. TTL 24h refreshed on each chunk. Fails open on KV error.
- First-chunk path: early cap check against declared `X-Total-Bytes` before credential verification — avoids burning a Cashu token on an oversized transfer.
- `X-Email` added to CORS `Access-Control-Allow-Headers`.
- All 413 rejections logged to AE with `errorMsg`: `chunk_too_large`, `tier_cap_exceeded`, `declared_total_exceeds_cap`, `chunk_body_too_large`.

### S40 — MIME type denylist gate
**Commit:** `c6f1a7a`

- `MIME_DENYLIST` constant in `worker/src/index.js` — `Set` of 6 execution-capable MIME types rejected at the upload boundary: `application/x-msdownload`, `application/x-executable`, `application/x-sh`, `application/x-bat`, `text/x-shellscript`, `application/x-php`.
- Gate applied to chunk 0 only — subsequent chunks are raw AES-GCM ciphertext continuations; Content-Type on those carries no meaningful signal.
- Missing Content-Type → 415 + AE log (`mime_missing`). Denylisted type → 415 + AE log (`mime_denied`).
- Gate fires before tier resolution, KV read, credential verification, or body read — zero Supabase/KV cost on rejection.
- `application/java-archive` (.jar) explicitly excluded from denylist — legitimate developer artefact; requires active JVM invocation.
- MIME type is never stored — not in R2 manifest, not in Supabase, not in AE (except errorMsg on rejection). Gate reflects declared intent only; Worker receives encrypted payload and cannot inspect content.
- `CLAUDE.md` locked decisions updated. `README.md` updated. `Share-Master-Context.md` updated.

### S41 — UUID validation + chunk bounds
**Commit:** `b2a4ba0`

- `UUID_RE` constant: RFC 4122 `/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i` — validated at entry to `handleUpload` and `handleDownload` before any R2/Supabase/KV touch. 400 + AE log (`invalid_uuid`) on mismatch.
- Chunk index bounds check in `handleDownload`: explicit `chunkIndex < 0 || chunkIndex > 9999` guard. 400 + AE log (`invalid_chunk_index`). Belt-and-braces over router regex.
- Both gates fire before any backend operation — zero R2/KV/Supabase cost on rejection.
- Smoke tests: 400 on 36-hyphen UUID, 404 on non-matching path, 404 on all-zeros UUID (gate passed, R2 reached). ✓
- Named transfers (client-side label in fragment, never stored) flagged as paid-tier feature for B5/B7 planning.

### S42a — Input validation hardening
**Commit:** `c8a57a42`

- `handleLogError` truthy bug fixed: `if (rl)` → `if (rl.limited)`. `checkRateLimit` returns an object (always truthy) — every client error report was silently dropped before reaching AE. Now correctly rate-limits on `.limited` property.
- `X-File-Name` sanitisation hardened: strips path separators, null bytes, C0/C1 control characters (U+0000–U+001F, U+007F), and Unicode bidirectional override codepoints (U+202A–U+202E, U+2066–U+2069). Truncates to 255 *bytes* (not chars) after sanitisation via `TextEncoder`/`TextDecoder` round-trip.
- `safeGetManifest()` wrapper added in `index.js`: fetches R2 object for size check (`obj.size > 64KB`) before delegating to imported `getManifest` for parsing. Returns `{ manifest, oversize }`. 502 + AE log (`manifest_oversize`) on violation. All three handler call sites updated: upload subsequent chunks, auth, download.
- `X-Total-Chunks` upper bound on chunk 0: `> 10,000` → 400 + AE log (`total_chunks_exceeded`). Gate fires before credential verification — no Cashu token burned on junk requests.
- `X-Expiry-Timestamp` server-side tier validation on chunk 0: validates declared expiry falls within tier-permitted window (free: 7d, creative: 30d, max: 90d). Past timestamps → 400 `expiry_in_past`. Exceeding tier window → 400 `expiry_exceeds_tier`. Gate fires after tier resolution, before credential verification.
- Smoke tests: all five items confirmed live. Worker version `c8a57a42`.
- **B4 complete.**

**Do not retry:**
- DO NOT trust `X-Tier` from client — ignored since S39, tier is always resolved from Supabase.
- DO NOT skip `X-Email` in upload requests — without it tier always resolves to `free`.
- DO NOT apply MIME gate to chunks > 0 — ciphertext continuations have no meaningful Content-Type.
- DO NOT store MIME type anywhere — it is a gate signal, not a record.
- DO NOT add `application/java-archive` to the denylist — deliberate exclusion, legitimate dev use.
- DO NOT use a URL shortener — lookup table is a privacy attack point; fragment key would be exposed to shortener service.
- DO NOT use `if (rl)` to check rate limit result — `checkRateLimit` always returns an object; use `if (rl.limited)`.
- DO NOT use `10_000` numeric separators if targeting environments that predate ES2021 — confirmed fine in Workers V8.
- DO NOT call `getManifest` directly from handlers — use `safeGetManifest` wrapper which enforces the 64KB ceiling.

### S42b — Rate limiting + upload integrity hardening
**Commit:** 18d85351

- Per-UUID auth rate limit: `checkRateLimit(env, authMatch[1], 'auth_uuid', 10, 60)` layered on top of existing per-IP limit. Both must fire independently. 429 + AE log with `errorMsg: 'rate_limit_uuid'` vs `'rate_limit_ip'`.
- Download rate limiting: `checkRateLimit(env, ip, 'download', 300, 60)` added to router before `handleDownload`. 429 + AE log.
- Upload continuation expiry: confirmed already present at line 669 (`now > manifest.expiry_timestamp` → 410). Not re-added.
- Chunk count manipulation defence: `chunkIndex >= manifest.total_chunks` guard before `chunks_received.push`. 400 + AE log (`chunk_index_out_of_bounds`).
- Smoke test: 404×5 + 429 on 6th auth attempt confirmed per-IP limit live. `as_of` 2026-07-22T09:33:10.898Z confirmed Worker healthy.

**Do not retry:**
- DO NOT apply per-UUID auth rate limit instead of per-IP — both are needed. Layer them.
- DO NOT set download rate limit below 200/60s — legitimate 250GB transfers at 1MB chunks = 250 chunks, multiple concurrent downloads possible.

### S42c — UUID-bound credential issuance
**Commit:** c053cbc

- `EXPIRY_WINDOWS` constant added to `index.js` — canonical tier expiry values (free: 604800s, creative: 2592000s, max: 7776000s). Must stay in sync with `EXPIRY_MAX_SECONDS` in `handleUpload`.
- `computeCommitment(uuid, tier, expiryWindow)` helper — `SHA256(uuid:tier:window)` as hex. Deterministic, nothing stored.
- `handleCredentialIssue` generates UUID server-side via `crypto.randomUUID()`. Computes commitment. Returns `{ signed_point, mint_pubkey, allocation_bytes, uuid, issued_tier, commitment }`.
- `handleUpload` chunk 0: reads `X-Credential-Commitment` + `X-Issued-Tier` headers. Recomputes expected commitment, constant-time compare. 401 + AE log (`credential_uuid_mismatch` / `credential_commitment_missing`) on failure. Fires before credential verification — no Supabase call on farming attempts.
- CORS `Allow-Headers` updated: `X-Credential-Commitment`, `X-Issued-Tier` added.
- Frontend (`src/index.njk`): removed `crypto.randomUUID()` call. UUID read from issue response. Hard throws if `uuid`, `commitment`, or `issued_tier` absent. Chunk 0 headers gain `X-Credential-Commitment` and `X-Issued-Tier`.
- `waitForTurnstile` function declaration restored — had been missing since S36b, leaving orphaned top-level code that caused `SyntaxError: Unexpected token '}'` at line 1303, breaking the entire frontend script. Pre-existing bug, discovered during S42c smoke test.
- Smoke test: upload ✓, share link ✓, download ✓. UUID in share link sourced from Worker confirmed.
- Cross-transfer farming vector closed at Worker layer. B8 Rust mint (NUT-20) is the long-term replacement.

**Do not retry:**
- DO NOT store UUID→credential binding in KV or Supabase — binding is in the cryptographic commitment.
- DO NOT generate UUID client-side — Worker generates it at `/credential/issue`.
- DO NOT use `issued_tier` for cap enforcement — cap uses `resolvedTier` from Supabase. `issued_tier` is commitment-only.

---

### S42c — UUID-bound credential issuance
**Commit:** pending

**Scope:**
- Worker generates UUID at `/credential/issue` and returns it alongside the signed credential.
- Blind signature commits to `H(uuid || tier || expiry_window)` using SHA-256 — unforgeable binding between credential and specific transfer UUID.
- `/credential/issue` request body gains optional `uuid` field; if absent Worker generates one via `crypto.randomUUID()`.
- Worker verifies binding on upload: recomputes `H(uuid || tier || expiry_window)` and checks it matches the credential's committed value. 401 on mismatch (`credential_uuid_mismatch`).
- Frontend (`src/index.njk`) updated: stops generating UUID client-side, reads UUID from credential issue response instead.
- Closes cross-transfer farming vector: a farmed credential is cryptographically invalid for any UUID other than the one it was issued for.
- Migration path documented for B8 Rust mint (NUT-20 quote signatures replace this Worker-based precursor).

**Deferred to B8:**
- Full NUT-20 quote signature scheme with Rust mint
- Tiered denomination embedding in credential
- Rate-limited issuance at mint layer

**Do not retry:**
- DO NOT store the UUID→credential binding in KV or Supabase — the binding is in the cryptographic commitment, not a lookup table.
- DO NOT break existing upload flow if `uuid` absent from credential response — fail loudly in dev, not silently in prod.

---

### S42d — Free tier hardening review
**Commit:** `0b32e69` · Wrangler 4.113.0

**Delivered:**
- Full attack surface review completed (S34–S42c). See assessment table in session notes.
- Turnstile nonce binding implemented in `handleCredentialIssue`. SHA-256 one-way hash of Turnstile token stored in KV as `tt_nonce:{hash}` with 600s TTL. 429 + AE log (`turnstile_nonce_replay`) on second use. Fails open on KV error. Closes token-replay amplifier: one Turnstile solve → at most one credential.
- Safari / mobile Safari Turnstile fix implemented in `src/index.njk`. `renderTurnstile()` now polls for `window.turnstile` every 200ms up to 15s when called before the script is ready. `pendingTurnstileRender` flag prevents double-render if both `onTurnstileLoad` callback and poll fire. `reportError('turnstile_load', ...)` on 15s timeout for visibility. Upload button now enables correctly on all browsers.
- Residual abuse exposure documented (see below).
- Farming signal card scoped to B5 dashboard: `credentials_issued_24h / uploads_completed_24h` ratio, normal band 0.8–1.2, alarm >3.0. Derivable from existing AE data, no new schema required.
**Residual abuse exposure (accepted):**
- IP-rotation farming: attacker requests fresh credential per IP, each requiring a fresh Turnstile solve + rate limit slot. Cost per credential = one bot-challenged Turnstile interaction. Realistic throughput very low. Business risk, not security risk. Architectural fix: B8 UUID-bound Rust mint (NUT-20 quote signatures).
- X-Email spoofing for paid tiers: attacker sends arbitrary email to claim paid tier. No live impact — paid tiers greyed out, Supabase lookup fails unless email matches active subscriber. Architectural fix: B7 signed transfer token.
- Per-account aggregate KV byte cap: counter is per-UUID, not per-identity. A user can start multiple transfers each up to the free cap. Accepted until B8 UUID binding tightens this.
- Turnstile nonce race: two near-simultaneous requests with the same token could both pass the KV read before the write lands. Rate limit at 10/60s + Turnstile's own server-side invalidation make this negligible. Architectural fix: atomic KV or Durable Object — not warranted at current scale.

**Do not retry:**
- DO NOT set Turnstile nonce TTL to 7 days — Cloudflare expires tokens after ~300s. 600s is the correct window.
- DO NOT fail-closed on nonce KV error — privacy takes precedence; a KV blip must not block legitimate uploads.
- DO NOT await the KV nonce write — fire-and-forget, never block issuance.
- DO NOT deduplicate on `pendingTurnstileRender` with a global `renderTurnstile()` call from `onTurnstileLoad` directly — the flag already handles re-entry; calling render from both paths without the flag causes double-render and a broken widget.

---

### S42e — Full B4 audit pass
**Commit:** — (no deploy)

**Delivered:**
- 20 B4 security claims audited against `index.js` commit `0b32e69`. All confirmed shipped and smoke-tested. Evidence table: commit hash + verified behaviour for every claim.
- Marketing claim rulings issued: server-side BLAKE3 chunk integrity and double-spend detection are unblocked with precise scope language. Full Merkle tree verification, NUT-11 Mode 2, "audit-certified", and ML-KEM remain blocked. Resolution path: B8 → B9 → B10.
- Critical chain S34→S42→S79 (renumbered) formally closed. S79 (B9 whitepaper) inherits: BLAKE3 integrity architecture, double-spend ledger, UUID-bound credential design, rate limiting topology, filename sanitisation rationale, Turnstile nonce binding, UK regulatory position. S79 must still establish: full Merkle root verification, NUT-11 Mode 2, external audit (if pursued).
- UK regulatory language drafted (exact whitepaper §Regulatory text). Share mint = capability token issuer under UK EMR 2011 and PSR 2017. FCA authorisation not required. Blink carries Lightning regulatory cover. Legal counsel review flagged before public claims.
- B5 handoff: 10-session allocation S43–S52. Two sessions for modal (S46a data layer + S46b polish), two for dashboard (S44 + S45), two for brand/gold edging (S49a + S49b). Session plan in Share-Master-Context.md §B5 session plan.
- `CLAUDE.md` bumped to v1.2. `Share-Master-Context.md` bumped to v3.0. B4 marked complete. B5 marked current.
- Roadmap renumbered: B5 absorbs 4 extra sessions (S43–S52), downstream blocks shift by +2 each.
- `safeGetManifest` double-read noted as minor R2 inefficiency — flag for optimisation if costs become material, not a security gap.

**Do not retry:**
- DO NOT assert end-to-end file integrity — server-side chunk integrity only until Merkle verification is implemented (B9).
- DO NOT assert "audit-certified" — no external audit conducted.

---

## Planning notes — mint architecture (locked 22 July 2026)

- Live mint lives inside its own product repo (Share mint in `refueler-share`, loyalty mint in `refueler-mint`/`refueler.io`, ticketing mint in future `refueler-tickets`)
- Test mint and shared cryptographic lab lives in `refueler-ecash-lab` — B8 planning task
- Separate mints = separate failure domains. One mint down does not affect other products.
- All three are capability/loyalty token issuers — none handle e-money (UK FCA regulatory constraint)
- NUT-14 (HTLCs): not suitable for farming defence — attacker still gets credential after secret exchange
- NUT-20 (Signature on mint quote): most promising for UUID-binding at B8 — mint signs `{uuid, tier, expiry_window}`
- NUT-10 (Spending conditions): compound AND/OR; could require fresh Turnstile at melt time — explore in lab
- NUT-29 (Batch mint): worsens farming if applied naively — not applicable
- `refueler-ecash-lab` to contain: shared Rust crate, attack simulations, NUT compliance tests, integration tests mimicking Share Worker environment

---

---

## Sessions 43–52 — B5 Design full pass

| Session | Label | Scope | Size |
|---------|-------|-------|------|
| S43 | Token alignment | Apply DESIGN-TOKENS.md to index.html, upgrade.html, status.html. Fix Paper/Carbon bg tokens, add --surface-raised, load IBM Plex Mono, declare --accent. | S |
| S44 | Dashboard design pass I | Satoshi 700 figures/labels, --heading font stack, System Summary rename, Copy JSON bottom-right, 4 latency cards, 16px min sub-text. | M |
| S45 | Dashboard design pass II | Spacing/hierarchy deep pass, Source Serif 4 editorial moments, farming signal card (AE wired). | M |
| S46a | Modal build I | Full-viewport scaffold for all 13 metric cards, data wiring, n/a and loading states. | L |
| S46b | Modal build II | Modal polish: CSV export stub, trend stub, error states, smoke test all 13 panels. | M |
| S47 | Upload/download UX | Progress bar animation fix, QR resolution fix, FREE_EXPIRY constant fix. | S |
| S48 | Theme persistence + named transfers | Cookie scoped to .refueler.io, privacy copy update, named transfers UI plan. | S |
| S49a | Carbon gold edging | --inset-rule #C8A96E throughout Carbon. Card borders, rule lines, active states. | S |
| S49b | Brand audit pass | Share UI vs BRANDING.md. Source Serif 4 editorial moments. Head of Design review. Paper/Carbon consistency sweep. | M |
| S52 | B5 close | Snag sweep, context files, version bump to 4.0, B6 planning brief. | S |

---

*"Nothing stops this train."*
