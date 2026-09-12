# Share-Master-Context — refueler-share
> **Version:** 8.0 | **Last updated:** B9-Opus · 12 Sep 2026
> Load alongside `CLAUDE.md` and `share-sessions.md` at every session start.

---

## Stack

| Layer | Technology |
|-------|-----------|
| Worker | Cloudflare Workers — `wrangler deploy` |
| Worker URL | `https://refueler-share.rt-fc4.workers.dev` |
| Storage | Cloudflare R2 — `refueler-share-prod` / `refueler-share-dev` |
| Ledger | Supabase `tihgvdokeofnjxjkenmm` — `spent_tokens`, `subscribers`, `double_spend_attempts` |
| Frontend | Eleventy 3.x — `src/` → `frontend/` (canonical `refueler-share/frontend/`, mirror `refueler-io/src/share/assets/`) · Local: `/Users/rajeshtaylor/Documents/refueler.io` |
| Subdomain | `refueler.io/share/` → `refueler-io.pages.dev` |
| Crypto | AES-GCM (Web Crypto), BLAKE3 WASM (browser local bundle + Worker WASM), secp256k1 (@noble v2) |
| Payments (fiat) | Stripe — live mode, GBP, embedded Payment Element |
| Payments (sats) | LNbits on Hetzner CAX21 (B7+) — `LNBITS_API_KEY` / `LNBITS_URL` |

---

## Supabase

Project: `tihgvdokeofnjxjkenmm`

| Table | Key columns | Notes |
|-------|-------------|-------|
| `spent_tokens` | `serial TEXT PK`, `melted_at TIMESTAMPTZ` | RLS deny-all |
| `subscribers` | `stripe_customer_id TEXT PK`, `email`, `tier`, `status`, `current_period_end`, `cancelled_at` | RLS deny-all · index on email |
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
| Pages | `refueler.io/share/` → `refueler-io.pages.dev` |
| Turnstile | Sitekey `0x4AAAAAAD0N7GlHlCRuWITr` · Managed widget (visible only) |

Worker secrets (all set): `MINT_PRIVATE_KEY`, `TURNSTILE_SECRET_KEY`, `SUPABASE_URL`,
`SUPABASE_SERVICE_KEY`, `STRIPE_SECRET_KEY` (sk_live_...ZehD),
`STRIPE_WEBHOOK_SECRET` (rotated 21 Jul), `ADMIN_KEY`,
`CF_ACCOUNT_ID` (fc4f3e5aeebe483677d14185daf544f5), `CF_AE_TOKEN` (Account Analytics Read).
`WEBHOOK_SIGNING_MASTER_KEY` (SW4a, stateless webhook signing master). Do not rotate without cause.

---

## Stripe — live mode

| Product | Price ID | Lookup key | Amount | Status |
|---------|----------|------------|--------|--------|
| Citizen monthly | `price_1Ts7vIGlctwiB9U3kb3NCLue` | `share-max-monthly` | £24/mo | ✅ Active |
| Citizen 3-month | `price_1TyzMLGlctwiB9U3cA31BOQc` | `share-max-3month` | £72/3mo | ✅ Active |
| Citizen yearly | `price_1TyzNaGlctwiB9U3T8uV4UIW` | `share-max-yearly` | £288/yr | ✅ Active |

**Tier rename complete Share-Brand-Opus-1:** Pro Bono (public good / free). Citizen (paid, Registered rail, Stripe). Sovereign (paid, Bearer rail, Lightning). Chartered (commercial API/MCP). Product ID: `prod_Urre2e3PQgr5Uq` — display name to update to Citizen (identity-rail paid). Price IDs and lookup keys unchanged.
**Chartered tier:** invoiced manually via Stripe invoice template. No subscription price object — off-repo.
**Personal API (£49/mo):** unlisted Stripe price, managed manually. Not on public pricing page.

