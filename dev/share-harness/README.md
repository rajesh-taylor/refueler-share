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
- Turnstile: append `?ts=click` (asks for a click) or `?ts=slow` (passes after 4 s)

Design specimen (Design-Theory-Opus-1): `specimen/` is a standalone page, no build step —
`python3 -m http.server 8093 --directory dev/share-harness/specimen`, open http://localhost:8093/ (Safari).
