# CLAUDE.md — refueler-share
> **Version:** 2.5 | **Initialised:** CC-64 · 8 July 2026 | **Updated:** B9-Opus · 12 Sep 2026
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

**Two Merkle roots, never conflated (locked B9-Opus · 12 Sep 2026):**
- **Ciphertext-chunk `merkle_root`** — over per-chunk BLAKE3 digests of stored ciphertext. Worker-verifiable. Storage integrity only.
- **Plaintext `blake3PlaintextRoot`** — over plaintext bytes. Client-side + recipient only. **Never enters the Worker. Never in any receipt. Permanent.**

"End-to-end file integrity" is the recipient's plaintext check. The Worker's Merkle verification is storage integrity. These are two different claims. Never conflate them in any copy, doc, or code comment.

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
- **Sovereign** ships in two SKUs: single-seat and Teams (N-seat, shared pool, one bill, UI-only). Sovereign Teams sizing → SW-Teams-1 (cross-product Opus in `refueler.io` project).
- **API ⊃ UI** (one-directional): an API key holder may also use the web interface. **Sovereign ⊅ API**: a Sovereign subscriber never gets API access. Price-enforced — API sits clearly above Sovereign.
- **Tier logic keys ≠ display names (Share-1, 11 Sep 2026).** Gate on `worker/src/tiers.js` — never on display strings. Live wire vocabulary: consumer `free`/`creative`/`max` (Stripe axis, `EXPIRY_WINDOWS`/`TIER_CAPS`), Chartered axis `'api'`. `TIERS.CHARTERED === 'api'` — wire value kept, `'chartered'` rename deferred. `citizen`/`sovereign` appear in **no** source module — display-layer and S89 rename narrative only. Helpers: `isPaidTier`, `isBearerTier`, `isCharteredTier`, `displayName`. Do not reintroduce literal `'api'`/`'citizen'`/`'sovereign'` comparisons in gating.
- **API tier is invoiceable** — preserves the PO/invoice path for firms that cannot pay by card or Lightning.
- **The rail model extends to the API tier.** Identity rail (Stripe/invoice) and anonymous rail (Lightning/prepaid sats) are mutually exclusive per credential relationship.
- **Rail is declared, not inferred from payment.** The client's principal declares the rail at onboarding; the permitted payment method follows.
- **Mandatory pre-payment disclosure of both irreversibles** (aimed at the principal, before AP handoff): wording locked SW-Opus-3, four surfaces.
- **DO NOT add a Supabase row or email field to the anonymous-rail API credential path** — same invariant as the Lightning consumer path. Load-bearing for the anonymous rail's identity promises.

**Pricing model (locked SW-Opus-1/2 · 7 Sep 2026):**
- **Model B (platform credit pool).** Models A and C rejected.
- **Rate card v1.0:** 10 credits/transfer + 100 credits/GB + 20 credits/permanent-record. OTS webhook and capability discovery free. Reference peg £50k BTC at publication. Governance: first review at £100k BTC 30-day trailing; ±40% GBP drift = re-version.
- **1 credit = 1 sat** (internal canonical unit — user-facing copy always says "credits", never "sats").
- **Identity rail:** server-held recovering ledger, auditable, invoiceable. Monthly allocation included (see MCP spec §7.4). Metered overage above allocation = abuse ceiling, not billing meter.
- **Anonymous rail:** client-held bearer Cashu credits. Balance is the client's local stack — server is blind to it. Non-recoverable.
- **Term protection is an identity-rail feature.** Annual prepay rate-locked 12 months; monthly gets 30 days' notice. Anonymous rail: current rate card always.

