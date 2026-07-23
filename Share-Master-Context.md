# Share-Master-Context — refueler-share
> **Version:** 3.1 | **Last updated:** S47a close · 23 July 2026
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
| Payments (sats) | Blink BOLT11 — deferred (B7) |

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

Worker secrets (all set): `MINT_PRIVATE_KEY`, `TURNSTILE_SECRET_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `STRIPE_SECRET_KEY` (sk_live_...ZehD, S29), `STRIPE_WEBHOOK_SECRET` (rotated 21 Jul), `ADMIN_KEY`, `CF_ACCOUNT_ID` (fc4f3e5aeebe483677d14185daf544f5), `CF_AE_TOKEN` (Account Analytics Read).

---

## Stripe — live mode

Account: `rt@rajeshtaylor.com` · GBP · Publishable key: `pk_live_qTLdmzRXg6KHXtxbgGYQZc7L00Kl4saD2q`

| Product | Price ID | Lookup key | Amount |
|---------|----------|------------|--------|
| Creative Premium monthly | `price_1Ts7lsGlctwiB9U3hdtgChU2` | `share-creative-monthly` | £12/mo |
| Creative Premium yearly | `price_1Ts7sqGlctwiB9U3YRloCFfi` | `share-creative-yearly` | £120/yr |
| Production Max monthly | `price_1Ts7vIGlctwiB9U3kb3NCLue` | `share-max-monthly` | £24/mo |
| Production Max yearly | `price_1Ts7xIGlctwiB9U3JyZB8Kwj` | `share-max-yearly` | £240/yr |

Webhook: `https://refueler-share.rt-fc4.workers.dev/webhook/stripe` · Destination: `we_1Ts8epGlctwiB9U3dXT8XBac`
Portal: configured · redirect to `https://share.refueler.io/upgrade.html` · cancel at period end · cancellation reasons enabled
Events: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`

---

## Locked architecture decisions

**Crypto layers (never conflate):**
- BLAKE3 = chunk integrity. Browser: local WASM at `frontend/blake3/`. Worker: `worker/blake3-wasm/` via `blake3_worker.js`. Server verifies every chunk — 400 on mismatch.
- Cashu = anonymous auth (NUT-00/07/11). No monetary usage. No external mint.
- Passphrase hash = SHA-256 only (`crypto.subtle.digest`). Stored in manifest as `p2sh_secret_hash`.
- AES-GCM session key lives in URL fragment only — never in requests, never in logs.
- Upload boundary: `Content-Type` header validated on chunk 0 against a denylist of
  execution-capable MIME types (`.exe`, `.elf`, `.sh`, `.bat`, `.php` families). 415 on
  missing or denylisted type, logged to AE. Gate reflects declared intent only — Worker
  receives AES-GCM ciphertext and cannot inspect payload. MIME type is never stored.
- AAD per chunk: 4-byte big-endian uint32 via `DataView.setUint32(0, i, false)`. Never `new Uint8Array([i])`.

**Storage:**
- R2 binding: `BUCKET`. KV binding: `STATUS_KV`. Chunk key: `{uuid}/{0000}`. Manifest key: `{uuid}/manifest.json`.
- R2 manifest is authoritative. Supabase is ledger only. No direct R2 URL exposure.
- `safeGetManifest()` double-read note: wrapper checks `obj.size` on the first R2 `.get()`, then delegates to `getManifest()` for a second read. Minor inefficiency — flag for optimisation if R2 costs become material. Not a security gap.

**Frontend:**
- Credentials in browser memory only — never localStorage, never sessionStorage.
- `frontend/blake3/` force-committed via `git add -f`.
- Status banner: `sessionStorage` dismiss. Status page `/status.html` — no nav entry.

**Stripe:**
- Direct Subscription + `expand[0]=latest_invoice.payment_intent` → `pi_...` secret for `stripe.elements()`.
- Paid tier cards greyed out (soft launch). Re-enable only on explicit instruction from Rajesh at each block close.

**Ops:**
- NUT-07 melt after first chunk write. Supabase failure: log and continue.
- Turnstile: fail-closed on any error.
- Rate limits (STATUS_KV, no new resources): `credential_issue` 10/60s · `upload` 120/60s · `auth` 5/60s · `log_error` 20/60s · `download` 300/60s. All 429s logged to AE.
- `/log/error`: always 200, fire-and-forget AE write, UUID truncated to 8 chars, detail max 200 chars.
- Wrangler updated to 4.113.0. ✓

**Regulatory (UK):**
- Refueler cannot operate as an e-money issuer without FCA authorisation.
- Share mint issues access credentials only — capability tokens, not monetary instruments.
- Cashu in Share = anonymous authentication mechanism, not payment instrument.
- Exact whitepaper language drafted S42e. Must be reviewed by qualified legal counsel before any public claims are made.

**Whitepaper language (B9 §Regulatory — drafted S42e):**
> The Refueler Share mint issues upload credentials — opaque capability tokens that grant the right to perform a single anonymous file transfer of a defined size and expiry. These tokens carry no monetary value, are not redeemable for currency or goods, and are not transferable between users. They function solely as anonymous authentication artefacts within the Refueler Share system.
>
> Under the UK Electronic Money Regulations 2011 (SI 2011/99) and the Payment Services Regulations 2017, e-money is defined as electronically stored monetary value issued on receipt of funds, used to make payment transactions, and accepted by persons other than the issuer. Refueler Share credentials satisfy none of these criteria: they represent system access, not stored monetary value, and are accepted only by Refueler Share infrastructure, not by third parties.
>
> Refueler Share does not require FCA authorisation as an e-money institution. Lightning payments are processed via Blink, a licensed custodial wallet provider that carries its own regulatory cover. Refueler holds no custodial funds.
>
> This analysis should be reviewed by qualified legal counsel before any public claims are made.

**Payment flow (locked):**
- Lightning → Blink API (Blink holds custodial wallet, carries regulatory cover)
- PayNym → Sparrow cold storage wallet, manual/semi-manual settlement
- Share mint → upload credentials only, zero monetary value, no e-money

**Mint architecture (locked):**
- Live mint lives inside its own product repo. Share mint in `refueler-share`. Loyalty mint in `refueler-mint` / `refueler.io`. Ticketing mint in future `refueler-tickets`.
- Test mint lives in `refueler-ecash-lab` — B8 planning task. Create empty repo now; no code until B8 architecture is locked.
- Resilience rationale: one mint down must not affect other products. Maintenance overhead accepted.
- All mints are capability/loyalty token issuers — none handle e-money.
- UUID-bound credentials (NUT-20 pattern) are the long-term resolution to credential farming. Deferred to B8 Rust mint. S42c implements a Worker-based precursor.

**Marketing claim rulings (S42e — update again after B8, B9, B10):**
- ✅ Safe to assert: server-side BLAKE3 chunk integrity; double-spend detection; rate limiting on all public endpoints; UUID-bound credential issuance (Worker precursor to NUT-20); Turnstile nonce binding (one solve, one credential); anonymous transfer (no account required for free tier).
- 🔒 Blocked: full Merkle tree verification (assembled file vs BLAKE3 root); NUT-11 Mode 2 keypair auth; "audit-certified" / "security-audited"; ML-KEM key wrapping; any "end-to-end file integrity" claim without the server-side-chunks-only qualifier.
- 📅 Resolution path: B8 unblocks NUT-11 Mode 2 · B9 unblocks whitepaper + Merkle claim · B10 unblocks ML-KEM.

---

## Known broken / do not retry

| Pattern | Correct approach |
|---------|-----------------|
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
| Trust `X-Tier` upload header | Ignored since S39 — tier resolved from Supabase via `X-Email` |
| Apply MIME gate to chunks > 0 | Gate is chunk-0 only — ciphertext continuations carry no meaningful Content-Type |
| URL shortener for share links | Lookup table is a privacy attack point; fragment key exposed to shortener service |
| `if (rl)` to check rate limit | `checkRateLimit` returns object — always truthy; use `if (rl.limited)` |
| `getManifest()` direct from handlers | Use `safeGetManifest()` wrapper — enforces 64KB manifest ceiling |
| Generate UUID client-side | Worker generates UUID at /credential/issue since S42c |
| Turnstile nonce TTL = 7 days | Cloudflare expires tokens ~300s; use 600s KV TTL |
| Fail-closed on nonce KV error | Fail open — KV blip must not block legitimate uploads |
| Await nonce KV write | Fire-and-forget only |
| `renderTurnstile()` from `onTurnstileLoad` without flag | Use `pendingTurnstileRender` flag to prevent double-render |

---

## Current state

**B4 Security hardening — COMPLETE. B5 Design full pass — current.**

| Session | Commit | Shipped |
|---------|--------|---------|
| S34 | `7738450f` | BLAKE3 WASM in Worker. Server-side chunk verification. Integrity gap closed. |
| S35-emergency | `95a12b4` | Paid tiers greyed out, soft-launch notice. Uncounted. |
| S35 | `ab01388` | AAD overflow fix (4-byte uint32, encrypt + decrypt). |
| S36 | `b877c76` | Rate limiting: `ratelimit.js`, 3 endpoints, KV-backed. |
| S36b | `0cc4de9` | `/log/error` + `reportError()` helper. 6 capture points in frontend. |
| S37 | `7684118` | Dashboard: Satoshi figures, row 2 6-cell (p95+p99+success+churn), row 3 3-cell (free users, client errors, lightning deferred B7). |
| S38 | `20da7d4` | `client_errors_24h` AE query live. Three rogue secrets deleted. Wrangler 4.113.0. |
| S39 | `ab4fc98` | Server-side tier enforcement: X-Email Supabase lookup, 10MB chunk cap, KV byte counter per UUID. |
| S40 | `c6f1a7a` | MIME denylist gate on chunk 0. 415 on missing/denied type. AE logged. |
| S41 | `b2a4ba0` | UUID format validation (RFC 4122) in upload + download. Chunk bounds check in download. Both gates pre-backend. |
| S42a | `c8a57a42` | `handleLogError` truthy fix. Filename bidi sanitisation. 64KB manifest cap (`safeGetManifest`). `X-Total-Chunks` ≤ 10,000. `X-Expiry-Timestamp` tier validation. |
| S42b | `18d85351` | Per-UUID auth rate limit. Download rate limiting (300/60s). Upload continuation expiry confirmed pre-existing. Chunk count manipulation defence. |
| S42c | `c053cbc` | UUID-bound credential issuance. Worker generates UUID. Commitment H(uuid:tier:window) verified on chunk 0. waitForTurnstile fix. |
| S42d | `0b32e69` | Turnstile nonce binding (`tt_nonce:` KV, 600s TTL). Safari polling fallback. Wrangler 4.113.0. |
| S42e | — | Full B4 audit pass. 20 claims verified against source. Marketing claim rulings. Critical chain S34→S42→S78 closed. UK regulatory language drafted. B5 handoff complete. |
| S43 | `5c54802` | Token alignment: Paper/Carbon --bg corrected, --surface-raised added, IBM Plex Mono loaded, --accent declared. Eleventy pages only (index, upgrade, status). Dashboard token alignment deferred to S44. |
| S44 | `b15f407` | Dashboard design pass I: sidebar layout, DESIGN-TOKENS.md alignment (dashboard was on pre-token palette — S43 only covered Eleventy pages), Satoshi 700 figures 2rem, 4 latency cards, Copy JSON bottom-right, sidebar Paper/Carbon toggle + sign out, @media print PDF export, Refresh double-bind bug fixed. |
| S45 | `7187e41` | Dashboard design pass II: sidebar 240px, gold wordmark, farming signal card (row-4), Source Serif editorial line, smoke test deduped to 11 checks. |
| S46a | `bbf271a` | Modal build I: 14 modal keys, skeleton, n/a, deferred Lightning, sparkline stub, CSV note, focus trap. CSS+JS extracted to separate files. Green on healthy metrics. |
| S46b | `023dfcc` | Modal polish: formatBytes 1dp, zero=green (errors/churn/client-errors), datasource banner, × close button, modal-active ring, smokeTest 27 pass. |
| S47a | `dbcf54f` → `1daeac9` → `63eb253` | FREE_EXPIRY fixed (7d). Progress bar smooth finish. QR retina + design token colours. Cap upgrade nudge on index. status.njk: shared-styles include added, "How it works" human-readable cards, plain-English state labels, card text sizes lifted, ← Back link added. |
---

## Roadmap

Core S19–S100 · Buffer S101–S120. B5 expanded to S43–S52 (10 sessions) to accommodate modal full build (2 sessions), dashboard depth (2 sessions), and brand pass (2 sessions).

| Block | Sessions | Scope |
|-------|----------|-------|
| B2 ✓ | S19–S26 | Instrumentation, metrics, dashboard |
| B3 ✓ | S27–S33 | Stripe test coverage |
| B4 ✓ | S34–S42 | Security hardening |
| B5 | S43–S52 | Design full pass ← current · S47 split into S47a/b/c/d |
| B6 | S53–S60 | Testing infrastructure |
| B7 | S61–S70 | Lightning/Blink + anonymous paid tier (highest design risk) |
| B8 | S71–S78 | NUT-11 Mode 2 keypair auth |
| B9 | S79–S84 | Documentation + security whitepaper (unblocked S42) |
| B10 | S85–S92 | Enterprise + ML-KEM spike |
| B11 | S93–S100 | Week 0 alpha, load test, go/no-go |
| B12 | S101–S102 | Public beta launch |

Critical chains: S34→S42→S79 (integrity, renumbered) · S18→S24→S67 (dashboard) · S53→S60→S95 (CI) · S63→S65 (anon paid tier).

B3 gap deferred to B11: full cancel → webhook → Supabase loop needs a real live subscriber.

---

## B5 session plan (S43–S52)

| Session | Label | Scope | Size |
|---------|-------|-------|------|
| S43 | Token alignment | Apply `DESIGN-TOKENS.md` to `index.html`, `upgrade.html`, `status.html`: fix `--bg` Paper (`#F5F0E8` → `#F7F4EF`), Carbon (`#1A1A1A` → `#1E1F22`), add `--surface-raised`, load IBM Plex Mono, declare `--accent: #C8A96E`. | S |
| S44 | Dashboard design pass I | ✅ Complete — b15f407 | M |
| S45 | Dashboard design pass II | ✅ Complete — 7187e41 | M |
| S46a | Modal build I | ✅ Complete — bbf271a. 14 modal keys, skeleton, n/a, deferred Lightning, sparkline stub, CSV note, focus trap. CSS+JS extracted to separate files. | L |
| S46b | Modal build II | ✅ Complete — 023dfcc. formatBytes, zero=green, datasource banner, × close, modal-active ring. smokeTest 27 pass. | M |
| S47a | Upload/download UX I | ✅ Complete — dbcf54f · 1daeac9 · 63eb253. FREE_EXPIRY, progress smooth, QR retina, upgrade nudge, status editorial + shared-styles fix, card text sizes, back link. | S |
| S47b | Status page + upgrade nudge | QR size (200px) + Carbon contrast fix. Button layout 2-col. integrity-card-note → Source Serif 4 14px 300. Back link → ghost button. upgrade.html back-nav. | S |
| S47c | Maintenance notification | KV-controlled modal on index.html, design tokens, sessionStorage dismiss. One Worker deploy. | M |
| S47d | B5 close | Snag sweep, context files, v4.0, B6 brief. | S |
| S48 | Theme persistence + named transfers | Paper/Carbon cookie scoped to `.refueler.io`. Review `privacy/index.html` + `README.md` for "no cookies" language; update to "no tracking cookies". Named transfers UI plan (fragment-only label, paid tier differentiator). | S |
| S49a | Carbon gold edging | Apply `--inset-rule: #C8A96E` throughout Carbon theme. Card borders, rule lines, active states per `DESIGN-TOKENS.md`. | S |
| S49b | Brand audit pass | Share UI against `BRANDING.md`. Source Serif 4 body text in editorial moments. Head of Design reference review. Full Paper/Carbon consistency sweep. | M |
| S52 | B5 close | Snag sweep. Context files. Version bump to 4.0. B6 planning brief. | S |

