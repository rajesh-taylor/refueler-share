# refueler-share

> Anonymous, end-to-end encrypted file transfer. No account. No email. No key on our side.

**Live at:** [refueler.io/share](https://refueler.io/share)  
**Part of the [Refueler](https://refueler.io) ecosystem

---

## What This Is

Refueler Share is not a file host. It is a cryptographic pipeline.

Files are encrypted in your browser before a single byte leaves your machine. The server is architecturally blind — not by policy, but by design. The key never exists on our infrastructure. A court order compelling us to hand over file contents would be complied with immediately, and yield nothing readable.

No account is required. Not on the free tier, not ever.

---

## The Architecture

### Three layers. Three jobs. Never conflated.

**BLAKE3 — Chunk Integrity**

Every file is split into chunks before upload. Each chunk is fingerprinted with BLAKE3, computed client-side via a compiled WebAssembly module. The Worker independently verifies every received chunk against the client-declared hash before writing to R2. A corrupted or tampered chunk is rejected at the boundary.

The BLAKE3 module is compiled from the official Rust `blake3` crate via `wasm-pack`, checked into `worker/blake3-wasm/`, and imported statically. No CDN dependency at runtime.

BLAKE3 handles integrity. It is not the authentication layer.

**Cashu Blind Signatures — Anonymous Upload Authentication**

Upload credentials are issued using the blind signature scheme from the Cashu protocol (NUT-00). The server signs a blinded credential without learning its serial number. The client presents the unblinded proof to authorise a transfer — the server cannot link any identity to any transfer.

This is not a monetary application of Cashu. There is no external mint. The blind signature primitive is used as a zero-knowledge anonymous credential system.

> This combination — BLAKE3 chunk integrity with Cashu blind signatures as anonymous authentication — has not been publicly implemented before. The Apache 2.0 patent grant clause in this repository protects this combination.

**SHA-256 + OpenTimestamps — Bitcoin-Anchored Existence Proof**

For Sovereign subscribers who opt in, a permanent record can be attached to any transfer. A commitment — derived from the file's BLAKE3 root and a private nonce — is submitted to the OpenTimestamps calendar network and anchored to the Bitcoin blockchain.

The Worker is a blind relay throughout: it forwards opaque encrypted bytes to calendar servers and stores the encrypted result. It never sees the plaintext timestamp, the nonce, or the file. The nonce lives in the URL fragment only — the same privacy guarantee as the AES key.

The result: a tamper-proof, third-party-verified record that a specific file existed on or before a specific Bitcoin block date. It proves *when*, not *who*. No notary. No trusted third party beyond Bitcoin itself.

### Why "we can't read your files" is an architectural claim, not a policy promise

The AES-256 session key is generated inside your browser using the Web Crypto API and placed in the URL fragment — the `#` portion of the link. Per RFC 3986, browsers never transmit the fragment to a server. It does not appear in HTTP requests, Worker logs, or anywhere in our infrastructure.

Our Worker receives encrypted bytes. It stores encrypted bytes. It has no key.

This is not a policy choice. It is the consequence of how the code is written.

---

## Stack

| Layer | Technology |
|-------|-----------|
| Frontend | HTML5 / ES Modules / Web Crypto API / BLAKE3 WASM |
| Backend | Cloudflare Workers |
| Storage | Cloudflare R2 |
| Ledger | Supabase PostgreSQL (spent-token tracking only) |
| Payments (fiat) | Stripe |
| Payments (Lightning) | LNbits on self-hosted Hetzner (phoenixd) |
| Encryption | AES-GCM 256-bit, client-side only |
| Integrity | BLAKE3 WASM, client + server |
| Existence proof | SHA-256 / OpenTimestamps / Bitcoin |
| Anonymous auth | Cashu NUT-00 blind signatures |

---

## Tiers

| Tier | Cap | Expiry | Rail |
|------|-----|--------|------|
| **Citizen** | 4 GB | 1 / 7 days | — |
| **Sovereign** | 100 GB | 1 / 7 / 30 / 90 days | Stripe or Lightning |
| **Business** | 2 TB/month · 1,000 credentials | 1 / 7 / 30 / 90 days | Invoiced |
| **Enterprise** | Custom · 5 TB/month | Custom | Annual contract |

Sovereign has two payment rails. The Stripe rail requires an email address for billing and account recovery. The Lightning rail requires nothing — no email, no account, no identity at any layer. The rail is a privacy choice, not a tier upgrade.

No free trials. No discounts. No savings framing. The price is the price.

---

## Transfer Features

**Destroy after download** — the transfer is deleted the moment it is downloaded. The recipient cannot return to it.

**Availability window** — restrict the window during which a transfer can be downloaded. Set an open-from time, a close-by time, or both. Sovereign tier only.

**Permanent record** — attach a Bitcoin-anchored date stamp to a transfer. Proves the file existed on or before a specific block date. Verifiable independently via OpenTimestamps. Sovereign tier only.

**Passphrase gate** — require a passphrase before the recipient can download. The passphrase hash is stored in the manifest; the passphrase itself never touches the server in plaintext.

**Folder upload** — drag a folder or use the folder picker. Files are compressed client-side using fflate (streaming, up to 2,000 files and 20 directory levels) and uploaded as a single encrypted zip.

---

## Security and Incident Response

### What a breach at Refueler Share actually exposes

| Data | Held by us? | Readable under compulsion or breach? |
|------|------------|--------------------------------------|
| File contents | No — ciphertext only in R2 | No — key never existed on our servers |
| AES-GCM session key | No — URL fragment, never transmitted | No — does not exist in our infrastructure |
| Sender / recipient identity (Citizen tier) | No | No |
| File sizes and transfer timestamps | Yes | Yes |
| Stripe subscriber email and name (Sovereign Stripe rail) | Yes | Yes |
| Lightning payment hashes | Yes, 25h TTL | Yes, within TTL window |

A full exfiltration of our R2 storage returns encrypted noise. The key was in the link. We never held it.

This is documented in advance because it should be documented in advance.

### Incident response

- `docs/incident-response.md` — severity tiers (S1/S2/S3), pre-written communication templates, UK GDPR Article 33 obligations, status page schema, tabletop simulation checklist.
- `security-breach.md` — living breach register. Currently empty.

A tabletop simulation will be completed before the first paying customer.

---

## Build Status

**TH-block complete · CI green · 324 tests passing**

| Block | Status | Scope |
|-------|--------|-------|
| B1 | ✅ | SSG scaffold, Cloudflare Pages deploy, Cashu NUT-00 credential issuance |
| B2 | ✅ | Analytics Engine, Supabase aggregation, admin dashboard |
| B3 | ✅ | Stripe checkout, webhook handler, Customer Portal |
| B4 | ✅ | Security hardening: BLAKE3 WASM, server-side chunk verification, AES-GCM AAD, rate limiting, MIME denylist, UUID validation, UUID-bound credential issuance |
| B5 | ✅ | Paper/Carbon design system, FSAA streaming download, receiver landing page |
| B6 | ✅ | Folder upload, bearer token TTL, 212 tests, k6 load tests, GitHub Actions CI Level 1 |
| TG-block | ✅ | Destroy after download, tidal availability window, Execution Dock, owner DELETE, 432 tests |
| TH-block | ✅ | Permanent record (OTS + Bitcoin), `share.js` refactor (crypto/upload/download split), 324 tests |

| Block | Scope |
|-------|-------|
| SW | White-label API, custom hostnames, Business tier dashboard, webhook delivery |
| B7 | Lightning BOLT11 payments via self-hosted LNbits + phoenixd |
| B8 | NUT-11 Mode 2 keypair authentication. Argon2id KDF for Enterprise |
| B9 | Security whitepaper, staging environment, tabletop simulation |
| B10 | ML-KEM post-quantum key wrapping |
| B11 | Alpha, full load test, CI Level 3 |
| B12 | Public beta, FROST threshold signatures |

---

## Licence

Apache 2.0. The patent grant clause protects the novel BLAKE3 + Cashu blind signature combination.

The Cashu blind signature implementation is a closed-loop, non-monetary application. No external Cashu mint is used or connected.
