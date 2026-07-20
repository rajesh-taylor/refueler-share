# Share-Master-Context — refueler-share
> **Version:** 2.1 | **Last updated:** Session 26 · 15 July 2026
> Load this file alongside `CLAUDE.md` (refueler-share) and `share-sessions.md` for every share session.

---

## What this repo is

`rajesh-taylor/refueler-share` — anonymous, encrypted peer-to-peer file transfer.
BLAKE3 chunk integrity + Cashu NUT-00 blind signatures as anonymous auth.
**These are distinct layers. Never conflate.**

Local path: `/Users/rajeshtaylor/Documents/refueler-share/`
Licence: **Apache 2.0**

---

## Stack (share only)

| Layer | Technology |
|-------|-----------|
| Worker | Cloudflare Workers — `wrangler deploy` |
| Worker URL | `https://refueler-share.rt-fc4.workers.dev` |
| Storage | Cloudflare R2 — `refueler-share-prod` / `refueler-share-dev` |
| Ledger | Supabase `tihgvdokeofnjxjkenmm` — `spent_tokens` + `subscribers` |
| Frontend | Eleventy 3.x — `src/` → `frontend/` build |
| Subdomain | `share.refueler.io` → CNAME → `refueler-share.pages.dev` (Pages) |
| Crypto | AES-GCM (Web Crypto), BLAKE3 WASM (browser, local bundle), secp256k1 (@noble) |
| Payments (fiat) | Stripe — live mode, GBP, embedded Payment Element |
| Payments (sats) | Blink BOLT11 — deferred |

---

## Supabase — share-specific

Project: `tihgvdokeofnjxjkenmm`

**Table: `spent_tokens`** (Session 2)
```
serial     TEXT PRIMARY KEY
melted_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
```

**Table: `subscribers`** (Session 4)
```
stripe_customer_id  TEXT PRIMARY KEY
email               TEXT
tier                TEXT CHECK (free | creative | max) DEFAULT free
status              TEXT CHECK (active | inactive | cancelled) DEFAULT inactive
current_period_end  TIMESTAMPTZ
created_at          TIMESTAMPTZ DEFAULT NOW()
updated_at          TIMESTAMPTZ DEFAULT NOW()
```
Index: `subscribers_email_idx` on `email`. RLS enabled. Worker service_role key only.

---

## Cloudflare resources

| Resource | Name / Value |
|----------|-------------|
| Worker | `refueler-share` |
| Worker URL | `https://refueler-share.rt-fc4.workers.dev` |
| R2 prod bucket | `refueler-share-prod` |
| R2 dev bucket | `refueler-share-dev` |
| KV namespace | `refueler-share-kv` — binding `STATUS_KV` in wrangler.toml ✓ |
| Pages | `share.refueler.io` — LIVE · project `refueler-share` · CNAME → refueler-share.pages.dev |
| Turnstile | Sitekey `0x4AAAAAAD0N7GlHlCRuWITr` · Secret `0x4AAAAAAD0N7OIqbRdBAbVR66n3FqTFkLU` · Widget: refueler-share (Managed) |
| DNS | `share.refueler.io` CNAME → `refueler-share.pages.dev` ✓ |

Worker secrets (all set ✓):
- `MINT_PRIVATE_KEY` — secp256k1 hex (32 bytes) ✓
- `TURNSTILE_SECRET_KEY` — `0x4AAAAAAD0N7OIqbRdBAbVR66n3FqTFkLU` ✓
- `SUPABASE_URL` → `https://tihgvdokeofnjxjkenmm.supabase.co` ✓
- `SUPABASE_SERVICE_KEY` → service_role JWT ✓
- `STRIPE_SECRET_KEY` → `sk_live_...ZehD` (active, set S29) ✓
- `STRIPE_WEBHOOK_SECRET` → rotated Session 6 ✓
- `ADMIN_KEY` → set Session 16 ✓

---

## Stripe — live mode

