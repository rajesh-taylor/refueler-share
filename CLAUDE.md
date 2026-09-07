# CLAUDE.md — refueler-share
> **Version:** 2.2 | **Initialised:** CC-64 · 8 July 2026 | **Updated:** SW-Opus-1 · 7 Sep 2026
> Load alongside `share-sessions.md` at the start of every session on this repo.
> For platform-wide context (brand, Supabase, Numo), load the main `claude.md` + `Refueler_MasterContext_CC64.md`.

---

## What this repo is

`refueler-share` is an anonymous, encrypted peer-to-peer file transfer system.
Files are chunked, BLAKE3-hashed for integrity, stored on Cloudflare R2, and access is gated by Cashu blind-signature tokens settled via Lightning (BOLT11).

**Fastest path to market.** Likely R&D funding source for the wider Refueler ecosystem.

**Local path:** `/Users/rajeshtaylor/Documents/refueler-share/`
**GitHub:** `rajesh-taylor/refueler-share` (public)
**Licence:** Apache 2.0

---

## Architectural lock

| Layer | Technology | Role |
|---|---|---|
| Chunk indexing & verification | BLAKE3 | Internal only — content addressing, integrity checks |
| Existence proof | SHA-256 (OTS) | Client-side only — Bitcoin-anchored permanent record. Never touches Worker. |
| Anonymous authentication | Cashu blind signatures | Access tokens, payment gate |
| Storage | Cloudflare R2 | Egress-free object store |
| Payment | LNbits on Hetzner CAX21 (B7+, all Refueler projects) | Upload capacity settled via Lightning |

**Three hashes, three jobs — never conflate:**
- **BLAKE3** → chunk integrity (internal, Worker + browser)
- **SHA-256 (OTS)** → existence proof, Bitcoin-anchored (client-side only — never in Worker)
- **Cashu** → anonymous auth (no hashing role)

BLAKE3 is not the auth layer. Cashu is not the hashing layer. SHA-256/OTS is not the integrity layer and never enters the Worker.

**Frontend module structure (post Share-JS-Refactor · 6 Sep 2026):**
- `frontend/share.js` — entry point, DOM refs, shared state, mode detection
- `frontend/crypto.js` — AES-GCM, BLAKE3, NUT-00, SHA-256, helpers, config constants
- `frontend/upload.js` — upload state machine, IDB resume, folder handling, zip, Turnstile
- `frontend/download.js` — download state machine, OTS offer, TG receiver helpers
- `frontend/timestamp.js` — OTS pipeline (born TH-1, always separate)

All five are `type="module"`. Do not collapse back into a single file.

---

## Locked decisions

- **Lightning provider: LNbits on Hetzner CAX21. Locked pre-Opus-2 · 28 Aug 2026.** Applies to all Refueler projects (Share, refueler.io POS, Relay, Refill). Blink discontinued custodial accounts UK Aug 31 2026 — dead as a provider. Voltage eliminated (US company, invoice metadata visible to third party, incompatible with compulsion-resistance framing). Strike eliminated (custodial, FCA-dependent). No other candidates.
- **Boltz submarine swaps: dead.** Boltz suspended all swap operations Aug 3 2026. Liquidation destination is a Silent Payments address, which receives on-chain BTC directly. No swap service required.
- **Node bootstrap is B7 pre-work, not B9.** No dark provisioning — instance goes live only when runbook is ready and test suite passes.
- No custodial wallet. Payment settled via self-hosted LNbits.
- Cloudflare Worker receives and stores encrypted noise — it cannot read file content.
- Content-Type header validated against execution-capable denylist at upload boundary. Header check reflects declared intent only. MIME type never stored.
- Pricing/unit economics are never published in this repo (stripped CC-64).
- Apache 2.0 licence — patent grant clause protects the novel BLAKE3 + Cashu combination.
- DO NOT edit inline CSS/JS in `src/index.njk` or `src/upgrade.njk` — edit `frontend/share.css`, `frontend/crypto.js`, `frontend/upload.js`, `frontend/download.js`, `frontend/timestamp.js` only.
- DO NOT put `share.js` as a regular script — must remain `type="module"`.
- **Sovereign storage cap: 100 GB. Locked TH-Opus-1.**
- **API tier storage cap: 250 GB + pay-per-GB overage (invoiced). Locked SW-Opus-1.**
- **Permanent record (Tower Hill) — Worker is a blind byte-relay only.** No OTS library in Worker. All OTS logic is client-side. Worker relay endpoints forward opaque bytes to calendar servers. The Worker sees a nonced 32-byte SHA-256 digest only — never the plaintext, never the file.
- **`seal_nonce` lives in URL fragment only** — never transmitted to Worker, never stored in manifest.
- **`date-seal.ots.enc` is load-bearing on all deletion paths** — expiry, destroy-after-download, Execution Dock grace sweep, owner delete. Never omit.

