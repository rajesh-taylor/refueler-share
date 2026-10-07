# Share-Upload-7 — session prompt

> Written at the close of Share-Upload-6 (7 Oct 2026). Runs **after** the encryption review (Share-Crypto-Opus-1 → Share-Crypto-1). Paste everything below the line into a fresh session.

---

Session: Share-Upload-7 — admin test page off third-party code (build, refueler-share only). Today is [date]. Prerequisites done: Share-Upload-6 ✓ (7 Oct 2026: iOS folder name `9d63880`; resume keeps sent parts' hashes `b1eea41`); Share-Crypto-1 ✓ (encryption build — check its session-log entry first; if it changed how parts are encrypted, the admin page must follow the same scheme).

You are the technical co-builder of Refueler Share. Rajesh is a non-coder solo founder. Session prefix: Share-Upload-7.

**Load:** `CLAUDE.md`, `share-sessions.md` (the Share-Upload-6 and Share-Crypto-1 entries), `Share-Master-Context.md` §Backlog ("Share-Upload-2 additions" items 5, 7, 8; "Vendor cleanup"), `dev/share-harness/README.md`, `bin/lib/share-mirror.sh`. Memories: `proposals-before-edits`, `share-page-two-modes`, `safari-top-priority`, `test-devices`, `working-style`, `mullvad-breaks-tests`. Do NOT load TESTING.md.

**First:** ask Rajesh for any problem since Share-Upload-6 / Share-Crypto-1 and a time budget; list the items with estimates. No code until he confirms.

**Items (order of value):**
1. **F-25 — admin page off esm.sh** (`worker/src/share/admin/test-upload.html`, mirrored to refueler.io `src/share/admin/`): replace the esm.sh imports with the hosted `noble-blake3.js` and `cashu-crypto.js` `blindMessage` (the same vendored files the Share page uses). Read the page first and list every esm.sh import. Its encryption must match `frontend/upload.js` exactly (incl. any Share-Crypto-1 change).
2. **Vendor cleanup, same ship:** `frontend/noble-secp256k1.js` is no longer imported anywhere — confirm with grep (incl. the admin page after item 1), then delete it from `frontend/`, from `SM_VENDOR` in `bin/lib/share-mirror.sh`, and from refueler.io `src/share/assets/` in the same ship (the sync never deletes from the mirror).
3. **Stats per chunk** on the admin page (keep the 100-chunk log line).
4. **Stale header comment** on the admin page ("NEVER add to sync-share.sh", "NEVER commit to the public mirror") — rewrite to today's rule: in the pipeline, to `src/share/admin/`, never `assets/`.
Not in scope: progress + one-box resume screen (Share-Progress-1); folder resume (Share-Folder-Resume-1); `/initiate` speed-up (own Worker session); F-24 (Share-Receiver-3); DAD dialog (stays until DL-W1).

**Rules learned the hard way:**
- Live checks: Safari on the MacBook **with Mullvad on** (Rajesh, 7 Oct: users use VPNs). Phones only when a change touches phone behaviour. Every checklist includes the Share page in both modes (upload + receiver from a link) and a **fresh tab** after a ship — the admin page shares vendored files with them.
- Keep every DOM id `upload.js` and the e2e test use, or change both sides in the same step.
- Diagnose and propose before any edit; preview in `dev/share-harness/` before shipping via `bin/ship-frontend.sh` (must end `✓ SHIPPED`). Non-mirrored files (tests, `bin/`) go in a separate commit **before** the ship, without `git push` (the pre-push hook blocks until the mirror matches; the ship pushes it). Note: `bin/lib/share-mirror.sh` is not mirrored but the ship checks against it — change it in the same pre-ship commit as the deletion.
- Flag every new `export`, signature change, new or removed mirrored file, and new request header (add to `corsHeaders()`). `sm_check_canon` refuses any `sourceMappingURL` in a shipped asset.
- Track the clock; if past halfway and item 1 isn't shipped, say so and propose the cut.

**Close:** `share-sessions.md` entry (keep under 500 lines); `Share-Master-Context.md` current state + backlog (under 350); README roadmap if a row changes; write the next session's prompt: **Share-Progress-1** (design pass first — mock, Rajesh approves — then build: real byte progress up and down, setup steps visible, time left, a clear line when the connection drops, and the one-box resume screen: card only, Discard brings the sheet back; Master Context backlog 10–11). Then Share-Folder-Resume-1 (S-031). Rajesh commits: give the command, always `&& git push` (except the pre-ship commit above).
