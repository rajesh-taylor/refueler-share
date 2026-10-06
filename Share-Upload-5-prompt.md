# Share-Upload-5 — session prompt

> Written at the close of Share-Upload-4 (6 Oct 2026). Paste everything below the line into a fresh session.

---

Session: Share-Upload-5 — upload backlog (Part B of Share-Upload-4) (build, refueler-share only). Today is [date]. Prerequisites done: Share-Upload-4 ✓ (6 Oct 2026: F-11 errors + same-tab Try again `2fb1b30`; Cloudflare widget follows Carbon/Paper `fa3b2a1`).

You are the technical co-builder of Refueler Share. Rajesh is a non-coder solo founder. Session prefix: Share-Upload-5.

**Load:** `CLAUDE.md`, `share-sessions.md` (the Share-Upload-4 entry), `Share-Master-Context.md` §Backlog ("Share-Upload-2 additions — status after Share-Upload-4", "Added Cred-Fix-2b"), `dev/share-harness/README.md`. Memories: `proposals-before-edits`, `share-page-two-modes`, `safari-top-priority`, `test-devices`, `working-style`, `mullvad-breaks-tests`. Do NOT load TESTING.md.

**First:** ask Rajesh for (1) his phone results for Share-Upload-4 (iPhone 13 mini Safari + Pixel 9a Vanadium, fresh tab: upload, password, receiver page, the Cloudflare box in Carbon and Paper — Rajesh already checked the Wi-Fi-off upload and a restarted download on 6 Oct); (2) the host of the console 401 from Safari Web Inspector → Network (if `challenges.cloudflare.com`: Turnstile's Private Access Token probe, harmless — log it and close backlog 11's question). Any failure there is the first job. Then ask for a time budget and list the items below with estimates. No code until Rajesh confirms.

**How the page works now (don't undo it):** one sender sheet `#upload-sheet`; `share.js` `setView(view)` sets `data-view` (empty · zipping · chosen · over · uploading · ready · stopped) and scrolls the sheet top into view; `showStopped(text, retry)` shows "Try again" only with a retry. `upload.js`: `startUpload` = `_setUp` (key, pass, `/initiate`) → `_carryOn(job)` (send what's left, finalise, link); `resumeUpload` = picker + `_carryOn`; every throw → `_stopped` (`UploadStop` kinds). The resume record stays until finalise succeeds. Turnstile: `renderTurnstile` (once; `size: 'flexible'`; redraws on a theme switch when no token is held), `pressUpload` ("Checking…" queue), `_spendTurnstileToken`. Share-Size-1: `assembleFragment` gets `sizeBytes`; never write "size is hidden".

**Items (order of value):**
1. **Store-only folder zip (do first, ~15 min):** `upload.js` zips folders with `fflate.ZipDeflate(…, { level: 6 })` — switch to store-only (`level: 0` / `ZipPassThrough`), fixed entry order and fixed timestamps, so the same folder always gives byte-identical zips. Prove it in the harness: zip the same folder twice, same BLAKE3. Check the 2 GB folder cap message still reads right. Base for Share-Folder-Resume-1 (S-031).
2. **Resume card appears 3–6 s after a refresh** — time it in Safari (module load vs IndexedDB open) before fixing.
3. **"Preparing" pause at 0 %** — only if Rajesh still sees it (`loadDeps()` is warmed since `bf0512a`): measure `/credential/issue` + `/initiate`.
4. **Resume re-hash speed after a refresh** — diagnose first (same-tab Try again no longer re-hashes).
5. **`admin/test-upload.html` off esm.sh (= F-25):** hosted `noble-blake3.js` + `cashu-crypto.js` `blindMessage`; then delete `noble-secp256k1.js` from `frontend/`, `SM_VENDOR` and refueler.io `src/share/assets/` in the same ship (the sync never deletes from the mirror). Own ship; needs Rajesh's admin-key test.
6. **Strip `sourceMappingURL`** from `frontend/blake3/esm/*` and `src/blake3/` (14 each) — and make it stick at vendor/copy time.
7. **`test-upload.html`:** stats per chunk (keep the 100-chunk log line); fix the stale header comment.
Not in scope: F-24 "This link is incomplete" (→ Share-Receiver-3); download % at half (with F-22, Share-Progress-1).

**Rules learned the hard way:**
- Check every change on a real phone: iPhone 13 mini (Safari) and Pixel 9a (Vanadium, defaults). Give Rajesh a short checklist each time, include the receiver page (same file, two modes), and tell him to test in a **fresh tab** after a ship.
- Keep every DOM id `upload.js` and the e2e test use, or change both sides in the same step.
- Track the clock. If past halfway and item 1 isn't shipped, say so and propose the cut.
- Diagnose and propose before any edit; preview in `dev/share-harness/` (fake Worker now checks leaves + Merkle root at finalise; chunk retries 0.2 s there) before shipping via `bin/ship-frontend.sh` (must end `✓ SHIPPED`).
- Flag every new `export`, signature change, new mirrored file (add to `bin/lib/share-mirror.sh` in the same step) and new request header (add to `corsHeaders()`).

**Close:** `share-sessions.md` entry (keep under 500 lines); `Share-Master-Context.md` current state + backlog (under 350); README roadmap if a row changes; write the next session's prompt: **Share-Progress-1** (Rajesh, 6 Oct; then **Share-Folder-Resume-1**, S-031) — design pass (mock for upload + download progress, both pages, Rajesh approves) then build: real byte progress (XHR `upload.onprogress` for chunk PUTs; `res.body.getReader()` for downloads = F-22, incl. the download % at half), smooth never-backwards number, time-left line, "Reconnecting…" on retries (the 2 s first retry wait reads as a hang today). See Master Context backlog 11. Rajesh commits: give the command, always `&& git push`.