Account: Rajesh Taylor (`rt@rajeshtaylor.com`), GBP
Publishable key: `pk_live_qTLdmzRXg6KHXtxbgGYQZc7L00Kl4saD2q`

| Product | Price ID | Lookup key | Amount |
|---------|----------|------------|--------|
| Creative Premium monthly | `price_1Ts7lsGlctwiB9U3hdtgChU2` | `share-creative-monthly` | £12/mo |
| Creative Premium yearly | `price_1Ts7sqGlctwiB9U3YRloCFfi` | `share-creative-yearly` | £120/yr |
| Production Max monthly | `price_1Ts7vIGlctwiB9U3kb3NCLue` | `share-max-monthly` | £24/mo |
| Production Max yearly | `price_1Ts7xIGlctwiB9U3JyZB8Kwj` | `share-max-yearly` | £240/yr |

Webhook: `https://refueler-share.rt-fc4.workers.dev/webhook/stripe`
Customer Portal: configured ✓ · redirect → `https://share.refueler.io/upgrade.html` · all 4 plans · cancel at period end · cancellation reasons enabled
Destination ID: `we_1Ts8epGlctwiB9U3dXT8XBac`
Events: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`

---

## Locked architecture decisions

- **Free tier cap: 4 GB** per transfer
- **Worker URL: `https://refueler-share.rt-fc4.workers.dev`** — hardcoded in all Eleventy templates ✓
- **R2 binding name: `BUCKET`** — `wrangler.toml` must use `binding = "BUCKET"`, code uses `env.BUCKET`
- **KV binding name: `STATUS_KV`** — `wrangler.toml` binding = `STATUS_KV`, KV key `status:current`
- **`X-Cashu-Credential` header is a JSON string** — must `JSON.parse()` before passing to `verifyCredential()`
- **Passphrase hashing: SHA-256 only** — frontend uses `crypto.subtle.digest('SHA-256')`, stored in manifest as `p2sh_secret_hash`. BLAKE3 is for chunk integrity only. Never conflate.
- BLAKE3 = chunk integrity (browser WASM, local bundle at `frontend/blake3/`). Server-side uses Web Crypto SHA-256.
- `frontend/blake3/` is force-committed via `git add -f` — `dist/` is in `.gitignore`, must use `-f` flag if re-adding.
- Cashu blind sigs = anonymous auth. Never conflate with BLAKE3.
- No external mint. No ecash-to-sats path. No Cashu monetary usage.
- AES-GCM session key lives in URL fragment only. Never in network requests. Never in logs.
- Browser memory only for credentials. Never localStorage. Never sessionStorage.
- Subscription model (monthly/yearly). Pay-per-transfer deferred to future.
- Stripe embedded Payment Element (not Checkout redirect) — card in upgrade.html.
- Lightning tab in upgrade.html is placeholder — Blink BOLT11 deferred.
- NUT-07 melt fires after first chunk write. On Supabase failure: log and continue.
- Turnstile: fail-closed on any verification error.
- R2 manifest is authoritative transfer state. Supabase is ledger only.
- Chunk key format: `{uuid}/{0000}` (zero-padded 4 digits)
- Manifest key: `{uuid}/manifest.json`
- Direct R2 URL exposure: none. Worker proxies all R2 access.
- Status banner: `sessionStorage` only for dismiss — reappears on next visit.
- Status page is banner-linked only (`/status.html`) — no nav entry.
- curl: always single-line, real key inlined, no backslash continuations.
- Downloaded files: Rajesh moves manually. Claude gives destination path as one-liner only.
- `double_spend_attempts` table: written fire-and-forget on 409. Never blocks request. On Supabase failure: log and continue.
- Supabase count pattern: `Prefer: count=exact` + `Range: 0-0` → total in `Content-Range: 0-0/TOTAL` header. No row data transferred.

---

## Known broken / do not retry