Webhook: `https://refueler-share.rt-fc4.workers.dev/webhook/stripe` · `we_1Ts8epGlctwiB9U3dXT8XBac`
Portal: configured · redirect to `https://refueler.io/share/upgrade.html`
Events: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`

---

## Lightning infrastructure (B7)

**Provider: LNbits on Hetzner CAX21. Locked pre-Opus-2.** Blink dead. Voltage/Strike eliminated.

**Stack on Instance A (Share+Pass):** phoenixd → LNbits → cloudflared tunnel → Tor (.onion for LNbits admin + phoenixd transport).

**Phoenixd → LND trigger:** ≥£10k/mo Lightning receipts sustained 3 consecutive months AND named operator committed OR ACINQ discontinues phoenixd.

**Payment flow (B7):** Frontend → `POST /subscription/lightning` → LNbits BOLT11 → KV 25h TTL → QR → user pays → LNbits webhook → authenticated GET re-verify → Cashu credential → KV 10-min TTL → frontend polls credential endpoint. No Supabase row. No identity.

**Privacy model:** Lightning payer = payment hash + amount + tier only. Honest claim: "pseudonymous." DO NOT claim "anonymous."

**DO NOT add a Supabase row or email field to the Lightning credential path** — load-bearing for Silent Drop and anonymous API rail.

---

## Locked architecture decisions

**Crypto layers (never conflate):**
- BLAKE3 = chunk integrity. Browser: `frontend/blake3/`. Worker: `worker/blake3-wasm/` via `blake3_worker.js`. 400 on mismatch.
- Cashu = anonymous auth (NUT-00/07/11). No monetary usage. No external mint.
- Passphrase hash = SHA-256 only. Stored as `p2sh_secret_hash` in manifest.
- AES-GCM session key lives in URL fragment only — never in requests, never in logs.
- AAD per chunk: 4-byte big-endian uint32 via `DataView.setUint32(0, i, false)`.

**Two roots, never conflated (B9-Opus · 12 Sep 2026):**
- `merkle_root` = ciphertext-chunk Merkle root. Worker-verifiable. Written to manifest at upload (client-authoritative); reconstructed by Worker at download (verification). Storage integrity only.
- `blake3PlaintextRoot` = plaintext root. Recipient-side only. Never in manifest. Never in Worker. Never in any receipt. Permanent ban.

**Merkle tree (locked B9-Opus):**
- RFC 6962 unbalanced, domain-separated (`0x00` leaf / `0x01` node), BLAKE3 node hash, big-endian leaf order. `tree_algo: "rfc6962-unbalanced-blake3-v1"`. `chunk_count` committed.
- Chunk hashes: R2 sidecar `{uuid}/hashes` (raw 32-byte concat per chunk). Never inline in manifest.
- Download sequence: `GET {uuid}/hashes` → reconstruct root → compare manifest `merkle_root` → verify-then-flush each chunk → 409 on any mismatch.
- `{uuid}/hashes` sidecar written at manifest-write (B9-2). Download-time verification (B9-3). Receipt upgrade (B9-4, post-B9-3 only).

**Storage:** R2 binding `BUCKET`. KV binding `STATUS_KV`. Chunk key: `{uuid}/{0000}`. Manifest key: `{uuid}/manifest.json`. Hashes sidecar: `{uuid}/hashes`. `safeGetManifest()` enforces 64 KB ceiling — do not inline chunk hashes in manifest.

**Frontend:**
- Credentials in browser memory only — never localStorage, never sessionStorage.
- `frontend/blake3/`, `frontend/fflate.min.js`, `frontend/qr-creator.min.js` — self-hosted, force-committed.
- Folder upload via streaming `fflate.Zip` (S53/RU0). Never `fflate.zip()` (buffered — OOM).
- `share.js` must remain `type="module"`.
- Theme: `rs-theme` cookie scoped to `.refueler.io` (30-day, SameSite=Lax). `dataset.theme` attribute only. `window.toggleTheme` global for nav pill.

**Ops:**
- Rate limits (STATUS_KV): `credential_issue` 10/60s · `upload` 120/60s · `auth` 5/60s · `log_error` 20/60s · `download` 300/60s.
- `/log/error`: always 200, fire-and-forget AE write, UUID truncated 8 chars, detail max 200 chars.
- Wrangler 4.113.0.

**Regulatory (UK):**
- Share mint issues access credentials only — capability tokens, not monetary instruments. FCA authorisation not required.
- UK GDPR Article 33: 72hr ICO notification for personal data breaches. Free tier: no identity data held.

---

## Known broken / do not retry

| Pattern | Correct approach |
|---------|-----------------|
| `checkout/sessions ui_mode:embedded` | Direct Subscription + PaymentIntent expansion |
| `new Uint8Array([i])` for AES-GCM AAD | `DataView.setUint32(0, i, false)` into 4-byte buffer |
| AE SQL `doubles[N]` / `blob[N]` syntax | Named columns: `double1`, `blob1` etc. |
| AE SQL from Worker binding | External REST only, proxy via `/admin/ae-metrics` |
| KV counter for double-spend | Supabase table only (race condition) |
| `await env.AE.writeDataPoint()` | Synchronous, fire-and-forget |
| Customer Portal without active subscription | Stripe returns `resource_missing` |
| `if (rl)` to check rate limit | Use `if (rl.limited)` — `checkRateLimit` returns object |
| `getManifest()` direct from handlers | Use `safeGetManifest()` — enforces 64 KB ceiling |
| Generate UUID client-side | Worker generates UUID at `/credential/issue` since S42c |
| Turnstile nonce TTL = 7 days | Cloudflare expires tokens ~300s; use 600s KV TTL |
| `fflate.zip()` (buffered) for folder uploads | `fflate.Zip` streaming API only — OOM on large folders |
| `ZipDeflate` with `{ level: 0 }` for already-compressed files | `fflate.ZipPassThrough` (STORED, method=0) — Archive Utility compatible |
| Multiple concurrent `arrayBuffer()` calls in zip loop | One file at a time; yield via `setTimeout(0)` |
| Hardcode 900s TTL for download tokens | Pass `manifest.expiry_timestamp` |
| `ProjectivePoint.subtract()` in noble v2 | Use `.add(point.negate())` |
| `localStorage` / `rfTheme` for theme in `head.njk` | `rs-theme` cookie, `dataset.theme` only |
| `classList.add('carbon-mode')` in theme script | `document.documentElement.dataset.theme = 'carbon'` |
| Template changes in `refueler-share/src/` | `*.njk` → `refueler-io/src/share/` · CSS/JS → `refueler-share/frontend/` + `bin/sync-share.sh` |
| Edit files in `refueler.io/src/share/assets/` | GENERATED — edit in `refueler-share/frontend/` then sync |
| Cloudflare Queues / Durable Objects / D1 for webhooks | `ctx.waitUntil` + KV dead-letter only |
| Store `whsec_hash` in `wh_config_` KV | Field removed SW4-patch — Option B derives, never stores |
| Derive `rfs_whsec_` without `created_at` in HMAC message | `created_at` is required rotation salt |
| Re-sign dead-letter retries with original `t` | Always re-sign with fresh current timestamp at retry |
| Begin SW5 build without SW5-Opus session | SW5-Opus must decide receipt verifier audience (symmetric HMAC vs asymmetric Ed25519) first |
| Sub-keys per API user | One keypair per commercial relationship + `transfer_ref` attribution |
| Require Turnstile on resume credential path | `resume: true` + `resume_uuid` + R2 HEAD check on chunk 0000 |
| HTTP 409 on resume chunk PUT as generic 4xx | 409 = transfer already complete — clear IDB + "already completed" message + New Upload CTA |
| Add email / Supabase row to Lightning or anonymous-rail API credential path | Load-bearing for Silent Drop + anonymous API rail — invariant, locked |
| Reuse upload credential UUID as SD cargo UUID | Generate separate cargo UUID at Lighthouse layer |
| Return 402 at `GET /inbox/{token}` intake check | Defer quota errors to upload attempt — prevents storage side-channel |
| Math.random() in Deed keypair generation | `crypto.getRandomValues()` only |
| Claim "anonymous" for Stripe-rail Silent Drop | Stripe rail = private (not anonymous). Lightning rail = anonymous. |
| Local refueler.io path wrong | Local repo is `/Users/rajeshtaylor/Documents/refueler.io` — not `refueler-io` |
| Surgical sed/python patch to `index.js` | Always produce a complete replacement file. Run `node --check worker/src/index.js` before presenting. |
| MCP server as Refueler-hosted plaintext endpoint | MCP runs in agent's trust domain, handles ciphertext only — invariant |
| Claim "proof of delivery" for transfer receipts | Unprovable. Acceptance receipts + collection receipts only. Never "delivery". |
| `X-File-Name` to Worker with real filename | Send constant placeholder `"encrypted-payload"` — real filename in URL fragment only (D-1 fix, SW-MCP-4) |
| "sats" / "ecash" / "tokens" in user-facing copy | Always "credits" / "Share credits" — invariant from Share-MCP-Opus-2 |
| `btoa()` on strings with chars > U+00FF in Workers | TextEncoder → binary string → `btoa` |
| `workers.dev` URL for smoke tests | Routes to Pages project, not Worker. Always use `api.share.refueler.io`. |
| SIGN_DOMAIN_TAG as `refueler.webhook.v1` | Must be `refueler.webhook.v1.sign` — never revert |
| Use tier display names (Citizen/Sovereign/Chartered) as logic keys | Internal enum keys only: `free` · `paid_registered` · `paid_bearer` · Chartered wire value `'api'` (not `'chartered'`) — display names live in a map, never in gating logic. Gate via `worker/src/tiers.js` helpers only. |
| Find-replace "Sovereign tier only" → "Sovereign" after brand rename | "Sovereign tier only" on perm-record/availability-window = paid-vs-free gate → must read "Citizen and Sovereign" / "paid tiers" |
| Rename Stripe price IDs or lookup keys for tier rename | Display names only — price IDs and lookup keys (share-max-monthly etc.) are immutable |
| Duplicate-last-leaf padding in Merkle tree | RFC 6962 unbalanced promotion (last odd node promotes unchanged). Duplicate-last = CVE-2012-2459. `chunk_count` committed to close residual ambiguity. |
| Undomain-separated Merkle node hash | `0x00` prefix for leaves, `0x01` prefix for internal nodes — leaf/node ambiguity attack without these |
| Inline chunk-hash array in manifest | Sidecar R2 object `{uuid}/hashes` only — manifest ceiling is 64 KB (`safeGetManifest()`) |
| `verified: true` receipt backed by spot-check | Full root reconstruction + full inline body verification only. Spot-check is a background canary, never touches a receipt. |
| "Smart contract" for MMR root anchoring | Say "Bitcoin-anchored" or "public timestamping layer" — OTS relay, not a smart contract |
| SMT replacing Supabase double-spend guard | SMT = public verifiability layer (periodic, complementary). Supabase = live race-safe arbiter. Never replace. |
| Claim "travel-rule compliance" for due-diligence proof | Record-keeping evidence (FCA SYSC 6.3 / MLR reg. 40). MLRO to confirm framing before marketing copy. |
| `blake3PlaintextRoot` in any receipt or Worker | Permanently barred. Receipt `merkle_root` post-B9-3 = ciphertext root only. |

---

## Current state

**B9-Opus ✓ complete (12 Sep 2026). Design lock done. Next: SW-MCP-8 (npm distribution).**

| Block | Commit | Summary |
|-------|--------|---------|
| TG-block ✓ | `0e51385` | Destroy-after-download · tidal window · Execution Dock · owner DELETE. 432 tests. |
| TH-series ✓ | `45a4d3b3` | OTS relay · permanent-record UI · JS refactor (5 modules). |
| SW1–SW9 ✓ | `8b4b4a1` | CF for SaaS · HMAC auth · credential issuance · badge · webhooks · receipts · dashboard · sandbox · hostname health · utils.js extraction · trailing full-stop normalisation · lightning.js LNbits wired. 484 tests. |
| SW-MCP-Opus-2 ✓ | — | MCP spec v2 locked. All O-6…O-11 resolved. D-1 filename fix locked (Option B). Personal API path locked. Capabilities endpoint contract locked. |
| SW-MCP-1–6 ✓ | `713156a` (refueler-mcp) | MCP server scaffold → demo hardening. 228 tests. |
| B9-Opus ✓ | — | Merkle/MMR/SMT/ZK design locked. `merkle-spec-v1.md` produced (repo root). BRIDGE v9.4. |

---

## Roadmap

| Order | Block / Session | Hetzner? | Notes |
|---|---|---|---|
| 1–8 | B1–TH-series ✓ | ❌ | Complete. |
| 9 | SW block ✓ | ❌ | Complete. Commit `8b4b4a1`. |
| 10 | SW-MCP block | ❌ | W1+W2 ✓. SW-MCP-1–6 ✓. **Next: SW-MCP-8** (npm, Apache 2.0). SW-MCP-7 gates on B7. |
| 11 | B8-Opus → B8 build — NUT-11 Mode 2 | ❌ | Pure cryptography on existing Worker. B8-Opus first. |
| — | **Hetzner commitment point** | ✅ | NB-2 provision. First new recurring cost. |
| 12 | NB-2 → NB-4 — node bootstrap | ✅ | Provision, test, declare live. |
| 13 | B7 Lightning (S74–S86+) | ✅ | Full Lightning block with node live. |
| 14 | SD-block — Silent Drop | ✅ | Sovereign (Bearer rail) + Lightning-only. Full Locke (B8) required. |
| 15 | Article pipeline | ✅ | Unlocks after NB-4. |
| 16 | B9 build (B9-1…B9-8) | — | Design locked B9-Opus · 12 Sep 2026. Build sessions sequenced in `merkle-spec-v1.md` §9. |
| 17 | B10+ | — | ML-KEM + NUT-22 + Verkle forward. |

**SD-block design decisions (locked SW-MCP-W2 session · 12 Sep 2026):**
- Per-client Quay link is the canonical multi-client attribution model.
- Target markets confirmed: Legal, health (PHI), finance/accountancy. Chartered invoiceable path.
- Anonymous API/MCP rail target: Bitcoin-native orgs, own infra, Lightning payment.
- Notification model: webhook for API/MCP clients; polling + badge for Sovereign web.
- Harbourmaster design pass load-bearing before SD4.
- SD-Opus-pre session required before SD1 (Quay data model, reference field UX, notification architecture).

---

## Brand terminology — locked Share-Brand-Opus-1 (11 Sep 2026)

| Tier | Internal key | Rail (user-facing) | Payment |
|------|-------------|-------------------|---------| 
| Pro Bono | `free` | — | Public good |
| Citizen | `paid_registered` | Registered | Stripe — GBP |
| Sovereign | `paid_bearer` | Bearer | Lightning — sats |
| Chartered | `chartered` | Registered or Bearer | Stripe / invoice, or Lightning |

**Code reality (Share-1, 11 Sep 2026):** live tier strings: `free`/`creative`/`max` (Stripe axis) + `'api'` (Chartered). `citizen`/`sovereign` appear in no source module. `TIERS.CHARTERED === 'api'` — wire rename deferred. `worker/src/tiers.js` is single source of truth for logic keys.

**Citizen and Sovereign are the same price and feature set.** The rail is a privacy choice, not a tier upgrade. Never present as a value ladder.

**Vocabulary (sealed):** Lodge/Lodged · Collect/Collection · Sealed/Under seal · Struck off · In camera · Enrolment · Chambers · Freehold/Leasehold · Conduit. Full rationale: `docs/Share-Brand-Terminology.md`.

---

## SW-Opus decisions — compact summary (locked 7–10 Sep 2026)

Full decision log: BRIDGE §SW-Opus-1/2/3/4 decisions and `refueler-mcp-spec-v2.md`.

- **SW-Opus-1:** Four-tier model. Rail model. Model B credit pool. API v1/v2/forward-commitment features. MCP v1 tools. Sandbox. BRIDGE v8.3.
- **SW-Opus-2:** Rate card v1.0 (10/transfer, 100/GB, 20/permanent-record). 1 credit = 1 sat. Credit blocks 10k/50k/200k/custom. £99/mo identity-API. Citizen Teams (£49/£89/£169, UI-only). GTM reframe. BRIDGE v8.4.
- **SW-Opus-3:** DPA mandatory by default. AM = founder first 3–6 months. Four-surface disclosure wording. GDPR framing. BRIDGE v8.5.
- **SW4-Opus:** Webhook signing: Option B (stateless HMAC). `whsec_hash` removed. Dead-letter schema. SIGN_DOMAIN_TAG = `refueler.webhook.v1.sign`. BRIDGE v8.8.
- **Share-MCP-Opus-2:** Capabilities endpoint locked (§7.1). Daily reference-rate KV locked. Monthly allocation + lazy reset locked. Personal API (£49/mo, 10k credits, `personal_api`, hard stop) locked. D-1 filename fix: Option B, fragment grammar v1. Citizen/Sovereign Teams UI-only. npm distribution, Apache 2.0. Terminology: "credits" everywhere user-facing.
- **B9-Opus:** Merkle/MMR/SMT/ZK design locked. Full spec: `merkle-spec-v1.md`. Two-roots distinction permanent. RFC 6962 unbalanced BLAKE3 tree. Sidecar `{uuid}/hashes`. Download verify-then-flush. Due-diligence proof = SYSC 6.3 / MLR reg. 40 (not travel rule). MLRO flag. BRIDGE v9.4.

---

**SW buffer pool:** SW2c · SW5c — **both retired** (no carry-forward work).

*"Nothing stops this train."*
