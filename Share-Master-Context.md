# Share-Master-Context — refueler-share
> **Version:** 9.1 | **Last updated:** B8-Opus · 13 Sep 2026
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

**Tier rename complete Share-Brand-Opus-1:** Pro Bono (free). Citizen (paid, Registered rail, Stripe). Sovereign (paid, Bearer rail, Lightning). Chartered (commercial API/MCP). Product ID: `prod_Urre2e3PQgr5Uq`. Price IDs and lookup keys unchanged.
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
- `merkle_root` = ciphertext-chunk Merkle root. Worker-verifiable. Written to manifest at upload; reconstructed by Worker at download. Storage integrity only.
- `blake3PlaintextRoot` = plaintext root. Recipient-side only. Never in manifest. Never in Worker. Never in any receipt. Permanent ban.

**Merkle tree (locked B9-Opus):**
- RFC 6962 unbalanced, domain-separated (`0x00` leaf / `0x01` node), BLAKE3 node hash, big-endian leaf order. `tree_algo: "rfc6962-unbalanced-blake3-v1"`. `chunk_count` committed.
- Chunk hashes: R2 sidecar `{uuid}/hashes` (raw 32-byte concat per chunk). Never inline in manifest.
- Download sequence: `GET {uuid}/hashes` → reconstruct root → compare manifest `merkle_root` → verify-then-flush each chunk → 409 on any mismatch.

**Storage:** R2 binding `BUCKET`. KV binding `STATUS_KV`. Chunk key: `{uuid}/{0000}`. Manifest key: `{uuid}/manifest.json`. Hashes sidecar: `{uuid}/hashes`. `safeGetManifest()` enforces 64 KB ceiling.

**Frontend:**
- Five modules, all `type="module"`: `share.js` · `crypto.js` · `upload.js` · `download.js` · `timestamp.js`
- `refueler-share/frontend/` is canonical. Mirror: `refueler-io/src/share/assets/`. Sync: `bin/sync-share.sh`.
- DO NOT collapse back into a single file. DO NOT edit the mirror directly.

**CF for SaaS (SW1 · 8 Sep 2026):**
- Fallback origin: `fallback.share.refueler.io`. Custom hostname: `api.share.refueler.io`.
- hostname_id: `d1d04abe-854c-48a0-8afe-bca47dfb0c3b`. ssl_id: `a3bd125f-f48c-4226-9e7c-d26e77fbaa90`.
- API token: `refueler-share-saas` (Zone → SSL and Certificates → Edit, scoped to `refueler.io`).
- `wl_config.js` is the host-lookup module — add new client hostnames to `WL_CONFIGS` there.

**HMAC auth (SW block):**
- Three credentials: `rfs_live_{32b base58}` (identification) + `rfs_sign_{32b base58}` (request integrity) + `rfs_whsec_{32b base58}` (webhook signing, API tier only).
- HMAC-SHA256 over `method + path + timestamp + body_hash`. SIGN_DOMAIN_TAG = `refueler.webhook.v1.sign` — never revert.
- Test credentials use `rfs_test_` prefix — never `rfs_live_` or `rfs_sign_` in test files.
- Rotation: `POST /api/v1/keys/rotate` (24h grace). One keypair per commercial relationship.

**D-1 filename fix (Option B, locked SW-MCP-4):**
- Fragment grammar v1: `base64url(JSON.stringify({ v:1, k:"<AES key>", n:"<filename>", s:"<seal_nonce>" }))`.
- `X-File-Name: "encrypted-payload"` (constant placeholder) to Worker. Real filename in fragment only.
- **Pre-SW-MCP-4:** Worker sees filename in manifest. Scope trust claims accordingly.
- **Post-SW-MCP-4:** Worker sees neither filename nor passphrase.

---

## Known broken / do not retry

See `CLAUDE.md` §Known broken for the full authoritative list. Key items not duplicated in CLAUDE.md:

- DO NOT write quota write-back synchronously — fire-and-forget KV put
- DO NOT reset a cancelled account on lazy period rollover — cancellation gate runs before reset
- DO NOT use `blake3` npm package — `@noble/hashes/blake3.js` only
- DO NOT import `@noble/hashes/blake3` without `.js` extension
- DO NOT generate `description: ...` placeholder stubs in JS — syntax errors
- DO NOT present `index.js` edits without full repo path — `refueler-mcp/src/index.js` ≠ `refueler-share/worker/src/index.js`
- DO NOT claim "end-to-end file integrity" — chunk integrity only (BLAKE3 per ciphertext chunk)
- DO NOT run `npm publish` in a session — dry-run only; Rajesh publishes manually

---

## Current state

**B8-Opus ✓ complete (13 Sep 2026). Next: B8 build.**

