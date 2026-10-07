# Share-Upload-6 — session prompt

> Written at the close of Share-Upload-5 (7 Oct 2026). Paste everything below the line into a fresh session.

---

Session: Share-Upload-6 — iOS folder name + upload timing (build, refueler-share only). Today is [date]. Prerequisites done: Share-Upload-5 ✓ (7 Oct 2026: store-only folder zip with each file's own date `45dde47`; Cloudflare check at page open, a tick never starts an upload `2a9f081`).

You are the technical co-builder of Refueler Share. Rajesh is a non-coder solo founder. Session prefix: Share-Upload-6.

**Load:** `CLAUDE.md`, `share-sessions.md` (the Share-Upload-5 entry), `Share-Master-Context.md` §Backlog ("Share-Upload-2 additions — status after Share-Upload-5", "iOS folder name"), `dev/share-harness/README.md`. Memories: `proposals-before-edits`, `share-page-two-modes`, `safari-top-priority`, `test-devices`, `working-style`, `mullvad-breaks-tests`. Do NOT load TESTING.md.

**First:** ask Rajesh for (1) any phone problem since Share-Upload-5 (Pixel 9a Vanadium + iPhone 13 mini Safari); (2) nothing else on the iOS folder name — it's diagnosed (below). Then ask for a time budget and list the items with estimates. No code until Rajesh confirms.

**How the page works now (don't undo it):** one sender sheet `#upload-sheet`; `share.js` `setView(view)` (empty · zipping · chosen · over · uploading · ready · stopped); `showStopped(text, retry)`. `upload.js`: `startUpload` = `_setUp` → `_carryOn(job)`; `resumeUpload` = picker + `_carryOn`; resume record kept until finalise succeeds. Turnstile drawn at page open (`enterUploadMode`); "Checking…" past 2 s shows the line; when Cloudflare's box appears a queued press is dropped and the button greys until the tick — **a tick never starts an upload** (Rajesh, 7 Oct). Folder zips: store-only, path order, each file's own date + UTC stamp, `_zipSize` cap before zipping — keep byte-identical re-zips (Share-Folder-Resume-1 depends on it). Never write "size is hidden".

**Items (order of value):**
1. **iOS folder name (diagnosed 7 Oct, ~15 min):** in the iOS folder picker, **Open** selects the folder you're inside; at the top of On My iPhone iOS reports that root as "File Provider Storage" in `webkitRelativePath`, so the zip is named "File Provider Storage.zip" (contents correct: 50 files = the On My iPhone top level; inner names and dates kept). Fix: in `_handleFolderFiles`, map that root name to "On My iPhone" (zip name + slip). Desktop names unchanged; zip bytes unchanged. Harness check only — no phone test needed (Rajesh).
2. **Resume card appears 3–6 s after a refresh** — time it in Safari (module load vs IndexedDB open) before fixing.
3. **"Preparing" pause at 0 %** — only if Rajesh still sees it: measure `/credential/issue` + `/initiate`.
4. **Resume re-hash speed after a refresh** — diagnose first (same-tab Try again doesn't re-hash).
Not in scope: admin page (Share-Upload-7: F-25 esm.sh → hosted `noble-blake3.js` + `cashu-crypto.js` `blindMessage`, delete `noble-secp256k1.js` from `frontend/`, `SM_VENDOR` and refueler.io `src/share/assets/` in the same ship, per-chunk stats, stale header comment); progress (Share-Progress-1); F-24 (Share-Receiver-3); DAD dialog (stays until DL-W1).

**Rules learned the hard way:**
- Default live check = Safari on the MacBook (Rajesh, 7 Oct: keep testing simple). Use the phones only when the change touches phone behaviour (iOS picker, touch, Vanadium/Cloudflare); then one short, self-contained test that creates nothing he must clean up. Every checklist includes the receiver page (same file, two modes) and a **fresh tab** after a ship.
- Keep every DOM id `upload.js` and the e2e test use, or change both sides in the same step.
- Track the clock. If past halfway and item 1 isn't shipped, say so and propose the cut.
- Diagnose and propose before any edit; preview in `dev/share-harness/` before shipping via `bin/ship-frontend.sh` (must end `✓ SHIPPED`). Non-mirrored files (tests, `bin/`) go in a separate commit **before** the ship, without `git push` (the pre-push hook blocks until the mirror matches; the ship pushes it).
- Flag every new `export`, signature change, new mirrored file (add to `bin/lib/share-mirror.sh` in the same step) and new request header (add to `corsHeaders()`). `sm_check_canon` now refuses any `sourceMappingURL` in a shipped asset.

**Close:** `share-sessions.md` entry (keep under 500 lines); `Share-Master-Context.md` current state + backlog (under 350); README roadmap if a row changes; write the next session's prompt: **Share-Upload-7** (admin page, scope above), then Share-Progress-1 (design pass + build, Master Context backlog 11) and Share-Folder-Resume-1 (S-031). Rajesh commits: give the command, always `&& git push` (except the pre-ship commit above).
