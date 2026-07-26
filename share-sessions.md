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

## Sessions 34–52 — B4 Security hardening + B5 Design full pass

| # | Commit | Summary |
|---|--------|---------|
| S34 | `7738450f` | BLAKE3 WASM in Worker. `verifyChunkHash()` live. Integrity gap closed. |
| S35-e | `95a12b4` | Paid tiers greyed out (soft launch). Uncounted. |
| S35 | `ab01388` | AAD overflow fix — `DataView.setUint32(0,i,false)` into 4-byte buffer. |
| S36 | `b877c76` | KV-backed rate limiting: `ratelimit.js`, 3 endpoints, 429s logged to AE. |
| S36b | `0cc4de9` | `/log/error` endpoint + `reportError()` helper. 6 capture points. |
| S36c | `2db7b08` | Dashboard legibility pass. Snapshot strip. Paper/Carbon cookie. Modal stubs. |
| S37 | `7684118` | Dashboard: Satoshi figures, row 2 6-cell, row 3 3-cell. `client_errors_24h` stub. |
| S38 | `20da7d4` | `client_errors_24h` AE query. 3 rogue secrets deleted. Wrangler 4.112. |
| S39 | `ab4fc98` | Server-side tier enforcement. 10 MB chunk cap. KV byte counter. |
| S40 | `c6f1a7a` | MIME denylist gate on chunk 0 (6 types). 415 + AE log on miss. |
| S41 | `b2a4ba0` | UUID validation (RFC 4122). Chunk bounds check. |
| S42a | `c8a57a42` | `handleLogError` fix. Filename sanitisation. 64 KB manifest cap. Chunk + expiry guards. |
| S42b | `18d85351` | Per-UUID auth rate limit. Download rate limiting. Chunk count defence. |
| S42c | `c053cbc` | UUID-bound credential issuance. Worker generates UUID. `waitForTurnstile` fix. |
| S42d | `0b32e69` | Turnstile nonce binding. Safari polling fallback. Wrangler 4.113. |
| S42e | — | Full B4 audit. Marketing claim rulings. UK regulatory language. B5 handoff. |
| S43 | `5c54802` | DESIGN-TOKENS.md v1.0 applied to index, upgrade, status pages. |
| S44 | `b15f407` | Dashboard design pass I: sidebar, token alignment, Satoshi figures, 4 latency cards. |
| S45 | `7187e41` | Dashboard design pass II: 240px sidebar, gold wordmark, farming card. |
| S46a | `bbf271a` | Modal build I: 14 modal keys, skeleton, focus trap. CSS+JS extracted to dashboard.css/js. |
| S46b | `023dfcc` | Modal polish: formatBytes, zero=green, datasource banner, × close. smokeTest 27 pass. |
| S47a | `63eb253` | FREE_EXPIRY fixed (5d→7d). Progress smooth. QR retina. Cap nudge. status.njk editorial. |
| S47b | `d8faf0f` | QR 200px SVG (qr-creator). 2-col button grid. Serif integrity notes. Ghost back links. |
| S47c | `cb7a925` | Receiver landing page. USP A/B test (Variant A/B, sessionStorage, AE logging). |
| S47d | `3eb4ec4` | QR guard. Drop zone single-file rejection. Colophon. Footer subdomain-only. Turnstile theme. |
| S48 | `0761f4c` | Maintenance modal. Theme cookie `rs-theme` scoped to `.refueler.io`. No FOUC. |
| S48a | `0152aae` | FSAA streaming download. Pipeline depth 2. Per-chunk retry 1s/2s/4s. Blob fallback. |
| S49a | `3598a65` | Carbon gold edging. `--inset-rule` throughout. Brand token aliases in shared-styles. |
| S50 | `e3a4407` | Serif audit. 3 correct usages confirmed. 3 CSS-only additions. |
| S51 | `c182036` | File extraction: `frontend/share.css` (367L), `frontend/share.js` (899L), `frontend/upgrade.css` (419L). |
| S52 | — | `TIER_EXPIRY_SECONDS.free` 5d→7d. `--heading` alias. Lightning ops plan. Context v4.0. B5 closed. |

---

## Sessions 53–72+ — B6 Testing infrastructure + folder upload

**Block principle:** No session holds more than one architecturally complex piece of work.
Split early rather than overstuff. Testing infra reviewed every 4 sessions (S63, S67) — buffer
consumed only if genuinely needed, not by default.

---

### S53 — Folder upload I
**Commits:** `b1d9855` (folder upload) · `ca1260c` (fflate fix)