| Block | Commit | Summary |
|-------|--------|---------|
| TG-block ✓ | `0e51385` | Destroy-after-download · tidal window · Execution Dock · owner DELETE. 432 tests. |
| TH-series ✓ | `45a4d3b3` | OTS relay · permanent-record UI · JS refactor (5 modules). |
| SW1–SW9 ✓ | `8b4b4a1` | CF for SaaS · HMAC auth · credential issuance · badge · webhooks · receipts · dashboard · sandbox · hostname health. 484 tests. |
| SW-MCP-1–6 ✓ | `713156a` (refueler-mcp) | MCP server scaffold → demo hardening. 228 tests. |
| SW-MCP-8 ✓ | pending commit | npm package distribution. Apache 2.0. Trust-boundary READMEs (refueler-mcp + refueler-share). |
| B9-Opus ✓ | — | Merkle/MMR/SMT/ZK design locked. `merkle-spec-v1.md` produced. BRIDGE v9.4. |

---

## Roadmap

| Order | Block / Session | Hetzner? | Notes |
|---|---|---|---|
| 1–10 | B1–SW block ✓ | ❌ | Complete. |
| 11 | SW-MCP block ✓ | ❌ | Complete. SW-MCP-7 anonymous tail gates on B7. |
| 12 | B8-Opus → B8 build — NUT-11 Mode 2 | ❌ | Pure cryptography on existing Worker. B8-Opus first. |
| — | **Hetzner commitment point** | ✅ | NB-2 provision. First new recurring cost. |
| 13 | NB-2 → NB-4 — node bootstrap | ✅ | Provision, test, declare live. |
| 14 | B7 Lightning (S74–S86+) | ✅ | Full Lightning block with node live. |
| 15 | SD-block — Silent Drop | ✅ | Sovereign (Bearer rail) + Lightning-only. Full Locke (B8) required. |
| 16 | Article pipeline | ✅ | Unlocks after NB-4. |
| 17 | B9 build (B9-1…B9-8) | — | Design locked B9-Opus. Build sessions in `merkle-spec-v1.md` §9. |
| 18 | B10+ | — | ML-KEM + NUT-22 + Verkle forward. |

---

## Brand terminology — locked Share-Brand-Opus-1 (11 Sep 2026)

| Tier | Internal key | Rail (user-facing) | Payment |
|------|-------------|-------------------|---------| 
| Pro Bono | `free` | — | Public good |
| Citizen | `paid_registered` | Registered | Stripe — GBP |
| Sovereign | `paid_bearer` | Bearer | Lightning — sats |
| Chartered | `chartered` | Registered or Bearer | Stripe / invoice, or Lightning |

**Code reality:** live tier strings: `free`/`creative`/`max` (Stripe axis) + `'api'` (Chartered). `TIERS.CHARTERED === 'api'` — wire rename deferred. `worker/src/tiers.js` is single source of truth for logic keys.

**Citizen and Sovereign are the same price and feature set.** The rail is a privacy choice, not a tier upgrade.

**Vocabulary (sealed):** Lodge/Lodged · Collect/Collection · Sealed/Under seal · Struck off · In camera · Enrolment · Chambers · Freehold/Leasehold · Conduit. Full rationale: `docs/Share-Brand-Terminology.md`.

---

## SW-Opus decisions — compact summary

- **SW-Opus-1:** Four-tier model. Rail model. Model B credit pool. API v1/v2/forward-commitment. MCP v1 tools. Sandbox. BRIDGE v8.3.
- **SW-Opus-2:** Rate card v1.0 (10/transfer, 100/GB, 20/permanent-record). 1 credit = 1 sat. Credit blocks 10k/50k/200k/custom. £99/mo identity-API. BRIDGE v8.4.
- **SW-Opus-3:** DPA mandatory by default. Four-surface disclosure wording. GDPR framing. BRIDGE v8.5.
- **SW4-Opus:** Webhook signing: Option B (stateless HMAC). `whsec_hash` removed. SIGN_DOMAIN_TAG = `refueler.webhook.v1.sign`. BRIDGE v8.8.
- **Share-MCP-Opus-2:** Capabilities endpoint locked (§7.1). Daily reference-rate KV locked. Monthly allocation + lazy reset locked. Personal API (£49/mo, 10k credits, `personal_api`, hard stop). D-1 filename fix: Option B, fragment grammar v1. Terminology: "credits" everywhere user-facing.
- **B9-Opus:** Merkle/MMR/SMT/ZK design locked. Full spec: `merkle-spec-v1.md`. Two-roots distinction permanent. RFC 6962 unbalanced BLAKE3 tree. Sidecar `{uuid}/hashes`. MLRO flag on due-diligence proof framing. BRIDGE v9.4.

---

- **B8-Opus:** NUT-11 Mode 2 (Locke) design locked. Full spec: `B8-spec-v1.md`. Deed→Locke HKDF derivation (scalar reject-sampled); Schnorr BIP-340 x-only verify; check order sig→BDHKE→double-spend; Locke KV challenge-response (SD3 primitive); `hashSecret()` unchanged/independent; CDK stays 0.17.2; builds direct in refueler-share (ecash-lab Mode 2 flag retired). BRIDGE v9.5.

*"Nothing stops this train."*