**Tier model (locked SW-Opus-1 · 7 Sep 2026):**
- **Three tiers: Citizen / Sovereign / API.** Business and Enterprise demolished entirely.
- **Sovereign** ships in two SKUs: single-seat and Teams (N-seat, shared pool, one bill, UI-only). Sovereign Teams sizing → SW-Opus-2.
- **API ⊃ UI** (one-directional): an API key holder may also use the web interface. **Sovereign ⊅ API**: a Sovereign subscriber never gets API access. Price-enforced — API sits clearly above Sovereign.
- **API tier is invoiceable** — preserves the PO/invoice path for firms that cannot pay by card or Lightning.
- **The rail model extends to the API tier.** Identity rail (Stripe/invoice) and anonymous rail (Lightning/prepaid sats) are mutually exclusive per credential relationship.
  - Identity rail: recoverable credentials, invoice, DPA path, accounts-payable-friendly. No identity-free features (no anonymous Silent Drop provisioning, no anonymous agent inboxes).
  - Anonymous rail: unlocks Silent Drop provisioning and anonymous machine-to-machine primitives. No recovery beyond the Deed, no invoice — an invoice is an identity artefact.
  - A single commercial relationship cannot straddle both rails. Physics, not policy.
- **Rail is declared, not inferred from payment.** The client's principal declares the rail at onboarding; the permitted payment method follows. Payment habit can never silently reconfigure the product.
- **Mandatory pre-payment disclosure of both irreversibles** (aimed at the principal, before AP handoff): (1) identity rail buys recovery and an invoice but forecloses identity-free features; (2) anonymous rail buys identity-free features but there is no recovery — lose the Deed and the firm loses the account. Prepaid balance loss on the anonymous rail must be named explicitly — not just account access. This disclosure appears in four places: user agreement, initial call/meeting (Rajesh/AM), follow-up email, and website.
- **DO NOT add a Supabase row or email field to the anonymous-rail API credential path** — same invariant as the Lightning consumer path. Load-bearing for the anonymous rail's identity promises.

**Pricing model (locked SW-Opus-1 · 7 Sep 2026):**
- **Model B (platform credit pool).** Model A (per-product metering) and Model C (flat subscription) rejected — neither survives the anonymous rail.
- **Two substrates, one rate card:**
  - Identity rail: server-held recovering ledger, auditable, invoiceable, optional itemised view.
  - Anonymous rail: client-held bearer Cashu credit tokens (blind-signed, unlinkable, non-recoverable). The "balance" is a stack of ecash, not a server record.
- **Rate card versioned** (v1.0, v1.1…); maps action → sat cost per product. A product's cost rising → new rate-card version for that product's actions only; credit value unchanged.
- **Term protection is an identity-rail feature.** Annual prepay locked at purchase-version for 12 months; monthly gets 30 days' notice. Anonymous rail transacts at the current rate card always — no lock. (The rail forgets you, including your discount. Consistent with "no recovery".)
- Keyset-versioned rate-lock for anonymous rail: noted as optional SW-Opus-2 extension, not recommended for v1.
- Unit economics, specific sat figures, credit block sizes, GBP-denomination boundary for identity-rail firms, and the BTC/GBP volatility treasury question → SW-Opus-2.

