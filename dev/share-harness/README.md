# Share preview harness (Share-Upload-2; rebuilt on the app at X5-2)

Local only. Builds the real app (`bin/ship-app.sh --check` → `dist/`), copies it and points it
at a fake Worker and a stub Turnstile, so every upload and receiver state can be previewed
before `bin/ship-app.sh`. Nothing here is deployed. (No CSP here: `_headers` is not served.)

    dev/share-harness/build.sh                 # rebuild after each edit → .out/app
    node dev/share-harness/fake-worker.mjs     # :8766, in-memory
    python3 -m http.server 8765 --directory dev/share-harness/.out/app

Open http://localhost:8765/. The fake Worker signs credentials with `worker/src/nut00.js`
(a fixed test key), so the browser's DLEQ check and the real AES-GCM path both run.

- Fail a step: `curl 'http://localhost:8766/_ctl?fail=issue|initiate|chunk:N|finalise|finalise409|wrong_size|none'`
- Slow chunks: `curl 'http://localhost:8766/_ctl?slow=2500'` (ms per chunk PUT)
- Receiver stops (Share-Copy-2): `?fail=meta503|meta_incomplete|dl401|auth500|auth410|auth_cut` (`down:N` + 127 s for the retry line)
- Closed links (OSA-Tools-2): `?fail=meta_removed` ("removed after a report" + uuid8) · `?fail=meta_deleted` (the plain "no longer active")
- Report tools (OSA-Tools-2): `/admin/reports/*` as the Worker; admin key `fake-admin-key` (or `FAKE_ADMIN_KEY`), helper key only if `FAKE_HELPER_KEY` is set; `/_seed?id=<uuid>` adds a live link, `/_reports` shows what each reports request carried; `?fail=takedown_partial|register_down`. `/admin/execution-dock` + `/admin/metrics` answer the admin key only; `FAKE_HELPER_KEY_FILE` (read per request) lets a rehearsal set and remove the helper key
- Turnstile: append `?ts=click` (asks for a click), `?ts=slow` (passes after 4 s), `?ts=fail` or `?ts=blocked` (never loads; the line shows 15 s after a press)

Design specimen (Design-Theory-Opus-1): `specimen/` is a standalone page, no build step —
`python3 -m http.server 8093 --directory dev/share-harness/specimen`, open http://localhost:8093/ (Safari).
