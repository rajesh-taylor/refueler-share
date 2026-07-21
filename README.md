# refueler-share

> Zero-knowledge, end-to-end encrypted file transfer — built for creative professionals who value speed, privacy, and financial sovereignty.

**Live at:** [share.refueler.io](https://share.refueler.io)  
**Part of the [Refueler](https://refueler.io) ecosystem**

---

## What This Is

`refueler-share` is a high-speed, anonymous file sharing utility targeting video editors, photographers, and media professionals who are leaving Adobe and corporate cloud platforms over privacy failures and unfair pricing.

It is **not** a standard file host. It is a cryptographic pipeline:

- Files are encrypted **in the browser** before a single byte leaves your machine
- The server is **architected to be blind** — reading your files is not technically possible for us, regardless of policy, jurisdiction, or legal compulsion
- Storage is **ephemeral** — hard deletion via Cloudflare R2 lifecycle rules, no exceptions
- Transfers run at **full line speed** — no artificial throttling, even on the free tier

---

## The Architecture

### Two-Layer Cryptographic Stack

**BLAKE3 — Chunk Integrity, Client and Server**  
Every file is split into 50MB blocks. Each block is fingerprinted using BLAKE3, computed client-side via a compiled WebAssembly module. The Cloudflare Worker independently recomputes the BLAKE3 hash of every received chunk and verifies it against the client-declared value before writing to R2. A compromised or corrupted chunk is rejected at the Worker boundary — the server cannot be made to store data that doesn't match the declared hash.

The Worker-side BLAKE3 implementation is compiled from the official Rust `blake3` crate (v1.8.5) to WebAssembly via `wasm-pack`, checked into `worker/blake3-wasm/`, and imported statically. No CDN dependency. No trust assumption on the client declaration.

BLAKE3 is used exclusively for **chunk integrity verification**. It does not replace the Cashu blind signature scheme.

**Cashu Blind Signatures — Anonymous Upload Authentication**  
Access tokens are issued using the cryptographic primitive underlying the Cashu protocol — specifically the blind signature scheme (NUT-00). The server signs a blinded upload credential without ever learning the token's serial number. The client presents the unblinded proof to the Cloudflare Worker to authorise a transfer.

This is not a monetary use of Cashu. There is no external mint. The blind signature primitive is repurposed as a **zero-knowledge anonymous credential system** for upload access — keeping the server's ledger structurally unable to link a user identity to a specific file transfer.

> **This combination — BLAKE3 chunk integrity + Cashu blind sigs as anonymous auth — has not been publicly implemented before.**

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
*Metric: CIT — Cryptographic Integrity Throughput (verified GB/s, BLAKE3-confirmed end-to-end).*

Directional benchmarks (500 Mbps UK studio fibre):

| Platform | Real-World Speed | Notes |
|----------|-----------------|-------|
| Smash (Free) | ~25 Mbps | Throttled above 2 GB on free tier |
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
| **share.refueler.io** | **4 GB** | **1 / 7 days** | **✓ — reading your files is not technically possible for us** | **None** | **Lightning + Stripe** |

\*Smash throttles transfers above 2 GB on the free tier to approximately 25 Mbps.

### Why "we can't read your files" means something different here

Most privacy services make a policy promise: *we choose not to read your files*. Policy promises can be changed, compelled by courts, or quietly abandoned after an acquisition.

We make an architectural statement: **reading your files is not technically possible for us.**

Here is why that claim holds:

The AES-256 key is generated inside your browser using the Web Crypto API. It is placed in the URL fragment — the part after the `#` symbol. Browsers are specified by RFC 3986 never to transmit the fragment to a server. It does not appear in HTTP requests. It does not appear in our Worker logs. It does not exist anywhere in our infrastructure.

Our Cloudflare Worker receives encrypted bytes and stores them in R2. It has no key. It cannot decrypt what it stores. A court order compelling us to hand over file contents would be complied with immediately — and yield nothing readable. A data breach of our R2 bucket exposes only ciphertext.

This is not a policy choice we made. It is the consequence of how the code is written.

### We also cannot "double-dip"

Most free file transfer services are not file transfer businesses. They are data businesses that use file transfer as an acquisition channel. Your upload behaviour, your recipient's download behaviour, your file metadata, your IP, your device fingerprint — all of it is extractable and sellable to advertisers and data brokers.

We cannot do this. Not because we have chosen not to — because we have no data to extract. We do not know who you are. We do not know what you transferred. We do not know who received it. The anonymous credential system is designed specifically so that this information does not exist on our side in any recoverable form.

One revenue stream. Upload capacity, paid directly via Lightning or card. No behavioural inventory to monetise.

### On SwissTransfer's 50 GB free tier

SwissTransfer is operated by Infomaniak, a Swiss cloud hosting company. They handle 8.28 million transfers per month — roughly 3 every second — and offer 50 GB free deliberately. It is their marketing budget, not a file transfer business. The model: generate brand exposure through massive transfer volume and convert a fraction of users into paid Infomaniak hosting customers.

The structural problem: SwissTransfer encrypts files on Infomaniak's servers. The encryption key is generated server-side and held by Infomaniak. This means Infomaniak can read every file you send, and their privacy guarantee is a legal one (Swiss data protection law) rather than a cryptographic one. SwissTransfer also caps downloads at 250 per link.

We are not competing with their 50 GB figure. That number is subsidised by an unrelated hosting business and built on a privacy model that doesn't survive a serious threat. Our 4 GB free tier is architecturally zero-knowledge. No subsidy required.

### On PrivCloud

PrivCloud are technically correct — client-side AES-256, open source, no account required for small transfers. The closest ideological overlap.

Their constraints: 2 GB free cap (ours is 4 GB), French legal jurisdiction as the primary privacy guarantee rather than cryptographic architecture, no Lightning payment option, no BLAKE3 chunk integrity verification, no anonymous credential system (an account or session exists that can be correlated with a transfer).

---

## Tiers

Four tiers: **Skint Tog** (free), **Creative Premium**, **Production Max**, and **Enterprise**.

| Tier | Cap | Expiry options | Price |
|------|-----|----------------|-------|
| Skint Tog | 4 GB | 1 / 7 days | Free |
| Creative Premium | 100 GB | 1 / 7 / 30 days | £12/mo or £120/yr |
| Production Max | 250 GB | 1 / 7 / 30 / 90 days | £24/mo or £240/yr |
| Enterprise | Unlimited | Custom | Contact us |

Full details at [share.refueler.io/upgrade](https://share.refueler.io/upgrade).

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

🟢 **Session 39 complete — Block 4 security hardening in progress.**

Full upload → share link → passphrase gate → download flow is end-to-end functional and live at [share.refueler.io](https://share.refueler.io).

**Completed blocks:**
- **B1 — SSG Migration:** Eleventy 3.x scaffold, `src/` → `frontend/`, Cloudflare Pages auto-deploy live.
- **B2 — Instrumentation:** Analytics Engine (`share_events`), Supabase aggregation, admin dashboard (`/admin/dashboard.html`), 13-metric smoke test, `/admin/snapshot` endpoint.
- **B3 — Stripe test coverage:** Checkout flow verified (embedded Payment Element, direct Subscription + PaymentIntent), webhook upsert confirmed, Customer Portal live, cancellation logic code-complete.
- **B4 — Security hardening (in progress):** BLAKE3 Worker WASM compiled from Rust (`blake3` crate v1.8.5), deployed S34. Server-side chunk hash verification live on every upload. AES-GCM AAD overflow fixed S35 (chunk index ≥256 now safe). KV-backed rate limiting deployed S36. Frontend error reporting via `/log/error` deployed S36b. Admin dashboard completed S37. AE SQL `client_errors_24h` query live S38. Server-side tier enforcement deployed S39: tier resolved from Supabase via `X-Email`, 10 MB chunk hard cap, KV cumulative byte counter per upload UUID.

---

## Licence

Apache 2.0 — open infrastructure, open source. The patent grant clause protects the novel BLAKE3 + Cashu blind signature combination.  
The Cashu blind signature implementation within this repo is a closed-loop, non-monetary application. No external Cashu mint is used or connected.
