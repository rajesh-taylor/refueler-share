# refueler-share

> Anonymous, encrypted file transfer. No account. No email. No key on our side.

**Live at:** [refueler.io/share](https://refueler.io/share)  
**Part of the [Refueler](https://refueler.io) ecosystem**

---

## What This Is

Refueler Share is not a file host. It is a cryptographic pipeline.

Files are encrypted in your browser before a single byte leaves your machine. The key goes into the share link, never to us. A court order for file contents would be complied with, and would yield ciphertext.

No account is needed on the free tier. The anonymous (Bearer) rail will need no account at any tier.

---

## The Architecture

### Three hashes. Three jobs. Never conflated.

**BLAKE3 — ciphertext storage integrity**

Every file is split into 32 MiB chunks and encrypted in the browser. Each encrypted chunk is fingerprinted with BLAKE3 (WebAssembly, compiled from the official Rust `blake3` crate), and the fingerprints form a Merkle tree (RFC 6962 shape, domain-separated, `rfc6962-unbalanced-blake3-v1`).

The browser uploads chunks straight to Cloudflare R2 through short-lived signed URLs; the Worker is not in the upload path. When the upload finishes, the Worker checks every chunk is present and records the chunk fingerprints and the Merkle root. On download, the Worker checks each stored chunk against that record before sending it, and refuses (`409`) on any mismatch.

What this proves: the encrypted object served is the encrypted object stored. It is **not** an end-to-end integrity claim. The Worker never sees plaintext, so it cannot vouch for the file you meant to send; only the recipient's browser can check the decrypted bytes.

**Cashu blind signatures — anonymous upload credentials**

Upload credentials use the blind signature scheme from the Cashu protocol (NUT-00). The server signs a blinded value without seeing what it signs. There is no account and no email behind a free upload, so there is no identity for us to attach to it.

This is not a monetary use of Cashu. There is no external mint; the blind signature is used as an anonymous credential. We are moving credentials onto the standard Cashu proof format, checked with the Cashu developers' reviewed library code rather than our own, which also opens the door to DLEQ proofs (NUT-12) and keypair-bound credentials (NUT-11). In build.

**SHA-256 + OpenTimestamps — Bitcoin-anchored existence proof**

On paid tiers, a sender can attach a permanent record to a transfer. A commitment derived from the file and a private nonce is submitted to the OpenTimestamps calendars and anchored in Bitcoin.

The Worker is a blind relay: it forwards opaque bytes to the calendars and stores the encrypted result. It never sees the plaintext, the nonce, or the file. The nonce lives in the URL fragment, like the AES key.

The result proves a file existed on or before a Bitcoin block date. It proves *when*, not *who*, and not that anyone received it.

### Why "we can't read your files" is an architectural claim

The AES-256-GCM key is generated in your browser with the Web Crypto API and placed in the URL fragment (the part after `#`). Per RFC 3986, browsers do not send the fragment to the server. The real filename travels there too; the Worker only ever sees the placeholder `encrypted-payload`.

The Worker stores encrypted bytes. It has no key.

---

## Stack

| Layer | Technology |
|-------|-----------|
| Frontend | HTML5 / ES Modules / Web Crypto API / BLAKE3 WASM |
| Backend | Cloudflare Workers (Paid plan) |
| Storage | Cloudflare R2, direct browser upload via signed URLs |
| Ledger | Supabase PostgreSQL (spent-credential tracking) |
| Payments (card) | Stripe, GBP |
| Payments (Lightning) | LNbits, self-hosted on Hetzner — planned (B7) |
| Encryption | AES-256-GCM, client-side only |
| Integrity | BLAKE3 WASM + Merkle root, ciphertext only |
| Existence proof | SHA-256 / OpenTimestamps / Bitcoin |
| Anonymous credentials | Cashu NUT-00 blind signatures |
| API auth | HMAC-SHA256 per-request signing |

---

## Tiers

| Tier | Rail | Storage cap | Expiry | Status |
|------|------|-------------|--------|--------|
| **Pro Bono** | — | 4 GB | 7 days | Live |
| **Citizen** | Registered (Stripe) | 100 GB | 7 / 30 / 90 days | Account sign-in in build (B12) |
| **Sovereign** | Bearer (Lightning) | 100 GB | 7 / 30 / 90 days | Needs Lightning (B7) |
| **Chartered** | Registered or Bearer | 250 GB + overage | 90 days | Registered-rail API live; Bearer with B7 |

Until Citizen sign-in ships, web uploads run on Pro Bono limits. Registered users will sign in with a single-use email link and a secure session; the tier comes from that session, never from anything the browser claims.

Citizen and Sovereign are the same price and feature set. The rail is a privacy choice, not an upgrade. Chartered is invoiceable, and API and MCP access is Chartered only.

No free trials. No discounts. The price is the price.

---

## Transfer Features

**Large transfers** — chunks go straight from the browser to storage, so size is bounded by the tier cap, not the Worker. Tested with 100 GiB transfers.

**Destroy after download** — the transfer is deleted once collected; a second attempt gets `410 Gone`.

**Availability window** — set an open-from time, a close-by time, or both. Paid tiers.

**Permanent record** — Bitcoin-anchored date stamp, verifiable independently with OpenTimestamps. Paid tiers.

**Passphrase gate** — the recipient needs a passphrase to download. Only its hash is stored.

**Folder upload** — folders are zipped in the browser (streaming, fflate) and sent as one encrypted transfer.

**Resumable uploads** — an interrupted single-file upload resumes where it stopped. Resume state lives in your browser (IndexedDB), not on our servers.

**Owner delete** — the sender can delete a transfer early. Deletion is batched and resumable, so very large transfers delete completely.

---

## API and MCP

The API lives at `api.share.refueler.io`. Every request is signed with HMAC-SHA256 over `method + path + timestamp + body_hash`. Each commercial relationship gets three credentials: a live key, a signing key, and a webhook signing key.

A companion MCP (Model Context Protocol) server lives at [`refueler-mcp`](https://github.com/rajesh-taylor/refueler-mcp) — source public, Apache 2.0. It runs in the operator's own infrastructure and handles ciphertext only; encryption, the key and the real filename stay on the operator's side. The npm package (`@refueler/mcp-server`) is prepared but not yet published: the send tool is being moved onto the direct-to-R2 upload path first.

**Credit model:** rate card v1.0 — 10 credits per transfer, 100 credits per GB, 20 credits per permanent record. Registered-rail clients draw on a server-side credit pool. Bearer-rail clients will hold their credits locally as Cashu tokens the server cannot see (B7).

---

## Security

### What a breach at Refueler Share actually exposes

| Data | Held by us? | Readable under compulsion or breach? |
|------|------------|--------------------------------------|
| File contents | Ciphertext only, in R2 | No — the key never reaches us |
| AES-GCM key | No — URL fragment, never transmitted | No |
| Real filename | No — URL fragment | No |
| Sender / recipient identity (Bearer rail) | No | No |
| File sizes and transfer timestamps | Yes | Yes |
| Client IP addresses | Briefly — rate-limit counters, about a minute | Yes, within that window |
| Stripe subscriber email (Registered rail) | Yes | Yes |
| Lightning payment hashes (from B7) | Yes, 25 h | Yes, within that window |

Cloudflare, as our host, also sees connecting IP addresses. If that matters to you, connect through Tor Browser or a multi-hop VPN: then the address we and Cloudflare see is an exit relay's, not yours. That protects your location, not your behaviour — a transfer's size and timing are still visible, and anything you sign into still identifies you. Tor users may see extra bot checks.

A full copy of our R2 storage is encrypted noise. The key was in the link.

### How we work on security

Designs are written down before they are built, and security-sensitive blocks get their own review first (for example the B12 storage and sign-in review, `docs/B12-SR-spec-v1.md`). When a review or a soak test finds a problem, the fix and the lesson go into the next build rather than into a footnote.

- `incident-response.md` — severity tiers, communication templates, UK GDPR Article 33 duties.
- `security-breach.md` — breach register. Currently empty.

---

## Build Status

**596 tests passing (refueler-share) · 228 (refueler-mcp)**

| Block | Status | Scope |
|-------|--------|-------|
| B1–B6 | ✅ | Credential issuance, analytics, Stripe, BLAKE3 WASM + chunk checks, AES-GCM AAD, rate limiting, design system, folder upload, resume, CI |
| TG-block | ✅ | Destroy after download, availability window, Execution Dock, owner delete |
| TH-block | ✅ | Permanent record (OpenTimestamps + Bitcoin), frontend module split |
| SW-block | ✅ | Custom API hostname, HMAC API auth, webhooks, receipts, sandbox |
| Share-6 | ✅ | Direct-to-R2 uploads, Merkle root at upload, ciphertext storage verification at download (B9-1…B9-3) |
| Ops | ✅ | Navy Office admin dashboard; batched, resumable deletes; one-command frontend deploy with byte-level live check, pre-push guard and CI mirror check |
| B12 | In progress | Storage quotas, Registered sign-in, billing. Design and security review done; first build session shipped |

| Next | Scope |
|------|-------|
| Credential hardening | Standard Cashu proof format, reviewed library code, DLEQ |
| B8 | NUT-11 keypair-bound credentials (the Locke) |
| B7 | Lightning via self-hosted LNbits; Bearer rail |
| Silent Drop | Standing, anonymous intake for receiving files |
| B9 (rest) | Receipts carrying the ciphertext Merkle root, transfer history, security whitepaper |
| B10 | ML-KEM post-quantum key wrapping |

---

## Repo Layout

```
worker/src/          Cloudflare Worker — issue, initiate/finalise, download
                     verification, delete, receipts, webhooks, OTS relay, tiers
worker/test/         Unit tests (Vitest, workerd pool)
frontend/            Browser JS and CSS (canonical source)
  share.js           Entry point, DOM, mode detection
  crypto.js          AES-GCM, BLAKE3, NUT-00, SHA-256, config constants
  merkle.js          Browser Merkle tree (twin of worker/src/merkle.js)
  upload.js          Upload state machine, IDB resume, folder handling
  download.js        Download state machine, OTS offer
  timestamp.js       OTS pipeline
bin/ship-frontend.sh Commit, mirror into refueler-io, push both, prove bytes live
bin/sync-share.sh    Mirror step and --check / --live diagnostics
bin/githooks/        Pre-push guard: main can't drift from the live site
docs/                Design specs and security reviews
merkle-spec-v1.md    Merkle tree specification
```

Frontend files are canonical here and served from `refueler.io/share/` via the `refueler-io` repo. Ship with `bin/ship-frontend.sh`; never edit the mirror directly.

---

## Licence

Apache 2.0. The licence includes an express patent grant from contributors, and publishing the design here puts it on the public record.

The Cashu blind signature use is closed-loop and non-monetary. No external Cashu mint is used or connected.
