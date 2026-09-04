# CLAUDE.md — refueler-share
> **Version:** 1.8 | **Initialised:** CC-64 · 8 July 2026 | **Updated:** Opus-2 · 29 Aug 2026
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
| Anonymous authentication | Cashu blind signatures | Access tokens, payment gate |
| Storage | Cloudflare R2 | Egress-free object store |
| Payment | LNbits on Hetzner CAX21 (B7+, all Refueler projects) | Upload capacity settled via Lightning |

**These two layers must never be conflated.** BLAKE3 is not the auth layer. Cashu is not the hashing layer.

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
- 🔒 **Still blocked:** Full Merkle tree verification. NUT-11 Mode 2 (keypair auth).
  "Audit-certified" or "security-audited". ML-KEM key wrapping. Any "end-to-end" integrity claim
  without the Merkle qualifier.
- 📅 **Blocked items resolve:** B8 (NUT-11 Mode 2) → B9 (whitepaper + Merkle) → B10 (ML-KEM).

---

## Session queue

See `share-sessions.md` for log. Full roadmap lives in `Share-Master-Context.md` §Roadmap.
Session count is a guide not a constraint — split early, never overload. Planning sessions uncounted.

**B6 ✓ complete (S72a). B7 in progress — S73/S73a complete. Opus-2 ✓ (29 Aug — resequenced for LNbits/phoenixd).**
**Next: NB-series** (node bootstrap, pre-B7, gates all B7 code) — starts with NB-1 (Opus, runbook). Locked block sequence: `NB → B7 → SYNC-1 → RU1/RU2 → HQ → SD-block → SW → B8 → B9 → B10+`. See Share-Master-Context.md §Roadmap + §Phoenixd → LND trigger + §SD-block placement + §Dual-repo asset sync.

Session numbering convention (B7 onwards): single-scope sessions use plain numbers (e.g. S78).
Sessions split by complexity use lettered suffixes (e.g. S73, S73a, S73b). Plain number is always
the first session of a group — never skipped. See Share-Master-Context.md §B7 notes.

---

## Session hygiene — mandatory

**After every `git commit`, always `git push`.** Commits that stay local mean Cloudflare Pages
never deploys. Combine into one command:

```
git commit -m "AP-7: description" && git push
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