- **blake3-wasm CDN imports** — `esm.sh` returns 404, `unpkg.com` blocked by CORS on Cloudflare Pages. Local bundle only.
- **Invisible Turnstile mode** — doesn't resolve in Chrome/Safari. Visible managed widget only.
- **`secp.Point`** — removed in `@noble/secp256k1@2.x`. Use `secp.ProjectivePoint` throughout.
- **`binding = "R2"` in wrangler.toml** — Worker uses `env.BUCKET`, binding must be `BUCKET`.
- **BLAKE3 for passphrase hash** — frontend must use SHA-256 to match `nut11.js hashSecret()`.
- **`wrangler r2 bucket lifecycle set --rule` inline JSON** — not supported in Wrangler 4.92. Use `add` subcommand.
- **`wrangler r2 bucket lifecycle get`** — command is `list`.
- **`checkout/sessions` with `ui_mode: embedded`** — returns `cs_test_...` secret incompatible with `stripe.elements()`. Use direct Subscription creation + `expand[0]=latest_invoice.payment_intent` instead.
- **`decodeURIComponent` on Stripe `client_secret`** — JSON response is already decoded. Do not wrap.

---

## Current state (Session 34 complete)

**Block 1 — SSG Migration: complete.**
**Block 2 — Instrumentation: complete.**
**Block 3 — Stripe test coverage: complete.**
**Block 4 — Security hardening: S34 complete (BLAKE3 WASM). S35–S42 remaining.**

- BLAKE3 Worker WASM compiled and deployed. Integrity gap closed.
- `verifyChunkHash` now performs real server-side BLAKE3 verification on every chunk.
- Integrity/audit marketing claims unblocked after S42 (full B4 audit pass).

**Next: S35 — AAD ≥256 fix**
---

## Roadmap S19–S120 (v1.6 · Share-19 planning session)

Core: S19–S100 (82 sessions). Buffer: S101–S120 (20 sessions, drawn on overrun, logged in SESSIONS.md).

| Block | Sessions | Scope |
|---|---|---|
| B2 Instrumentation completion | S19–S26 | Supabase aggregation (MRR/conversion/churn), R2 + crypto metrics, /admin/metrics, dev dashboard, investor snapshot, 13-metric smoke test |
| B3 Stripe test coverage | S27–S33 | Test mode (4242 card), webhook replay, cancellation, portal, failed payment/dunning, edge cases |
| B4 Security hardening | S34–S42 | BLAKE3 Worker WASM (S34–S35), AAD ≥256 fix (S36), large-file test, rate limiting, admin hardening, CSP, audits, integrity gap card → green (S42) |
| B5 Design full pass | S43–S50 | Progress bar, Turnstile placement, QR/copy icon, FREE_EXPIRY, theme cookie, shared nav, brand audit, cross-browser |
| B6 Testing infra | S51–S58 | Vitest workers pool, unit tests (nut00/nut11/manifest/blake3), integration harness, Playwright E2E, GitHub Actions CI |
| B7 Lightning/Blink | S59–S68 | Invoice endpoint, settlement detection, credential-on-settlement, anonymous paid tier (S64 — highest design risk), Lightning tab, settlement mix metric, real-sats E2E |
| B8 NUT-11 Mode 2 | S69–S76 | Keypair challenge-response, keygen UX, Worker verify, manifest v2, Prod Max gating, tests |
| B9 Documentation | S77–S82 | README, security whitepaper (unblocked by S42), API docs, help/FAQ, ToS/privacy |
| B10 Enterprise groundwork | S83–S90 | Org/seat schema, custom caps, Stripe invoicing, admin provisioning, sales page, ML-KEM spike |
| B11 Beta prep | S91–S98 | Week 0 alpha (S91–S93), load test, incident runbook, onboarding, feedback loop, go/no-go |
| B12 Launch | S99–S100 | Public beta launch + stabilization |

