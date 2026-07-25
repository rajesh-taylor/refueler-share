# Share-Master-Context — refueler-share
> **Version:** 4.0 | **Last updated:** S52 · 25 July 2026
> Load alongside `CLAUDE.md` and `share-sessions.md` at every session start.

---

## What this repo is

`rajesh-taylor/refueler-share` — anonymous, encrypted peer-to-peer file transfer.
BLAKE3 chunk integrity + Cashu NUT-00 blind signatures as anonymous auth. **Distinct layers — never conflate.**

Local path: `/Users/rajeshtaylor/Documents/refueler-share/` · Licence: Apache 2.0

---

## Stack

| Layer | Technology |
|-------|-----------|
| Worker | Cloudflare Workers — `wrangler deploy` |
| Worker URL | `https://refueler-share.rt-fc4.workers.dev` |
| Storage | Cloudflare R2 — `refueler-share-prod` / `refueler-share-dev` |
| Ledger | Supabase `tihgvdokeofnjxjkenmm` — `spent_tokens`, `subscribers`, `double_spend_attempts` |
| Frontend | Eleventy 3.x — `src/` → `frontend/` |
| Subdomain | `share.refueler.io` → CNAME → `refueler-share.pages.dev` |
| Crypto | AES-GCM (Web Crypto), BLAKE3 WASM (browser local bundle + Worker WASM), secp256k1 (@noble v2) |
| Payments (fiat) | Stripe — live mode, GBP, embedded Payment Element |
| Payments (sats) | Blink BOLT11 primary → LNbits Tier 2 (deferred B7) |

---

## Supabase

Project: `tihgvdokeofnjxjkenmm`

| Table | Key columns | Notes |
|-------|-------------|-------|
| `spent_tokens` | `serial TEXT PK`, `melted_at TIMESTAMPTZ` | RLS deny-all |
| `subscribers` | `stripe_customer_id TEXT PK`, `email`, `tier` (free/creative/max), `status` (active/inactive/cancelled), `current_period_end`, `cancelled_at`, `created_at`, `updated_at` | RLS deny-all · index on email |
| `double_spend_attempts` | `id BIGSERIAL PK`, `serial`, `uuid`, `attempted_at` | RLS deny-all · fire-and-forget on 409 |

Count pattern: `Prefer: count=exact` + `Range: 0-0` → parse total from `Content-Range: 0-0/TOTAL`.

---

## Cloudflare resources

| Resource | Value |
|----------|-------|
| Worker | `refueler-share` |
| R2 buckets | `refueler-share-prod`, `refueler-share-dev` |
| KV | `refueler-share-kv` · id `5b1dca6a8f06423f98d0bbc4286e2968` · binding `STATUS_KV` |
| AE dataset | `share_events` · binding `AE` |
| Pages | `share.refueler.io` → `refueler-share.pages.dev` |
| Turnstile | Sitekey `0x4AAAAAAD0N7GlHlCRuWITr` · Managed widget (visible only) |

Worker secrets (all set): `MINT_PRIVATE_KEY`, `TURNSTILE_SECRET_KEY`, `SUPABASE_URL`,
`SUPABASE_SERVICE_KEY`, `STRIPE_SECRET_KEY` (sk_live_...ZehD, S29),
`STRIPE_WEBHOOK_SECRET` (rotated 21 Jul), `ADMIN_KEY`,
`CF_ACCOUNT_ID` (fc4f3e5aeebe483677d14185daf544f5), `CF_AE_TOKEN` (Account Analytics Read).

---

## Stripe — live mode

Account: `rt@rajeshtaylor.com` · GBP · Publishable key: `pk_live_qTLdmzRXg6KHXtxbgGYQZc7L00Kl4saD2q`

