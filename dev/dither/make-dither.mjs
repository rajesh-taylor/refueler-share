// dev/dither/make-dither.mjs — builds frontend/app/dither.png (X5-1b · 14 Oct 2026).
// Design theory §12.1: Carbon's Dial 1 % is a radial lift toward the centre; a fine
// noise tile on top breaks up the banding 8-bit screens show on such a shallow
// gradient. A static PNG (img-src 'self'), not a canvas data URL. Paper stays flat.
//
// Ink #F5F0E8 at alpha 0…ALPHA_MAX/255 per pixel, uniform noise from a fixed seed,
// so the file is the same every time it is rebuilt.
//   node dev/dither/make-dither.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const SIZE = 64;
const ALPHA_MAX = 6;            // ≈ 0–2.4 % ink: enough to dither a 1 % lift, invisible as texture
const INK = [0xF5, 0xF0, 0xE8];

let seed = 0x5EED1A17;          // xorshift32, fixed seed
const rand = () => { seed ^= seed << 13; seed >>>= 0; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0; return seed / 2 ** 32; };

const raw = Buffer.alloc(SIZE * (1 + SIZE * 4));
for (let y = 0; y < SIZE; y++) {
  const row = y * (1 + SIZE * 4);
  raw[row] = 0;                 // filter: none
  for (let x = 0; x < SIZE; x++) {
    const p = row + 1 + x * 4;
    raw[p] = INK[0]; raw[p + 1] = INK[1]; raw[p + 2] = INK[2];
    raw[p + 3] = Math.floor(rand() * (ALPHA_MAX + 1));
  }
}

const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf) => { let c = 0xFFFFFFFF; for (const b of buf) c = CRC[(c ^ b) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0); ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;   // 8-bit RGBA

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);
const out = new URL('../../frontend/app/dither.png', import.meta.url);
writeFileSync(out, png);
console.log(`wrote ${out.pathname} (${png.length} bytes)`);
