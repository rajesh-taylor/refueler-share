# Share-Cleanup-1 — prompt (N-4 copy fixes · N-3 Carbon default · F-3 stale pages)
> Written 28 Sep 2026 (end of Share-Receiver-2b). Planned: **Tue 29 Sep, after Share-Upload-1.** Small, fits the Berlin rule.
> Don't run it at the same time as Share-Upload-2: both change `src/index.njk` and use `ship-frontend.sh`.

Paste this as the session prompt:

---

Share-Cleanup-1 — three small fixes from `docs/Share-Receiver-1-build-list.md` §3: N-4 copy fixes, N-3 Carbon default site-wide, F-3 stale generated pages. Repos: refueler.io and refueler-share. Read CLAUDE.md first, then `Share-Cleanup-1-prompt.md` (this plan, order and checks) and the build list (R-7, R-13, F-2, F-3, F-5, F-7). Propose before editing; N-4 wording needs my OK first. I run `ship-frontend.sh` and the Safari checks myself. Short, plain answers.

---

## Order (matters: two repos, one pipeline)

1. **N-4 — copy fixes (refueler.io only). Live false claim, so first.**
   - `src/share/plans.njk` (~168, ~187) and `src/share/upgrade.njk` (~168): "Passphrase download gate" → "Password-protected downloads" (R-7).
   - `src/share/status.njk` (~98–103): "passphrase" → "password", and fix the claim (F-2). The recipient's browser sends the password to the Worker over TLS when unlocking; only a hash is stored. Proposed: "Only a hash of the password is stored. When the recipient unlocks, the password is sent over an encrypted connection, checked, and not kept."
   - Grep refueler.io for any other reader-facing "passphrase" first (internal field names stay).
2. **N-3 — Carbon default site-wide (refueler.io).** Change the default from `'paper'` to `'carbon'` in `src/_includes/head.njk`, `src/notes/notes.js`, `src/share/chambers/index.html`, `src/dev/index.html`, and the `src/assets/css/global.css` header comment.
   - **Ask Rajesh first:** is `src/merchant/merchant-tablet-logic.js` (POS tablet) in scope?
   - Visitors who already chose a theme keep it (the `rs-theme` cookie).
   - **F-5:** add Source Serif 4 (opsz, wght 300) to the site-wide font link in `head.njk`.
   - **F-7:** the theme pill reads "Paper / Carbon" wrongly on load in Carbon (the head script sets the label before the pill exists). Fix in `head.njk`.
   - Commit and push refueler.io (Git-connected Pages deploys on push). **Push before step 3:** `ship-frontend.sh` refuses to run while refueler.io has unpushed commits it didn't make.
3. **N-3, refueler-share part:** remove the Share-only Source Serif `<link>` in `src/index.njk` (extraHead, marked "Remove when N-3 adds Source Serif 4 to the site-wide head"). Mirrored path, so it goes via `ship-frontend.sh` (Rajesh runs it). Only after step 2 is live, or the receiver headline loses its font.
4. **F-3 — stale generated pages (refueler-share only).** Wider than the build list says: `frontend/index.html`, `frontend/status.html` and `frontend/upgrade.html` are all old Eleventy output from the `pages.dev` era (`.eleventy.js` writes `src/*.njk` into `frontend/`). None is mirrored or served. Deleting only `index.html` isn't enough: the next local `npm run build` recreates it.
   - Check nothing uses them first: tests, `bin/`, the workflow, `share-tokens.css`'s comment.
   - Proposal to confirm: delete all three, and stop the local build writing HTML into `frontend/` (gitignore the three files, or point Eleventy's output elsewhere).
   - Then decide whether refueler-share's `src/status.njk`, `src/upgrade.njk` and local `src/_includes/*` (a local-only copy of refueler.io's header) still earn their place. Don't delete `src/index.njk` or `src/_includes` without checking `sm_render_njk` and the local preview.
   - Update the CLAUDE.md line "Never edit `frontend/upgrade.html` directly…".
   - Plain `git commit && git push` (not mirrored).

## Checks (before Rajesh's Safari pass)

- Local preview of refueler.io pages touched by N-3/N-4 in both themes.
- **First visit with no cookie** (private window) lands in Carbon, and the pill label is right on load.
- An existing Paper cookie stays Paper.
- Pages: home, Notes, Share upload, a Share receiver link, Plans, Status, Legend, Privacy. Desktop + phone width.
- After `✓ SHIPPED`: the receiver headline is still Source Serif, and the upload page is unchanged apart from the font link.

## Close

- `share-sessions.md` entry and build-list status (N-3 ✅, N-4 ✅, F-3/F-5/F-7 closed).
- Rajesh commits docs with `&& git push`.