**API / white-label locked decisions (AP-2/AP-3a + SW-Opus-1 · 7 Sep 2026):**
- HMAC signing: every API request signed with HMAC-SHA256 over `method + path + timestamp + body_hash`.
- Three credentials per commercial relationship: `rfs_live_{32b base58}` (identification) + `rfs_sign_{32b base58}` (request integrity) + `rfs_whsec_{32b base58}` (webhook signing, API tier only).
- Test/sandbox credentials use `rfs_test_` prefix — never `rfs_live_` or `rfs_sign_` in test files. GitHub scanner pattern-matches these prefixes.
- One API keypair per commercial relationship. No sub-keys. Rotation via `POST /api/v1/keys/rotate` (24h grace window).
- Webhooks are notification, never control flow. Credential issuance and transfer completion proceed identically whether the client webhook endpoint is up or down.
- DO NOT use Cloudflare Queues, Durable Objects, or D1 for webhook delivery or any other purpose. `ctx.waitUntil` + KV dead-letter only.
- Badge links to `refueler.io/share/`.
- **CF for SaaS enabled on `refueler.io` zone (SW1 · 8 Sep 2026).** Fallback origin: `fallback.share.refueler.io`. Custom hostname: `api.share.refueler.io`. hostname_id: `d1d04abe-854c-48a0-8afe-bca47dfb0c3b`. ssl_id: `a3bd125f-f48c-4226-9e7c-d26e77fbaa90`. API token: `refueler-share-saas` (Zone → SSL and Certificates → Edit, scoped to `refueler.io`). Worker route: `api.share.refueler.io/*` in `wrangler.toml`. `wl_config.js` is the host-lookup module — add new client hostnames to `WL_CONFIGS` there.
- API tier invoiced manually via Stripe invoice template. No subscription price object for API tier — invoice template only, managed manually in Stripe dashboard, off-repo.
- `X-Email` header dropped from upload path entirely.
- Never edit `frontend/upgrade.html` directly — Eleventy overwrites it from `src/upgrade.njk` on every build.
- `refueler-io/src/share/index.njk` must have `permalink: /share/index.html` — never `/index.html`.
- `refueler-io/src/share/index.njk` CSS href must be `/share/assets/share.css` — never `/share.css`. Never produce index.njk as a download — always edit via sed directly on `refueler-io/src/share/index.njk`.

