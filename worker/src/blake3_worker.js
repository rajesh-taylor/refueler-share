// blake3_worker.js — Workers-compatible WASM initialiser
// Wraps the wasm-pack bundler output without requiring a bundler.
// Import the .wasm binary directly; Wrangler static-import bundles it.

import wasmBinary from '../blake3-wasm/blake3_wasm_bg.wasm';
import { __wbg_set_wasm, hash as _hash, __wbindgen_init_externref_table } from '../blake3-wasm/blake3_wasm_bg.js';

let initialised = false;

async function init() {
  if (initialised) return;
  const instance = await WebAssembly.instantiate(wasmBinary, {
    './blake3_wasm_bg.js': {
      __wbindgen_init_externref_table,
    },
  });
  __wbg_set_wasm(instance.exports);
  initialised = true;
}

// Returns a 32-byte Uint8Array BLAKE3 hash of data (Uint8Array).
export async function blake3Hash(data) {
  await init();
  return _hash(data);
}
