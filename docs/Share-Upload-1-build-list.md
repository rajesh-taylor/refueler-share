# Share-Upload-1 — upload page + Share sub-menu build list
> **Session:** Share-Upload-1 · 28 Sep 2026 (design, no code changed)
> **Status:** Design approved by Rajesh (mock v3, 28 Sep). Build: Share-Upload-2. Share-Deps-1 ✓ (F-20, F-21 fixed, 28 Sep).
> **Mock:** https://claude.ai/artifact/MAQmeQhhM3KieZo1Cr2FYg (private; v1 = A/B, v2 = open sheet, v3 = empty ledger) · repo copy `docs/drafts/share-upload-mock-v3.html`
> **Inputs:** `Share-Upload-1-prompt.md` §1–5 · `docs/Share-Receiver-1-build-list.md` (R-1…R-14, F-1…F-9 carry over) · receiver mock v5

The page a sender lands on. One job: get a file to a link. Same look as the receiver (R-1 type rule, ledger, big mono %).

---

## 1. Decisions (Rajesh, 28 Sep 2026)

| # | Decision |
|---|---|
| U-1 | **Open sheet (variant B), no card.** The receiver's twin: eyebrow, serif headline, ledger, big mono %. The homepage code card (A) was mocked and not chosen. |
| U-2 | **"Encrypted in your browser"** replaces "End-to-end encrypted", here and on the Plans page. |
| U-3 | **Share sub-menu = one segmented pill, centred** over the content column, on every Share page: **Send · Plans · Status.** Hairline outline, hairline dividers, current page = soft fill + full-strength text (not the filled button style, which belongs to the primary button). No bottom rule under the row. Notes and Support stay in the top nav. Receiver mode hides it (R-14). |
| U-4 | **"Subscriber sign-in" joins the pill only when sign-in exists** (Registered rail, B12 + X5 origin). No placeholder until then. Harbourmaster never appears in the public menu. |
| U-5 | **The page follows the theme.** (Paper may be retired later.) |
| U-6 | **HTTP/3 line and Refueler badge removed** from the upload page. |
| U-7 | **The empty ledger.** No icon, no dashed drop box. Setup lives in one hairline box (the "slip"): ledger rows File / Size / Available until, empty at first ("—", "7 days after upload"), with a facts row at its foot, joined by a hairline: **"No account or email needed · Encrypted in your browser · Free up to 4 GB"** (one line on a laptop; on a phone it breaks after the first item, each part `nowrap`). Choosing or dropping a file fills the rows **in place** (they settle in, R-14 motion); Password and After download rows join. Same box through zipping, file chosen and over 4 GB. Uploading, link ready and error stay open (no box), as in v2. |
| U-8 | **Choosing and dropping.** File row, laptop: "Drop it anywhere on this page" + **"Choose a file"** (small filled button) + **"or a folder"** (text link). Most people send one file. **The whole page takes a drop**: while a file is held over it, a thin accent frame surrounds the page, the box turns accent and the File row reads **"Release to add."** Phones: button and link only (no drag and drop); the drop line shows only on `(hover: hover) and (pointer: fine)`, so an iPad with a trackpad gets it. |
| U-9 | **QR:** hidden until "Show QR code" (it is the link). Centred in a light tile, dark modules in both themes, ~260 px laptop / ~220 px phone. Sharp: a real canvas sized to CSS × `devicePixelRatio`, whole CSS pixels per module, `image-rendering: pixelated`. Caption: **"Scan with a phone's camera to download the file on that phone."** |
| U-10 | **Turnstile hidden unless needed** (`appearance: 'interaction-only'`). It starts when a file is chosen. If Cloudflare needs a click, the widget appears above the button, full width like the button (`size: 'flexible'`, min 300 px), with one line above it: **"A quick check by Cloudflare that you're a person. Not an account."** The button is never greyed out for an invisible reason: pressing it before the token arrives shows **"Checking…"** and the upload starts when the token lands. |
| U-11 | **Wrong file: "Choose another".** Next to the file name (13.5 px, full-strength text; under the name on a phone). It empties the rows back to the empty ledger and puts focus on "Choose a file", so file-or-folder is open again. The password and delete settings are kept for the next file. Dropping a new file anywhere on the page replaces the current one. A passed Cloudflare check is kept (today `_handleFileSelection` throws the token away and re-renders Turnstile on every new file). The browser Back button is no help: the page has no history of its own, so Back leaves Refueler. |

