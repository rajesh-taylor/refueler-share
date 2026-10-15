# VENDORED.md — code copied into this repo

> Vuln-Watch-1 · 15 Oct 2026. Checked on every push by `bin/check-vendored.mjs` (CI step "Vendored code — hashes + OSV").

`npm audit` and Dependabot only see packages installed from a lockfile. The files below are **bytes we copied in**, so nothing else watches them. Each row records where the bytes came from and their SHA-256. CI fails when:

- the bytes change and this table doesn't (rebuild from the source, then update the row), or
- OSV (`api.osv.dev`) lists a **high or critical** advisory (or one with no rating) for the package and version, or for anything in the row's lockfile.

**Updating a row:** rebuild or re-copy from the named source, then run `node bin/check-vendored.mjs --update <path>`. `bin/vendor-cashu.sh` does this itself for `frontend/cashu-crypto.js`. After a version change, also edit the Version column by hand.

**Directory rows** use a tree hash. To reproduce it, run this from inside the directory:
`git ls-files | LC_ALL=C sort | xargs shasum -a 256 | shasum -a 256`

<!-- vendored:begin -->
| Path | Kind | Package | Ecosystem | Version | SHA-256 | Lockfile | How it got here |
|---|---|---|---|---|---|---|---|
| `frontend/cashu-crypto.js` | file | @cashu/cashu-ts | npm | 4.11.0 | `7dd8efbcb26c276e8a7843c4115863d30f1ee14b3b71d20712e87af69a1e0c83` | `bin/vendor-cashu/package-lock.json` | `bin/vendor-cashu.sh` — esbuild bundle, two byte-identical builds, integrity checked against the registry |
| `frontend/noble-blake3.js` | file | @noble/hashes | npm | 1.7.2 | `a34b2ca5713d1a536f48adf56560ccdb4b3ee781d6015535024fbc26088a89b3` | — | esbuild bundle of `blake3` (Share-Deps-1, 28 Sep 2026); source + integrity in the file header. JS fallback when WASM can't run |
| `frontend/blake3` | dir | blake3-wasm | npm | 2.1.5 | `d329ba7f38bfd4502a097693d4b0fa633d979d354681600ee35fd09a74aa98ab` | — | Web build from the npm tarball, `//# sourceMappingURL` lines removed (Share-Upload-5). Otherwise byte-identical (re-checked 15 Oct 2026) |
| `src/blake3` | dir | blake3-wasm | npm | 2.1.5 | `d329ba7f38bfd4502a097693d4b0fa633d979d354681600ee35fd09a74aa98ab` | — | Same bytes as `frontend/blake3` (Eleventy copy) |
| `frontend/fflate.min.js` | file | fflate | npm | 0.8.2 | `c3b34f2e9f5e74d4d7d64e01cac7a0c01954c6c406414d42185c7b53d6875ddf` | — | `umd/index.js` from the npm tarball, byte-identical (S56) |
| `frontend/qr-creator.min.js` | file | qr-creator | npm | 1.0.0 | `bfc60e4ea386e8deabe768077ec4e4fe1bc65a97ba3b8a50a5b2f9f76781b42f` | — | `dist/qr-creator.min.js` from the npm tarball, `sourceMappingURL` line removed (Share-Upload-5) |
| `worker/blake3-wasm-incr` | dir | blake3-wasm | npm | 2.1.5 | `068da0a33eb0af1a2f89d9f7a3dd8617df3c34e86891c72f1a3e24a53cae34e6` | — | Web build from the npm tarball, byte-identical. Worker streaming hash (Safari-Slow-Link-1) |
| `worker/blake3-wasm` | dir | blake3 | crates.io | 1.8.5 | `15bc7d6126adf6e7c1f2479c345c699baa3ba729369140b096d5ad1323a23711` | `worker/blake3-wasm-src/Cargo.lock` | **Our own** wasm-pack build of the Rust `blake3` crate from `worker/blake3-wasm-src/` (S34). No upstream file to compare against; OSV checks every crate in its Cargo.lock |
<!-- vendored:end -->

## Notes

- **Two browser BLAKE3s.** `frontend/blake3` (WASM) is the normal path. `frontend/noble-blake3.js` is the fallback for browsers with the JIT off (Vanadium, F-20).
- **`frontend/locke.js`** imports `@noble/curves` / `@noble/hashes` by bare name and isn't wired to any page yet (B8-5). When B8 vendors those, they get a row here.
- **Tidy item:** `worker/blake3-wasm-src/target/` (the Rust build cache, about 200 files) is committed. It should be gitignored and removed at Tidy.
- **Not code, not listed:** fonts in `frontend/app/fonts/` (Satoshi is gitignored and hash-checked by `ship-app.sh`).
