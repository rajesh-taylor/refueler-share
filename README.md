# refueler-share

> Encrypted file transfer. Your browser encrypts the file; the key travels in the link, never to us.

**Use it:** [share.refueler.io](https://share.refueler.io) · **About:** [refueler.io/share](https://refueler.io/share/) · **Stage:** alpha ([what that means](https://refueler.io/share/#alpha))

Part of [Refueler](https://refueler.io). Source published under Apache 2.0.

---

## What it does

You choose a file, your browser encrypts it, and you get a link. Whoever has the link can download and decrypt it. No account or email is needed for the free tier.

The encryption key is made in your browser and placed in the link's fragment (the part after `#`). Browsers never send the fragment to a server, so the key never reaches us. The real filename travels there too.

What we store is ciphertext. A full copy of our storage, handed over or stolen, is encrypted bytes with no key.

## What it doesn't do

Honest scope matters more than a long feature list:

- **It does not hide that a transfer happened, when, or roughly how big it was.** The number of encrypted chunks gives the size to within 32 MiB, and anyone with access to the stored objects can work out the exact size.
- **It does not hide your IP address from our host.** Cloudflare, which serves Share, sees connecting addresses. Use Tor Browser or a multi-hop VPN if that matters to you.
- **Our integrity check covers ciphertext, not your file.** The server checks that the encrypted object it serves is the one it stored. Only the recipient's browser, which holds the key, can check the decrypted file.
- **A permanent record proves *when*, not *who*.** On paid tiers a sender can anchor a date stamp in Bitcoin through OpenTimestamps. It shows a file existed on or before a block date. It does not prove authorship or delivery.

## How it is built

| Job | How |
|---|---|
| Encryption | AES-256-GCM in the browser (Web Crypto). Each chunk has its own nonce under a key derived from the link key. |
| Storage | Cloudflare R2. The browser uploads straight to storage through short-lived signed URLs. |
| Ciphertext integrity | BLAKE3 per chunk and a Merkle root (RFC 6962 shape, domain-separated), checked by the Worker on every download. Spec: [`merkle-spec-v1.md`](merkle-spec-v1.md). |
| Anonymous upload credentials | Standard Cashu proofs (NUT-00) with DLEQ (NUT-12), verified with the Cashu developers' library [`@cashu/cashu-ts`](https://github.com/cashubtc/cashu-ts). No external mint; not a monetary use. Note: [`docs/Cred-verification-note-v1.md`](docs/Cred-verification-note-v1.md). |
| Existence proof | SHA-256 commitment, OpenTimestamps, Bitcoin. Computed in the browser; the Worker only relays opaque bytes. |
| Served code | One origin, `share.refueler.io`, with a strict Content Security Policy: no inline scripts, no third-party scripts except Cloudflare's bot check, no analytics. |

Vendored third-party code is listed with hashes in [`frontend/VENDORED.md`](frontend/VENDORED.md) and checked in CI. Every Worker route and the gate in front of it is listed in [`docs/ROUTES.md`](docs/ROUTES.md).

## Checking it yourself

- Open your browser's developer tools on [share.refueler.io](https://share.refueler.io) and look at the network panel while you send a file: the key and filename never leave the page.
- Share's own JavaScript is served as plain, unminified ES modules; compare it with `frontend/` in this repository. The few third-party libraries are listed, with hashes, in `frontend/VENDORED.md`.
- A step-by-step page for checking the served files against a published release is planned.

## Security

If you find a security problem, please tell us privately before publishing it: use **Report a vulnerability** on this repository's **Security** tab.

How incidents are handled: [`incident-response.md`](incident-response.md). Breach register: [`security-breach.md`](security-breach.md) (empty). Security designs and reviews are in [`docs/`](docs/).

## Repository layout

```
frontend/        browser code: the app's JavaScript and CSS (frontend/app/ = app-only files)
src/app/         page templates for share.refueler.io
worker/          the Cloudflare Worker (API, credentials, verification) and its tests
bin/             build, check and release scripts
docs/            security designs, reviews, route inventory
supabase/        database migrations
```

## Licence

Apache 2.0 — see [`LICENSE`](LICENSE). The licence includes an express patent grant from contributors.
