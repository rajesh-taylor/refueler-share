# Known-answer vectors

`v1.json` is one set of answers for the crypto Share runs, checked in workerd
(`worker/test/kat-vectors.test.js`), in Chromium, Firefox and Playwright's WebKit
(`dev/share-harness/tests/kat.spec.mjs`), and weekly in real Safari
(`dev/share-harness/real-safari.mjs`). `run.mjs` holds the checks, shared by all of them.

**Independent of the code under test.** `gen.py` imports nothing of Share's. Its values come from
Python `cryptography` (AES-GCM, HKDF), the BLAKE3 team's Rust code checked against their
published vectors, `hashlib` checked against FIPS 180, and the published Cashu vectors. Its few
lines of curve arithmetic are for this generator only and must reproduce those published
vectors before anything is written.

A vector that disagrees with the app means the app is wrong until shown otherwise: fix the code,
never the vector. A new scheme gets a new file (`v2.json`), not an edit here. The `v1` link and
legacy fragment cases go when old links are removed (on or after 12 Jan 2027).

    python3 -m venv /tmp/kv && /tmp/kv/bin/pip install cryptography blake3
    /tmp/kv/bin/python -I test-vectors/gen.py
