# CLAUDE.md — refueler-share
> **Version:** 1.0 | **Initialised:** CC-64 · 8 July 2026
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
| Payment | Blink BOLT11 | Upload capacity settled via Lightning |

**These two layers must never be conflated.** BLAKE3 is not the auth layer. Cashu is not the hashing layer.

---

## Locked decisions

- No custodial wallet. Payment settled externally via Blink.
- Cloudflare Worker receives and stores encrypted noise — it cannot read file content.
- Pricing/unit economics are never published in this repo (stripped CC-64).
- Apache 2.0 licence — patent grant clause protects the novel BLAKE3 + Cashu combination.

**SHA-256 / BLAKE3 integrity gap (known, deferred):**
Client declares BLAKE3 hash per chunk. Worker re-hashes with Web Crypto SHA-256 —
it does not verify the client-declared BLAKE3. A compromised client can declare
a hash that doesn't match the payload; Worker cannot detect this.
Fixed S34. BLAKE3 WASM compiled, checked into worker/blake3-wasm/, imported statically via blake3_worker.js. Server-side verification live on every chunk. Integrity/audit marketing claims remain blocked until full B4 audit pass (S42).

---

## Session queue

See `share-sessions.md` for log. Full S19–S120 roadmap lives in `Share-Master-Context.md` §Roadmap.
Core build: S19–S100. Buffer: S101–S120. Planning sessions are uncounted.
Integrity/audit marketing claims remain blocked until S42 (BLAKE3 Worker WASM verified).

---

## Deferred experiments

- **refueler-ecash-lab** — separate repo for NUT-11 Mode 2 and ML-KEM key wrapping
  experimentation before wiring into production. Flagged S20. Scope decision at B8 (S69)
  and B10 (S83). Do not start until NUT-11 Mode 2 design is locked.

  ---

*"Nothing stops this train."*
