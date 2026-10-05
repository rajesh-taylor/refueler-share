# Share-Upload-2 — session prompt

> Run in a fresh session **after B12-1b is finished** (Rajesh, 5 Oct 2026). Design approved at Share-Upload-1 (28 Sep). Paste everything below the line.

---

Session: Share-Upload-2 — upload page redesign + Share sub-menu (build, two repos). Today is [date]. B12-1b is done.

Load: `CLAUDE.md`, `docs/Share-Upload-1-build-list.md` (decisions U-1…U-11, findings, build items), `docs/drafts/share-upload-mock-v3.html` (the approved design), and `Share-Upload-1-prompt.md` §4–5 plus its "Share-Upload-2 — build" section at the bottom.

**Already done; skip these:** F-12, F-13, F-14 (Share-Cleanup-1) and F-20, F-21 (Share-Deps-1). Confirm each against the code rather than trusting this line.
**Add to scope:** F-23 (the upload page flashes for about half a second before the receiver card).

**Two ships, in this order, each one finished before the next starts:**
1. **Part A, refueler.io only:** `_data/sections.js`, `share.11tydata.json`, `section-nav.njk`, `nav.njk` without Plans/Status, and Plans + Status moved onto the shared header. Ship via refueler.io's own git. Stop point: if Part A isn't live and checked, Part B waits for a new session.
2. **Part B, refueler-share:** canonical `src/index.njk` includes `section-nav.njk` (plus a local stub include), the upload sheet in `share.css`, copy changes in `index.njk`/`upload.js`, F-6 token mapping to `global.css`. Ship only via `bin/ship-frontend.sh` (it must end `✓ SHIPPED`).

**Rules learned the hard way at Berlin:**
- **After every layout change, check it on a real phone**, not just a desktop preview: iPhone 13 mini (Safari) and Pixel 9a (Vanadium, defaults). Give me a short checklist each time, and include the receiver page (the same file has two modes).
- **Keep every DOM id `upload.js` uses**, or change both sides in the same step.
- **Track the clock.** If we're past the halfway mark and Part B isn't close, say so and propose the cut. Don't push on.
- **Diagnose and propose before any edit.** Preview every state locally (a scratch harness, as in Receiver-2a/2b) before shipping.

Start by listing the build items from the build list, marking which belong to Part A and which to Part B, and flag anything that looks stale since 28 Sep. No code until I confirm.