Still open (defaults below unless Rajesh says otherwise):
- Link-preview title / description (same page as the receiver, so it's the unfurl a recipient sees): "Refueler Share — encrypted file transfer" / "Encrypted file transfer. Files are encrypted in the browser before upload. No account or email needed." Drops lowercase and "No history".
- Tab title while uploading: "41% · Refueler Share", never the file name.

### Copy

| Where | Today | New |
|---|---|---|
| Headline | none | "Send a file." · "Zipping your folder." · "This file is over 4 GB." · "Uploading." · "Your link is ready." · "The upload stopped." |
| Eyebrow | none | New transfer · Preparing · Ready to send · Too large · Encrypting and uploading · Link ready · Stopped |
| Drop area | "Drop a file or folder here" / "📄 Browse file" / "📁 Upload folder" | Empty File row: "Drop it anywhere on this page" / "Choose a file" / "or a folder" (phone: button + link only); Size "—"; Available until "7 days after upload" |
| Drag-over | — | File row: "Release to add." |
| Wrong file | none (re-drop only) | "Choose another" beside the file name |
| Facts row | lock message + "End-to-end encrypted · Free up to 4 GB" | "No account or email needed · Encrypted in your browser · Free up to 4 GB" |
| Turnstile (only if a click is needed) | — | "A quick check by Cloudflare that you're a person. Not an account." |
| Button before the check finishes | disabled, no reason shown | "Checking…", then the upload starts by itself |
| Password | "Protect with password" / "Recipient must enter a password to download" | Row "Password": "Ask for a password" |
| Password helper | "Share this separately. We never store it." | "Send it separately from the link. Refueler stores only a hash of it." |
| Delete toggle | "Destroy after download" / "This transfer is deleted the moment it is downloaded" | Row "After download": "Delete the file" |
| Delete notice | "**Once downloaded, the recipient cannot download again.** Our servers store only encrypted data…" | "The link works once, then the file is deleted." After Share-DL-W1: R-6 wording on both pages. |
| Button | "Encrypt & upload" | "Encrypt and upload" |
| Over 4 GB | "Creative Premium supports transfers up to 100 GB — see plans →" (`/upgrade.html`) | Size row (warn colour): "Free transfers go up to 4 GB. Paid plans for larger files aren't open yet. See plans" (`/share/plans/`) + "Choose another file" |
| Folder over 2 GB | "…lodge the .zip as a single file — single files stream from disk with no size limit beyond your tier ceiling." | "This folder is 2.6 GB. Folders can be up to 2 GB. Zip it yourself and send the .zip as a file (free up to 4 GB)." |
| Multi-drop | "One file or one folder at a time please." | "One file or one folder at a time." |
| Zipping | "Gathering" / "Compressing" / "Finalising archive" / "Writing zip directory…" | "640 MB of 1.2 GB" + "Folders are zipped in your browser first, up to 2 GB." |
| Upload stages | Generating key · Hashing password · Chunking · Credentialling · Initiating · Uploading · "1344 / 3200 chunks" · Finalising · Done | Preparing · Encrypting and uploading · Finishing; readout "X MB of Y MB" + "Keep this tab open"; "If this tab closes, come back to this page to resume." |
| Resume | "Interrupted / Transfer paused / {name} — 42% uploaded (chunk 1344 of 3200, …)" / "Chunks already sent are encrypted." | "An upload didn't finish." File + Uploaded rows · "Choose the same file to carry on. Your browser can't reopen it by itself." · "Choose the file" / "Discard" |
| Resume, folder | "Folder uploads cannot be resumed — please start a new upload." | "A folder upload didn't finish. Folders can't be resumed, so start again." |
| Link ready | "✓ Ready to share" + link + "Copy link" / "New upload" | "Your link is ready." + key line + link + "Copy link" / "Show QR code" + ledger (File, Size, Available until, Password, After download) + "Send another file" |
| Key line | "Only you hold the key." (wrong) | "The key to the file is inside the link. Anyone who has the link can download the file, so send it only to the person it's for." |
| Password note | "🔐 Password protected — share the password separately." | Ledger row Password: "Needed to download" / "Send it separately from the link." |
| Error: network | nothing (frozen, F-11) | "The upload stopped." / "Refueler couldn't be reached after several tries. Nothing was shared. Try again carries on from 42%; you'll be asked to choose the same file." |
| Error: check failed | nothing (frozen) | "The security check didn't go through. Try again." |
| Error: refused | nothing (frozen) | "Refueler refused the upload. Try again; if it keeps happening, check the Status page." |
| Error: finish failed | "Finalise failed — N chunk(s) missing at storage. Transfer not complete." | "The upload didn't finish. Some parts didn't arrive. Try again." |

Paid-only options (availability window, permanent record) stay out of the design until paid uploads open and F-1/F-9 are solved. See F-10.

## 2. Findings from code reading (28 Sep 2026)

Numbering continues from the receiver list.

- **F-10 Paid options can't be reached.** `upload.js` sends `tier: 'free'` on every credential request, and `_updatePaidFeaturesVisibility` runs after the options card is hidden. The availability window and permanent-record toggle can never be set from the page. Leave them hidden; redesign with paid uploads.
- **F-11 Upload errors are silent.** `startUpload` throws on credential, initiate and chunk failures (after 6 tries) with no catch, so the page freezes on its last stage. Finalise failures do write a line, in jargon.
- **F-12 Status banner links to `/status.html`,** which refueler.io answers with the homepage. Should be `/share/status/`.
- **F-13 Cap warning links to `/upgrade.html`,** which 308s to the legacy `/upgrade` page (Stripe form, retired tier names). Should be `/share/plans/`.
- **F-14 Stray public page.** refueler.io `src/share/-includes/share-footer.njk` is built and served at `refueler.io/share/-includes/share-footer/` (a bare footer). Same bytes as `_includes/share-footer.njk`, which is itself identical to `footer.njk`.
- **F-15 Double label at ≤640 px on other sections.** `/legend/` shows "Refueler / Legend" + "LEGEND" (global.css keeps the active link). Share's fix lives in `share.css` and covers the upload page only; Plans and Status get the same bug once they use `nav.njk` with a section. Fix once in refueler.io.
- **F-16 QR colours.** `_renderQr` draws light-on-dark in Carbon (`#F7F4EF` on `#111316`); some phone scanners can't read inverted codes. It's drawn once, so it doesn't follow a theme switch. Always dark on a light tile (U-9).
- *F-17 withdrawn (Turnstile in the always-dark card; variant A only).*
- **F-18 F-8 may go away.** Removing Plans and Status from the top nav frees well over 100 px. Retest 961–1040 px; if "/ Share" fits, remove the hide rule in `share.css`.
- **F-19 The live QR is blank.** `share.js` creates an `<svg>` and passes it to `QrCreator.render`, which only draws to a canvas: given anything else, it appends a `<canvas>` inside the SVG, and browsers don't display HTML inside SVG. Checked live in Chromium: the canvas is 0 × 0 inside an empty 300 × 150 box. Probably blank since the S47–S52 "QR SVG" change. Fix: pass a real `<canvas>` (U-9).
- **F-20 ✓ Fixed, Share-Deps-1 (`b8673e2`, 28 Sep).** Receiver mode no longer loads BLAKE3 or secp256k1; BLAKE3 falls back to vendored pure-JS noble BLAKE3 when WebAssembly is missing or broken (identical digests and Merkle roots, tested). **Pixel 9a, Vanadium, default settings: received a link from the Mac and sent one to the Mac, both fine (Rajesh, 28 Sep, small files).** Not yet known: which BLAKE3 Vanadium ran (WASM interpreter or the JS fallback), and how a large send feels there (JS with no JIT ≈ 2.5 MiB/s on an M-series Mac, so a 4 GB send costs ~30–60 min of hashing on a phone). *Original finding:* **GrapheneOS / Vanadium may not send or receive at all (not yet tested).** Vanadium turns the JavaScript JIT off by default, and Chromium without the JIT usually has no WebAssembly. The browser BLAKE3 (`frontend/blake3/browser-async.js`) is WebAssembly and loads via `loadDeps()` at the start of both `startUpload` and receiver mode (`download.js` ~93), so the recipient page may stay blank and uploads may freeze (silently, F-11). Rajesh tests on a Pixel 9a. If confirmed: a pure-JS BLAKE3 fallback when `WebAssembly` is missing, so Share works on Vanadium's hardened defaults. Covered by Share-Deps-1 (below).
- **F-21 ✓ Fixed, Share-Deps-1 (`b8673e2`, 28 Sep).** `@noble/secp256k1` 1.7.2 vendored as `frontend/noble-secp256k1.js`; no Share page requests esm.sh (checked live). CSP still to do: draft in `docs/Share-CSP-1-notes.md` (own session). *Original finding:* **The live page loads code from esm.sh on every visit.** `crypto.js` `loadDeps()` imports `https://esm.sh/@noble/secp256k1@1.7.2` at runtime (live `crypto.js` line 53), on sender and recipient pages, with no SRI and no CSP. A third party can run code on the page that holds the decryption key, and sees every visitor's IP. Receiver mode imports only `loadDeps`, `hexToBuf` and `WORKER_URL` from `crypto.js` and uses neither BLAKE3 nor secp256k1, so it loads both for nothing. Its own session, **Share-Deps-1** (prompt given in chat, 28 Sep): vendor the v1 module, stop receiver mode loading deps it doesn't use, pure-JS BLAKE3 fallback, then a CSP for `/share/`.
- **F-6 is wider than logged.** `--card-bg`, `--card-border` and `--tag-bg` are defined nowhere on refueler.io: `.card` has no fill or border and the upload progress track is invisible. Fix with the F-6 token mapping.

Found at Share-Deps-1 (28 Sep, Rajesh's phone tests + code reading):

- **F-22 The download bar jumps in 15 % steps and looks frozen in between.** On the Safari/Firefox/iPhone path (`download.js` ~553) each 32 MiB chunk is read with `res.arrayBuffer()`, so the bar moves only when a whole chunk has arrived, and downloading fills just the first half of the bar ("Preparing file" fills the rest). A 104 MB folder = 4 jumps of ~15 %. Fix: read `res.body.getReader()` and update the bar as bytes arrive (same for the streaming path). Rajesh: "It'll de-stress the receiver." Not Upload-2 — download work (Share-DL-W1 or a small session).
- **F-23 The upload page flashes before the receiver card.** Opening a link shows the upload screen for ~½ s until the modules load and `enterDownloadMode` hides it. Fix: a tiny blocking script file in `<head>` (not inline — CSP) that adds a class when `location.hash` is non-empty, and `share.css` hides the upload screen under it. Fits Upload-2 (touches `src/index.njk` + `share.css`).
- **F-24 A link with a damaged key shows "Share couldn't start in this browser."** Deps-1's catch-all is right for a failed load, wrong for a bad link (reloading or another browser won't help). Rare: a truncated fragment usually fails to parse and lands on the upload page instead. Give the key-import failure its own "This link is incomplete" notice with the F-11 error work.
- **F-25 The admin test page still loads code from esm.sh.** `worker/src/share/admin/test-upload.html` (mirrored to `refueler.io/share/admin/`) imports `@noble/hashes@1.8.0/blake3` and `@noble/secp256k1@2.2.1` from esm.sh. Admin-only, no user keys, but it breaks under a `/share/*` CSP. Vendor or give it its own policy (see `docs/Share-CSP-1-notes.md`).
- **F-26 Permanent record contacts the OTS calendars from the browser.** `timestamp.js` `submitToCalendars()` POSTs the 32-byte commitment straight to alice/bob `…calendar.opentimestamps.org`, so the calendars see the sender's IP. CLAUDE.md describes Worker relay endpoints for this. Unreachable today (F-10, paid only); decide at the permanent-record rebuild whether the browser or the Worker talks to the calendars.
- Noted, no change: resume keeps the AES key and IV in IndexedDB until the upload finishes, is discarded, or is 8 days old.

## 3. Build — Share-Upload-2

Two repos. **Order matters:** refueler.io first, or the Pages build fails on a missing include.

### Part 1 · refueler.io (own git)
1. `src/_data/sections.js`: `share: [Send /share/, Plans /share/plans/, Status /share/status/]`. Legend later; sign-in when built (U-4).
2. `src/share/share.11tydata.json`: `{ "section": "share", "wordmarkSection": "Share" }`. Check `chambers/index.html` (an Eleventy template in the same folder) doesn't render a nav from it.
3. `src/_includes/section-nav.njk`: the centred segmented pill (U-3); current item from `page.url` with `aria-current="page"`. Verify `/share/index.html` gives `page.url` `/share/`.
4. `nav.njk`: drop the Plans/Status block (bar and drawer); "Share" active when `section == 'share'`. Hide the active product link at ≤640 px whenever a section shows in the wordmark (F-15), then remove the upload-only rule from `share.css`.
5. `plans.njk`, `status.njk`: `nav.njk` + `section-nav.njk` + `footer.njk`; remove "← Back to Refueler Share". Retire `share-nav.njk`, `share-footer.njk` and the stray `-includes/` folder (F-14).
6. Plans page "End-to-end encrypted" → "Encrypted in your browser" (U-2).

### Part 2 · refueler-share → `bin/ship-frontend.sh`
7. `src/index.njk`: include `section-nav.njk` (add a local stub in refueler-share `src/_includes/`); remove the info card and `#share-subnav` + its inline observer script; new upload markup: the slip with empty rows that fill in place (U-1, U-7, U-8); Turnstile block above the button (U-10); remove HTTP/3 line + badge (U-6); title/description; banner link (F-12); cap link (F-13); a blocking `<head>` script file that marks a link visit before the modules load (F-23; new file → add to `bin/lib/share-mirror.sh`).
8. `share.css`: upload styles on `global.css` tokens (F-6); slip + facts row, filled "Choose a file", switch, measure shared with `.rx-*`; drop line only on `(hover: hover) and (pointer: fine)`; page-drop accent frame; retest F-8/F-18. Receiver mode hides the sub-menu (R-14). Hide the upload screen under the F-23 class, so a link never flashes it.
9. `upload.js`: copy per §1; stage words; **drop target = the whole page** (dragover/drop on `document` in upload mode only, never in receiver mode; the accent frame follows dragover and clears when it stops); drop the destroy notice; move the destroy toggle into static markup (keep ids `destroy-after-download`, `destroy-toggle-row`); leave the paid-options injection hidden (F-10); catch `startUpload` errors into the error state (F-11); Turnstile `appearance: 'interaction-only'`, `size: 'flexible'`, shown via `before-interactive-callback`; a click before the token arrives shows "Checking…" and starts when the token lands (U-10). "Choose another" (U-11): back to the empty rows, keep toggle state and password, keep a live Turnstile token (stop resetting `state.turnstileToken` and re-rendering in `_handleFileSelection`; re-render only if the token has expired).
10. `share.js`: share panel (key line, ledger, "Send another file"); QR on request, into a real canvas at CSS × `devicePixelRatio`, dark on light (U-9, F-16, F-19); remove the info-card dismiss handler.
11. Keep every id the e2e test and `upload.js` use (`drop-zone` moves to the slip; `file-btn` = "Choose a file", `folder-btn` = "or a folder"): `drop-zone`, `file-input`, `folder-input`, `file-btn`, `folder-btn`, `options-card`, `upload-btn`, `share-card`, `share-link-display`, `copy-btn`, `new-upload-btn`, `qr-wrap`, `progress-*`, `zip-*`, `resume-*`, `cap-warning`, `passphrase-*`, `turnstile-wrap`, `cf-turnstile`, `drop-multi-msg`. The e2e test waits for `#upload-btn` to be enabled; with U-10 the button is enabled early, so check the test still waits for the token (or the queued start).

### Verify
12. Scratch harness (fake Worker, as in Receiver-2a/2b): every upload state + receiver states, Paper + Carbon, 375 / 640 / 1000 / 1280 px, no side-scroll. Plans and Status pages with the new header.
13. After `✓ SHIPPED`: live upload + receive in Safari (phone width), password + delete-after-download, theme switch, QR scans from a laptop screen, then the full CLAUDE.md frontend checklist.
14. **iPhone 13 mini (Safari):** does "or a folder" work in iOS Safari? If it can't pick a folder, hide it there.
15. **Pixel 9a (GrapheneOS, Vanadium, default settings):** receive a link first, then send. A blank recipient page or a frozen upload = F-20.

## 4. Not in Upload-2
- esm.sh import and Vanadium fallback (F-20, F-21) — ✓ Share-Deps-1, 28 Sep.
- Notes article for GrapheneOS users — F-20 fixed and tested on Vanadium defaults; listed as article 15 in `notes-articles-list.md`.
- Download bar (F-22), damaged-key notice (F-24), admin page (F-25), calendars (F-26). F-23 (upload flash) **is** in Upload-2: add to items 7–8.
- Paid options and permanent record (F-1, F-9, F-10) — with paid uploads and Legend.
- Receiver R-6 line and dialog removal — Share-DL-W1.
- Plans page tier names and layout — plans draft B.
- Sign-in itself — B12 + X5.