**API / white-label locked decisions (AP-2/AP-3a + SW-Opus-1 · 7 Sep 2026):**
- HMAC signing: every API request signed with HMAC-SHA256 over `method + path + timestamp + body_hash`.
- Three credentials per commercial relationship: `rfs_live_{32b base58}` (identification) + `rfs_sign_{32b base58}` (request integrity) + `rfs_whsec_{32b base58}` (webhook signing, API tier only).
- Test/sandbox credentials use `rfs_test_` prefix — never `rfs_live_` or `rfs_sign_` in test files. GitHub scanner pattern-matches these prefixes.
- One API keypair per commercial relationship. No sub-keys. Rotation via `POST /api/v1/keys/rotate` (24h grace window). Multi-user = shared firm key + `transfer_ref` attribution + dashboard seats.
- Webhooks are notification, never control flow. Credential issuance and transfer completion proceed identically whether the client webhook endpoint is up or down.
- DO NOT use Cloudflare Queues, Durable Objects, or D1 for webhook delivery or any other purpose. `ctx.waitUntil` + KV dead-letter only.
- Badge links to `refueler.io/share/`.
- API tier invoiced manually via Stripe invoice template. No subscription price object for API tier — invoice template only, managed manually in Stripe dashboard, off-repo.
- `X-Email` header dropped from upload path entirely.
- Never edit `frontend/upgrade.html` directly — Eleventy overwrites it from `src/upgrade.njk` on every build.
- `refueler-io/src/share/index.njk` must have `permalink: /share/index.html` — never `/index.html`.
- `refueler-io/src/share/index.njk` CSS href must be `/share/assets/share.css` — never `/share.css`. Never produce index.njk as a download — always edit via sed directly on `refueler-io/src/share/index.njk`.

**API feature gates (locked SW-Opus-1 · 7 Sep 2026):**
- **v1 (buildable on current stack, ships in SW block):** capability discovery (`GET /api/v1/capabilities`), OTS-confirmation webhook, acceptance receipts + collection receipts. "Proof of delivery" retired as a phrase — unprovable, never claim it.
- **v2 (each with explicit gate):** Silent Drop provisioning via API (gate: SD-block shipped); agent-to-agent transfers (gate: SD provisioning live); verifiable agent identity NUT-11 Mode 2 (gate: B8, `bind_pubkey` field reserved in voucher now); batch credential issuance (gate: Pass API Q4); composable receipts (v1 if free off credit-token work, else v2).
- **Flagship forward commitment (document, do not build, do not fake):** policy-encoded transfers via the Nutroot three-product flow (gates: Nutroot merge + B8 + Pass + B12). There is no honest Worker-side version — the Worker never holds keys. Transfer chaining: noted research direction, not committed.
- **MCP v1 tools (build when API ships):** `refueler_capabilities`, `refueler_send_file`, `refueler_check_transfer`, `refueler_quote`. Namespace and contracts for remaining tools locked; each tool ships the day its backing product comes online.
- **MCP architectural constraint (invariant):** the MCP server runs in the agent's trust domain and handles ciphertext only. Never a Refueler-hosted plaintext endpoint — that recreates a readable server and breaks the core privacy claim.
- **API whitepaper naming for MCP tools** (`refueler_capabilities`, `refueler_quote`/`refueler_balance` atom descriptors): logged for vocabulary track. Not urgent.
- **BOLT12/MCP agent payment: B9+ forward commitment, phoenixd-native.** SW constraints: credit-issuance contract accepts arbitrary-amount pay-then-mint (not blocks-only); MCP envelope can carry `payment_required` + offer. Documented, not built.
- **Sandbox:** credential-limited, no time cap. Model-B test-credits, both rails walkable with real HMAC and `rfs_test_` prefix. Non-anonymous by design (observable for debugging) — "do not send real cargo to the sandbox" stated plainly in the sandbox itself.

**BLAKE3 server-side integrity — VERIFIED S34, AUDITED S42e:**
Server verifies every chunk via BLAKE3 WASM (`worker/blake3-wasm/`), imported statically via
`blake3_worker.js`. 400 on hash mismatch. Full Merkle root verification (assembled file vs BLAKE3 tree root)
remains unimplemented — do not claim end-to-end file integrity until B9 audit.

**Integrity/audit marketing claims — current ruling (S42e + TH-series):**
- ✅ **Safe to assert:** Server-side BLAKE3 chunk integrity. Double-spend detection via Supabase ledger. Rate limiting on all public endpoints. UUID-bound credential issuance.
- ✅ **Safe to assert (TH-series+):** Permanent record (Bitcoin-anchored existence proof) for Sovereign+ transfers where sender opts in. Honest scope: proves bytes existed on or before a block date. Does not prove authorship, truth, or delivery.
- 🔒 **Still blocked:** Full Merkle tree verification. NUT-11 Mode 2 (keypair auth). "Audit-certified" or "security-audited". ML-KEM key wrapping. Any "end-to-end" integrity claim without the Merkle qualifier. Journalist/source-protection copy (gate: SD shipped + VPN scope stated).
- 📅 **Blocked items resolve:** B8 (NUT-11 Mode 2) → B9 (whitepaper + Merkle) → B10 (ML-KEM).

---

## Session queue

