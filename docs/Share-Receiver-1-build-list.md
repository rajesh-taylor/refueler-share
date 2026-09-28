# Share-Receiver-1 — receiver page build list
> **Session:** Share-Receiver-1 · 27 Sep 2026 (design, no code changed)
> **Status:** Design approved by Rajesh (mock v5). N-1 ✅ · N-2a ✅ shipped 27 Sep (`82105b4`) · N-2b ✅ shipped 28 Sep (`22689ef`; Safari ✓) · N-3 ✅ N-4 ✅ (Share-Cleanup-1, 28 Sep) · item 13 waits on Share-DL-W1.
> **Mock:** https://claude.ai/artifact/1HRgQc8hxtcpod7ZKqE66t (private) · repo copy `docs/drafts/share-receiver-mock-v5.html`
> **Inputs:** `receiver-page-brief.md` · `docs/Share-Download-spec-v1.md` §6 · Share-DAD-2 log entry

The page a person lands on when they open a Share link. A handover, not a marketing page.
Carbon first. One primary action: Download.

---

## 1. Decisions (Rajesh, 27 Sep 2026)

| # | Decision |
|---|---|
| R-1 | **Type rule, three roles only.** Source Serif 4 light = the one headline per screen (and the Notes card title). IBM Plex Mono = small uppercase labels (eyebrows, ledger labels, field labels, theme pill) and the big download percentage. DM Sans = everything read: values, sentences, buttons, links, footer. |
| R-2 | **Ledger layout.** Label left / value right, hairline rules, one column max ~480 px. Phone: label above value. |
| R-3 | **"Download" is the verb** (not "Collect"). One primary button. |
| R-4 | **Bottom line:** "No account or email needed." No "No tracking" (the page reports a download event; Cloudflare injects a script). No taglines ("Privacy by architecture" rejected). |
| R-5 | **Expiry:** exact local date + time first ("Sat 3 Oct, 15:25"), countdown underneath, refreshed every minute; hours on the last day. |
| R-6 | **Delete-after-download:** the "Download / Not now" dialog is **dropped**. One line on the card: **"Deleted as soon as the download finishes. The link works once."** (not "immediately": a large file takes minutes to clear, though the link stops working at once). |
| R-7 | **"Password" everywhere, never "passphrase"** in anything a person reads. Internal field names (`passphrase_protected`, `p2sh_secret_hash`) stay. |
| R-8 | **Password screen:** "This file has a password." / "The sender gives you this separately from the link." / button "Unlock and download" / error "Incorrect password." under the field, field outlined. |
| R-9 | **Date seal is not shown to recipients** (see finding F-1). Remove the live offer. |
| R-10 | **Finished screen:** "Downloaded." + File/Size ledger + (DAD only) "Transfer permanently deleted from Refueler's servers." + **Notes card = the newest Notes article** + "Send your own file, free up to 4 GB →". |
| R-11 | **Notes card shows the newest article automatically** (no email list or social accounts, by design). Read from refueler.io after the download finishes; no card if it can't load. Never both a date seal and a Notes card. |
| R-12 | **"Free up to 4 GB" must change if the free limit ever drops below 4 GB** (also the upload page's "Free up to 4 GB"). Put a code comment next to the send line pointing at the free cap. |
| R-13 | **Whole refueler.io site defaults to Carbon** (not just Share). Visitors who already chose a theme keep it (cookie). |
| R-14 | **Receiver header:** wordmark + theme pill only, no nav. Footer: © 2026 Refueler · Status · Support. |

## 2. Findings from code reading (27 Sep 2026)

- **F-1 Date seal can't be checked by a recipient.** The `.ots` stamps `SHA-256(BLAKE3 plaintext root ‖ seal_nonce)`, not `SHA-256(file)` (`frontend/timestamp.js` `buildCommitment`). opentimestamps.org hashes the dropped file with SHA-256, so file + seal will not match. The nonce lives only in the link fragment, which `download.js` clears from the address bar on load. The saved seal is also the pending (un-upgraded) version; upgrade belongs to Legend. So the live line "Verify with opentimestamps.org — proves when this file existed…" is false for a recipient. Not reachable today (permanent record is paid-only; paid uploads not open). A recipient checker is a future design session (with Legend): the seal file would need to carry the nonce, plus an upgrade step.
- **F-2 Status page password claim is wrong.** refueler.io `src/share/status.njk:101-102`: "The passphrase never travels the wire — only its hash is stored". The **sender** sends only a hash, but the **recipient's** browser POSTs the plain password to `/auth/{uuid}` (`download.js`), where the Worker hashes it (`worker/src/index.js` ~1411-1428). True version: only a hash is stored; the password is sent over an encrypted connection when unlocking and is not kept.
- **F-3 `frontend/index.html` is stale.** The mirrored page is `src/index.njk` (`bin/lib/share-mirror.sh` `SM_C_NJK`). Edit receiver markup in `src/index.njk` only. `frontend/index.html` should be deleted in a cleanup session. *✅ Deleted, Share-Cleanup-1 (`7c9c692`).*
- **F-4 Timed window is one window,** `available_from` → `available_until` (paid tiers only, `manifest_tg.js`), enforced by the Worker on `/auth` and `/download`. Not daily hours (9am–6pm every day would be a new feature). Today, after the window closes, the page still shows a Download button, and pressing it lands on "no longer active".
- **F-5 Source Serif 4 is not loaded** on refueler.io (`src/_includes/head.njk` loads Satoshi, DM Sans, IBM Plex Mono). Add Source Serif 4 (opsz, wght 300) to the font link. The live site wordmark uses Satoshi; keep it. *(N-2a: loaded for the Share page only, one `<link>` in `src/index.njk` extraHead — remove it when N-3 adds the font site-wide.)* *✅ Site-wide since Share-Cleanup-1 (refueler.io `4acc358`); Share-only link removed (`d1bacad`).*

Found in N-2a (27 Sep 2026):
- **F-6 `share-tokens.css` is not loaded on refueler.io/share/.** refueler.io's `head.njk` loads `global.css` only, which has no `--mono`, `--serif`, `--display`, `--sans`, `--card-bg`, `--radius`, `--c-red`, `--c-amber`. Every `share.css` rule using them silently falls back live (e.g. "mono" labels on the upload page render in DM Sans). The receiver styles (`.rx-*`) set their own fonts and rules, so they're unaffected. Fix the upload-page styles in a cleanup session (map to `global.css` tokens; don't load a second token file).
- **F-7 Theme pill label is wrong on load in Carbon** (site-wide): the head script sets the pill text before the pill exists, so it reads "Paper / Carbon" until clicked. refueler.io `head.njk`. Fold into N-3. *✅ Fixed, Share-Cleanup-1: label re-set on `DOMContentLoaded`, markup starts "Carbon / Paper". Notes pages had a second cause (`notes.js` replaced the toggle), also fixed.*
- **F-8 "Refueler / Share" wordmark** (`wordmarkSection: "Share"`, N-2a) doesn't fit beside the full site nav between 961 and ~1000 px. `share.css` hides "/ Share" from 961 to 1040 px on the upload page only. Tidy when the site nav is revisited. *(N-2b: at ≤640 px the upload page header read "Refueler / ShareSHARE": the wordmark plus the one active nav link global.css keeps on narrow screens. Live since N-2a. Fixed 28 Sep: that link is hidden at ≤640 px on the upload page.)*

Found in N-2b (28 Sep 2026):
- **F-9 No one can download the date seal now.** The sender never received the `.ots` file (upload only shows "date seal submitted ✓"); the recipient's offer was the only way out, and item 10 removed it. The seal is still made, stored encrypted (`{uuid}/date-seal.ots.enc`) and deleted with the transfer. `/timestamp/seal/{uuid}` and `decryptOts` now have no caller; kept for the checker. Not reachable today (permanent record is paid-only). **Before paid uploads open, or before "permanent record" is claimed:** give the sender (or a checker) the seal, the nonce and an upgrade step — the F-1 design session, with Legend.

## 3. Build sessions, in order

Berlin rule: only small ad hoc sessions until Sun 4 Oct. N-1 and N-3/N-4 are small. R-2 is medium: Rajesh decides whether it waits until after Berlin.

### N-1 · Notes-List-1 (refueler.io, small) — ✅ Done 27 Sep 2026 (refueler.io 10bc0b6). /notes/latest.json live; publishing = add src/notes/<slug>/index.njk with cardTitle, summary, topics, date, readTime.
One list of Notes articles drives both the Notes index page and a small `/notes/latest.json`. Prompt: `Notes-List-1-prompt.md` (repo root).

### N-2 · Share-Receiver-2 (refueler-share frontend, medium) → `bin/ship-frontend.sh`
Files: `src/index.njk` (receiver markup only), `frontend/share.css`, `frontend/download.js`. No Worker change.
Split in two sessions:
- **N-2a · Share-Receiver-2a** — items 1–9. ✅ **Done 27 Sep 2026** — shipped `82105b4` (refueler.io `8c9986c`). Also: password row "Needed to download"; other errors "Stopped" / "The download stopped." + today's message; wordmark "Refueler / Share"; save-dialog-cancel dead button fixed; Safari/Firefox network error no longer hangs. Dead link and failed check use the new layout with today's words (reworded in N-2b).
- **N-2b · Share-Receiver-2b** — ✅ **Done 28 Sep 2026** — shipped `22689ef` (refueler.io `8516a9a`), items 10, 11, 12, 14; item 15 Safari ✓ (Rajesh, phone width: folder + password + DAD, Notes link, theme switch, second use → dead link). Found F-9. Was:
  - item 10 remove the date-seal offer (and drop the `decryptOts` import if unused);
  - item 11 "Link no longer active" copy + send line;
  - item 12 "Failed check" copy;
  - item 14 arrival motion (`prefers-reduced-motion` respected);
  - item 15 live verify in Safari: fresh link, password link, folder link, dead link, both themes, phone width.
  - Item 13 (DAD line on the card + dialog removal) still gated on Share-DL-W1.

1. **Receiver mode shell:** hide site nav, HTTP/3 whisper, badge, Upgrade link (R-14). Theme pill stays.
2. **Ready card:** eyebrow "A file for you" / headline "Someone sent you a file." / ledger File (hidden name + Show name, keep) · Size · Available until (R-5). Replace `usp-text` with R-4 line.
3. **Expiry refresh:** recompute on open and every minute (today: once at load).
4. **Password:** "Password" row on the card; unlock screen copy per R-8; `aria-invalid` + error line.
5. **Folder:** "Someone sent you a folder." / Folder row / "A zipped folder. Unzip it after download." (replaces "Compressed folder — unzip after download").
6. **Timed window, not yet open:** Opens / Closes rows, disabled button "Download from HH:MM", "The sender chose when this file can be downloaded. This page unlocks by itself." (countdown + auto-unlock already exist).
7. **Timed window, closed (new):** detect `available_until` passed on load → "This file is no longer available." / "The sender made it available until {date, time}. Ask them for a new link." No name or size.
8. **Downloading:** big mono %, hairline track, "X MB of Y MB", "Keep this tab open". Blob path's "Decrypting" stage label → "Preparing file".
9. **Finished:** R-10. Notes card fetches `https://refueler.io/notes/latest.json` (same site) **after** the download completes; on any failure, no card. Send line with the R-12 code comment.
10. **Remove date seal offer** (`_offerOtsDownload` calls in both download paths; drop the `decryptOts` import if unused). R-9.
11. **Link no longer active:** "This link is no longer active." / "The file was deleted after download, or its time ran out. Ask the sender for a new link." + send line.
12. **Failed check:** "This file didn't pass its check." / "The stored copy doesn't match what the sender uploaded, so the download stopped. Nothing was saved to your device. Ask the sender for a new link." (drops "lodged"; storage integrity only, never "end-to-end").
13. **Delete-after-download line (R-6) and dialog removal — gated on Share-DL-W1** (Worker deletes only after the verified last piece is fully sent, spec §5 D-DAD-2). Until then keep today's dialog.
14. Arrival motion: lines settle 170 ms apart, button last, once only; `prefers-reduced-motion` respected.
15. Verify live per CLAUDE.md frontend checklist, in Safari: fresh link, password link, DAD link (after DL-W1), dead link, both themes, phone width.

"Open this link on a computer" (phone > 4 GB, browser can't save) is designed in the mock but built in **Share-DL-2** with its detection logic (spec §2.3, D-8).

### N-3 · Share-Theme-1 (refueler.io + refueler-share, small) — R-13 · ✅ **Done 28 Sep 2026 in Share-Cleanup-1** (refueler.io `4acc358`; Share `d1bacad`, `7c9c692`). F-3, F-5, F-7 closed. POS tablet left out (Rajesh). `dev/index.html` was already Carbon.
Change the default from `'paper'` to `'carbon'` in: refueler.io `src/_includes/head.njk`, `src/notes/notes.js`, `src/share/chambers/index.html`, `src/dev/index.html`, `src/assets/css/global.css` (header comment); refueler-share `src/_includes/head.njk` (local build). Check `src/merchant/merchant-tablet-logic.js` (POS tablet): confirm with Rajesh whether it's in scope. Add Source Serif 4 to the font link (F-5).

### N-4 · Copy fixes (refueler.io, small) — ✅ **Done 28 Sep 2026 in Share-Cleanup-1** (refueler.io `e4463bb`), wording as below, approved by Rajesh
- `src/share/plans.njk:168,187` and `src/share/upgrade.njk:168`: "Passphrase download gate" → "Password-protected downloads" (R-7).
- `src/share/status.njk:98-103`: passphrase → password, and fix the claim (F-2), e.g. "Only a hash of the password is stored. When the recipient unlocks, the password is sent over an encrypted connection, checked, and not kept."

### Later, not scheduled
- **Receiver footer (R-14)** — "© 2026 Refueler · Status · Support" vs the live site-wide footer ("© 2026 Refueler Ltd (incorporating) · refueler.io" · Privacy · Support). Rajesh, 27 Sep: leave for now; do when needed or in a snag-list run.
- Upload-page styles on refueler.io (F-6), wordmark band (F-8). (Pill label on load, F-7: ✅ Share-Cleanup-1.)
- Date-seal checker a recipient can use (F-1), and a way for anyone to get the seal at all (F-9) — design with Legend, before paid uploads open.
- Daily availability hours — new feature, not planned.
- ~~Delete stale `frontend/index.html` (F-3).~~ ✅ Share-Cleanup-1 (`7c9c692`): also `status.html`, `upgrade.html`, `src/status.njk`, `src/upgrade.njk`; `frontend/index.html` gitignored.
