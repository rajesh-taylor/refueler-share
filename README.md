# refueler-share

> Anonymous, encrypted file transfer. No account. No email. No key on our side.

**Live at:** [refueler.io/share](https://refueler.io/share)  
**Part of the [Refueler](https://refueler.io) ecosystem**

---

## What This Is

Refueler Share is not a file host. It is a cryptographic pipeline.

Files are encrypted in your browser before a single byte leaves your machine. The server is architecturally blind — not by policy, but by design. The key never exists on our infrastructure. A court order compelling us to hand over file contents would be complied with immediately, and yield nothing readable.

No account is required on the free tier. The anonymous rail requires no account at any tier, ever.

---

## The Architecture

### Three layers. Three jobs. Never conflated.

**BLAKE3 — Chunk Integrity**

Every file is split into chunks before upload. Each chunk is fingerprinted with BLAKE3, computed client-side via a compiled WebAssembly module. The Worker independently verifies every received chunk against the client-declared hash before writing to R2. A corrupted or tampered chunk is rejected at the boundary.

The BLAKE3 module is compiled from the official Rust `blake3` crate via `wasm-pack`, checked into `worker/blake3-wasm/`, and imported statically. No CDN dependency at runtime.

BLAKE3 handles chunk integrity. It is not the authentication layer. Full Merkle-root verification — where the Worker reconstructs the complete ciphertext tree on download and compares it against the root committed at upload — is in build (B9).

**Cashu Blind Signatures — Anonymous Upload Authentication**

Upload credentials are issued using the blind signature scheme from the Cashu protocol (NUT-00). The server signs a blinded credential without learning its serial number. The client presents the unblinded proof to authorise a transfer — the server cannot link any identity to any transfer.

This is not a monetary application of Cashu. There is no external mint. The blind signature primitive is used as an anonymous credential system.

> This combination — BLAKE3 chunk integrity with Cashu blind signatures as anonymous authentication — has not been publicly implemented before. The Apache 2.0 patent grant clause in this repository protects this combination.

**SHA-256 + OpenTimestamps — Bitcoin-Anchored Existence Proof**

For Sovereign and Chartered subscribers who opt in, a permanent record can be attached to any transfer. A commitment — derived from the file's BLAKE3 root and a private nonce — is submitted to the OpenTimestamps calendar network and anchored to the Bitcoin blockchain.

The Worker is a blind relay throughout: it forwards opaque encrypted bytes to calendar servers and stores the encrypted result. It never sees the plaintext, the nonce, or the file. The nonce lives in the URL fragment only — the same privacy guarantee as the AES key.

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
| Payments (fiat) | Stripe — GBP, live mode |
| Payments (Lightning) | LNbits on self-hosted Hetzner (phoenixd) — B7 |
| Encryption | AES-GCM 256-bit, client-side only |
| Integrity | BLAKE3 WASM, client + server |
| Existence proof | SHA-256 / OpenTimestamps / Bitcoin |
| Anonymous auth | Cashu NUT-00 blind signatures |
| API auth | HMAC-SHA256 per-request signing |

---

## Tiers

| Tier | Rail | Storage cap | Expiry options |
|------|------|-------------|----------------|
| **Pro Bono** | — | 4 GB | 7 days |
| **Citizen** | Registered (Stripe) | 100 GB | 7 / 30 / 90 days |
| **Sovereign** | Bearer (Lightning) | 100 GB | 7 / 30 / 90 days |
| **Chartered** | Registered or Bearer | 250 GB + overage | 90 days |

Citizen and Sovereign are the same price and feature set for everything currently live. The rail is a privacy choice, not a tier upgrade — features may diverge naturally as the product develops.

The Chartered tier is invoiceable — firms that cannot pay by card or Lightning can be invoiced directly. API and MCP access is Chartered only.

No free trials. No discounts. No savings framing. The price is the price.

---

## Transfer Features

**Destroy after download** — the transfer is deleted the moment it is collected. The recipient cannot return to it.

**Availability window** — restrict the window during which a transfer can be collected. Set an open-from time, a close-by time, or both. Paid tiers only.

**Permanent record** — attach a Bitcoin-anchored date stamp to a transfer. Proves the file existed on or before a specific block date. Verifiable independently via OpenTimestamps. Paid tiers only.

**Passphrase gate** — require a passphrase before the recipient can download. The passphrase hash is stored in the manifest; the passphrase itself never touches the server in plaintext.

**Folder upload** — drag a folder or use the folder picker. Files are compressed client-side using fflate (streaming, up to 2,000 files and 20 directory levels) and uploaded as a single encrypted transfer.

**Resumable uploads** — interrupted uploads can be resumed without restarting. State is held in IndexedDB on the sender's device, never on our servers.

---

## API and MCP

Refueler Share exposes a HMAC-authenticated API at `api.share.refueler.io`. Every request is signed with HMAC-SHA256 over `method + path + timestamp + body_hash`. Three credentials per commercial relationship: a live key, a signing key, and a webhook signing key.

The API ships a companion MCP (Model Context Protocol) server as an Apache 2.0 npm package — [`@refueler/mcp-server`](https://github.com/rajesh-taylor/refueler-mcp). Operators install it in their own infrastructure; Refueler never sees their keys or plaintext. Full documentation, trust boundary details, and installation instructions are in that repo.

**Credit model:** 1 credit = 1 sat. Rate card v1.0: 10 credits/transfer · 100 credits/GB · 20 credits/permanent record. Identity-rail clients hold a server-side credit pool; anonymous-rail clients hold bearer Cashu tokens locally — the server cannot see their balance.

---

## Security

### What a breach at Refueler Share actually exposes

| Data | Held by us? | Readable under compulsion or breach? |
|------|------------|--------------------------------------|
| File contents | No — ciphertext only in R2 | No — key never existed on our servers |
| AES-GCM session key | No — URL fragment, never transmitted | No — does not exist in our infrastructure |
| Sender / recipient identity (Bearer rail) | No | No |
| Sender / recipient identity (Registered rail) | No | No |
| File sizes and transfer timestamps | Yes | Yes |
| Stripe subscriber email (Registered rail) | Yes | Yes |
| Lightning payment hashes | Yes, 25h TTL | Yes, within TTL window |

A full exfiltration of our R2 storage returns encrypted noise. The key was in the link. We never held it.

### Incident response

- `docs/incident-response.md` — severity tiers (S1/S2/S3), pre-written communication templates, UK GDPR Article 33 obligations, status page schema, tabletop simulation checklist.
- `security-breach.md` — living breach register. Currently empty.

---

## Build Status

**SW-MCP-8 complete · 484 tests passing (refueler-share) · 228 tests passing (refueler-mcp)**

| Block | Status | Scope |
|-------|--------|-------|
| B1 | ✅ | SSG scaffold, Cloudflare Pages deploy, Cashu NUT-00 credential issuance |
| B2 | ✅ | Analytics Engine, Supabase aggregation, admin dashboard |
| B3 | ✅ | Stripe checkout, webhook handler, Customer Portal |
| B4 | ✅ | BLAKE3 WASM, server-side chunk verification, AES-GCM AAD, rate limiting, MIME denylist, UUID validation |
| B5 | ✅ | Paper/Carbon design system, FSAA streaming download, receiver landing page |
| B6 | ✅ | Folder upload, resumable uploads, 212 tests, k6 load tests, CI Level 1 |
| TG-block | ✅ | Destroy after download, tidal availability window, Execution Dock, owner DELETE |
| TH-block | ✅ | Permanent record (OTS + Bitcoin), JS refactor (5-module split) |
| SW-block | ✅ | CF for SaaS, HMAC API auth, credential issuance, webhooks, receipts, sandbox, hostname health |
| SW-MCP-1…8 | ✅ | MCP server scaffold through npm distribution — [`@refueler/mcp-server`](https://github.com/rajesh-taylor/refueler-mcp) |

| Block | Scope |
|-------|-------|
| B7 | Lightning BOLT11 payments via self-hosted LNbits + phoenixd |
| B8 | NUT-11 Mode 2 keypair authentication |
| B9 | Full Merkle-root verification, ciphertext storage integrity, security whitepaper |
| B10 | ML-KEM post-quantum key wrapping |

---

## Repo Layout

```
worker/src/       Cloudflare Worker — upload, download, auth, receipts,
                  webhooks, OTS relay, tiers, rate limiting
frontend/         Browser JS and CSS (canonical source)
  share.js        Entry point, DOM, mode detection
  crypto.js       AES-GCM, BLAKE3, NUT-00, SHA-256, config constants
  upload.js       Upload state machine, IDB resume, folder handling
  download.js     Download state machine, OTS offer
  timestamp.js    OTS pipeline
bin/sync-share.sh Asset sync from frontend/ to refueler-io/src/share/assets/
docs/             Incident response, security documentation
```

Frontend assets are canonical here and mirrored into the `refueler-io` repo by `bin/sync-share.sh`. Never edit the mirror directly.

---

## Licence

Apache 2.0. The patent grant clause protects the novel BLAKE3 + Cashu blind signature combination.

The Cashu blind signature implementation is a closed-loop, non-monetary application. No external Cashu mint is used or connected.
