# refueler-share

> Zero-knowledge, end-to-end encrypted file transfer — built for creative professionals who value speed, privacy, and financial sovereignty.

**Live at:** [share.refueler.io](https://share.refueler.io) *(coming soon)*  
**Part of the [Refueler](https://refueler.io) ecosystem**

---

## What This Is

`refueler-share` is a high-speed, anonymous file sharing utility targeting video editors, photographers, and media professionals who are leaving Adobe and corporate cloud platforms over privacy failures and unfair pricing.

It is **not** a standard file host. It is a cryptographic pipeline:

- Files are encrypted **in the browser** before a single byte leaves your machine
- The server is **completely blind** — it cannot read your files or link your identity to your uploads
- Storage is **ephemeral** — hard 5-day deletion via Cloudflare R2 lifecycle rules, no exceptions
- Transfers run at **full line speed** — no artificial throttling, even on the free tier

---

## The Architecture

### Two-Layer Cryptographic Stack

**BLAKE3 — Internal Chunk Integrity**  
Every file is split into 50MB blocks. Each block is fingerprinted using a BLAKE3 Merkle tree, computed client-side via a compiled WebAssembly module. If a network interruption occurs at 180GB into a transfer, the browser performs a rapid BLAKE3 tree-check against the Cloudflare Worker to identify exactly which chunks already exist in R2 — resuming in milliseconds without restarting.

BLAKE3 is used exclusively for **internal indexing and chunk verification**. It does not replace the Cashu blind signature scheme.

**Cashu Blind Signatures — Anonymous Upload Authentication**  
Access tokens are issued using the cryptographic primitive underlying the Cashu protocol — specifically the blind signature scheme (NUT-00). The server signs a blinded upload credential without ever learning the token's serial number. The client presents the unblinded proof to the Cloudflare Worker to authorise a transfer.

This is not a monetary use of Cashu. There is no external mint. The blind signature primitive is repurposed as a **zero-knowledge anonymous credential system** for upload access — keeping the server's ledger completely unable to link a user identity to a specific file transfer.

> **This combination — BLAKE3 chunk trees + Cashu blind sigs as anonymous auth — has not been publicly implemented before.**

### Protocol Extensions Supported

| NUT | Purpose |
|-----|---------|
| NUT-00 | Blind proof issuance & double-spend prevention |
| NUT-04 | Automated token minting on Lightning / Stripe webhook settlement |
| NUT-07 | Token melt on transfer completion — instant spent-token recording |
| NUT-11 | Programmable spending conditions: time-locks, capacity ceilings, P2SH identity locks |

### Post-Quantum Security (Production Max tier)
AES-GCM session keys are wrapped inside an **ML-KEM (Kyber)** post-quantum envelope for download link generation. Protects against Harvest Now, Decrypt Later attacks on high-value media assets.

---

## Stack

| Layer | Technology |
|-------|-----------|
| Frontend | HTML5 / JavaScript Streams API / BLAKE3 WASM |
| Backend | Cloudflare Workers (serverless, blind relay) |
| Storage | Cloudflare R2 (zero egress fees, 5-day lifecycle) |
| Ledger | Supabase PostgreSQL (spent-token tracking only) |
| Payments | Stripe (card / Apple Pay) · Lightning BOLT11 |
| Encryption | AES-GCM 256-bit (client-side) · ML-KEM (PQC, Max tier) |

---

## Speed Benchmarks

On a standard 500 Mbps UK studio fibre line:

| Platform | Real-World Speed | Our Advantage |
|----------|-----------------|---------------|
| Smash (Free) | ~25 Mbps (artificially throttled) | **15–20× faster** |
| WeTransfer (Paid) | ~85–160 Mbps (server-side rate limits) | **3–5× faster** |
| Dropbox Transfer | ~380–430 Mbps (sequential server-side encryption) | **1.5–2× faster** |
| **share.refueler.io** | **~480+ Mbps (full line saturation)** | Maximum |

Frame.io is not benchmarked here because it serves a different purpose (collaborative review, proxy transcoding). `refueler-share` deliberately does zero transcoding — raw BLAKE3-hashed encrypted data passes directly to R2 at full fibre saturation.

---

## Tiers

| Tier | Price | Cap | Features |
|------|-------|-----|---------|
| **Skint Tog** | Free | 6 GB per transfer | Unthrottled · 5-day deletion · Share links |
| **Creative Premium** | £12/mo | 100 GB per transfer | NUT-11 contractor upload links · Email backup · Portfolio embed |
| **Production Max** | £24/mo | 250 GB per transfer | BLAKE3 pause/resume · ML-KEM PQC key locks · P2SH identity-gated downloads |
| **Enterprise** | Contact | Unlimited | White-label custom domain integration |

---

## Economics (Cloudflare R2)

Cloudflare charges ~£0.012/GB/month for storage. Egress is always free.

- A Premium user (100GB cap, ~150GB average active) costs ~£2.18/month to service → **~82% margin**
- A Max user (250GB cap, ~350GB average active) costs ~£4.76/month to service → **~80% margin**

---

## Why Not Just Use WeTransfer?

Three reasons:

1. **Speed** — WeTransfer enforces browser-session rate limits to keep legacy servers alive. We don't have a legacy server.
2. **Privacy** — WeTransfer can read your files. Our Cloudflare Worker receives and stores encrypted noise it cannot interpret.
3. **Business model alignment** — WeTransfer sells your data behaviour. We sell upload capacity, settled instantly via Lightning.

---

## Ecosystem Position

`refueler-share` is one of three infrastructure pillars in the Refueler ecosystem:

```
              [ refueler.io ] (Master Brand & Funnel)
             /       |        \
            /        |         \
[multi-core]         |      [share.refueler.io]
(Bitcoin Indexer     |      (This repo — encrypted
& Stream Engine)     |       P2P file transfer)
                     |
              [mint.refueler.io]
              (Closed-loop digital
               loyalty stamp mint)
```

---

## Status

🔴 **Pre-build.** Architecture locked. Repository initialised.  
Active development begins Q3 2026.

---

## Licence

MIT — open infrastructure, open source.  
The Cashu blind signature implementation within this repo is a closed-loop, non-monetary application. No external Cashu mint is used or connected.
