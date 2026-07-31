/**
 * chunks.js — fixture factory for chunk bytes + BLAKE3 hashes.
 *
 * k6-compatible: zero external imports. BLAKE3 hashes are pre-computed
 * from deterministicBytes() using @noble/hashes/blake3 in Node.js.
 *
 * Supported chunk sizes and pre-computed hash counts:
 *   524288 bytes (512 KB) — 22 hashes  [default; used by load tests]
 *   512 bytes              — 5 hashes   [used by round-trip.test.js]
 *   256 bytes              — 5 hashes   [used by security.test.js]
 *   64 bytes               — 5 hashes   [used by security.test.js]
 *
 * To add a new size or extend chunk count, run from repo root:
 *   node --input-type=module -e "
 *     import { blake3 } from './worker/node_modules/@noble/hashes/blake3.js';
 *     const SZ = <size>; function b(i,s){const a=new Uint8Array(s);let x=(i+1)*1000003;
 *     for(let j=0;j<s;j++){x=(x*1664525+1013904223)>>>0;a[j]=x&0xff;}return a;}
 *     function h(x){return Array.from(x).map(b=>b.toString(16).padStart(2,'0')).join('');}
 *     for(let i=0;i<5;i++)console.log(h(blake3(b(i,SZ))));"
 *
 * Pure ESM — no vitest, no node built-ins, no CF types.
 * Shared between Vitest integration tests and k6 load scripts.
 */

// ── Pre-computed BLAKE3 hashes keyed by chunk size ───────────────────────────
// Each entry: array of hex strings for chunks 0..N at that size.

const HASH_TABLE = {
  524288: [
    '2f2a0bec89395b19c7b9f663e4d1eb271b40c899ec8fc71e53f6798e889866ea', // 0
    '7d009094a9381a666df1e5e75a3df1d98b3d962ee0bcbc700a2be44e0ea7c295', // 1
    'e0aa5142c41ccd93bb2b053b5b7672dd7a054477bca959d52ae44ce32b1416df', // 2
    '15f03a5c91a6fe02c2f64406bd9525b34ee38d3a88e8527ea2532d17489e8ec0', // 3
    'beced66f3e30945f4aff0c6a48cb6c0c87b40b87fea952320ae1c867903c89c7', // 4
    '20af3c9ad1acb3e541f1bdbba38126fbf65f7b89a17e39b726054ad4cad34f2f', // 5
    'a58e95d6332843e5ce9779febe0872cd51f60751147aff0c99de8bc9892bca1a', // 6
    'f55f34ed5cc16f99969ec54c740b43efd05f411db7ff3999f1e8c0571a4777b6', // 7
    '32354224d69397784d1b0334bb944cdcc896ed72fd934ccfddac956708a8f3d5', // 8
    'b68630d684a6f433fc4315a403fff44f9f543d7ffa8f552db04971eb0646c6eb', // 9
    'f3430fdb7a069f49432ec8f98eb38f3534b89d62194382d071c1b11a5c6bc6fe', // 10
    '5df04c3d6e95b5a1cbdc4edb8632c9b7deeeac0136fcba7d2af4b650ba13fcb2', // 11
    'dd309f637846677b808e5546af2fb1d57786808373e98b1b7ebfc0ed49a70e4c', // 12
    'ad14a5e364f3cc8c41c8080cfc62687e68c75948843053b5cd8153dd86ff9519', // 13
    '16bcf5fcc13678d8309869cff4a776600036fd9e05010882550480277d2bd7dc', // 14
    '635f61e846df6f0fe9933ff956e839759b6e0c66fcc92d2520d774d166b2d77e', // 15
    '43c1015785f12dd8a295923e936e7e8c924b618d03c45b14fc625dd9e991dda5', // 16
    '8c7ccfebc75fd7b13da9d6261b4576d5e5769597d4e83e17743d0bbdb395ba8f', // 17
    '764ec00614f21a62cc4cf5e3b9516d0967735d9feb37662bae3de809e30b6c75', // 18
    '2172d18bfa5fb8f6005d512edaec78ef5fe4869dda4b819d090c3eaeec3589fb', // 19
    '6fdc6640e5be180f243f32b2f796f3b081803123a04cb2c99d820c0c1b5f91fe', // 20
    '01cc0dee9ef384d4618ff06a8b73970369bf292b2afed000d41ccaa274ec033b', // 21
  ],
  512: [
    '43d06e6bd445f12e21632e738f9fd7307e42e7f6bf26aadcfe25d434bf6c84f9', // 0
    'ff908fa0fc326e7c6cda4ad79375c98cdcb63f3dd94b548656560a6f4d0f83d6', // 1
    '6c378c4eea4f6485a5ca08cb86562a4d196b8c548d23d90951d11ce518b9b68e', // 2
    'e2658f4d69e821cdc96396e63fa395eb7b48038d4f3d6018237ffd5482cd0dc8', // 3
    '6d8e3aa181ae4c6f4e42f73e84deb9a6905bfabed0ae8f7ad843a9af87cca138', // 4
  ],
  256: [
    '301096faf288bf94e2f162048a1c6a79ac78401c045fb68a708d1b80ce87b102', // 0
    '2fa0719ac69f7fc32b75ac3eee2ff467ea4b0d4db28e2044177c52d8c2ecf57f', // 1
    'f4aedc01df80eaea3822f58b5e4c09ab5ecef0f3d991e083cf860f97dceb816b', // 2
    '5362c93040b53beecb50c2fa1f3c2c6fb2a7aa756d41911cc4fcc1fa82fa3de4', // 3
    'd78ac598ad61bdbef51f3fecbc33ef63795f6d19a95cd2c67e653febc50e1c87', // 4
  ],
  64: [
    '347e826ff0e2e235ebea5d5c1109efae9b146a0029216141220a4d523ba9eb26', // 0
    '4e2a39c07a9d9f1d13406d6d935521e3b11d99a15868064ecd2766f7e5491417', // 1
    '134bc779ea437e22e6be6006b47fc4c7869dde3b64c02ae7395048f2fc8df2e4', // 2
    '5fb85d35a541fe6e79ca5ee5fbc9a509a3afb33d5504f0fe81d0d49c447aaeaa', // 3
    '5806fdc3ab54e82ab3b69bd0c6494280bd5820e6a4a298d5ae01510c71e4756e', // 4
  ],
};

