# Share-Master-Context — refueler-share
> **Version:** 1.0 | **Last updated:** Session 2 · 11 July 2026
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
| Storage | Cloudflare R2 — `refueler-share-prod` / `refueler-share-dev` |
| Ledger | Supabase `tihgvdokeofnjxjkenmm` — `spent_tokens` only |
| Frontend | Single-file HTML5 — `frontend/index.html` |
| Crypto | AES-GCM (Web Crypto), BLAKE3 WASM, secp256k1 (@noble) |
| Payments (Session 3) | Stripe + Blink BOLT11 |

---

## Supabase — share-specific

Project: `tihgvdokeofnjxjkenmm` (same Supabase project as refueler-app — separate tables)

**Table: `spent_tokens`** (applied Session 2)
```
serial     TEXT PRIMARY KEY
melted_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
```
RLS enabled. No client policies. Worker service_role key only.  
This table is the double-spend prevention ledger. Nothing else.

---

## Cloudflare resources

| Resource | Name |
|----------|------|
| Worker | `refueler-share` |
| R2 prod bucket | `refueler-share-prod` |
| R2 dev bucket | `refueler-share-dev` (A/B speed tests) |
| Pages (Session 3) | `share.refueler.io` |
| Turnstile (free tier gate) | Sitekey in `frontend/index.html` placeholder |

Worker secrets (set via `wrangler secret put`):
- `MINT_PRIVATE_KEY` — secp256k1 hex (32 bytes). `openssl rand -hex 32`
- `TURNSTILE_SECRET_KEY`
- `SUPABASE_URL` → `https://tihgvdokeofnjxjkenmm.supabase.co`
- `SUPABASE_SERVICE_KEY` → service_role JWT

---

## Locked architecture decisions

- **Free tier cap: 4 GB** per transfer (not 6 GB — corrected Session 2)
- BLAKE3 = chunk indexing and integrity. Cashu blind sigs = anonymous auth. Never conflate.
- No external mint. No ecash-to-sats path. No Cashu monetary usage.
- AES-GCM session key lives in URL fragment only. Never in network requests. Never in logs.
  `history.replaceState` strips it from URL bar after link construction.
- Browser memory only for credentials. Never localStorage. Never sessionStorage.
- Cap enforcement: checked before any chunk processing on file selection.
- NUT-07 melt fires after first chunk write + manifest write. On Supabase failure:
  log and continue (NUT-00 verify will fail on replay — no double-spend risk).
- Turnstile: fail-closed on any verification error or network failure.
- R2 manifest is authoritative transfer state. Supabase is spent-token ledger only.
- Chunk key format: `{uuid}/{0000}` (zero-padded 4 digits)
- Manifest key: `{uuid}/manifest.json`
- Direct R2 URL exposure: none. Worker proxies all R2 access.
- `verify_jwt: false` not applicable here (Worker, not Edge Function) — but all endpoints
  perform explicit credential verification before any state mutation.
- curl: always single-line, real key inlined, no backslash continuations.

---

## Tiers (corrected and locked)

| Tier | Cap | Expiry options |
|------|-----|---------------|
| Skint Tog (free) | **4 GB** | 5 days, no choice, no extension |
| Creative Premium (£12/mo or £120/yr) | 100 GB | 1 / 7 / 30 days, user must choose |
| Production Max (£24/mo or £240/yr) | 250 GB | 1 / 7 / 30 / 90 days, user must choose |
| Enterprise | Unlimited | Custom |

Yearly = 10 months price (2 months free).

---

## NUT protocol scope

| Session | NUTs in scope |
|---------|--------------|
| Session 2 (complete) | NUT-00 (blind sig issuance), NUT-07 (token melt) |
| Session 3 | NUT-04 (mint on payment), NUT-11 (P2SH download gate) |
| Prod Max Phase 2 | ML-KEM key wrapping (deferred) |

---

## File map

```
refueler-share/
  README.md                 ← corrected Session 2
  CLAUDE.md                 ← repo DNA
  SESSIONS.md               ← session log
  Share-Master-Context.md   ← this file
  LICENSE                   ← Apache 2.0
  worker/
    wrangler.toml
    package.json
    src/
      index.js              ← main Worker (3 endpoints)
      nut00.js              ← NUT-00 BDHKE implementation
      blake3.js             ← BLAKE3 WASM integration
      turnstile.js          ← Turnstile verification
      manifest.js           ← R2 manifest helpers + TIER_CAPS
  frontend/
    index.html              ← single-file upload UI
  docs/
    r2-lifecycle.md         ← Wrangler commands for R2 lifecycle rules
```

---

Speed benchmarks (pre-Production Max): Replace directional figures with empirical CIT results. Run refueler-share-dev A/B test protocol against SwissTransfer and PrivCloud under identical conditions. No competitor publishes verified throughput figures — empirical CIT data is a first-mover differentiator for press and investor materials.

## Session 3 targets (carry-forward)

- NUT-11 P2SH download gating (Mode 1: pre-shared secret; Mode 2: keypair challenge-response)
- Contractor upload link flow (NUT-11 P2SH upload token, Option A)
- Payment integration (Stripe Checkout + Blink BOLT11 for paid tiers)
- `share.refueler.io` domain + Cloudflare Pages routing
- Dashboard for paid tiers (transfer history — UUID only, no AES key reconstruction)
- Speed benchmark table (A/B test — pre-Production Max launch): Replace directional figures with empirical CIT results. Run the refueler-share-dev test protocol against SwissTransfer and PrivCloud under identical conditions (same file sizes, same connection profiles). No competitor in this space publishes verified throughput numbers. Empirical data published as CIT (Cryptographic Integrity Throughput, verified GB/s) is a first-mover differentiator.
- "Info card technical copy displaced to a 'How it works' secondary block on the landing page."

---

## Pre-commit checklist (Session 2)

- [ ] `openssl rand -hex 32` → `wrangler secret put MINT_PRIVATE_KEY`
- [ ] Set `TURNSTILE_SECRET_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` via Wrangler
- [ ] Replace Turnstile sitekey placeholder in `frontend/index.html`
- [ ] `wrangler r2 bucket create refueler-share-prod`
- [ ] `wrangler r2 bucket create refueler-share-dev`
- [ ] Apply R2 lifecycle rules: `docs/r2-lifecycle.md`
- [ ] `cd worker && npm install && wrangler deploy`
- [ ] Update `WORKER_URL` in `frontend/index.html` with deployed URL
- [ ] Smoke test `/credential/issue` endpoint
- [ ] Commit all: `git add . && git commit -m "session-2: worker scaffold, frontend, migration"`

---

*"Nothing stops this train."*
