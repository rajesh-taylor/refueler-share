# CLAUDE.md — refueler-share
> **Version:** 2.0 | **Initialised:** CC-64 · 8 July 2026 | **Updated:** TH-Opus-1 · 5 Sep 2026
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

---

## Locked decisions

- **Lightning provider: LNbits on Hetzner CAX21. Locked pre-Opus-2 · 28 Aug 2026.** Applies to all Refueler projects (Share, refueler.io POS, Relay, Refill). Blink discontinued custodial accounts UK Aug 31 2026 — dead as a provider. Voltage eliminated (US company, invoice metadata visible to third party, incompatible with compulsion-resistance framing). Strike eliminated (custodial, FCA-dependent). No other candidates.
- **Boltz submarine swaps: dead.** Boltz suspended all swap operations Aug 3 2026 (AI-assisted infrastructure probing). Blockstream Swaps exists as a potential replacement but is irrelevant to this stack: liquidation destination is a Silent Payments address, which receives on-chain BTC directly. No swap service is required in the liquidation path.
- **Node bootstrap is B7 pre-work, not B9.** Timeline: 3–4 weeks deliberate pace including Opus planning sessions. Pre-server work available immediately (see Share-Master-Context.md §B7 notes). No dark provisioning — instance goes live only when runbook is ready and test suite passes.
- No custodial wallet. Payment settled via self-hosted LNbits.
- Cloudflare Worker receives and stores encrypted noise — it cannot read file content.
- Content-Type header is validated against a denylist of execution-capable types at the upload boundary. The Worker cannot verify payload content — the header check reflects declared intent only. The MIME type is never stored.
- Pricing/unit economics are never published in this repo (stripped CC-64).
- Apache 2.0 licence — patent grant clause protects the novel BLAKE3 + Cashu combination.
- DO NOT edit inline CSS/JS in `src/index.njk` or `src/upgrade.njk` — edit `frontend/share.css`,
  `frontend/share.js`, `frontend/upgrade.css` only (extracted S51).
- DO NOT put `share.js` as a regular script — must remain `type="module"`.
- **Sovereign storage cap: 100 GB. Locked TH-Opus-1.** Previously 250 GB — revised before any published copy. Business/API: 250 GB + pay-per-GB overage (invoiced). No legacy subscribers affected.
- **Permanent record (Tower Hill) — Worker is a blind byte-relay only.** No OTS library in Worker. All OTS logic is client-side. Worker relay endpoints forward opaque bytes to calendar servers. The Worker sees a nonced 32-byte SHA-256 digest only — never the plaintext, never the file.

**API / white-label locked decisions (AP-2/AP-3a):**
- HMAC signing: every API request signed with HMAC-SHA256 over `method + path + timestamp + body_hash`.
- Three credentials per commercial relationship: `rfs_live_{32b base58}` (identification) + `rfs_sign_{32b base58}` (request integrity) + `rfs_whsec_{32b base58}` (webhook signing, Business tier only).
- One API keypair per commercial relationship. No sub-keys. Rotation via `POST /api/v1/keys/rotate` (24h grace window). Multi-user = shared firm key + `transfer_ref` attribution + dashboard seats.
- Webhooks are notification, never control flow. Credential issuance and transfer completion proceed identically whether the client webhook endpoint is up or down.
- DO NOT use Cloudflare Queues, Durable Objects, or D1 for webhook delivery or any other purpose. `ctx.waitUntil` + KV dead-letter only.
- Badge links to `refueler.io/share/`.
- Business tier = invoiced. No Stripe subscription price object for Business — invoice template only, managed manually in Stripe dashboard, off-repo.
- `X-Email` header dropped from upload path entirely — snag resolves by removal.
- Never edit `frontend/upgrade.html` directly — Eleventy overwrites it from `src/upgrade.njk` on every build.
- `refueler-io/src/share/index.njk` must have `permalink: /share/index.html` — never `/index.html` (conflicts with site root index).
- `refueler-io/src/share/index.njk` CSS href must be `/share/assets/share.css` — never `/share.css`. Never produce index.njk as a download — always edit via sed directly on `refueler-io/src/share/index.njk`.

**BLAKE3 server-side integrity — VERIFIED S34, AUDITED S42e:**
Server verifies every chunk via BLAKE3 WASM (`worker/blake3-wasm/`), imported statically via
`blake3_worker.js`. 400 on hash mismatch. This claim is safe to assert with correct scope
(server-side chunk integrity). Full Merkle root verification (assembled file vs BLAKE3 tree root)
remains unimplemented — do not claim end-to-end file integrity until B9 audit.

**Integrity/audit marketing claims — current ruling (S42e):**
- ✅ **Safe to assert:** Server-side BLAKE3 chunk integrity. Double-spend detection via Supabase
  ledger. Rate limiting on all public endpoints. UUID-bound credential issuance (Worker precursor
  to NUT-20).
- ✅ **Safe to assert (TH-Opus-1+):** Permanent record (Bitcoin-anchored existence proof) for
  Sovereign+ transfers where sender opts in. Honest scope: proves bytes existed on or before a
  block date. Does not prove authorship, truth, or delivery.
- 🔒 **Still blocked:** Full Merkle tree verification. NUT-11 Mode 2 (keypair auth).
  "Audit-certified" or "security-audited". ML-KEM key wrapping. Any "end-to-end" integrity claim
  without the Merkle qualifier. Journalist/source-protection copy (gate: SD shipped + VPN scope stated).
- 📅 **Blocked items resolve:** B8 (NUT-11 Mode 2) → B9 (whitepaper + Merkle) → B10 (ML-KEM).

---

## Session queue

See `share-sessions.md` for log. Full roadmap lives in `Share-Master-Context.md` §Roadmap.
Session count is a guide not a constraint — split early, never overload. Planning sessions uncounted.

**TG-block ✓ complete (commit `18d2157`, 432 tests passing). TH-Opus-1 ✓ (5 Sep — Tower Hill / Permanent Record scoped).**
**Next: TH-Opus-2 (Pass + Legend scoping — Legend price, cross-product entitlement architecture).**
Locked block sequence (AP-10): `NB-1 → S89/S90 → snag sweeps → [S88 ✓] → TG-block ✓ → TH-series → SW → B8 → [Hetzner] → NB-2–NB-4 → B7 → SD-block → articles → B9 → B10+`. See Share-Master-Context.md §Roadmap + §TH-series + §SD-block.

Session numbering convention (B7 onwards): single-scope sessions use plain numbers (e.g. S78).
Sessions split by complexity use lettered suffixes (e.g. S73, S73a, S73b). Plain number is always
the first session of a group — never skipped. See Share-Master-Context.md §B7 notes.

---

## Session hygiene — mandatory

**After every `git commit`, always `git push`.** Commits that stay local mean Cloudflare Pages
never deploys. Combine into one command:

```
git commit -m "TH-Opus-1: description" && git push
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

**Applies to:** S87 (B7) · SW9 (SW) · then B8, B9, B10, B11, B12 close sessions
(renumber after B7 close — check Share-Master-Context.md §Roadmap for current numbers).
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
