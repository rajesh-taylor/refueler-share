# CLAUDE.md — refueler-share
> **Version:** 2.30 | **Initialised:** CC-64 · 8 July 2026 | **Updated:** Ops-Hardening-Ease-1 · 31 Oct 2026
> Load alongside `../refueler-share-private/strategy/share-sessions.md` (and `Share-Master-Context.md` beside it) at the start of every session on this repo.
> For platform-wide context (brand, Supabase, Numo), load the main `claude.md` + `Refueler_MasterContext_CC64.md`.

---

## What this repo is

`refueler-share` is an anonymous, encrypted peer-to-peer file transfer system.
Files are chunked, BLAKE3-hashed for integrity, stored on Cloudflare R2, and access is gated by Cashu blind-signature tokens settled via Lightning (BOLT11).

**Local path:** `/Users/rajeshtaylor/Documents/refueler-share/`
**GitHub:** `rajesh-taylor/refueler-share` (public)
**Licence:** Apache 2.0

---

## Architectural lock

| Layer | Technology | Role |
|---|---|---|
| Chunk indexing & verification | BLAKE3 | Internal only — content addressing, integrity checks |
| Existence proof | SHA-256 (OTS) | Client-side only — Bitcoin-anchored permanent record. Never touches Worker. |
| Anonymous authentication | Cashu blind signatures | Access tokens, payment gate |
| Storage | Cloudflare R2 | Egress-free object store |
| Payment | Self-hosted Lightning node (B7+; details in the private half) | Upload capacity settled via Lightning |

**Three hashes, three jobs — never conflate:**
- **BLAKE3** → chunk integrity (internal, Worker + browser)
- **SHA-256 (OTS)** → existence proof, Bitcoin-anchored (client-side only — never in Worker)
- **Cashu** → anonymous auth (no hashing role)

BLAKE3 is not the auth layer. Cashu is not the hashing layer. SHA-256/OTS is not the integrity layer and never enters the Worker.

**Two Merkle roots, never conflated (locked B9-Opus · 12 Sep 2026):**
- **Ciphertext-chunk `merkle_root`** — over per-chunk BLAKE3 digests of stored ciphertext. Worker-verifiable. Storage integrity only.
- **Plaintext `blake3PlaintextRoot`** — over plaintext bytes. Client-side + recipient only. **Never enters the Worker. Never in any receipt. Permanent.**

"End-to-end file integrity" is the recipient's plaintext check. The Worker's Merkle verification is storage integrity. These are two different claims. Never conflate them in any copy, doc, or code comment.

**Frontend module structure (post Share-JS-Refactor · 6 Sep 2026):**
- `frontend/share.js` — entry point, DOM refs, shared state, mode detection
- `frontend/crypto.js` — AES-GCM, BLAKE3, NUT-00, SHA-256, helpers, config constants
- `frontend/upload.js` — upload state machine, IDB resume, folder handling, zip, Turnstile
- `frontend/download.js` — download state machine, OTS offer, TG receiver helpers
- `frontend/timestamp.js` — OTS pipeline (born TH-1, always separate)

All five are `type="module"`. Do not collapse back into a single file.

---

## Private half (strategy, pricing, locks, session queue)

Everything else this file used to hold — locked decisions, tier and pricing model, API/MCP locks, integrity-claim rulings, B12 security locks, session queue, context-file hygiene, file delivery, editorial voice — lives in the private repo since X5-2 (15 Oct 2026) and is imported here:

@../refueler-share-private/strategy/CLAUDE-strategy.md

If that import is missing (another machine, a cloud session), stop and ask Rajesh for the private repo before changing anything.

---

## Encryption rule — every Refueler repo (locked 7 Oct 2026)

Applies to every repo: product, hackathon, test or throwaway. Check any new encryption code against it before it ships.