- fflate 0.8.2 loaded as blocking CDN script before `share.js` module (later moved to self-hosted S56).
- Hidden `<input webkitdirectory multiple>` added to drop zone. "📁 Upload folder" ghost button triggers it.
- Folder drag-drop: `webkitGetAsEntry().isDirectory` detection routes to `handleFolderDrop()` via FileSystem API.
- `readDirectoryEntry()`: batched `createReader.readEntries()` loop — handles >100 entries per dir correctly.
- `handleFolderFiles()`: strips top-level folder name from `webkitRelativePath`. Zip named `{FolderName}.zip`.
- `zipAndSelect()`: reads files into memory, builds fflate `fileMap`, calls `fflate.zip()` async callback, synthesises `File` object, hands to `handleFileSelection()` unchanged.
- Zip progress card (`#zip-progress-card`): gold bar, file count detail, hides when zip complete.
- Zero Worker changes. `application/zip` passes MIME denylist gate.
- **Fix `ca1260c`:** `[new Uint8Array(buf), { level: 0 }]` → bare `new Uint8Array(buf)`. fflate `level:0` macOS Archive Utility rejects. Bare = default level-6 DEFLATE, universally compatible. ✓

**Do not retry:**
- DO NOT use `[new Uint8Array(buf), { level: 0 }]` in fflate 0.8.x — macOS Archive Utility rejects. Bare `Uint8Array` only.
- DO NOT use `webkitGetAsEntry` result without `.isDirectory` check.

---

### S54 — Folder upload II: edge cases + robustness
**Commit:** `c732abf` · `frontend/share.js` only · no Worker changes

- `sanitiseSegment(seg)` + `sanitisePath(rel)` helpers: strip null bytes, control chars, bidi overrides; drop `..`/`.` traversal; truncate segments to 200 bytes.
- `readDirectoryEntry` depth limit: throws user-facing `Error` at > 20 levels. `FOLDER_MAX_DEPTH = 20` · `FOLDER_WARN_FILES = 500` · `FOLDER_MAX_FILES = 2000`.
- Empty folder guard: both paths show explicit amber message.
- File count cap: > 2000 → hard stop with manual zip instruction. > 500 → amber non-blocking warning.
- Memory pressure warning: > 500 MB → amber non-blocking warning in `zipAndSelect`.
- `fflate` availability guard: both entry points check `typeof fflate === 'undefined'`.

**Do not retry:**
- DO NOT pass explicit `depth=0` to initial `readDirectoryEntry(directoryEntry)` call — default `undefined` resolves to 0 correctly.

---

### S55 — Folder upload receiver UX
**Commit:** TBD · `frontend/share.js`, `frontend/share.css`, `src/index.njk` · no Worker changes

**Decisions locked (permanent):**
- **Delivery: zip as-is.** Receiver downloads the zip and unzips themselves. Auto-unzip not implemented — same memory footprint concern, no benefit over native OS unzip.
- **Error states:** Generic `showDownloadError` messages are correct for folder transfers — AES-GCM decrypt error is the right signal regardless of file or folder.

**Delivered:**
- `id="rc-file-icon"` on receiver card icon span. `<div class="rc-folder-note hidden" id="rc-folder-note">` added.
- In `enterDownloadMode`: detect `.zip` extension → set icon to 📁, show `rc-folder-note`.
- `.rc-folder-note` CSS: IBM Plex Mono 11px, `--text-secondary`, `margin-top: 4px`.

---

### S56 — Folder upload smoke test + drop zone fix
**Commits:** `6cf711d` · `7735787` · 25 July 2026

- fflate 0.8.2 + qr-creator 1.0.0 self-hosted at `frontend/fflate.min.js` + `frontend/qr-creator.min.js` (cdnjs blocked from share.refueler.io).
- Drop zone inputs moved outside hit area. Both inputs `display:none` above drop zone, triggered by explicit JS click handlers. `stopPropagation` on both buttons.
- Two buttons: 📄 Browse file (single file) + 📁 Upload folder.
- **Full end-to-end pass:** PhotoSession folder (nested subdirs, 2.3 MB) → zip → encrypt → upload → passphrase → receiver card (📁, size, expiry, password badge) → unlock → FSAA → PhotoSession.zip → macOS unzip → folder structure intact. ✓

**Snag carried:** Receiver page nav shows main domain links (APP, EDITORIAL, PRIVACY). Should be share-subdomain nav only. Fix in nav consolidation session (B13 scope).

**Do not retry:**
- DO NOT load fflate or qr-creator from cdnjs — self-hosted only (`frontend/`).
- DO NOT put file inputs inside the drop zone hit area — inputs outside, JS-triggered only.

