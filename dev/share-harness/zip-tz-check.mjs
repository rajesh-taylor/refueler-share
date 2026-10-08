// Share-Folder-Resume-1: what a time-zone move does to a folder zip, with the page's own
// zipFolder + folderPrint (frontend/crypto.js) and vendored fflate. Node only:
//   node dev/share-harness/zip-tz-check.mjs
// Expect: list never moves; local and the zip bytes move together, never one without the other.
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';

globalThis.fflate = createRequire(import.meta.url)('../../frontend/fflate.min.js');
const { zipFolder, folderPrint } = await import('../../frontend/crypto.js');

const file = (text, lastModified) => {
  const b = new TextEncoder().encode(text);
  return { size: b.length, lastModified, arrayBuffer: async () => b.slice().buffer };
};
const folder = () => [
  { relativePath: 'clip.mov', file: file('frames'.repeat(100), Date.UTC(2026, 9, 7, 21, 15, 31)) },
  { relativePath: 'notes/a.txt', file: file('summer', Date.UTC(2026, 6, 1, 9, 0, 0)) },
  { relativePath: 'old.bin', file: file('no date', 0) },
];
const run = async (tz) => {
  process.env.TZ = tz;
  const zip = new Uint8Array(await (await zipFolder(folder())).arrayBuffer());
  return { tz, zip: createHash('sha256').update(zip).digest('hex').slice(0, 12), ...(await folderPrint(folder())) };
};

const base = await run('Europe/London');
let bad = 0;
for (const tz of ['Europe/London', 'Europe/Lisbon', 'Europe/Berlin', 'America/New_York', 'Asia/Kolkata', 'UTC']) {
  const r = await run(tz);
  const sameZip = r.zip === base.zip, sameLocal = r.local === base.local;
  if (sameZip !== sameLocal || r.list !== base.list) bad++;
  console.log(`${tz.padEnd(17)} zip ${r.zip} ${sameZip ? 'same' : 'DIFF'} · local ${sameLocal ? 'same' : 'DIFF'} · list ${r.list === base.list ? 'same' : 'DIFF'}`);
}
console.log(bad ? `✗ ${bad} mismatch(es)` : '✓ local moves exactly when the bytes do; list never moves');
process.exit(bad ? 1 : 0);