| Product | Price ID | Lookup key | Amount |
|---------|----------|------------|--------|
| Creative Premium monthly | `price_1Ts7lsGlctwiB9U3hdtgChU2` | `share-creative-monthly` | £12/mo |
| Creative Premium yearly | `price_1Ts7sqGlctwiB9U3YRloCFfi` | `share-creative-yearly` | £120/yr |
| Production Max monthly | `price_1Ts7vIGlctwiB9U3kb3NCLue` | `share-max-monthly` | £24/mo |
| Production Max yearly | `price_1Ts7xIGlctwiB9U3JyZB8Kwj` | `share-max-yearly` | £240/yr |

Webhook: `https://refueler-share.rt-fc4.workers.dev/webhook/stripe`
Destination: `we_1Ts8epGlctwiB9U3dXT8XBac`
Portal: configured · redirect to `https://share.refueler.io/upgrade.html`
Events: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`

---

## Lightning infrastructure — operational resilience plan

**Primary (launch → scale threshold):** Blink (Bitcoin Beach Wallet / Galoy)
Managed custodial Lightning node. Blink carries its own regulatory cover. Zero hosting overhead.
All Lightning payments at launch route through Blink API. Refueler holds no custodial funds.

**Migration trigger to LNbits (Tier 2):** When any 2 of 3 conditions are true:
- Paid subscriber count exceeds 100 active accounts, OR
- Monthly Lightning settlement volume exceeds £2,000 GBP equivalent, OR
- Blink API reliability falls below 99.5% measured over a 30-day window

**Tier 2: Self-hosted LNbits** — target 4–6 weeks after trigger, 3–4 engineer-days.
LNbits on dedicated VPS (~£4/mo). Migration = Worker env var swap
(`LIGHTNING_BACKEND=lnbits`), no frontend changes. Blink account remains live and funded
throughout Tier 2 operation.

**Fallback 1 — LNbits instability:** Revert to Blink within 4 hours.
Procedure: set KV flag `lightning_available: blink` → redeploy. Single env var gates routing.
Admin dashboard toggle executes this without a code deploy (scoped B6).

**Fallback 2 — both Blink and LNbits unavailable:** Activate graceful degradation within 30 minutes.
Set KV flag `lightning_available: false`. Lightning option hidden on upgrade page, amber notice shown,
Stripe fiat path remains fully operational. Lightning resumes when primary or fallback is confirmed stable.
Dashboard toggle card executes this without a code deploy (scoped B6).

**Not pursued pre-scale:** Self-hosted lnd/phoenixd. Operational overhead not justified until
sustained Lightning demand is demonstrated. Phoenix is noted as excellent — revisit post-B12.

Full text for B9 whitepaper §Operations. Legal review before any public claims.

---

## Locked architecture decisions

**Crypto layers (never conflate):**
- BLAKE3 = chunk integrity. Browser: local WASM at `frontend/blake3/`. Worker: `worker/blake3-wasm/`
  via `blake3_worker.js`. Server verifies every chunk — 400 on mismatch.
- Cashu = anonymous auth (NUT-00/07/11). No monetary usage. No external mint.
- Passphrase hash = SHA-256 only (`crypto.subtle.digest`). Stored in manifest as `p2sh_secret_hash`.
- AES-GCM session key lives in URL fragment only — never in requests, never in logs.
- Upload boundary: `Content-Type` header validated on chunk 0 against denylist of execution-capable
  MIME types. 415 on missing or denylisted type, logged to AE. Gate reflects declared intent only.
  MIME type is never stored.
- AAD per chunk: 4-byte big-endian uint32 via `DataView.setUint32(0, i, false)`.
  Never `new Uint8Array([i])`.

**Storage:**
- R2 binding: `BUCKET`. KV binding: `STATUS_KV`. Chunk key: `{uuid}/{0000}`.
  Manifest key: `{uuid}/manifest.json`.
- R2 manifest is authoritative. Supabase is ledger only. No direct R2 URL exposure.
- `safeGetManifest()` double-read: minor R2 inefficiency, not a security gap.

**Frontend:**
- Credentials in browser memory only — never localStorage, never sessionStorage.
- `frontend/blake3/` force-committed via `git add -f`.
- Status banner: `sessionStorage` dismiss. Status page `/status.html` — no nav entry.
- QR library: `qr-creator` (SVG output, cdnjs). DO NOT use `qrcodejs`.
- Drop zone: single file only. Multiple file drag rejected with explicit message.
- Folder upload via client-side zip (fflate) — B6. DO NOT implement multi-file manifest.
- DO NOT edit inline CSS/JS in `src/index.njk` or `src/upgrade.njk` — edit
  `frontend/share.css`, `frontend/share.js`, `frontend/upgrade.css` only (extracted S51).
- `share.js` must remain `type="module"` — scoped deps, top-level await support.

**Stripe:**
- Direct Subscription + `expand[0]=latest_invoice.payment_intent` → `pi_...` secret for `stripe.elements()`.
- Paid tier cards greyed out (soft launch). Re-enable only on explicit instruction from Rajesh at B7 close.

**Ops:**
- NUT-07 melt after first chunk write. Supabase failure: log and continue.
- Turnstile: fail-closed on any error.
- Rate limits (STATUS_KV): `credential_issue` 10/60s · `upload` 120/60s · `auth` 5/60s ·
  `log_error` 20/60s · `download` 300/60s. All 429s logged to AE.
- `/log/error`: always 200, fire-and-forget AE write, UUID truncated to 8 chars, detail max 200 chars.
- Wrangler 4.113.0. ✓

**Regulatory (UK):**
- Refueler cannot operate as an e-money issuer without FCA authorisation.
- Share mint issues access credentials only — capability tokens, not monetary instruments.
- Cashu in Share = anonymous authentication mechanism, not payment instrument.
- Exact whitepaper language drafted S42e. Legal counsel review before any public claims.

**Whitepaper language (B9 §Regulatory — drafted S42e):**
> The Refueler Share mint issues upload credentials — opaque capability tokens that grant the right
> to perform a single anonymous file transfer of a defined size and expiry. These tokens carry no
> monetary value, are not redeemable for currency or goods, and are not transferable between users.
> They function solely as anonymous authentication artefacts within the Refueler Share system.
>
> Under the UK Electronic Money Regulations 2011 (SI 2011/99) and the Payment Services Regulations
> 2017, e-money is defined as electronically stored monetary value issued on receipt of funds, used
> to make payment transactions, and accepted by persons other than the issuer. Refueler Share
> credentials satisfy none of these criteria: they represent system access, not stored monetary value,
> and are accepted only by Refueler Share infrastructure, not by third parties.
>
> Refueler Share does not require FCA authorisation as an e-money institution. Lightning payments are
> processed via Blink, a licensed custodial wallet provider that carries its own regulatory cover.
> Refueler holds no custodial funds.
>
> This analysis should be reviewed by qualified legal counsel before any public claims are made.

**Payment flow (locked):**
- Lightning → Blink API (primary) → LNbits (Tier 2 on trigger)
- PayNym → Sparrow cold storage wallet, manual/semi-manual settlement
- Share mint → upload credentials only, zero monetary value, no e-money

**Mint architecture (locked):**
- Share mint in `refueler-share`. Loyalty mint in `refueler-mint`. Ticketing mint in future
  `refueler-tickets`. Test lab in `refueler-ecash-lab` — B8 planning task.
- Resilience: one mint down must not affect other products.
- All mints are capability/loyalty token issuers — none handle e-money.

**Folder upload (locked direction, B6):**
- Client-side zip via `fflate` before AES-GCM encrypt. Worker sees one blob — unchanged.
- `webkitdirectory` input or folder drag. Relative paths preserved in zip.
- DO NOT implement multi-file manifest approach.

**Marketing claim rulings (S42e — update again after B8, B9, B10):**
- ✅ Safe: server-side BLAKE3 chunk integrity; double-spend detection; rate limiting; UUID-bound
  credential issuance; Turnstile nonce binding; anonymous transfer (no account, free tier).
- 🔒 Blocked: full Merkle tree verification; NUT-11 Mode 2; "audit-certified"; ML-KEM;
  any "end-to-end file integrity" without the server-side-chunks-only qualifier.
- 📅 Resolution: B8 → NUT-11 Mode 2 · B9 → whitepaper + Merkle · B10 → ML-KEM.

---

## Known broken / do not retry

| Pattern | Correct approach |
|---------|--------------------|
| blake3-wasm CDN (esm.sh / unpkg) | Local bundle only |
| Invisible Turnstile | Visible managed widget only |
| `secp.Point` | `secp.ProjectivePoint` (noble v2) |
| `binding = "R2"` in wrangler.toml | Must be `BUCKET` |
| BLAKE3 for passphrase hash | SHA-256 only |
| `wrangler r2 bucket lifecycle set --rule` inline JSON | Use `add` subcommand |
| `wrangler r2 bucket lifecycle get` | Command is `list` |
| `checkout/sessions ui_mode:embedded` | Direct Subscription + PaymentIntent expansion |
| `decodeURIComponent` on Stripe `client_secret` | Already decoded |
| `new Uint8Array([i])` for AES-GCM AAD | `DataView.setUint32(0, i, false)` into 4-byte buffer |
| AE SQL `doubles[N]` / `blob[N]` syntax | Named columns: `double1`, `blob1` etc. |
| AE SQL from Worker binding | External REST only, proxy via `/admin/ae-metrics` |
| KV counter for double-spend | Supabase table only (race condition) |
| `await env.AE.writeDataPoint()` | Synchronous, fire-and-forget |
| Sub-100ms loop to test KV rate limiter | Use `sleep 0.5` — KV eventual consistency |
| Customer Portal without active subscription | Stripe returns `resource_missing` |
| 4242 card in live mode | Test mode only |
| `await reportError(...)` | `.catch(() => {})` fire-and-forget |
| Full UUID in `/log/error` | First 8 chars only |
| Trust `X-Tier` upload header | Ignored — tier resolved from Supabase via `X-Email` |
| Apply MIME gate to chunks > 0 | Gate is chunk-0 only |
| URL shortener for share links | Privacy attack point; fragment key exposed to shortener |
| `if (rl)` to check rate limit | Use `if (rl.limited)` — `checkRateLimit` returns object |
| `getManifest()` direct from handlers | Use `safeGetManifest()` — enforces 64KB ceiling |
| Generate UUID client-side | Worker generates UUID at `/credential/issue` since S42c |
| Turnstile nonce TTL = 7 days | Cloudflare expires tokens ~300s; use 600s KV TTL |
| Fail-closed on nonce KV error | Fail open — KV blip must not block legitimate uploads |
| Await nonce KV write | Fire-and-forget only |
| `renderTurnstile()` without `pendingTurnstileRender` flag | Causes double-render |
| `qrcodejs` library | Use `qr-creator` (SVG, cdnjs) |
| Multi-file manifest for folder upload | Client-side zip via fflate only |
| `types: [...]` in showSaveFilePicker | Use `types: []` |
| Omit `total_chunks` from `/meta/` response | Must be included — FSAA loop bound |
| Edit inline CSS/JS in `src/index.njk` or `src/upgrade.njk` | Edit `frontend/share.css`, `frontend/share.js`, `frontend/upgrade.css` |
| `TIER_EXPIRY_SECONDS.free` = 5 days | Canonical value is 7 days everywhere |
| `--display` as sole heading token | Declare both `--display` and `--heading` in shared-styles.njk |
| `classList.contains('carbon-mode')` for theme detection | Use `dataset.theme === 'carbon'` |
| Omit `{% include "shared-styles.njk" %}` from any Eleventy page | Required on every page |

---

## Current state

**B5 Design full pass — COMPLETE. B6 Testing infrastructure + folder upload — current.**

| Session | Commit | Shipped |
|---------|--------|---------|
| S34 | `7738450f` | BLAKE3 WASM in Worker. Server-side chunk verification. Integrity gap closed. |
| S35-emergency | `95a12b4` | Paid tiers greyed out, soft-launch notice. Uncounted. |
| S35 | `ab01388` | AAD overflow fix (4-byte uint32, encrypt + decrypt). |
| S36 | `b877c76` | Rate limiting: `ratelimit.js`, 3 endpoints, KV-backed. |
| S36b | `0cc4de9` | `/log/error` + `reportError()` helper. 6 capture points in frontend. |
| S37 | `7684118` | Dashboard: Satoshi figures, row 2 6-cell, row 3 3-cell. |
| S38 | `20da7d4` | `client_errors_24h` AE query. Secret hygiene. Wrangler 4.113.0. |
| S39 | `ab4fc98` | Server-side tier enforcement. 10MB chunk cap. KV byte counter. |
| S40 | `c6f1a7a` | MIME denylist gate on chunk 0. |
| S41 | `b2a4ba0` | UUID validation (RFC 4122). Chunk bounds check. |
| S42a | `c8a57a42` | handleLogError fix. Filename sanitisation. 64KB manifest cap. Chunk + expiry guards. |
| S42b | `18d85351` | Per-UUID auth rate limit. Download rate limiting. Chunk count defence. |
| S42c | `c053cbc` | UUID-bound credential issuance. Worker generates UUID. waitForTurnstile fix. |
| S42d | `0b32e69` | Turnstile nonce binding. Safari polling fallback. |
| S42e | — | Full B4 audit pass. Marketing claim rulings. UK regulatory language. B5 handoff. |
| S43 | `5c54802` | Token alignment: Eleventy pages onto DESIGN-TOKENS.md v1.0. |
| S44 | `b15f407` | Dashboard design pass I: sidebar, tokens, Satoshi figures, 4 latency cards. |
| S45 | `7187e41` | Dashboard design pass II: 240px sidebar, gold wordmark, farming card. |
| S46a | `bbf271a` | Modal build I: 14 modal keys, skeleton, focus trap. CSS+JS extracted. |
| S46b | `023dfcc` | Modal polish: formatBytes, zero=green, datasource banner, × close. smokeTest 27 pass. |
| S47a | `63eb253` | FREE_EXPIRY fixed. Progress smooth. QR retina. Cap nudge. status.njk editorial. |
| S47b | `d8faf0f` | QR 200px SVG (qr-creator). 2-col button grid. Serif integrity notes. Ghost back links. |
| S47c | `cb7a925` | Receiver landing page. Info card. USP A/B test. No auto-download. |
| S47d | `3eb4ec4` | QR guard. Drop zone rejection. Colophon. Footer subdomain-only. Turnstile theme. |
| S48 | `0761f4c` | Maintenance modal. Theme cookie `rs-theme` scoped to `.refueler.io`. No FOUC. |
| S48a | `0152aae` | FSAA streaming download. Pipeline depth 2. Per-chunk retry. Blob fallback. |
| S49a | `3598a65` | Carbon gold edging. `--inset-rule` throughout. Brand token aliases in shared-styles. |
| S50 | `e3a4407` | Serif audit. 3 correct usages confirmed. 3 CSS-only additions. |
| S51 | `c182036` | File extraction: `frontend/share.css` (367L), `frontend/share.js` (899L), `frontend/upgrade.css` (419L). index.njk 1582→280L. upgrade.njk 944→525L. |
| S52 | TBD | manifest.js TIER_EXPIRY_SECONDS.free 5d→7d. shared-styles.njk --heading alias. B5 closed. B6 scoped. Lightning ops plan documented. Context v4.0. |

---

## Roadmap

Core S19–S100 · Buffer S101–S120. Session count is a guide not a constraint.

| Block | Sessions | Scope |
|-------|----------|-------|
| B1–B4 ✓ | S1–S42e | Foundation through security hardening |
| B5 ✓ | S43–S52 | Design full pass |
| B6 | S53–S72+ | Testing infrastructure + folder upload ← current |
| B7 | S73–S82 | Lightning/Blink + anonymous paid tier (highest design risk) |
| B8 | S83–S90 | NUT-11 Mode 2 keypair auth |
| B9 | S91–S96 | Documentation + security whitepaper |
| B10 | S97–S104 | Enterprise + ML-KEM spike |
| B11 | S105–S112 | Week 0 alpha, load test, go/no-go |
| B12 | S113–S114 | Public beta launch |
| B13 | post-B12 | Go-to-market (brand, partnerships, non-traditional markets) |

Critical chains: S34→S42→S91 (integrity) · S18→S24→S75 (dashboard) · S60→S70→S105 (CI) · S73→S75 (anon paid tier).

B3 gap deferred to B11: full cancel → webhook → Supabase loop needs a real live subscriber.

---

## B6 session plan (S53–S72+)

**Principle:** No session holds more than one architecturally complex piece of work.
Testing infra reviewed every 4 sessions (S63, S67, S71). Buffer consumed only if genuinely needed.

| Session | Label | Scope | Size |
|---------|-------|-------|------|
| S53 | Folder upload I | fflate, client-side zip, zip progress UI, blob → upload flow | M |
| S54 | Folder upload II | Streaming large folders, edge cases, special chars, 1000+ files | M |
| S55 | Folder upload III | Receiver UX, zip preview card, error states | M |
| S56 | Folder upload test | Photographer folder end-to-end. Off snags. | S |
| S57 | Bearer TTL — investigation | Measure token lifetime vs large-transfer duration. Document gap. | S |
| S58 | Bearer TTL — fix | Extend TTL or mid-stream 401 re-auth. Decision at S57. | M |
| S59 | Bearer TTL — buffer | Consumed only if S58 has outstanding issues. | S |
| S60 | Worker unit tests I | Miniflare setup. `ratelimit.js` + `manifest.js` coverage. | M |
| S61 | Worker unit tests II | `nut00.js` blind sig. `blake3.js` hash verification. | M |
| S62 | Worker unit tests III | `turnstile.js`, `stripe.js` handler stubs. Edge cases. | M |
| S63 | Testing infra review | 4-session checkpoint. Integration test harness design. | S |
| S64 | Integration tests I | Full upload→download round-trip in test harness. | L |
| S65 | Integration tests II | Passphrase gate, rate limit, farming defence. | M |
| S66 | Integration tests III | MIME denylist, UUID validation, chunk bounds, tier caps. | M |
| S67 | Testing infra review II | 4-session checkpoint. Load test design. | S |
| S68 | Load test I | k6 setup, credential issue + upload load. KV rate limit validation. | M |
| S69 | Load test II | Download load, concurrent transfers, KV timing. | M |
| S70 | CI pipeline I | GitHub Actions: build check, wrangler dry-run, lint. | S |
| S71 | CI pipeline II | Test runner in CI. Fail-fast on Worker unit test regression. | S |
| S72 | B6 close | Snag sweep, context files v5.0, B7 brief. Lightning backend confirmed. | S |

**Buffer pool:** 10 sessions for testing infra (reviewed S63+S67) + 2–3 for bearer TTL.

**Admin dashboard Lightning toggle (B6 scope):**
KV flag `lightning_available: true/false/blink`. Dashboard toggle card. Upgrade page reads flag.
Enables Fallback 1 + Fallback 2 without a code deploy, within target time windows.

**Background work for Rajesh during B6:**
1. Competitor analysis: WeTransfer, SwissTransfer, Smash, Wormhole, OnionShare.
   Max file size · expiry · encryption model · pricing · anonymous use · Lightning/Bitcoin support.
2. 2 GB test file: `dd if=/dev/urandom of=/tmp/testfile.bin bs=1m count=2048`
3. Blink API key: create account + generate API key if not already done.
4. btc++ Berlin abstract: draft one paragraph if considering presenting.

---

## B5 snag list — resolved + carried

| Item | Status |
|------|--------|
| FREE_EXPIRY 5d→7d in manifest.js | ✅ S52 |
| `--heading` alias in shared-styles.njk | ✅ S52 |
| WOFF2 parsing warning (Bunny/Fontshare) | ✅ Confirmed cosmetic. No action. |
| QR logo centre (Refueler mark in quiet zone) | Deferred → B11 prep if time allows |
| X-Email header wiring for paid tier enforcement | Deferred → B7 (paid tiers not yet live) |
| Nav snag (Upgrade link on refueler.io) | Deferred → B5 index iteration / B13 |
| Status tile for admin dashboard | Carry to B6 snag sweep at S72 |

---

## Tiers

| Tier | Cap | Expiry |
|------|-----|--------|
| Skint Tog (free) | 4 GB | 1 / 7 days |
| Creative Premium (£12/mo · £120/yr) | 100 GB | 1 / 7 / 30 days |
| Production Max (£24/mo · £240/yr) | 250 GB | 1 / 7 / 30 / 90 days |
| Enterprise | Unlimited | Custom |

Yearly = 10 months price.

---

## NUT protocol scope

| Status | NUTs |
|--------|------|
| Complete | NUT-00 (blind sig), NUT-07 (melt), NUT-11 Mode 1 (passphrase gate) |
| Deferred B8 | NUT-11 Mode 2 (keypair challenge-response, Prod Max) |
| Deferred B10 | ML-KEM key wrapping |

---

## Worker endpoints

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/status` | public | Operational state from KV |
| POST | `/admin/status` | X-Admin-Key | Update KV state (inc. lightning_available flag) |
| GET | `/admin/metrics` | X-Admin-Key | Supabase aggregation |
| GET | `/admin/ae-metrics` | X-Admin-Key | AE SQL proxy |
| GET | `/admin/snapshot` | X-Admin-Key | 6-field combined snapshot |
| POST | `/credential/issue` | Turnstile | NUT-00 blind sig |
| PUT | `/upload/{uuid}/{chunk}` | Cashu credential | Chunked upload |
| POST | `/auth/{uuid}` | — | NUT-11 passphrase → download token |
| GET | `/download/{uuid}/{chunk}` | Bearer (if protected) | R2 chunk proxy |
| POST | `/webhook/stripe` | Stripe sig | Subscription lifecycle |
| POST | `/subscription/checkout` | — | Subscription + PaymentIntent |
| GET | `/subscription/status` | — | Tier by email |
| POST | `/subscription/portal` | — | Customer Portal session |
| POST | `/log/error` | — | Client error → AE (20/60s rate limited) |

