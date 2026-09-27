# Share-Upload-1 — prompt (design + A/B mock, no code)
> Written at the end of Share-Receiver-2b · 28 Sep 2026. Planned: **Tue 29 Sep** (small, fits the Berlin rule).
> Share-Upload-2 (the build) starts **after Berlin (back Sun 4 Oct)** — see the bottom of this file.

Paste this as the session prompt:

---

Share-Upload-1 — upload page + Share sub-menu: design and A/B mock only, no repo code. Repos: refueler-share (read) and refueler.io (read). Read CLAUDE.md first, then `docs/Share-Receiver-1-build-list.md` (decisions R-1…R-14 and findings F-1…F-9 carry over), `docs/drafts/share-receiver-mock-v5.html` (the approved receiver mock, same look), and the "Share-Upload direction" entry in `share-sessions.md`. Produce an A/B mock as a private artifact plus `docs/Share-Upload-1-build-list.md` (decisions, findings, build items for Upload-2). Propose before writing anything to the repo. Short, plain answers.

---

## 1. Decided (Rajesh, 28 Sep 2026)

- **Remove the lock message** ("No account. No email. No history. Files are encrypted in your browser before upload. Only you hold the key.").
- **Upload card styled like the homepage code card** (refueler.io `src/index.njk` `.home-code`, `home.css`): a header strip (mono label + status tag), a body and a caption line. Rajesh likes it. Make it variant A of the mock.
- **A/B mock.** Two variants side by side, so Rajesh can compare. Not a live A/B test: traffic is too small to read, and the page doesn't track visitors.
- **Share sub-menu under the site header** on every Share page: Send (the upload page) · Plans · Status, with room for later items (sign-in, Harbourmaster). **Then Plans and Status come out of the top nav**, freeing space there.
- **Each product's section is a mini site**: its own sub-menu under the one Refueler header. Build it with Eleventy (data + one include), not by hand per page (§4).
- **Upload-1 tomorrow (29 Sep); Upload-2 after Berlin.**

## 2. To decide in Upload-1

1. **"End-to-end encrypted"** (drop zone). Claude's recommendation: **"Encrypted in your browser"** (drop-zone line: "Encrypted in your browser · Free up to 4 GB").
   - It says exactly what happens and where.
   - CLAUDE.md bans "end-to-end" for integrity. The same words for encryption invite confusion.
   - The plans-page review (Share-MCP-Chat-1) flagged the same phrase. Decide once, for both pages.