- **Never encrypt two things under the same key and IV/nonce.** With AES-GCM or ChaCha20-Poly1305, every encryption under one key needs its own unique nonce. A fixed IV, or one IV shared across chunks, parts, records, leaves or messages, is a bug — different AAD does not make it safe.
- **One key per job, derived and tagged.** Derive per-purpose keys from a master key with HKDF-SHA256, `info = utf8("refueler.<product>.<purpose>.vN") ‖ 0x00`. Never use one key for two jobs (e.g. file parts and a seal).
- **Chunked data → counter nonce with a last-chunk flag** under a derived key: `nonce = 0x00×7 ‖ BE32(i) ‖ last` (age/STREAM style). It also catches reordered, dropped or added chunks. Reference: refueler-share `frontend/crypto.js` (`derivePartKey`, `encryptPart`, `decryptPart`) + `worker/test/part-crypto.test.js`.
- **Independent messages → a fresh random nonce per message** (96-bit for AES-GCM), or a scheme that handles it for you (XChaCha20, NIP-44).
- **Re-encrypting is only safe when the bytes are identical** (same key, same nonce, same plaintext — e.g. resume). If they could differ, compare before sending.
- **No hand-rolled ciphers.** WebCrypto or an audited library; add known-answer test vectors for any new scheme.

---

## Session hygiene — mandatory

**After every `git commit`, always `git push`.** Combine into one command:

```
git commit -m "message" && git push
```

Rajesh consistently forgets the push step. Claude must always include `&& git push` in the
commit command at session close, without being asked.

**Deploy surfaces (rewritten X5-2 · 15 Oct 2026; was the refueler.io mirror, Share-Sync-1):**

1. **`refueler-share` Worker** (`api.share.refueler.io`) — `npm run deploy` from `worker/`. Not
   Git-connected; pushing does nothing here. Rajesh runs it. Since H6a (Admin-Access-1b, 31 Oct) it also
   serves **Navy Office** on `admin.share.refueler.io`, behind Cloudflare Access: the source is
   `navy-office/` (static assets, headers in `worker/src/admin_headers.js`), shipped by the same
   `npm run deploy` — never by `ship-app.sh`. Every admin path answers 404 on `api.share`.
2. **`share.refueler.io`** — the ONLY place Share's frontend is served. Cloudflare Pages project
   `refueler-share-app`, **direct upload** (never Git-connected), reached ONLY via `bin/ship-app.sh`.
   Rajesh runs it. Its `refueler-share-app.pages.dev` alias is in no allowlist — never link it, never verify there.
3. **refueler.io** (Git-connected `refueler-io` repo; pushing `main` deploys) owns Share's
   **landing page `/share/`**, **Plans**, **Status**, `/upgrade.html` (`/share/admin/` → 301 to the admin host), and
   `share/forward.js` (carries old `refueler.io/share/?uuid=…#…` and `/share/signin/#t=…` links to
   share.refueler.io; fixed destination, never reads the fragment; **remove 12 Jan 2027**). Its
   `/share/` + `/share/signin/` CSP allows refueler.io's inline theme script and two nav `onclick`s by
   hash (`src/_headers`) — change `head.njk`'s script or a nav `onclick` → recompute the hash there.
