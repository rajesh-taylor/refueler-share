Notes-List-1 — build the Notes page from one list, and publish the newest article as a small file for the Share receiver card.

Repo: refueler.io (~/Documents/refueler.io). Eleventy site, Git-connected to Cloudflare Pages: pushing main deploys. Read the repo's own CLAUDE.md / SESSIONS-refueler-io.md first. Background: ~/Documents/refueler-share/docs/Share-Receiver-1-build-list.md (item N-1, decisions R-10/R-11).

Why: Refueler has no email list and no social accounts, by design. The Share receiver page will show the newest Notes article as a card after a download finishes. So publishing an article must update both the Notes page and that card, with no second step to forget.

Today: src/notes/index.njk hand-writes each article card (one article: /notes/what-a-subpoena-gets/). Article titles in front matter carry a " · Refueler Notes" suffix for the browser tab.

Do:
1. Read how the Notes page and the article are built. Then propose, in plain English, one source list for articles. Prefer each article's own front matter + an Eleventy collection, so publishing = adding the article's folder. Fields: card title (no suffix), one-line summary, tags, date published, url. Wait for my OK before editing.
2. The Notes page renders its cards from that list, newest first, and looks exactly as it does today.
3. Build a static /notes/latest.json holding the newest article only:
   { "schema": "notes-latest.v1", "title": …, "summary": …, "url": "https://refueler.io/notes/…/", "date": "YYYY-MM-DD" }
   Summary for the current article (approved 27 Sep): "If a legal order reached your file transfer service tomorrow, what would it hand over? Eight services compared."
   No cookies, no query strings, nothing about the reader. Same site as refueler.io/share/, so no CORS needed. Keep caching short so a new article shows up within minutes. Serve it as application/json.
4. Build locally (Eleventy) and check: _site/notes/index.html looks the same as today, and _site/notes/latest.json is valid JSON with the right fields.

Rules:
- Never edit src/share/* (mirrored from refueler-share by bin/ship-frontend.sh). The Share receiver card itself is built later in refueler-share (Share-Receiver-2), not here.
- Never push. Show me the diff, then give me the commit and push commands.
- After I push, verify live: fetch https://refueler.io/notes/latest.json and check it parses as JSON with the right title. A 200 status proves nothing: refueler.io answers a missing file with 200 + the homepage.
- Short, plain answers. I'm a non-coder.
- Close: log the session in the refueler.io sessions file, and tell me the line to mark N-1 done in refueler-share's build list.
