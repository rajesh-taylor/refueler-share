# Share-Master-Context — refueler-share
> **Version:** 2.4 | **Last updated:** S40 · 21 July 2026
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
- Rate limits (STATUS_KV, no new resources): `credential_issue` 10/60s · `upload` 120/60s · `auth` 5/60s · `log_error` 20/60s. All 429s logged to AE.
- `/log/error`: always 200, fire-and-forget AE write, UUID truncated to 8 chars, detail max 200 chars.
- Wrangler updated to 4.112.0. ✓

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

---

## Current state

**B4 Security hardening — S34 S35-e S35 S36 S36b done. S36c + S37–S42 remaining.**

| Session | Commit | Shipped |
|---------|--------|---------|
| S34 | `7738450f` | BLAKE3 WASM in Worker. Server-side chunk verification. Integrity gap closed. |
| S35-emergency | `95a12b4` | Paid tiers greyed out, soft-launch notice. Uncounted. |
| S35 | `ab01388` | AAD overflow fix (4-byte uint32, encrypt + decrypt). |
| S36 | `b877c76` | Rate limiting: `ratelimit.js`, 3 endpoints, KV-backed. |
| S36b | `0cc4de9` | `/log/error` + `reportError()` helper. 6 capture points in frontend. |
| S37 | `7684118` | Dashboard: Satoshi figures, row 2 6-cell (p95+p99+success+churn), row 3 3-cell (free users, client errors, lightning deferred B7). |
| S38 | `20da7d4` | `client_errors_24h` AE query live. Three rogue secrets deleted. Wrangler 4.112.0. |
| S39 | `ab4fc98` | Server-side tier enforcement: X-Email Supabase lookup, 10MB chunk cap, KV byte counter per UUID. |
| S40 | `c6f1a7a` | MIME denylist gate on chunk 0. 415 on missing/denied type. AE logged. |
| S41 | `f2d775e5` | UUID format validation (RFC 4122) in upload + download. Chunk bounds check in download. Both gates pre-backend. |

**Next: S42 — B4 continuing security hardening.**

---

## Roadmap

Core S19–S100 · Buffer S101–S120.

| Block | Sessions | Scope |
|-------|----------|-------|
| B2 ✓ | S19–S26 | Instrumentation, metrics, dashboard |
| B3 ✓ | S27–S33 | Stripe test coverage |
| **B4** | S34–S42 | Security hardening ← current |
| B5 | S43–S50 | Design full pass |
| B6 | S51–S58 | Testing infrastructure |
| B7 | S59–S68 | Lightning/Blink + anonymous paid tier (S64, highest design risk) |
| B8 | S69–S76 | NUT-11 Mode 2 keypair auth |
| B9 | S77–S82 | Documentation + security whitepaper (unblocked S42) |
| B10 | S83–S90 | Enterprise + ML-KEM spike |
| B11 | S91–S98 | Week 0 alpha, load test, go/no-go |
| B12 | S99–S100 | Public beta launch |

Critical chains: S34→S42→S78 (integrity) · S18→S24→S66 (dashboard) · S51→S58→S94 (CI) · S62→S64 (anon paid tier).

B3 gap deferred to B11: full cancel → webhook → Supabase loop needs a real live subscriber.

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

## Design snag list (B5)

- Progress bar 15%→100% jump — needs smooth animation
- QR code blurry — sharper output needed
- `FREE_EXPIRY` mismatch: 5 days in code, "1 / 7 day expiry" in UI
- Theme state: write cookie scoped to `.refueler.io`
- Dashboard S36c: larger fonts, plain-English sub-labels (16px min), retain technical terms
- Dashboard B5: "Investor Snapshot" → "System Summary", Satoshi font, 4 latency cards, Copy JSON → bottom-right, Source Serif 4 body
- Brand audit: BRANDING.md against share UI, Carbon gold edging
- Modal full build — own session allocation in B5
- Named transfers: user-supplied label in URL fragment only, never stored server-side. Paid tier differentiator. Plan in B5 or B7.

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