---

### S57 — Bearer token TTL investigation
No commit · 26 July 2026

- `nut11.js`: stateless HMAC-SHA256 token, format `base64url({uuid,exp}).base64url(hmac)`. No KV storage. `verifyDownloadToken` re-derives HMAC per request — correct architecture.
- TTL hardcoded: `exp = now + 900` (15 minutes). Fatal for transfers >~1 GB.
- Fix: `issueDownloadToken(uuid, key, expiresAt)` → `exp = expiresAt`. Caller passes `manifest.expiry_timestamp`.
- NUT-11 Mode 2 keypair (B8) is unrelated — this fix is stateless HMAC only.

**Do not retry:** 15-minute fixed TTL for download tokens on any tier.

---

### S58 — Bearer token TTL fix
**Commit:** `f94a158` · 26 July 2026

- `issueDownloadToken` signature updated: `(uuid, mintPrivkeyHex, expiresAt)`. `const exp = expiresAt`.
- `handleAuth` in `index.js`: passes `manifest.expiry_timestamp` as third argument.
- `verifyDownloadToken` untouched — already checks `payload.exp > now` correctly.
- Smoke test ✓: PhotoSession folder → passphrase protect → receiver card ("6 days remaining") → unlock → FSAA download → 100% complete → colophon.

**Do not retry:**
- DO NOT hardcode 900s (15 min) TTL for download tokens — pass `manifest.expiry_timestamp` as `expiresAt`.

---

## B6 session plan

| Session | Label | Scope | Size |
|---------|-------|-------|------|
| S53 ✅ | Folder upload I | fflate integration, client-side zip, zip progress UI | M |
| S54 ✅ | Folder upload II | Edge cases, depth limit, file count cap, path sanitisation | M |
| S55 ✅ | Folder upload III | Receiver UX: folder icon, zip-as-is decision, folder note | S |
| S56 ✅ | Folder upload smoke test | Self-hosted fflate/qr, drop zone fix, full round-trip ✓ | S |
| S57 ✅ | Bearer TTL investigation | 15-min hardcoded exp fatal for large transfers | S |
| S58 ✅ | Bearer TTL fix | Token exp = manifest.expiry_timestamp. Smoke test ✓ | S |
| S59 | — | Bearer TTL buffer. Skipped — S58 clean first attempt. |
| S60 | Worker unit tests I | Miniflare/Workers test runtime setup. `ratelimit.js` + `manifest.js` coverage. | M |
| S61 | Worker unit tests II | `nut00.js` blind sig tests. `blake3.js` hash verification. | M |
| S62 | Worker unit tests III | `turnstile.js`, `stripe.js` handler stubs. Edge case coverage. | M |
| S63 | Testing infra review I | 4-session checkpoint: assess buffer need. Integration test harness design. | S |
| S64 | Integration tests I | Full upload→download round-trip in test harness against dev Worker. | L |
| S65 | Integration tests II | Passphrase gate, rate limit enforcement, credential farming defence. | M |
| S66 | Integration tests III | MIME denylist, UUID validation, chunk bounds, tier cap enforcement. | M |
| S67 | Testing infra review II | 4-session checkpoint. Load test design. | S |
| S68 | Load test I | k6 setup, credential issue + upload synthetic load. KV rate limit validation. | M |
| S69 | Load test II | Download load, concurrent transfers, KV timing edge cases. | M |
| S70 | CI pipeline I | GitHub Actions: Eleventy build check, wrangler dry-run deploy, lint. | S |
| S71 | CI pipeline II | Test runner in CI. Fail-fast on Worker unit test regression. Lightning toggle card. | S |
| S72 | B6 close | Snag sweep, context files v5.0, B7 brief. Lightning backend confirmed. | S |

**Buffer pool:**
- S60b, S61b, S62b, S64b — testing infra (10 sessions total, reviewed S63 + S67)
- S57b, S58b — bearer token TTL (consumed: S58 was clean)

**Background work for Rajesh during B6:**
1. Competitor analysis — WeTransfer, SwissTransfer, Smash, Wormhole, OnionShare. Max file size · expiry · encryption model · pricing · anonymous use · Lightning/Bitcoin. Feeds B13 and btc++ Berlin pitch.
2. 2 GB test file: `dd if=/dev/urandom of=/tmp/testfile.bin bs=1m count=2048`
3. Blink API key: create account + generate key if not already done. Needed at B7 start.
4. btc++ Berlin abstract: draft one paragraph if considering presenting. Claude can help.

*"Nothing stops this train."*
