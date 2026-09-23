// worker/src/blake3_wasm.js
// Share-6-5d — synchronous, module-scope WASM BLAKE3 for the download verify path.
//
// PURPOSE
//   Replace the pure-JS @noble/hashes BLAKE3 on the ONE CPU-hot operation of the
//   verified download path: hashing a whole 32 MiB ciphertext chunk per request
//   (download_verify.js verifyChunkBody, reached by BOTH the <=128 buffer path and
//   the >128 streaming path). merkle.js is deliberately left on noble (it hashes
//   only 33/65-byte nodes — near-zero CPU; it is also the byte-for-byte parity
//   keystone with frontend/merkle.js and is not worth disturbing). Share-6-5d
//   decision: MINIMAL swap. See areas/refueler-share.md, merkle-spec-v1.md sec.3.
//
// WHY SYNCHRONOUS
//   Under Wrangler's [[rules]] type = "CompiledWasm" (wrangler.toml), the static
//   import below yields a *compiled* WebAssembly.Module. new WebAssembly.Instance(
//   module, imports) is therefore synchronous — no async compile step — so this
//   module instantiates ONCE at module scope (once per isolate, never per request)
//   and exposes a SYNCHRONOUS hashOneShot(). That is what lets verifyChunkBody keep
//   its exact synchronous signature: no call site in download.js changes, and the
//   409/416/truncation semantics of Share-6-5a are preserved untouched.
//
// WASM API (confirmed by inspecting the vendored binary, Share-6-5d STEP 1)
//   Exports: memory, hash, __wbindgen_malloc, __wbindgen_free, __wbindgen_start.
//   Imports: ./blake3_wasm_bg.js :: __wbindgen_init_externref_table (only).
//   hash(&[u8]) -> Vec<u8> — ONE-SHOT, returns a 32-byte owned copy (the bg.js
//   glue slices out of wasm memory and frees, so the result is safe to keep and
//   does not alias the heap). There is NO incremental Hasher in this bundle.
//   Standard BLAKE3 verified against the official empty/"abc" vectors AND proven
//   byte-for-byte identical to pinned @noble/hashes v1 on a real 32 MiB input.
//
// START WIRING
//   The binary has NO start section, so __wbindgen_start() is not auto-run. We do
//   NOT call it: hash() touches no externrefs and is byte-correct without it (the
//   frontend runs this exact bundle set_wasm-only in production). Calling an init
//   function whose glue we can't re-verify here, at module-load time, would be a
//   needless risk to isolate startup for zero correctness gain. The import is still
//   wired below (imports must be satisfiable) using the glue's own initialiser.
//
// INVARIANTS HONOURED
//   - No new npm dependency: vendored WASM only (respects noble / CDK 0.17.2 pin).
//   - Instantiated once per isolate.
//   - Ciphertext-chunk hashing only. This module never sees, computes, or emits
//     the plaintext blake3_root (two-roots wall).
//   - Output is byte-for-byte BLAKE3 — identical to the noble path it replaces.

import wasmModule from '../blake3-wasm/blake3_wasm_bg.wasm';
import {
  __wbg_set_wasm,
  hash,
  __wbindgen_init_externref_table,
} from '../blake3-wasm/blake3_wasm_bg.js';

// Instantiate synchronously, once, at module scope. The single import the binary
// declares is the externref-table initialiser exported by the bg.js glue.
const instance = new WebAssembly.Instance(wasmModule, {
  './blake3_wasm_bg.js': { __wbindgen_init_externref_table },
});

// Hand the live exports to the bg.js glue so its hash() wrapper can marshal in/out.
__wbg_set_wasm(instance.exports);

/**
 * BLAKE3-256 over the given bytes, returned as a fresh 32-byte Uint8Array.
 * Synchronous. Drop-in replacement for noble's blake3(bytes) on the verify path.
 *
 * @param {Uint8Array} bytes  input (e.g. exactly the stored bytes of one chunk)
 * @returns {Uint8Array} 32-byte digest (owned copy — safe to retain/compare)
 */
export function hashOneShot(bytes) {
  return hash(bytes);
}
