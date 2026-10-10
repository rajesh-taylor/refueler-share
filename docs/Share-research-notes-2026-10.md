# Share research notes — October 2026

> **Source:** cloud research session (Rajesh, 9 Oct 2026), checked in Share-Soak-4 against the primary links Rajesh supplied. Research only — nothing here is a decision. Each block names the session that should weigh it.
> Legend: ✅ primary source · 🟡 secondary / single report · 🔵 inference (theirs or ours). Re-check anything marked 🟡/🔵 before building on it.

**Version note:** Safari 27 shipped mid-Sep 2026; Rajesh's Mac is on macOS Tahoe 26.6.2. Record the exact Safari version in every DL-Spike result. (Safari 26.6.1 security notes, `support.apple.com/en-us/148286`: memory-safety CVEs only — nothing on downloads, service workers or cookies.)

---

## A. Large downloads → Share-DL-Spike / DL-1

1. **Safari streams SW downloads to disk** (since 15.4, WebKit 202142, `ServiceWorkerDownloadTask`). The RAM problem is a Blob fallback in *our* code, not Safari. ✅ via StreamSaver.js #373 (3 Sep 2026, Transcend).
   - **Correction to the cloud answer:** #373 does **not** report 11.9 GB working on iOS — that user failed three times silently. Largest *confirmed* iOS success in #373: **1.41 GB** (iOS 18.7). 5 GB / 12 GB tests were planned, results not posted. Nobody has published a 100 GiB SW download. That is exactly what the spike measures.
   - **SW eviction 41–58 min into long downloads** (<2 % of attempts, one company's data). At our download speeds 100 GiB takes ~1.5–3 h, so this is the headline spike risk for D-1. Mitigation reported: hold the fetch event open (`respondWith` promise pending) until the body drains.
   - **iOS: no Content-Length → silent truncation** (900 MB saved as 8 MB). We know the exact plaintext size (`z`), so always send `Content-Length: z`.
   - **postMessage > 256 KiB silently dropped** on iOS. 🔵 Design so the SW fetches and decrypts parts itself; the page posts only the key/link once (never persisted — §11).
   - Desktop Safari: a plain link click may bypass the SW; navigate a **hidden iframe** to a URL in scope. 🟡
   - Safari 26.2 fixed SW downloads not landing in Downloads; 26.5 takes the file extension from Content-Type. ✅ WebKit blog.
2. **Firefox:** streams to disk, but kills an idle SW after ~30 s and chunk posts don't reset it; field reports of death at 500–700 MB. Page must ping the SW < 30 s. No `showSaveFilePicker` (Mozilla position negative). 🟡
3. **Chrome FSAA:** writes `name.crswap`, Safe Browsing pass, then rename on `close()`. No published 100 GiB `close()` timing — 🔵 estimate 1.5–3 min external exFAT. Show a "finishing" state.
   - ⚠️ **Live-product finding:** a crash mid-write leaves an orphaned `.crswap` holding **decrypted plaintext** next to the target. Our shipped FSAA path has this today. `download-save.js` already calls `writable.abort()` on every caught error (checked 9 Oct), which deletes it; a tab crash or power loss can't be caught. → DL-1 (and Receiver-3 copy, if we tell the user).
   - `keepExistingData: true` copies the target into the swap first — useless for a fresh download, no resume value. 🔵
4. **iOS:** no documented SW lifetime; screen lock drops WebKit's background-load hold (WebKit 205104) → expect a stall when locked or app-switched. Files land in Files → Downloads, shown as "0 KB" until done. Per-tab memory ~1.5–2 GB on iPhones; 🔵 plan ~1 GB usable. Supports D-8 ("open on a computer" above 4 GiB) until the spike says otherwise.
5. **StreamSaver.js / native-file-system-adapter:** MIT, effectively unmaintained for Safari (#373 PRs unmerged). 🔵 Don't depend on either; write our own SW (needed for decryption anyway). Activation recipe: `skipWaiting` + `clients.claim`; `await navigator.serviceWorker.ready`; wait for `controller` (Shift-reload bypasses SW → ask for a normal reload); ping-pong right before navigating (matches §11 "ping before navigate").
6. **Screen Wake Lock:** Safari 16.4+, Firefox 126+. Released when the tab is hidden; stops auto-lock only. Pair with "keep Safari open, plugged in" copy.

## B. Cleanup → next session (orphan `f539e9b2…`)

7. **Our parts are single presigned PUTs, not multipart** — the cloud answer's multipart-upload step doesn't apply. R2 deletes are free; listing is Class A (trivial).
   - The S3 batch delete (1,000 keys/call) needs an R2 S3 API token with delete rights; the existing `refueler-share-presign` token is the Worker's — don't reuse it for ad-hoc deletes. Alternative: the Worker's own `destroyTransfer()` path if it accepts a never-finalised transfer — check first.
   - Always end the prefix with `/` (`f539e9b2-…/`), dry-run first, verify `Total Objects: 0`.

## C. Sealing → B12-3

8. GCM random 96-bit nonces: NIST limit 2³² encryptions per key ✅. Our seals (`seal.js`: fresh nonce, per-purpose HKDF subkey, AAD binds uuid + kid) run at one or two per transfer — many orders of magnitude below the limit. **No change needed.** XAES-256-GCM (C2SP) is the standard route if volume ever matters. AES-GCM-SIV / XChaCha20 aren't in Workers WebCrypto. 🔵
9. Rotation: lazy re-seal on read **plus** a batch sweep to actually retire a key; bind record id + purpose + version in AAD (already done); never reuse a kid; secrets rotation = redeploy. 🔵

## D. Magic links → B12-4a

10. Scanners (MS Safe Links "detonation") follow GETs; some run JS; none reported submitting forms. Locked design (fragment + click, single-use) already matches. **New idea for B12-4a:** bind the link to the requesting browser with a short-lived cookie, plus a 6–8 digit code fallback for another device. 🔵
    - **Tension with a lock:** 15-min expiry is locked (B12-SR); the research says email delay plus scanning often burns 15 min, so 20–30 min is more forgiving. Rajesh decides at B12-4a, not before.
11. refueler.io ↔ api.share.refueler.io are **same-site**: no ITP / Total Cookie Protection partitioning; `__Host-` cookie + exact-origin credentialed CORS works ✅.
    - SameSite doesn't stop **sibling subdomains**: require `Origin` exactly `https://refueler.io` and a JSON content type on every state change, and keep the CSRF token (locked).
    - Sibling hosts exist today: `fallback.share.refueler.io`, `wh-sink.refueler.io` (named tunnel, on demand). Neither serves user content, but list them in the B12-4a threat check. X5 (dedicated app origin) changes this picture — decide together.
    - 🟡 Safari caps cookies at 7 days when the API's IP differs from the site's; check with `dig` if sessions outlive 7 days.
12. **Email:** Amazon SES eu-west-2 (London) is the only real UK-resident option, with no tracking unless configured; metrics 60 days. Postmark is US-hosted but can stop storing message content. Resend's "Ireland" region sends only; account data stays in the US. Any provider keeps the link for its retention window — another reason for short expiry and browser binding. 🟡/✅ mix; verify the SES and Postmark retention pages before choosing.
