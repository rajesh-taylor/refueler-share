# Share-Master-Context — refueler-share
> **Version:** 1.5 | **Last updated:** Session 17 · 14 July 2026
> Load this file alongside `CLAUDE.md` (refueler-share) and `SESSIONS.md` for every share session.

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
- `STRIPE_SECRET_KEY` → `sk_live_...Fyop` ✓
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

---

## Known broken / do not retry

- **blake3-wasm CDN imports** — `esm.sh` returns 404, `unpkg.com` blocked by CORS on Cloudflare Pages. Local bundle only.
- **Invisible Turnstile mode** — doesn't resolve in Chrome/Safari. Visible managed widget only.
- **`secp.Point`** — removed in `@noble/secp256k1@2.x`. Use `secp.ProjectivePoint` throughout.
- **`binding = "R2"` in wrangler.toml** — Worker uses `env.BUCKET`, binding must be `BUCKET`.
- **BLAKE3 for passphrase hash** — frontend must use SHA-256 to match `nut11.js hashSecret()`.
- **`wrangler r2 bucket lifecycle set --rule` inline JSON** — not supported in Wrangler 4.92. Use `add` subcommand.
- **`wrangler r2 bucket lifecycle get`** — command is `list`.

---

## Current state (Session 17 complete)

**Block 1 — SSG Migration: complete.**
- Eleventy 3.x scaffold live. `src/` → `frontend/` build via `npm run build`.
- Pages build config: build command `npm run build`, output dir `frontend`.
- `src/index.njk`, `src/upgrade.njk`, `src/status.njk` — all Eleventy templates.
- Partials: `src/_includes/head.njk`, `nav.njk`, `footer.njk`, `shared-styles.njk`.
- KV-backed status system: `GET /status`, `POST /admin/status`, maintenance banner on all pages.
- Status page: ops layer + cryptographic integrity layer (6 cards, honest gap disclosure).

**Full upload → share link → passphrase gate → download flow is end-to-end functional.**
Stripe Customer Portal live. R2 lifecycle rules applied to prod and dev buckets.

**Latent (deferred):** `FREE_EXPIRY` in `index.njk` is 5 days but free tier UI displays "1 / 7 day expiry". Fix in a snag session.

**Next: Block 2 — Instrumentation (Session 18).**

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
  SESSIONS.md
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
