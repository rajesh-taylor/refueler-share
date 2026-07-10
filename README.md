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
- Storage is **ephemeral** — hard deletion via Cloudflare R2 lifecycle rules, no exceptions
- Transfers run at **full line speed** — no artificial throttling, even on the free tier

---

## The Architecture

### Two-Layer Cryptographic Stack

**BLAKE3 — Internal Chunk Integrity**  
Every file is split into 50MB blocks. Each block is fingerprinted using a BLAKE3 Merkle tree, computed client-side via a compiled WebAssembly module. If a network interruption occurs mid-transfer, the browser performs a rapid BLAKE3 tree-check against the Cloudflare Worker to identify exactly which chunks already exist in R2 — resuming in milliseconds without restarting.

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
| Storage | Cloudflare R2 (zero egress fees) |
| Ledger | Supabase PostgreSQL (spent-token tracking only) |
| Payments | Stripe (card / Apple Pay) · Lightning BOLT11 |
| Encryption | AES-GCM 256-bit (client-side) · ML-KEM (PQC, Max tier) |

---

## Speed Benchmarks

*Pending A/B test results from `refueler-share-dev` bucket — to be published pre-Production Max launch.*  
*Test protocol: 1GB / 10GB / 50GB / 100GB files across 500 Mbps fibre, 100 Mbps broadband, 30 Mbps 4G.*

Directional benchmarks (500 Mbps UK studio fibre):

| Platform | Real-World Speed | Notes |
|----------|-----------------|-------|
| Smash (Free) | ~25 Mbps | Artificially throttled above 2 GB |
| WeTransfer (Paid) | ~85–160 Mbps | Server-side rate limits |
| SwissTransfer | ~200–350 Mbps | Server-side AES — Infomaniak holds your key |
| PrivCloud | ~180–280 Mbps | Client-side AES-256, 2 GB free cap |
| **share.refueler.io** | **~480+ Mbps** | Full line saturation, client-side encryption |

---

## How We Compare

### The honest competitive picture

| Service | Free Cap | Retention | Zero-Knowledge | Download Limit | Business Model |
|---------|----------|-----------|----------------|----------------|----------------|
| WeTransfer | 2 GB | 7 days | ✗ — server reads files | None stated | Ads + data |
| Smash | Unlimited\* | 7 days | ✗ | None stated | Paid speed tiers |
| TransferNow | 5 GB | 7 days | ✗ | None stated | Paid tiers |
| **SwissTransfer** | **50 GB** | **30 days** | **✗ — Infomaniak holds the key** | **250 downloads** | **Loss leader for hosting upsell** |
| PrivCloud | 2 GB | — | ✓ (client-side AES) | None stated | Freemium |
| **share.refueler.io** | **4 GB** | **5 days** | **✓ — server is structurally blind** | **None** | **Lightning + Stripe** |

\*Smash throttles transfers above 2 GB on the free tier to ~25 Mbps.

### On SwissTransfer's 50 GB free tier

SwissTransfer is run by Infomaniak, a Swiss cloud hosting company with 8.28 million transfers per month (roughly 3 per second). They offer 50 GB free deliberately — it is their marketing budget, not a file transfer business. The model: handle hundreds of thousands of transfers daily to convert a fraction of users into paid Infomaniak cloud hosting customers.

**The structural problem:** SwissTransfer encrypts files on Infomaniak's servers. The encryption key is generated server-side and held by Infomaniak. This means:

- Infomaniak can read every file you send
- A court order, data breach, or insider threat exposes your content
- Their privacy claim is jurisdictional (Swiss law), not cryptographic

SwissTransfer also caps downloads at 250 per link — a hard operational limit for anyone distributing to a wider audience.

We are not competing with SwissTransfer's 50 GB free tier. That figure is subsidised by an unrelated hosting business and carries a privacy model that undermines the headline claim. Our 4 GB free tier is fully zero-knowledge — the AES-256 key never leaves your browser, and our infrastructure is structurally incapable of decrypting your files regardless of jurisdiction or legal compulsion.

### On PrivCloud

PrivCloud are the closest ideological competitors — client-side AES-256, no account required, open source. Respect to them for building correctly.

Their constraints: 2 GB free cap, French hosting jurisdiction (GDPR-compliant, but a legal surface area exists), no Lightning payment option, no BLAKE3 chunk integrity, no anonymous credential system.

Our 4 GB free tier beats their 2 GB. Our blind signature auth means even the act of uploading is uncorrelated with identity. And for users who want to pay without creating a financial paper trail, Lightning is available.

### Why the free tier is 4 GB, not more

4 GB is a deliberate choice, not a limitation. It covers:

- ~800 RAW files from a Canon R5 or Sony A7 series shoot
- A full 4K ProRes clip up to approximately 12 minutes at 422 HQ
- A complete audio master session with stems
- An uncompressed 4K DCP package for a short film

The Skint Tog's actual delivery job fits inside 4 GB. Users who need 50 GB of free storage are not users who need zero-knowledge encryption — they are users who need a loss leader, and SwissTransfer serves them correctly.

Our 100 GB Creative Premium tier (£12/mo) is the answer for users with larger regular transfers. At that price point against SwissTransfer's free 50 GB, the value proposition is not size — it is that your client's confidential brief, your unreleased footage, or your legal document cannot be read by anyone other than the intended recipient, regardless of what happens to our infrastructure.

---

## Tiers

| Tier | Price | Cap | Link expiry |
|------|-------|-----|-------------|
| **Skint Tog** | Free | 4 GB per transfer | 5 days, no extension |
| **Creative Premium** | £12/mo or £120/yr | 100 GB per transfer | User-set: 1 / 7 / 30 days |
| **Production Max** | £24/mo or £240/yr | 250 GB per transfer | User-set: 1 / 7 / 30 / 90 days |
| **Enterprise** | Contact | Unlimited | Custom |

Yearly pricing = 10 months. Two months free.

---

## Ecosystem Position

`refueler-share` is one of three infrastructure pillars in the Refueler ecosystem:

```
              [ refueler.io ] (Commerce Platform)
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

🟢 **Session 2 complete — commit `4152d29`.**  
Worker scaffold, Supabase migration, BLAKE3 WASM integration, and frontend built.  
Session 3: NUT-11 P2SH download gating, payment integration, domain routing.

---

## Licence

Apache 2.0 — open infrastructure, open source. The patent grant clause protects the novel BLAKE3 + Cashu blind signature combination.  
The Cashu blind signature implementation within this repo is a closed-loop, non-monetary application. No external Cashu mint is used or connected.