2. **Other upload-page copy that isn't true or is out of date** (read live before the mock):
   - "Only you hold the key": anyone with the link holds it (it's in the link). Goes with the lock message.
   - "No history": dropped from the receiver page on 27 Sep.
   - "Destroy after download / This transfer is deleted the moment it is downloaded": the receiver says "Deleted as soon as the download finishes. The link works once." (R-6, not "immediately"). Align the two. Mind the item-13 gate (Share-DL-W1) for the receiver line.
   - Cap warning: "Creative Premium supports transfers up to 100 GB — see plans →" links to `/upgrade.html`. "Creative" is a retired tier name; paid cards are "Coming Soon".
   - Permanent record: "unforgeable record", and after F-9 **no one can download the seal**. Keep the toggle out of the design until F-1/F-9 are solved (paid-only; not live today).
   - Password: "Protect with password" / "Share this separately. We never store it." (only a hash is stored: fine, but check against F-2 wording).
   - Tab/link-preview title "refueler share — encrypted file transfer" (lowercase) and description "…No account. No email. No history." This is the same page as the receiver, so the unfurl a recipient sees in chat changes too.
3. **Sub-menu labels and order.** "Send" vs "Share" for the upload page (the wordmark already says Share). Where Notes/Support go (stay in the top nav?).
4. **Sign-in slot.** Registered rail only (magic link, B12). The anonymous Lightning-credits route has no login, so the label must not suggest everyone needs an account ("No account or email needed" stays true). Signed-in pages must move to a separate origin with strict CSP (X5) before the Sovereign ledger ships. Harbourmaster (B12-5) is Chartered-only and waits until a Chartered client is in sight. **Design reserves the slot; nothing is built.**
5. **Headline.** One serif headline above the card, like the receiver ("Send a file." or similar), per R-1. No taglines (R-4 spirit).

## 3. States the mock must show (both variants, Paper + Carbon, desktop + phone)

Empty · drag-over · folder zipping · file chosen (password toggle + field, delete-after-download toggle + notice, Turnstile box) · over 4 GB · resume an interrupted upload · uploading (progress) · link ready (copy, QR, new upload) · error. Paid-only options (availability window, permanent record) shown greyed or left out, with a note. Include the header at ≤640 px (just fixed: "Refueler / Share", menu button, theme pill) and the new sub-menu at phone width.

Check the live page first (https://refueler.io/share/), and `frontend/upload.js` for the options it injects (`_injectTransferOptions`: destroy toggle, availability window, permanent record).

## 4. Eleventy "mini site" — current state and proposed shape (refueler.io)

**Today, three different headers on one product:**
- `/share/` (upload + receiver) uses the site `nav.njk` with `wordmarkSection: "Share"`. `nav.njk` adds Plans and Status to the top nav only when `activePage` is share/plans/status.
- `/share/plans/` and `/share/status/` use a separate `share-nav.njk` (Plans · Notes · Support · Privacy; no Share, Legend or Status link) and `share-footer.njk`.
- The floating "Plans · Status" links under the drop zone live in canonical `src/index.njk` (hidden on file select by a small inline script).
- Also odd: `src/share/-includes/share-footer.njk` (stray copy?), and `src/share/upgrade.njk` → `/upgrade.html` (legacy).

**Proposed (to confirm in Upload-1, build in Upload-2):**
- `src/_data/sections.js`: each product's sub-menu items (Share now; Legend later, which already sets `wordmarkSection: Legend`).
- `src/share/share.11tydata.json`: section defaults for every page under `src/share/` (`section: "share"`, `wordmarkSection: "Share"`).
- `src/_includes/section-nav.njk`: renders the sub-menu from that data; the current page is marked from `page.url` (no `activePage` strings).
- `nav.njk`: drop the Plans/Status block. Plans and Status switch to `nav.njk` + `section-nav.njk`. Retire `share-nav.njk` (and check the stray `-includes` folder).
- Receiver mode hides the sub-menu (R-14 unchanged).
- One header and one token file (`global.css`) across products: the section changes the navigation, not the styling.

## 5. Constraints (from CLAUDE.md, apply to both sessions)

- Canonical `src/index.njk` and `frontend/*` live in refueler-share and reach refueler.io only via `bin/ship-frontend.sh`. Never edit refueler.io `src/share/index.njk` or `src/share/assets/*` directly.
- The page has two modes (upload and receiver): check both after every change.
- F-6: many upload-page styles use tokens refueler.io doesn't load (`share-tokens.css`), so they fall back live. Fix inside the redesign by mapping to `global.css` tokens, not by loading a second token file.
- `upload.js` is a state machine (Turnstile, IndexedDB resume, folder zip, cap check, progress, share card, QR). Keep every DOM id it uses, or change them in the same session.

---

## Share-Upload-2 — build (after Berlin, from Sun 4 Oct)

Medium, two repos. Scope comes from `docs/Share-Upload-1-build-list.md`. Known shape:

1. **refueler.io first:** `_data/sections.js`, `share.11tydata.json`, `section-nav.njk`, `nav.njk` without Plans/Status, Plans + Status pages on the shared header. Ship via refueler.io's own git.
2. **Then refueler-share:** canonical `src/index.njk` includes `section-nav.njk` (plus a local stub include in refueler-share `src/_includes/` for the local build), upload card redesign in `share.css`, copy changes in `index.njk`/`upload.js`, F-6 token mapping. Ship via `ship-frontend.sh`.
   **Order matters:** if canonical `index.njk` includes a file refueler.io doesn't have yet, the refueler.io Pages build fails.
3. Preview every state locally (scratch harness, as in Share-Receiver-2a/2b) + the receiver page, then Rajesh ships and checks in Safari.

**Scheduling flag:** the locked queue after Berlin starts with **B12-1b** (the live Pro Bono size hole, S1.1). Rajesh decides whether Upload-2 goes before or after it.
