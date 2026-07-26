# refueler-share

> Zero-knowledge, end-to-end encrypted file transfer. No account. No tracking. No key on our side.

**Live at:** [share.refueler.io](https://share.refueler.io)  
**Part of the [Refueler](https://refueler.io) ecosystem**

---

## What This Is

`refueler-share` is an anonymous, encrypted file transfer system. It is not a standard file host. It is a cryptographic pipeline:

- Files are encrypted **in the browser** before a single byte leaves your machine
- The server is **architected to be blind** — reading your files is not technically possible for us, regardless of policy, jurisdiction, or legal compulsion
- Storage is **ephemeral** — hard deletion via R2 lifecycle rules, no exceptions
- Transfers run at **full line speed** — no artificial throttling, even on the free tier

---

## The Architecture

### Two-Layer Cryptographic Stack

**BLAKE3 — Chunk Integrity**  
Every file is split into chunks. Each chunk is fingerprinted with BLAKE3, computed client-side via a compiled WebAssembly module. The Cloudflare Worker independently recomputes the hash of every received chunk and verifies it against the client-declared value before writing to R2. A corrupted or tampered chunk is rejected at the Worker boundary.

The Worker-side BLAKE3 implementation is compiled from the official Rust `blake3` crate (v1.8.5) via `wasm-pack`, checked into `worker/blake3-wasm/`, and imported statically. No CDN dependency.

BLAKE3 is used exclusively for chunk integrity verification. It is not the authentication layer.

**Cashu Blind Signatures — Anonymous Upload Authentication**  
Access tokens are issued using the blind signature scheme from the Cashu protocol (NUT-00). The server signs a blinded upload credential without learning the token's serial number. The client presents the unblinded proof to authorise a transfer.

This is not a monetary use of Cashu. There is no external mint. The blind signature primitive is repurposed as a zero-knowledge anonymous credential system — structurally preventing the server from linking any user identity to a specific transfer.

> **This combination — BLAKE3 chunk integrity + Cashu blind signatures as anonymous auth — has not been publicly implemented before.**

### Why "we can't read your files" is an architectural claim, not a policy promise

The AES-256 session key is generated inside your browser using the Web Crypto API and placed in the URL fragment — the `#` portion. Browsers, per RFC 3986, never transmit the fragment to a server. It does not appear in HTTP requests, Worker logs, or anywhere in our infrastructure.

Our Worker receives encrypted bytes and stores them in R2. It has no key. A court order compelling us to hand over file contents would be complied with immediately — and yield nothing readable. A breach of our R2 bucket exposes only ciphertext.

This is not a policy choice. It is the consequence of how the code is written.

---

## Stack

| Layer | Technology |
|-------|-----------|
| Frontend | HTML5 / Web Streams API / BLAKE3 WASM |
| Backend | Cloudflare Workers (serverless, blind relay) |
| Storage | Cloudflare R2 (zero egress fees, lifecycle-enforced deletion) |
| Ledger | Supabase PostgreSQL (spent-token tracking only) |
| Payments | Stripe · Lightning BOLT11 |
| Encryption | AES-GCM 256-bit (client-side only) |

---

## Tiers

| Tier | Cap | Expiry options | Price |
|------|-----|----------------|-------|
| Skint Tog | 4 GB | 1 / 7 days | Free |
| Creative Premium | 100 GB | 1 / 7 / 30 days | £12/mo or £120/yr |
| Production Max | 250 GB | 1 / 7 / 30 / 90 days | £24/mo or £240/yr |
| Enterprise | Unlimited | Custom | Contact us |

Full details at [share.refueler.io/upgrade](https://share.refueler.io/upgrade).

---

## Status

🟢 **Block 6 in progress — testing infrastructure and folder upload.**

Full upload → share link → passphrase gate → download flow is live at [share.refueler.io](https://share.refueler.io). Folder upload (client-side zip, directory structure preserved) is supported.

**Completed blocks:**
- **B1** — Eleventy SSG scaffold, Cloudflare Pages deploy
- **B2** — Analytics Engine instrumentation, Supabase aggregation, admin dashboard
- **B3** — Stripe checkout, webhook handler, Customer Portal
- **B4** — Security hardening: BLAKE3 Worker WASM, server-side chunk verification, AES-GCM AAD fix, KV rate limiting, MIME denylist, UUID validation, filename sanitisation, UUID-bound credential issuance, Turnstile nonce binding
- **B5** — Design system full pass: DESIGN-TOKENS.md, Paper/Carbon toggle, FSAA streaming download, receiver landing page
- **B6** — Folder upload (fflate), bearer token TTL fix, Worker unit test suite (178 tests, 6 suites)

---

## Licence

Apache 2.0. The patent grant clause protects the novel BLAKE3 + Cashu blind signature combination.  
The Cashu blind signature implementation is a closed-loop, non-monetary application. No external Cashu mint is used or connected.