**API feature gates (locked SW-Opus-1 · 7 Sep 2026):**
- **v1 (ships in SW block):** capability discovery (`GET /api/v1/capabilities`), OTS-confirmation webhook, acceptance receipts + collection receipts. "Proof of delivery" retired — unprovable, never claim it.
- **v2 (each with explicit gate):** Silent Drop provisioning via API (gate: SD-block shipped); agent-to-agent transfers (gate: SD provisioning live); verifiable agent identity NUT-11 Mode 2 (gate: B8, `bind_pubkey` reserved in voucher now); batch credential issuance (gate: Pass API Q4); composable receipts (v1 if free off credit-token work, else v2).
- **Forward commitments (document, do not build):** policy-encoded transfers via Nutroot three-product flow (gates: Nutroot PR #421 + B8 + Pass + B12). BOLT12/MCP inline payment: B9+, phoenixd-native.
- **MCP v1 tools:** `refueler_capabilities`, `refueler_send_file`, `refueler_check_transfer`, `refueler_quote`. Full contracts in `refueler-mcp-spec-v2.md`. Each ships the day its backing product is live.
- **MCP architectural constraint (invariant):** MCP server runs in the agent's trust domain, handles ciphertext only. Never a Refueler-hosted plaintext endpoint.
- **Sandbox:** credential-limited, no time cap. Model-B test-credits, both rails walkable with `rfs_test_` prefix. Non-anonymous by design — "do not send real cargo to the sandbox" stated plainly.

**MCP spec v2 — locked decisions (Share-MCP-Opus-2 · 10 Sep 2026):**
Full contracts in `refueler-mcp-spec-v2.md`. Worker-contract items that affect every build session:

- **`GET /api/v1/capabilities` response shape:** locked in spec §7.1. Emits `schema_version: "cap.v1"`, `rate_card_version`, `credit_unit: "sat"`, `rails_available` (live state only — `["identity"]` until B7/NB-4), `features` map, `rate_card` (integer credits), `daily_reference_rate` block, `limits`. **SW-MCP-W1** implements this shape; do not emit the old illustrative shape from v1.
- **Daily reference-rate KV key:** `btc_ref_rate:current` in `STATUS_KV`. Schema: `{ gbp_per_btc, source, last_updated, set_by, previous }`. No TTL — staleness derived from `last_updated`. Tier 1 (pre-node): manual override + 3am CoinGecko fallback + ±20% guard. Tier 2 (post-B7): 15-minute node feed + CoinGecko fallback. **SW-MCP-W1.**
- **Monthly allocation KV schema:** `api_quota_{sha256(rfs_live_key)}` gains `plan`, `allocation`, `overage_credits`, `overage_ceiling`, `period_start`, `period_end`, `status`. Reset is lazy (on next `credential/issue`). Identity-API: 50,000 credits/mo, metered overage to ceiling. Personal API (`plan: "personal_api"`): 10,000 credits/mo, hard stop. **SW-MCP-W2.**
- **Personal Sovereign API path (unlisted):** £49/mo, 10,000 credits/mo, hard stop, no webhook, no AM, DPA on request. KV plan value: `personal_api`. Not on public pricing page.
- **Fragment grammar v1 (D-1 filename fix):** `X-File-Name` to Worker is always the constant placeholder `"encrypted-payload"`. Real filename travels in the URL fragment only, inside a versioned base64url-JSON blob: `{ v: 1, k: "<aes-key-b64url>", n: "<real-filename>", s: "<seal-nonce-b64url>" }` (s present only for permanent-record transfers). Applies to **both** MCP send tool and consumer `upload.js`/`download.js` in the same session (SW-MCP-4). Verify `hashSecret()` in `nut11.js` construction (bare SHA-256 vs domain-tagged) at SW-MCP-2 before shipping agent-to-agent passphrase protocol.
- **Vocabulary rule (user-facing):** "credits" / "Share credits" everywhere a human reads. Never "sats", "ecash", "tokens" in any output string, tool schema value, or pitch copy. Internal technical docs: precise terms permitted.
- **Transfers persist until `expiry_timestamp`** regardless of account cancellation status — explicit policy, not assumed behaviour.
- **No Anthropic marketplace.** Distribution: `refueler.io` and AMs only. MCP server ships as Apache 2.0 npm package; operator installs in their own infrastructure.

**BLAKE3 server-side integrity — VERIFIED S34, AUDITED S42e:**
Server verifies every chunk via BLAKE3 WASM (`worker/blake3-wasm/`), imported statically via
`blake3_worker.js`. 400 on hash mismatch. Full Merkle root verification (assembled file vs BLAKE3 tree root)
remains unimplemented — do not claim end-to-end file integrity until B9 build is complete (B9-3).

**Integrity/audit marketing claims — current ruling (S42e + TH-series + B9-Opus · 12 Sep 2026):**
- ✅ **Safe to assert:** Server-side BLAKE3 chunk integrity. Double-spend detection via Supabase ledger. Rate limiting on all public endpoints. UUID-bound credential issuance.
- ✅ **Safe to assert (TH-series+):** Permanent record (Bitcoin-anchored existence proof) for Sovereign+ transfers where sender opts in. Honest scope: proves bytes existed on or before a block date. Does not prove authorship, truth, or delivery.
- ✅ **Safe to assert after B9-3 ships:** Ciphertext storage integrity — Worker verifies assembled ciphertext Merkle root on every download. Use: "ciphertext storage integrity" or "the encrypted object served equals the encrypted object stored." Never "end-to-end."
- 🔒 **Still blocked (until B9 build):** Full Merkle tree verification at download. Receipt `merkle_root`/`verified` fields (gate: B9-3). NUT-11 Mode 2 (keypair auth). "Audit-certified" or "security-audited". ML-KEM key wrapping. Any "end-to-end" integrity claim. Journalist/source-protection copy (gate: SD shipped + VPN scope stated).
- 🔒 **Permanently blocked:** Plaintext `blake3PlaintextRoot` in any receipt or in the Worker. "End-to-end file integrity" as a Refueler-side claim (the Worker never verifies plaintext — the recipient does).
- 📅 **Blocked items resolve:** B8 (NUT-11 Mode 2) → B9 build B9-1…B9-3 (ciphertext Merkle root verification) → B9-4 (receipt upgrade) → B10 (ML-KEM).

**Merkle / MMR / SMT — locked B9-Opus · 12 Sep 2026 (full spec: `merkle-spec-v1.md` in repo root):**
- Tree construction: RFC 6962 unbalanced, domain-separated (`0x00` leaf / `0x01` node), BLAKE3 node hash, sequential big-endian leaf ordering (matches AAD convention), `chunk_count` committed. `tree_algo: "rfc6962-unbalanced-blake3-v1"`. Duplicate-last-leaf rejected (CVE-2012-2459).
- Chunk hashes persisted in R2 sidecar `{uuid}/hashes` (raw 32-byte concat). Never inline in manifest (64 KB `safeGetManifest()` ceiling). Download = sidecar-root check + verify-then-flush per chunk + 409 on mismatch. Full reconstruction only basis for `verified`.
- Receipt `merkle_root`/`verified` unblocked post-B9-3, ciphertext root only. Plaintext root barred from receipts forever.
- MMR roots anchor via Share OTS relay, never a "smart contract". AES-256-GCM leaf encryption, on-device key (Deed→HKDF).
- SMT complements Supabase double-spend guard (public verifiability); never the live arbiter; no build slot without design partner.
- ZK build slot only where (a) use case hides which set member satisfied a predicate; (b) no NUT-22/nutroot primitive covers it; (c) buyer committed.
- Due-diligence proof = FCA SYSC 6.3 / MLR 2017 reg. 40 record-keeping evidence — NOT FATF travel rule compliance. MLRO confirmation required before marketing copy.

---

## Session queue

See `share-sessions.md` for log. Full roadmap lives in `Share-Master-Context.md` §Roadmap.
Session count is a guide not a constraint — split early, never overload. Planning sessions uncounted.

**TH-block ✓ complete (6 Sep 2026):**
- TH-Opus-1 ✓ — Tower Hill / Permanent Record scoped
- TH-Opus-2 ✓ — Legend price locked. Cross-product entitlement architecture locked. BRIDGE v8.0.
- TH-1 ✓ — Worker OTS relay. Deployed `a71f12fe`.
- TH-2 ✓ — Permanent-record toggle UI, `seal_nonce`, `blake3PlaintextRoot`. Deployed `53e3c7fb`.
- Share-JS-Refactor ✓ — 5-module split. Deployed `45a4d3b3`. 324 tests passing.

**SW-block ✓ complete (11 Sep 2026):**
- SW1–SW9 ✓ — CF for SaaS, HMAC auth, credential issuance, badge, webhooks, receipts, dashboard, sandbox, hostname health. 484 tests passing.

**SW-MCP block in progress:**
- SW-MCP-1–6 ✓ — MCP server scaffold through demo hardening. 228 tests passing (`refueler-mcp` repo).
- **Next: SW-MCP-8** — npm package distribution, Apache 2.0, trust-boundary README.
- SW-MCP-7 gates on B7/NB-4 (anonymous rail send).

**B9-Opus ✓ complete (12 Sep 2026):** Merkle / MMR / SMT / ZK design locked. `merkle-spec-v1.md` produced (repo root).

Locked block sequence: `SW-MCP-8 → B8-Opus → B8 build → [Hetzner] → NB-2–NB-4 → B7 → SD-block → B9 build (B9-1…B9-8) → B10+`

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

**Applies to:** SW-MCP-8 (next B-close) · then B8, B9, B10, B11, B12 close sessions.
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
