# CLAUDE.md — refueler-share
> **Version:** 1.3 | **Initialised:** CC-64 · 8 July 2026 | **Updated:** S52 · 25 July 2026
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
| Payment | Blink BOLT11 (primary) → LNbits (Tier 2) | Upload capacity settled via Lightning |

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

See `share-sessions.md` for log. Full S19–S120 roadmap lives in `Share-Master-Context.md` §Roadmap.
Core build: S19–S100. Buffer: S101–S120. Planning sessions are uncounted.

**B5 COMPLETE. Current block: B6 (Testing infrastructure + folder upload) — S53 onwards.**

B6 session allocation: 20 core sessions + up to 10 buffer (testing infra only, reviewed every 4
sessions) + 2–3 buffer for download bearer token TTL investigation. See Share-Master-Context.md §B6.

---

## Deferred experiments

- **refueler-ecash-lab** — separate repo for NUT-11 Mode 2 and ML-KEM key wrapping
  experimentation before wiring into production. Flagged S20. Scope decision at B8 (S69)
  and B10 (S83). Do not start until NUT-11 Mode 2 design is locked.

---

*"Nothing stops this train."*
