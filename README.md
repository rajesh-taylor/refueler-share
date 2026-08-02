# refueler-share

> Anonymous, end-to-end encrypted file transfer. No account. No tracking. No key on our side.

**Live at:** [share.refueler.io](https://share.refueler.io)  
**Part of the [Refueler](https://refueler.io) ecosystem**

---

## What This Is

`refueler-share` is an anonymous, encrypted file transfer system. It is not a standard file host. It is a cryptographic pipeline:

- Files are encrypted **in the browser** before a single byte leaves your machine
- The server is **architected to be blind** — reading your files is not technically possible for us, regardless of policy, jurisdiction, or legal compulsion
- Storage is **ephemeral** — hard deletion via R2 lifecycle rules, no exceptions
- Transfers run at **full line speed** — no artificial throttling, even on the free tier
- **No account required** — not on the free tier, not ever

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
| Payments | Stripe (fiat) · Lightning BOLT11 via Blink |
| Encryption | AES-GCM 256-bit (client-side only) |

---

## Tiers

| Tier | Cap | Expiry options | Billing |
|------|-----|----------------|---------|
| Free | 4 GB | 1 / 7 days | — |
| Creative Premium | 100 GB | 1 / 7 / 30 days | Monthly / 3-month / yearly |
| Production Max | 250 GB + API access | 1 / 7 / 30 / 90 days | Monthly / 3-month / yearly |
| Business | 2 TB/month · 1,000 credentials | 1 / 7 / 30 / 90 days | Invoiced annually |
| Enterprise | Custom · 5 TB/month included | Custom | Annual contract |

Full details at [share.refueler.io/upgrade](https://share.refueler.io/upgrade).

No free trials. No discounts. No savings framing. The price is the price.

---

## Security and Incident Response

### What a breach at Refueler Share actually exposes

| Data | Held by us? | Readable under compulsion or breach? |
|------|------------|--------------------------------------|
| File contents | No — ciphertext only in R2 | No — key never existed on our servers |
| AES-GCM session key | No — URL fragment, never transmitted | No — does not exist in our infrastructure |
| Sender / recipient identity (free tier) | No | No |
| File sizes and transfer timestamps | Yes | Yes — disclosed voluntarily (see B9 whitepaper) |
| Stripe subscriber email and name (paid tier) | Yes | Yes |
| Lightning payment hashes | Yes, 25h TTL | Yes, within TTL window |

The short version: a full exfiltration of our R2 storage returns encrypted noise. The key was in the link. We never held it.

This is documented in advance because it should be documented in advance. A company that has thought through the worst case before it happens is more trustworthy than one that works it out under pressure.

### Incident response documentation

- `docs/incident-response.md` — the standing playbook: severity tiers (S1/S2/S3), pre-written communication templates, channel order, UK GDPR Article 33 obligations and process, status page KV schema, tabletop simulation checklist.
- `security-breach.md` — the living breach register: one entry per confirmed or suspected incident, entry template included, currently empty.

The tabletop simulation (a structured walkthrough of a realistic S1 scenario) will be completed before the first paying customer. The results will be documented in `security-breach.md`.

---

## Status

🟡 **Block 7 in progress — Lightning payments.**

Full upload → share link → optional passphrase gate → download flow is live at
[share.refueler.io](https://share.refueler.io). Folder upload (client-side zip via fflate,
directory structure preserved, up to 2,000 files and 20 levels deep) is supported.

**Completed blocks:**

| Block | Scope |
|-------|-------|
| B1 | Eleventy SSG scaffold, Cloudflare Pages deploy, Cashu NUT-00 credential issuance |
| B2 | Analytics Engine instrumentation, Supabase aggregation, admin dashboard |
| B3 | Stripe checkout, webhook handler, Customer Portal |
| B4 | Security hardening: BLAKE3 Worker WASM, server-side chunk verification, AES-GCM AAD fix, KV rate limiting, MIME denylist, UUID validation, filename sanitisation, UUID-bound credential issuance, Turnstile nonce binding |
| B5 | Design system full pass: Paper/Carbon theme toggle, FSAA streaming download, receiver landing page |
| B6 | Folder upload (fflate, client-side zip), bearer token TTL fix, 212 tests across 8 suites (6 unit + 2 integration), security regression suite, k6 load tests, GitHub Actions CI Level 1 |

**Upcoming:**

| Block | Scope |
|-------|-------|
| B7 | Lightning BOLT11 payments via Blink. Anonymous paid tier — no email, no account, credential issued on payment. |
| SW | White-label API. Custom hostnames. Business tier dashboard. Webhook delivery. IT handover flow. |
| B8 | NUT-11 Mode 2 keypair authentication (Production Max). Argon2id KDF for Enterprise passphrase-protected transfers. |
| B9 | Security whitepaper. Staging and demo environment. LNbits fork. LNURL-withdraw credential delivery. Status page incident dashboard. Tabletop simulation. |
| B10 | ML-KEM post-quantum key wrapping. Enterprise tier. Chaos tests. |
| B11 | Alpha. Full load test. CI Level 3. Dashboard test card. |
| B12 | Public beta. FROST threshold signatures (M-of-N transfer authorisation). |

---

## Licence

Apache 2.0. The patent grant clause protects the novel BLAKE3 + Cashu blind signature combination.  
The Cashu blind signature implementation is a closed-loop, non-monetary application. No external Cashu mint is used or connected.