---

## File map

```
refueler-share/
  CLAUDE.md  share-sessions.md  Share-Master-Context.md  LICENSE  README.md
  .eleventy.js   package.json   package-lock.json
  src/
    index.njk  upgrade.njk  status.njk
    _includes/  head.njk  nav.njk  footer.njk  shared-styles.njk
  frontend/                      ← Eleventy output (committed, Pages serves)
    index.html  upgrade.html  status.html
    share.css                    ← extracted from src/index.njk (S51)
    share.js                     ← extracted from src/index.njk (S51), type="module"
    upgrade.css                  ← extracted from src/upgrade.njk (S51)
    blake3/                      ← WASM bundle (force-committed, git add -f)
    admin/
      dashboard.html             ← self-contained, no build step
      dashboard.css              ← extracted S46a
      dashboard.js               ← extracted S46a
  worker/
    wrangler.toml                ← BUCKET + STATUS_KV + AE bindings
    package.json                 ← @noble/hashes@1.7.2, @noble/secp256k1@2.1.0
    blake3-wasm/                 ← compiled WASM + glue (force-committed)
    src/
      index.js  nut00.js  nut11.js  blake3.js  blake3_worker.js
      manifest.js  turnstile.js  stripe.js  ratelimit.js
  docs/r2-lifecycle.md
```

---

*"Nothing stops this train."*
