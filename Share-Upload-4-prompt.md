# Share-Upload-4 — session prompt

> Written at the close of Share-Upload-3 (6 Oct 2026). Paste everything below the line into a fresh session.

---

Session: Share-Upload-4 — upload errors (F-11) + the upload/resume backlog (build, refueler-share only). Today is [date]. Prerequisites done: Share-Upload-3 ✓ (6 Oct 2026: B2 items 1–4 shipped `4bb3fde` + `627c0d0` — sheet top into view on every view change, Cloudflare check hidden unless it needs a click + "Checking…" auto-start + single-use token, "Choose another" keeps the check, whole-page drop).

You are the technical co-builder of Refueler Share. Rajesh is a non-coder solo founder. Session prefix: Share-Upload-4.

**Load:** `CLAUDE.md`, `share-sessions.md` (the Share-Upload-3 entry), `docs/Share-Upload-1-build-list.md` (§1 copy table — the four "Error:" rows; F-11, F-24, F-25), `docs/drafts/share-upload-mock-v3.html` (state "Error"), `Share-Master-Context.md` §Backlog ("Share-Upload-2 additions — status after Share-Upload-3", "Added Cred-Fix-2b"), `dev/share-harness/README.md`. Memories: `proposals-before-edits`, `share-page-two-modes`, `safari-top-priority`, `test-devices`, `working-style`, `mullvad-breaks-tests`. Do NOT load TESTING.md.

**First:** ask Rajesh (1) whether the iPhone retest in a fresh tab passed (Share-Upload-3: his first test ran pre-ship code — button grey until the Cloudflare tick); (2) whether the resume picker now opens on the first click in Safari desktop (`bf0512a`). If either fails, that is the first job. Also confirm the Share-Upload-3 test findings (Master Context backlog 11): which request the console 401 was (likely Turnstile's PAT probe — harmless), and why two chunk PUTs failed with no status after ~3 s (Mullvad was off — network or code).

**How the page works now (don't undo it):** one sender sheet `#upload-sheet`; `share.js` `setView(view, {eyebrow, head})` sets `data-view` (empty · zipping · chosen · over · uploading · ready · stopped) and scrolls the sheet top into view (`revealSheet`); `share.css` shows parts per view (`.up-for-*`). Helpers: `setView`, `showStopped`, `setStage`, `setProgress`, `showSharePanel(url, info)`, `formatWhen`. Turnstile in `upload.js`: `renderTurnstile` (draws once), `_resetTurnstile`, `_spendTurnstileToken` (in a `finally` round `/credential/issue`), `_cancelQueuedStart`, `startWhenChecked` (the "Checking…" queue). Whole-page drop = `document` dragover/drop with a 250 ms timer. Share-Size-1 untouched: both `assembleFragment` calls pass `sizeBytes`; `download.js` `_resolveSize`; never write "size is hidden".

**Part A — F-11 errors (ship via `bin/ship-frontend.sh`, must end `✓ SHIPPED`):**
1. Catch every `startUpload` / `resumeUpload` throw into the `stopped` view with the §1 copy: network (after the retries) / check failed / refused / finish failed, incl. finalise 409 `wrong_size`.
2. "Try again" in the same tab reuses the held file, no picker: "Try again carries on from 42%." (Rajesh, 6 Oct). After a refresh the resume card still asks for the file.
3. A failed check needs a fresh token. The token was reset after `/credential/issue`; if Cloudflare now wants a click, the widget is inside the options card (hidden in `stopped`) — Try again must show it, or reuse "Checking…".
4. Password: `startUpload` clears `passphraseInput` once hashed — Try again must not lose it (keep the hash, or the value, for the retry).
5. Optional, if free: F-24 "This link is incomplete" (receiver key-import failure) — only if it stays small; otherwise Share-Receiver-3. Turnstile theme follows a Carbon/Paper switch (today fixed at first draw).
Preview every state in `dev/share-harness/` (`_ctl?fail=issue|initiate|chunk:N|finalise|finalise409|wrong_size`, `?ts=click|slow|fail`) — Carbon + Paper, 375 / 640 / 1000 / 1280 px, upload AND receiver — before shipping.

**Part B — backlog, if time allows (else Share-Upload-5):**
1. Resume card appears 3–6 s after a refresh — time it in Safari (module load vs IndexedDB open) before fixing. (The two-click picker was fixed in Share-Upload-3 `bf0512a`.)
2. Resume re-hash speed (the pause is labelled) — diagnose first.
2b. Fresh-upload "Preparing" pause at 0 % (Rajesh, 6 Oct): `loadDeps()` is now warmed when a file is chosen (`bf0512a`); if Rajesh still sees a pause, measure `/credential/issue` + `/initiate`.
3. `admin/test-upload.html` off esm.sh (= F-25): hosted `noble-blake3.js` + `cashu-crypto.js` `blindMessage`; then delete `noble-secp256k1.js` from `frontend/`, `SM_VENDOR` and refueler.io `src/share/assets/` in the same ship (the sync never deletes from the mirror). Own ship; needs Rajesh's admin-key test.
4. Strip `sourceMappingURL` from `frontend/blake3/esm/*` and `src/blake3/` (14 each) — and make it stick at vendor/copy time.
5. `test-upload.html`: stats per chunk (keep the 100-chunk log line); fix the stale header comment.
6. **Store-only folder zip (Rajesh, 6 Oct — do this one even if Part B is cut short; ~15 min):** `upload.js` zips folders with `fflate.ZipDeflate(…, { level: 6 })` — switch to store-only (`level: 0` / `ZipPassThrough`), fixed entry order and fixed timestamps, so the same folder always gives byte-identical zips (prove it in the harness: zip twice, same BLAKE3). Faster for video/photos; it is the base for Share-Folder-Resume-1 (S-031). Check the 2 GB folder cap message still reads right.
Not in scope: download % at half (with F-22, download track); receiver redesign (Share-Receiver-3).

**Rules learned the hard way:**
- Check every change on a real phone: iPhone 13 mini (Safari) and Pixel 9a (Vanadium, defaults). Give Rajesh a short checklist each time, include the receiver page (same file, two modes), and tell him to test in a **fresh tab** after a ship.
- Keep every DOM id `upload.js` and the e2e test use, or change both sides in the same step.
- Track the clock. Ask Rajesh for a time budget at the start. If past halfway and Part A isn't close, say so and propose the cut.
- Diagnose and propose before any edit; preview in the harness before shipping.
- Flag every new `export`, signature change, new mirrored file (add to `bin/lib/share-mirror.sh` in the same step) and new request header (add to `corsHeaders()`).

**Close:** `share-sessions.md` entry (file is ~485 lines — trim older entries to table rows if it passes 500); `Share-Master-Context.md` current state + backlog (keep under 350 lines); `docs/Share-Upload-1-build-list.md` item statuses; README roadmap if a row changes; write the next session's prompt: **Share-Progress-1** (Rajesh, 6 Oct; after it comes **Share-Folder-Resume-1**, S-031) — design pass (mock for upload + download progress, both pages, Rajesh approves) then build: real byte progress (XHR `upload.onprogress` for chunk PUTs; `res.body.getReader()` for downloads = F-22, incl. the download % at half), smooth never-backwards number, time-left line, "Reconnecting…" on retries. See Master Context backlog 11. Rajesh commits: give the command, always `&& git push`.

Start by asking about the iPhone retest, list Part A + Part B with a time estimate each, and ask for the time budget. No code until Rajesh confirms.