**Critical chains:** S34→S35→S37→S42→S78 (integrity claims) · S18→S22→S24→S49/S66 (dashboard) · S51→S55→S58→S94 (CI/load) · S62→S63→S64 (anonymous paid tier).

---

## Tiers

| Tier | Cap | Expiry options |
|------|-----|---------------|
| Skint Tog (free) | **4 GB** | 1 / 7 days |
| Creative Premium (£12/mo or £120/yr) | 100 GB | 1 / 7 / 30 days |
| Production Max (£24/mo or £240/yr) | 250 GB | 1 / 7 / 30 / 90 days |
| Enterprise | Unlimited | Custom |

Yearly = 10 months price (2 months free).

---

## NUT protocol scope

| Status | NUTs |
|--------|------|
| Complete | NUT-00 (blind sig), NUT-07 (melt), NUT-11 Mode 1 (passphrase gate) |
| Deferred | NUT-11 Mode 2 (keypair challenge-response, Production Max) |
| Deferred | ML-KEM key wrapping (Prod Max Phase 2) |

---

## Worker endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/status` | Operational state from KV — public ✓ |
| POST | `/admin/status` | Update KV state — `X-Admin-Key` protected ✓ |
| POST | `/credential/issue` | NUT-00 blind sig (free tier, Turnstile gate) ✓ |
| PUT | `/upload/{uuid}/{chunk}` | Chunked upload, credential verify ✓ |
| POST | `/auth/{uuid}` | NUT-11 Mode 1 passphrase → download token ✓ |
| GET | `/download/{uuid}/{chunk}` | R2 chunk proxy ✓ |
| POST | `/webhook/stripe` | Stripe subscription lifecycle ✓ |
| POST | `/subscription/checkout` | Create embedded checkout session ✓ |
| GET | `/subscription/status` | Returns tier by email ✓ |
| POST | `/subscription/portal` | Create Stripe Customer Portal session ✓ |

---

## Design snag list (separate design session)

- Progress bar: 15%→100% jump is choppy — needs smooth animation during upload chunk loop
- Turnstile widget should sit above passphrase field in upload UI
- QR code render is blurry — needs sharper output
- Copy button: add double-square icon alongside text
- Brand audit: run refueler.io branding .md against share UI
- `FREE_EXPIRY` mismatch: 5 days in code, "1 / 7 day expiry" in UI
- Theme state must persist across domains — write to cookie scoped to `.refueler.io`

---

## File map

```
refueler-share/
  README.md
  CLAUDE.md
  share-sessions.md
  Share-Master-Context.md   ← this file (v1.5)
  LICENSE                   ← Apache 2.0
  .eleventy.js              ← input: src, output: frontend, passthrough: blake3/
  package.json              ← build: eleventy, dev: eleventy --serve
  package-lock.json
  frontend-deps/            ← throwaway npm install dir, not committed
  src/
    index.njk               ← upload/download page
    upgrade.njk             ← pricing page
    status.njk              ← status page (ops + crypto integrity)
    _includes/
      head.njk              ← fonts, theme script, extraHead slot
      nav.njk               ← wordmark + site-nav + theme pill
      footer.njk            ← canonical footer
      shared-styles.njk     ← brand tokens, reset, shared components, banner CSS
  frontend/                 ← Eleventy output (committed, Pages serves this)
    index.html
    upgrade.html
    status.html
    blake3/                 ← local blake3-wasm bundle (force-committed)
  worker/
    wrangler.toml           ← binding = "BUCKET" ✓, STATUS_KV binding ✓
    package.json            ← @noble/hashes@1.7.2, @noble/secp256k1@2.1.0
    src/
      index.js              ← Worker router + all handlers
      nut00.js              ← Cashu blind sig (noble v2 API)
      nut11.js              ← passphrase gate + download token
      blake3.js             ← verifyChunkHash → return true (passthrough)
      manifest.js           ← R2 manifest helpers
      turnstile.js
      stripe.js
  docs/
    r2-lifecycle.md
```

---

*"Nothing stops this train."*
