# Share preview harness (Share-Upload-2; rebuilt on the app at X5-2)

Local only. Builds the real app (`bin/ship-app.sh --check` → `dist/`), copies it and points it
at a fake Worker and a stub Turnstile, so every upload and receiver state can be previewed
before `bin/ship-app.sh`. Nothing here is deployed. (No CSP here: `_headers` is not served.)

    dev/share-harness/build.sh                 # rebuild after each edit → .out/app
    node dev/share-harness/fake-worker.mjs     # :8766, in-memory
    python3 -m http.server 8765 --directory dev/share-harness/.out/app

Or under the real CSP, as the tests do: `node dev/share-harness/serve-app.mjs` in place of the python line, plus `node dev/share-harness/serve-gate.mjs` for the gate. Tests (Test-Hardening-1, TESTING.md §2a): `npm run test:browser` from the repo root; `/kat/` runs the vectors in whatever browser opens it. The fake's `/unlock` now wants the right password, and its `/download` the token, on password transfers.

Open http://localhost:8765/. The fake Worker signs credentials with `worker/src/nut00.js`
(a fixed test key), so the browser's DLEQ check and the real AES-GCM path both run.

- Fail a step: `curl 'http://localhost:8766/_ctl?fail=issue|initiate|chunk:N|finalise|finalise409|wrong_size|none'`
- Slow chunks: `curl 'http://localhost:8766/_ctl?slow=2500'` (ms per chunk PUT)
- Receiver stops (Share-Copy-2): `?fail=meta503|meta_incomplete|dl401|auth500|auth410|auth_cut` (`down:N` + 127 s for the retry line)
- Closed links (OSA-Tools-2): `?fail=meta_removed` ("no longer available … after a report" + uuid8) · `?fail=meta_deleted` (the plain "no longer active")
- Report tools (OSA-Tools-2): `/admin/reports/*` as the Worker; admin key `fake-admin-key` (or `FAKE_ADMIN_KEY`), helper key only if `FAKE_HELPER_KEY` is set; `/_seed?id=<uuid>` adds a live link, `/_reports` shows what each reports request carried; `?fail=takedown_partial|register_down`. `/admin/execution-dock` + `/admin/metrics` answer the admin key only; `FAKE_HELPER_KEY_FILE` (read per request) lets a rehearsal set and remove the helper key
- Navy Office (OSA-Tools-3; Admin-Access-1b): `node dev/share-harness/navy-office-serve.mjs` serves `navy-office/` on http://localhost:8767/ **with the admin host's real headers** (`worker/src/admin_headers.js`, the same function the Worker uses) and passes every admin path to the fake Worker, so page and API share one origin as live (`connect-src 'self'`). No Access locally. The fake answers `GET/POST /admin/status` and `/api/v1/admin/sandbox/activate|reset`. Admin key `fake-admin-key`; for the helper view start the fake Worker with `FAKE_HELPER_KEY_FILE=<file>` and write a key (≥ 32 chars) into that file — delete the file to revoke
- Turnstile: append `?ts=click` (asks for a click), `?ts=slow` (passes after 4 s), `?ts=fail` (fails once) or `?ts=blocked` (Cloudflare's script never defines itself; the blocked line shows at once after a press), `?ts=real` (Cloudflare's real script with its always-pass test key; network)
- Trusted Types (H8): the app CSP enforces them; `TT_REPORT_ONLY=1 node dev/share-harness/serve-app.mjs` (or before `npx playwright test`) makes them report-only, `GATE_TT_REPORT_ONLY=1` reports them in the gate (Chromium only: WebKit needs a `report-to`)
- The gate (Turnstile-Gate-1): `build.sh` also builds `src/gate/` → `.out/gate`; `node dev/share-harness/serve-gate.mjs` serves it on http://localhost:8768/ under the gate's real CSP. The app frames it and the stub runs inside it; `?ts=` on the app URL is passed to the gate's address (harness build only). Without the gate server running, a press shows the blocked line after 15 s (as live when gate.share.refueler.io is blocked)

Design specimen (Design-Theory-Opus-1): `specimen/` is a standalone page, no build step —
`python3 -m http.server 8093 --directory dev/share-harness/specimen`, open http://localhost:8093/ (Safari).
