# Share-Upload-3 — session prompt

> Written at the close of Share-Upload-2 (6 Oct 2026). Paste everything below the line into a fresh session.

---

Session: Share-Upload-3 — upload page B2 (behaviour) + the upload/resume backlog (build, refueler-share only). Today is [date]. Prerequisites done: Share-Upload-2 ✓ (6 Oct 2026: Share sub-menu refueler.io `580135c`; upload page B1 shipped `565efd9`, refueler.io `beb611b`, live-verified on iPhone, Pixel and desktop).

You are the technical co-builder of Refueler Share. Rajesh is a non-coder solo founder. Session prefix: Share-Upload-3.

**Load:** `CLAUDE.md`, `share-sessions.md` (the Share-Upload-2 entry), `docs/Share-Upload-1-build-list.md` (decisions U-1…U-11, §1 copy table, §3 item statuses, F-11 and F-27), `docs/drafts/share-upload-mock-v3.html` (the approved design: states "Check needed", "Drag-over", "Error"), `Share-Master-Context.md` §Backlog ("Share-Upload-2 additions — status after Share-Upload-2", "Added Cred-Fix-2b", "Added Share-Upload-2"), `dev/share-harness/README.md`. Memories: `proposals-before-edits`, `share-page-two-modes`, `safari-top-priority`, `test-devices`, `working-style`, `mullvad-breaks-tests`. Do NOT load TESTING.md.

**How B1 is built (don't undo it):** one sender sheet `#upload-sheet`; `share.js` `setView(view, {eyebrow, head})` sets `data-view` (empty · zipping · chosen · over · uploading · ready · stopped) and `share.css` shows the parts for each view (`.up-for-*`). Helpers in `share.js`: `setView`, `showStopped`, `setStage` (eyebrow word), `setProgress` (bytes-based %, tab title), `showSharePanel(url, info)`, `formatWhen`. F-23: `frontend/share-early.js` + `.rx-pending`. Share-Size-1 is untouched: both `assembleFragment` calls pass `sizeBytes`; `download.js` `_resolveSize`; never write "size is hidden".

**Part B2 (ship via `bin/ship-frontend.sh`, must end `✓ SHIPPED`):**
1. **Scroll (F-27):** bring the top of the sheet into view on every view change. Rajesh will eyeball it over a week of tests.
2. **Turnstile (U-10):** `appearance: 'interaction-only'`, `size: 'flexible'`; the `#turnstile-wrap` line shows only via `before-interactive-callback`; button never greyed for an invisible reason — a click before the token shows "Checking…" and the upload starts when the token lands; drop `?onload=` from `src/index.njk` and `initTurnstile`'s export (flag it). Token is single-use: reset the widget after `/credential/issue` consumes it. Check the e2e test (`tests/e2e/share-link.spec.js` waits for `#upload-btn` enabled).
3. **"Choose another" (U-11):** keep a live Turnstile token (stop resetting `state.turnstileToken` and re-rendering in `_handleFileSelection`; re-render only if expired). Password and delete settings already kept (B1).
4. **Whole-page drop (U-8):** dragover/drop on `document`, upload mode only (never receiver), views empty/chosen/over only; thin accent frame round the page while a file is held; File row "Release to add."; two or more files: "One file or one folder at a time."
5. **Errors (F-11):** catch every `startUpload`/`resumeUpload` throw into the `stopped` view with the §1 copy (network / check failed / refused / finish failed, incl. finalise 409 `wrong_size`). "Try again" in the same tab reuses the held file, no picker: *"Try again carries on from 42%."* (Rajesh, 6 Oct). After a refresh the resume card still asks for the file. A failed check needs a fresh token.
Preview every state in `dev/share-harness/` (fault injection: `_ctl?fail=…`, `?ts=click`) — Carbon + Paper, 375 / 640 / 1000 / 1280 px, upload AND receiver — before shipping.

**Part C, if time allows (otherwise Share-Upload-4):**
1. Resume button 3–6 s + two-click picker (Safari desktop). Likely: `resumeUpload` awaits before `input.click()`, losing user activation — open the picker first.
2. Resume re-hash speed (the pause is now labelled).
3. `admin/test-upload.html` off esm.sh (= F-25): hosted `noble-blake3.js` + `cashu-crypto.js` `blindMessage`; then delete `noble-secp256k1.js` from `frontend/`, `SM_VENDOR` and refueler.io `src/share/assets/` in the same ship (the sync never deletes from the mirror).
4. Strip `sourceMappingURL` from `frontend/blake3/esm/*` and `src/blake3/` (14 each).
5. `test-upload.html`: stats per chunk (keep the 100-chunk log line); fix the stale header comment.
Not in scope: download % at half (with F-22, download track); receiver changes (Share-Receiver-3).

**Rules learned the hard way:**
- Check every change on a real phone: iPhone 13 mini (Safari) and Pixel 9a (Vanadium, defaults). Give Rajesh a short checklist each time, and include the receiver page (same file, two modes).
- Keep every DOM id `upload.js` and the e2e test use, or change both sides in the same step.
- Track the clock. Ask Rajesh for a time budget at the start. If past halfway and B2 isn't close, say so and propose the cut.
- Diagnose and propose before any edit; preview in the harness before shipping.
- Flag every new `export`, signature change, new mirrored file (add to `bin/lib/share-mirror.sh` in the same step) and new request header (add to `corsHeaders()`).

**Close:** `share-sessions.md` entry; `Share-Master-Context.md` current state + backlog (keep under 350 lines); `docs/Share-Upload-1-build-list.md` item statuses; README roadmap if a row changes; write the next session's prompt. Rajesh commits: give the command, always `&& git push`.

Start by confirming B1 is what's live (`bin/sync-share.sh --live`), list B2 + Part C with a time estimate each, and ask for the time budget. No code until Rajesh confirms.