4. **`refueler-share.pages.dev`** — orphaned Pages project (Share's pre-refueler.io home). No Git
   connection, CORS-blocked from the API. Deletion blocked by Cloudflare (code 8000076) — parked.
   Dead wood: NEVER `wrangler pages deploy` to it, never verify against it.

`git push` in `refueler-share` deploys nothing public. There is no pre-push hook any more
(`git config --unset core.hooksPath` once, X5-2).

---
## Frontend change checklist — mandatory

Applies to ANY change under `frontend/` (incl. `frontend/app/`, `frontend/blake3/`), `src/app/`,
`src/_includes/`, `eleventy.app.js` or `bin/lib/app-csp.txt`.

1. Commit and push (`git commit -m "…" && git push`), then ship with ONE command — build → check →
   draft release → deploy → prove → publish: `/Users/rajeshtaylor/Documents/refueler-share/bin/ship-app.sh`
   It must end `✓ SHIPPED (app) — release app-<sha> published`. Anything else = not shipped,
   whatever GitHub or wrangler says. It builds twice (working tree + `git archive HEAD`) and refuses
   on any difference or untracked file. (`--check` = build + checks only, safe anywhere; `--prove` =
   is the live site serving `dist/`?; `--rebuild <commit> [<prev>]` = one release from git alone.)
2. Then eyeball behaviour at **https://share.refueler.io/** (the script proves bytes, not behaviour) —
   Safari on the Mac with Mullvad on first:
   a. Share URL contains `?uuid=` and a non-empty `#` fragment
   b. Pasting that URL in a new tab shows the receiver card — NOT the upload screen
   c. File name, size, and expiry are populated on the receiver card
   d. For error-state changes: trigger the actual error condition live and read the
      rendered text/UI directly — do not infer correctness from the diff alone
   e. Console: no `Content-Security-Policy` errors from our own files (errors inside Cloudflare's
      Turnstile frame, `flexible?lang=auto`, are Turnstile's own CSP and not ours)
   f. **https://share.refueler.io/verify/** names the release just published, and its links open
      that release, its rebuild run and the watchdog runs. If the copy changed, read it against plan
      §8 (never proves / verified / guaranteed / tamper-proof / trustless / certified).
3. If the change touches the password flow: verify the unlock screen appears on paste.
4. Speed (Terminal.app, start with Mullvad off): `node dev/speed/speed.mjs --weekly --place=<code>` — runs VPN
   off, asks you to switch Mullvad on (multihop + DAITA; it never toggles it), runs VPN on, then `--summarise`
   and shows `summary.json` in Finder: drag it (with `speed/places.md`) onto Navy Office → Speed. Monthly:
   add `--with-others`. Conditions allowlisted; results only in `../refueler-share-private/speed/` (refuses this repo).

**Enforced, not remembered:**
- The release asset list lives in ONE place: `bin/lib/app-assets.sh`. A top-level `frontend/*.js`
  or `*.css` not listed fails `ship-app.sh` and CI (the merkle.js / Share-6-3d trap). Add it there, same session.
- `ship-app.sh` refuses: inline `<script>`, `on*=` or `style=` in built HTML; a `_headers` CSP that
  isn't byte-equal to `bin/lib/app-csp.txt` (**enforced** since X5-2); a missing `! Link` or
  `no-transform` or HSTS; Satoshi tracked by git. Live: CSP exact, HSTS (`max-age=31536000;
  includeSubDomains`, from `_headers`), no Report-Only, no `X-Robots-Tag`, no `Link`, `max-age=0`,
  real 404. `/.well-known/security.txt` (`src/app/security-txt.njk`) has a fixed `Expires`
  (17 Apr 2027) — renew it before then (calendar).
- CI: `.github/workflows/app-check.yml` runs `bin/ship-app.sh --ci` (same build + checks, an empty
  stand-in for the never-committed Satoshi, no deploy) alongside `ci.yml`, plus the release-file tests
  (`node --test bin/test/*.test.mjs`) and `--rebuild HEAD` = `--ci`. Beside it,
  `.github/workflows/release-rebuild.yml` rebuilds every published release from its tag and compares
  its `SHA256SUMS`.
- Live: `ship-app.sh` proves the live bytes from the Mac at ship time; between ships the public
  watchdog (`.github/workflows/watchdog.yml`, every six hours at :17) runs `bin/verify-live.mjs`,
  which compares every served file and the headers with the release on GitHub (never with the site's
  own `/release.json`). Red = failed run + GitHub email; re-run once (fetch failures are listed apart),
  then `--prove` from the Mac. `node bin/verify-live.mjs` works from any checkout too.
- Versioned assets: every release lives at `/v/<sha>/` and the previous one is kept, so a tab open
  across a ship still loads its own modules.
- **Browser cache:** Cloudflare Cache Rule `http.host eq "share.refueler.io"` → Browser TTL = Respect
  origin (dashboard, off-repo); `ship-app.sh` fails if responses become browser-cacheable. The refueler.io
  Cache Rule "Share assets — respect origin browser TTL" (`/share/assets/`) **stays**: Plans/Status CSS
  live there (X5-2). Its `/share/admin/` half is dead since Navy Office moved (H6a; optional tidy, G-9).
- Local preview of every state: `dev/share-harness/` (builds the real app, fake Worker, stub Turnstile).
- Admin tooling never goes on share.refueler.io. `worker/src/share/admin/test-upload.html` is local-only.

**Incident record:** DAD-ERROR-TEXT (Share-DAD-1, 25 Sep 2026) — a correct fix deployed to the wrong
target three times before reaching refueler.io. A green log on the wrong project is not verification.
DO NOT commit frontend JS based on code review alone — verify behaviour live after `✓ SHIPPED`.
DO NOT assume manifest fields exist — `curl /meta/{uuid}` to verify before coding against them.
DO NOT change fragment.js without verifying upload.js and download.js handle IV, key, and filename end-to-end.
DO NOT introduce a NEW request header the browser sends to the Worker without adding it to Access-Control-Allow-Headers in worker/src/utils.js corsHeaders() — the CORS preflight blocks it (net::ERR_FAILED, "field x-… is not allowed"). X-Upload-Session hit this at Share-6-3d (now allowed; the 3,200-chunk soaks went through `/urls` with it). X-Part added with UUID-Out-Of-Path-1 (21 Oct).
DO NOT put a transfer UUID in an API path or query: it travels in `X-Transfer-UUID` (download part: `X-Part`) — Cloudflare's sampled request records keep IP + path for ≥ 31 days (UUID-Out-Of-Path-1). Enforced by `bin/check-no-uuid-path.mjs` (CI + ship-app) and `bin/route-inventory.mjs`; API HMAC canonical v2 signs the UUID line.
NOTE (browser + hostname, Share-6 live-test 21 Sep): download "CORS/ERR_FAILED/503" failures were **Brave** + the api.share.refueler.io custom hostname (6-6b cutover not done) intermittently 503-ing; a 503 carries no CORS header so the browser mislabels it "CORS". Safari downloads the same link cleanly, and curl shows the Worker DOES send CORS on the failing chunk. DO NOT edit Worker CORS or finalise token logic for this — both are correct. Real fix lives in 6-6b (or revert frontend/crypto.js WORKER_URL to https://refueler-share.rt-fc4.workers.dev). Test downloads in Safari before assuming a code fault.
NOTE (verifying R2): wrangler v4 `r2/kv/d1 object get` defaults to the LOCAL store — pass `--remote` to read production, e.g. `npx wrangler r2 object get refueler-share-prod/{uuid}/manifest.json --remote --pipe`; without it you get "key does not exist" against an empty local bucket.
Claude must ask for all relevant files before writing any fix — never assume and code blind.

---

## Dependencies — read before merge (H4 Supply-Chain-1 · 31 Oct 2026)

- **Exact pins** in every `package.json` (no `^` or `~`); the lock file decides the rest.
- **Read before merge.** A Dependabot PR is never merged on green CI alone: read its changelog
  and the lock-file diff (new packages, new install scripts, new maintainers), then either fold it
  into a commit that summarises that diff, or close it with one line saying why.
- **Majors are planned sessions** (vitest, eslint, `@noble/*`, cashu-ts — which moves only with
  `bin/vendor-cashu.sh`), never a weekly merge.
- **No install scripts:** CI and local installs use `npm ci --ignore-scripts`; nothing needs one
  today (esbuild and workerd ship binaries as packages). A new package that needs one is a decision
  to record here, not a flag to drop. CI also runs `npm audit signatures` on both lock files.

---

## Test environment

`TESTING.md` in repo root is the canonical testing architecture document.
Load it at the start of any session touching tests, CI, load testing,
staging environment, or the B9 security whitepaper.
Do not load it by default — it is reference material, not working memory.

---

*"Nothing stops this train."*
