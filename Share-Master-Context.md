# Share-Master-Context — refueler-share
> **Version:** 1.1 | **Last updated:** Session 4 · 11 July 2026
> Load this file alongside `CLAUDE.md` (refueler-share) and `SESSIONS.md` for every share session.
> Do NOT load `Refueler_MasterContext_CC64.md` for share sessions — it carries irrelevant context
> (Blink webhooks, rail intelligence, Numo, mint). This file is the lean equivalent.

---

## What this repo is

`rajesh-taylor/refueler-share` — anonymous, encrypted peer-to-peer file transfer.
BLAKE3 chunk integrity + Cashu NUT-00 blind signatures as anonymous auth.
**These are distinct layers. Never conflate.**

Local path: `/Users/rajeshtaylor/Documents/refueler-share/`
Licence: **Apache 2.0** (not MIT — early repo init was wrong, corrected Session 2)

---

## Stack (share only)

| Layer | Technology |
|-------|-----------|
| Worker | Cloudflare Workers — `wrangler deploy` |
| Worker URL | `https://refueler-share.rt-fc4.workers.dev` |
| Storage | Cloudflare R2 — `refueler-share-prod` / `refueler-share-dev` |
| Ledger | Supabase `tihgvdokeofnjxjkenmm` — `spent_tokens` + `subscribers` |
| Frontend | Static HTML5 — `frontend/index.html` + `frontend/upgrade.html` |
| Subdomain | `share.refueler.io` → CNAME → `refueler-share.rt-fc4.workers.dev` (Proxied) |
| Crypto | AES-GCM (Web Crypto), BLAKE3 WASM (browser only), secp256k1 (@noble) |
| Payments (fiat) | Stripe — live mode, GBP, embedded Payment Element |
| Payments (sats) | Blink BOLT11 — Session 5 |

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
| Pages | `share.refueler.io` — NOT YET DEPLOYED (Session 5) |
| Turnstile | Sitekey NOT YET CREATED (Session 5) |
| DNS | `share.refueler.io` CNAME → `refueler-share.rt-fc4.workers.dev` (Proxied) ✓ |

Worker secrets (all set ✓):
- `MINT_PRIVATE_KEY` — secp256k1 hex (32 bytes). Generated Session 4.
- `TURNSTILE_SECRET_KEY` — ⚠ NOT YET SET (Session 5)
- `SUPABASE_URL` → `https://tihgvdokeofnjxjkenmm.supabase.co` ✓
- `SUPABASE_SERVICE_KEY` → service_role JWT ✓
- `STRIPE_SECRET_KEY` → `sk_live_...Fyop` ✓
- `STRIPE_WEBHOOK_SECRET` → `whsec_bZBn7PX9IVxm1MMWvejujI0bvC8JjuqH` ✓

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
Destination ID: `we_1Ts8epGlctwiB9U3dXT8XBac`
Events: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`

---

## Locked architecture decisions

- **Free tier cap: 4 GB** per transfer
- **Worker URL: `https://refueler-share.rt-fc4.workers.dev`** — hardcoded in upgrade.html. Update index.html Session 5.
- BLAKE3 = chunk integrity (browser WASM). Server-side uses Web Crypto SHA-256 for verification.
  Security guarantee identical — client declares hash, Worker verifies bytes match.
- Cashu blind sigs = anonymous auth. Never conflate with BLAKE3.
- No external mint. No ecash-to-sats path. No Cashu monetary usage.
- AES-GCM session key lives in URL fragment only. Never in network requests. Never in logs.
- Browser memory only for credentials. Never localStorage. Never sessionStorage.
- Subscription model (monthly/yearly). Pay-per-transfer deferred to future.
- Stripe embedded Payment Element (not Checkout redirect) — card in upgrade.html.
- Lightning tab in upgrade.html is placeholder — Blink BOLT11 Session 5.
- NUT-07 melt fires after first chunk write. On Supabase failure: log and continue.
- Turnstile: fail-closed on any verification error.
- R2 manifest is authoritative transfer state. Supabase is ledger only.
- Chunk key format: `{uuid}/{0000}` (zero-padded 4 digits)
- Manifest key: `{uuid}/manifest.json`
- Direct R2 URL exposure: none. Worker proxies all R2 access.
- curl: always single-line, real key inlined, no backslash continuations.