Notes:
- S49a and S49b replace the single S49 slot, which was too compressed for both the gold edging implementation and the full brand audit.
- S52 is the close session number after the 10-session B5 block (S43–S52). No sessions S50–S51 are skipped — the table above uses S50 and S51 for S49a and S49b respectively; renumber at session start if preferred.
- Paid tier cards remain greyed out throughout B5. Re-enable only on Rajesh's explicit instruction at B7 close.
- Nav snag (Upgrade link breaking on `refueler.io`) deferred — review at B5 when iterating Share index page.
- X-Email header wiring for paid tier enforcement: must be fixed before paid tiers go live. Review in B5 S47 or B7.
- Upgrade nudge snag (S47): free-tier users have no visible path to upgrade.html from index.html when they hit the 4GB cap or try to select a longer expiry. Fix: contextual upgrade prompt on cap hit / expiry-tier gate, independent of nav snag.
- Status page editorial (COMPLETE S47a): human-readable "How it works" cards live. Plain-English state labels live. Fetch error softened. Known-gap card removed. Status tile for admin dashboard still needed — add at S52 snag sweep.
- DO NOT use `classList.contains('carbon-mode')` for theme detection — use `dataset.theme === 'carbon'`.
- DO NOT omit `{% include "shared-styles.njk" %}` from any Eleventy page — without it all CSS variables, `.hidden`, and Paper/Carbon toggle JS are absent.
- S47b carry-forward snags: (1) QR 200px display + Carbon high-contrast colours. (2) Copy link + New upload as full-width 2-col grid. (3) integrity-card-note → Source Serif 4 300/14px/1.7. (4) Back link → ghost button style. (5) upgrade.html back-nav to share index.

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
| POST | `/admin/status` | X-Admin-Key | Update KV state |
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
  frontend/                    ← Eleventy output (committed, Pages serves)
    index.html  upgrade.html  status.html
    blake3/                    ← WASM bundle (force-committed, git add -f)
    admin/dashboard.html       ← self-contained, no build step
  worker/
    wrangler.toml              ← BUCKET + STATUS_KV + AE bindings
    package.json               ← @noble/hashes@1.7.2, @noble/secp256k1@2.1.0
    blake3-wasm/               ← compiled WASM + glue (force-committed)
    src/
      index.js  nut00.js  nut11.js  blake3.js  blake3_worker.js
      manifest.js  turnstile.js  stripe.js  ratelimit.js
  docs/r2-lifecycle.md
```

---

*"Nothing stops this train."*