See `share-sessions.md` for log. Full roadmap lives in `Share-Master-Context.md` §Roadmap.
Session count is a guide not a constraint — split early, never overload. Planning sessions uncounted.

**TH-block ✓ complete (6 Sep 2026):**
- TH-Opus-1 ✓ — Tower Hill / Permanent Record scoped
- TH-Opus-2 ✓ — Legend price locked (£50/mo · £600/yr starting price). Cross-product entitlement architecture locked. Legend native verifier locked. Pass timestamping pattern locked. BRIDGE v8.0.
- TH-1 ✓ — Worker OTS relay, `POST /timestamp/submit`, `date-seal.ots.enc` on all deletion paths. Deployed `a71f12fe`.
- TH-2 ✓ — Permanent-record toggle UI, `seal_nonce`, `blake3PlaintextRoot`, `runPermanentRecord()`, download OTS offer, `GET /timestamp/seal/:uuid`. Deployed `53e3c7fb`.
- Share-JS-Refactor ✓ — `share.js` split into `crypto.js` / `upload.js` / `download.js` / entry `share.js`. Deployed `45a4d3b3`. 324 tests passing.

**SW-Opus-1 ✓ complete (7 Sep 2026)** — three-tier model locked, rail model extended to API tier, Model B credit pool, API v1 feature gates, MCP v1 tool list, BOLT12 commitment, sandbox spec. BRIDGE v8.3.
**SW-Opus-2 ✓ complete (7 Sep 2026)** — Rate card v1.0 locked. GBP invoicing policy locked. Credit blocks locked. Margin model locked (identity-API: £99/mo access fee + metered). Treasury policy locked (hold sats, pay GBP from GBP, sweep above ops reserve only). Sovereign Teams structure locked (shared 100 GB pool, three bands £49/£89/£169, cross-product Opus in refueler.io project before build). GTM reframe locked (HNW + accountant, warm-intro only, closed-door positioning). Rate-card notification wording locked (both rails). Rate-card governance: first review at £100k BTC 30-day trailing average. BRIDGE v8.4.

**Next: SW-Opus-3** — identity-API access-fee detail, then SW build block (SW1–SW9).

Locked block sequence: `NB-1 → S89/S90 → snag sweeps → [S88 ✓] → TG-block ✓ → TH-series ✓ → SW-Opus-1 ✓ → SW-Opus-2 ✓ → SW-Opus-3 → SW → B8 → [Hetzner] → NB-2–NB-4 → B7 → SD-block → articles → B9 → B10+`.

Session numbering convention (B7 onwards): single-scope sessions use plain numbers (e.g. S78).
Sessions split by complexity use lettered suffixes (e.g. S73, S73a, S73b). Plain number is always
the first session of a group — never skipped. See Share-Master-Context.md §B7 notes.

---

## Session hygiene — mandatory

**After every `git commit`, always `git push`.** Commits that stay local mean Cloudflare Pages
never deploys. Combine into one command:

```
git commit -m "message" && git push
```

Rajesh consistently forgets the push step. Claude must always include `&& git push` in the
commit command at session close, without being asked.

---

## Context file hygiene — mandatory at every B-close session

Every block-close session must include a trim pass on both context files before the git commit.
This is not optional.

**`share-sessions.md`:**
- Sessions more than two blocks old: convert full narrative entries to compact one-row table format
  (session number · commit · one-line summary). Do-not-retry blocks are permanent — never trim.
- Target: under 500 lines at all times.

**`Share-Master-Context.md`:**
- §Current state table: drop rows older than two blocks. Block summaries in §Roadmap carry the history.
- §Known broken / do not retry: remove entries that duplicate `CLAUDE.md` locked decisions.
- §B-n snag list: remove fully resolved items. Carried items only.
- Target: under 350 lines at all times.

**Applies to:** SW9 (SW) · then B8, B9, B10, B11, B12 close sessions.
Also apply at any session where either file exceeds its target line count mid-block.

---

## Deferred experiments

- **refueler-ecash-lab** — separate repo for NUT-11 Mode 2 and ML-KEM key wrapping
  experimentation before wiring into production. Flagged S20. Scope decision at B8 (S88+)
  and B10 (S111+). Do not start until NUT-11 Mode 2 design is locked.

---

## Test environment

`TESTING.md` in repo root is the canonical testing architecture document.
Load it at the start of any session touching tests, CI, load testing,
staging environment, or the B9 security whitepaper.
Do not load it by default — it is reference material, not working memory.

---

*"Nothing stops this train."*
