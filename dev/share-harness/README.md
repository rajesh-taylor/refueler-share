# Share page preview harness (Share-Upload-2)

Local only. Renders the canonical Share page into a copy of refueler.io (your working tree,
both repos), pointed at a fake Worker and a stub Turnstile, so every upload and receiver
state can be previewed before `bin/ship-frontend.sh`. Nothing here is mirrored or deployed.

    dev/share-harness/build.sh                 # rebuild after each edit → .out/io/_site
    node dev/share-harness/fake-worker.mjs     # :8766, in-memory
    python3 -m http.server 8765 --directory dev/share-harness/.out/io/_site

Open http://localhost:8765/share/. The fake Worker signs credentials with `worker/src/nut00.js`
(a fixed test key), so the browser's DLEQ check and the real AES-GCM path both run.

- Fail a step: `curl 'http://localhost:8766/_ctl?fail=issue|initiate|chunk:N|finalise|finalise409|wrong_size|none'`
- Slow chunks: `curl 'http://localhost:8766/_ctl?slow=2500'` (ms per chunk PUT)
- Turnstile: append `?ts=click` (asks for a click) or `?ts=slow` (passes after 4 s)