const DEFAULT_CHUNK_SIZE = 524288; // 512 KB

/**
 * Deterministic pseudo-random bytes seeded by chunk index.
 * Same index + same size → same bytes → same hash across test runs.
 * LCG constants are fixed — do not change them.
 */
function deterministicBytes(index, size) {
  const buf = new Uint8Array(size);
  let seed = (index + 1) * 1_000_003;
  for (let i = 0; i < size; i++) {
    seed = (seed * 1_664_525 + 1_013_904_223) >>> 0;
    buf[i] = seed & 0xff;
  }
  return buf;
}

/**
 * makeChunks(n, sizeBytes) → Array of { bytes: Uint8Array, blake3Hash: string }
 *
 * sizeBytes must be one of the sizes in HASH_TABLE (524288, 512, 256, 64).
 * n must be ≤ the number of pre-computed hashes for that size.
 * Throws clearly for unsupported size/count combinations.
 */
export function makeChunks(n = 3, sizeBytes = DEFAULT_CHUNK_SIZE) {
  const hashes = HASH_TABLE[sizeBytes];
  if (!hashes) {
    throw new Error(
      `makeChunks: unsupported sizeBytes=${sizeBytes}. ` +
      `Supported sizes: ${Object.keys(HASH_TABLE).join(', ')}. ` +
      `Add new sizes by running the pre-computation script in the file header.`
    );
  }
  if (n > hashes.length) {
    throw new Error(
      `makeChunks: requested ${n} chunks at size ${sizeBytes} but only ` +
      `${hashes.length} hashes are pre-computed. ` +
      `Extend HASH_TABLE[${sizeBytes}] using the pre-computation script.`
    );
  }
  return Array.from({ length: n }, (_, i) => ({
    bytes: deterministicBytes(i, sizeBytes),
    blake3Hash: hashes[i],
  }));
}

/**
 * Returns a copy of chunks with the hash at `index` deliberately wrong.
 * Used for negative tests: Worker must reject with 400.
 */
export function wrongHashVariant(chunks, index = 0) {
  const copy = chunks.map(c => ({ ...c }));
  copy[index] = { ...copy[index], blake3Hash: 'deadbeef'.repeat(8) };
  return copy;
}