---

## Tiers

| Tier | Cap | Expiry options |
|------|-----|---------------|
| Skint Tog (free) | **4 GB** | 5 days, no choice |
| Creative Premium (£12/mo or £120/yr) | 100 GB | 1 / 7 / 30 days |
| Production Max (£24/mo or £240/yr) | 250 GB | 1 / 7 / 30 / 90 days |
| Enterprise | Unlimited | Custom |

Yearly = 10 months price (2 months free).

---

## NUT protocol scope

| Session | NUTs in scope |
|---------|--------------|
| Sessions 2-4 (complete) | NUT-00 (blind sig), NUT-07 (melt), NUT-11 Mode 1 (passphrase gate) |
| Session 5 | NUT-04 (mint on payment — may simplify to subscription check) |
| Session 6+ | NUT-11 Mode 2 (keypair challenge-response, Production Max) |
| Prod Max Phase 2 | ML-KEM key wrapping (deferred) |

---

## Worker endpoints

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/credential/issue` | NUT-00 blind sig (free tier, Turnstile gate) |
| PUT | `/upload/{uuid}/{chunk}` | Chunked upload, credential verify |
| POST | `/auth/{uuid}` | NUT-11 Mode 1 passphrase → download token |
| GET | `/download/{uuid}/{chunk}` | R2 chunk proxy |
| POST | `/webhook/stripe` | Stripe subscription lifecycle |
| POST | `/subscription/checkout` | Create embedded checkout session |
| GET | `/subscription/status` | Returns tier by email |

---

## File map

```
refueler-share/
  README.md
  CLAUDE.md
  SESSIONS.md               ← updated Session 4
  Share-Master-Context.md   ← this file (v1.1)
  LICENSE                   ← Apache 2.0
  worker/
    wrangler.toml
    package.json            ← @noble/hashes@1.7.2, @noble/secp256k1@2.1.0
    package-lock.json
    src/
      index.js              ← 7 endpoints + CORS
      nut00.js              ← NUT-00 BDHKE + aliased exports
      nut11.js              ← NUT-11 Mode 1 helpers + download tokens
      blake3.js             ← Web Crypto SHA-256 (WASM replaced Session 4)
      turnstile.js          ← Turnstile verify (export: verifyTurnstileToken)
      manifest.js           ← R2 manifest helpers + TIER_CAPS
      stripe.js             ← Stripe webhook verify + checkout session
  frontend/
    index.html              ← upload UI (WORKER_URL needs updating Session 5)
    upgrade.html            ← tier cards + Payment Element (new Session 4)
  docs/
    r2-lifecycle.md         ← R2 lifecycle rules (not yet applied)
```

---

## Session 5 targets

1. **Turnstile** — create sitekey + secret in Cloudflare dashboard → `wrangler secret put TURNSTILE_SECRET_KEY` → replace placeholder in `index.html`
2. **Update `WORKER_URL`** in `frontend/index.html` → `https://refueler-share.rt-fc4.workers.dev`
3. **Cloudflare Pages deploy** — connect repo `frontend/` directory → `share.refueler.io`
4. **End-to-end smoke test** — upload a small file through `share.refueler.io`, verify download link works
5. **Lightning tab** — Blink BOLT11 invoice generation in `upgrade.html`
6. **Stripe Customer Portal** — enable in Stripe dashboard, wire up "Manage subscription" link
7. **R2 lifecycle rules** — apply from `docs/r2-lifecycle.md`
8. **Speed benchmark table** — A/B test protocol against SwissTransfer and PrivCloud

---

## Pre-commit checklist (Session 5)

- [ ] `wrangler secret put TURNSTILE_SECRET_KEY`
- [ ] Replace Turnstile sitekey placeholder in `frontend/index.html`
- [ ] Update `WORKER_URL` in `frontend/index.html` to `https://refueler-share.rt-fc4.workers.dev`
- [ ] Cloudflare Pages: connect repo, set build output to `frontend/`, custom domain `share.refueler.io`
- [ ] Apply R2 lifecycle rules: `docs/r2-lifecycle.md`
- [ ] End-to-end upload smoke test
- [ ] Commit all

---

*"Nothing stops this train."*
