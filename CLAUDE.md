# CLAUDE.md — refueler-share
> **Version:** 1.4 | **Initialised:** CC-64 · 8 July 2026 | **Updated:** B7 Lightning planning · 26 July 2026
> Load alongside `share-sessions.md` at the start of every session on this repo.
> For platform-wide context (brand, Supabase, Blink, Numo), load the main `claude.md` + `Refueler_MasterContext_CC64.md`.

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
| Payment | Blink BOLT11 — Share-specific account (B7) → LNbits Tier 2 (B9) | Upload capacity settled via Lightning |

**These two layers must never be conflated.** BLAKE3 is not the auth layer. Cashu is not the hashing layer.

---

## Locked decisions

- No custodial wallet. Payment settled externally via Blink (primary) or LNbits (Tier 2, see Lightning ops plan in Share-Master-Context.md).
- Cloudflare Worker receives and stores encrypted noise — it cannot read file content.
- Content-Type header is validated against a denylist of execution-capable types at the upload boundary. The Worker cannot verify payload content — the header check reflects declared intent only. The MIME type is never stored.
- Pricing/unit economics are never published in this repo (stripped CC-64).
- Apache 2.0 licence — patent grant clause protects the novel BLAKE3 + Cashu combination.
- DO NOT edit inline CSS/JS in `src/index.njk` or `src/upgrade.njk` — edit `frontend/share.css`,
  `frontend/share.js`, `frontend/upgrade.css` only (extracted S51).
- DO NOT put `share.js` as a regular script — must remain `type="module"`.

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

**B5 COMPLETE. B6 (Testing infrastructure + folder upload) in progress — S62 next.**
**B7 plan locked (Lightning planning session, 26 Jul 2026) — S73–S87, 25 core + 5 buffer.**

Session numbering convention (B7 onwards): single-scope sessions use plain numbers (e.g. S78).
Sessions split by complexity use lettered suffixes (e.g. S73, S73a, S73b). Plain number is always
the first session of a group — never skipped. See Share-Master-Context.md §B7 notes.

---

## Context file hygiene — mandatory at every B-close session

Every block-close session (S72, S87, S96+, S110+, S118+, S126+, S127–S128) must include a trim pass
on both context files before the git commit. This is not optional.
(B8+ session numbers renumber at B7 close — check Share-Master-Context.md §Roadmap for current numbers.)

**`share-sessions.md`:**
- Sessions more than two blocks old: convert full narrative entries to compact one-row table format
  (session number · commit · one-line summary). Do-not-retry blocks are permanent — never trim.
- Target: under 500 lines at all times.

**`Share-Master-Context.md`:**
- §Current state table: drop rows older than two blocks. Block summaries in §Roadmap carry the history.
- §Known broken / do not retry: remove entries that duplicate `CLAUDE.md` locked decisions.
- §B-n snag list: remove fully resolved items. Carried items only.
- Target: under 350 lines at all times.

**Applies to:** S72 (B6) · S87 (B7) · S96 (B8 — renumber at B7 close) · S110 (B9) ·
S118 (B10) · S126 (B11) · S127–S128 (B12).
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
