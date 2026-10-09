/**
 * folder-resume.test.js — store-only folder zips and the folder resume print (Share-Folder-Resume-1)
 *
 * Imports the browser's own frontend/zip.js and the vendored fflate the page loads,
 * so the zip under test is the real one. What resume relies on:
 *   - the same folder zips to the same bytes, in any read order;
 *   - zipSize() is the exact size;
 *   - the only time-zone-dependent bytes are the zip's own date fields, and
 *     folderPrint().local is computed from exactly those (zipDosTime);
 *   - folderPrint().list changes when a file is added, removed or edited, and not otherwise.
 *
 * The pool runs in UTC, so a real time-zone move is shown by
 * dev/share-harness/zip-tz-check.mjs (Node, TZ switched).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import * as fflateModule from '../../frontend/fflate.min.js';
import {
  zipFolder, zipSize, zipDate, zipDosTime, folderPrint, sortZipEntries,
} from '../../frontend/zip.js';

const utf8 = (s) => new TextEncoder().encode(s);
const hex = (b) => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, '0')).join('');
const sha256 = async (b) => hex(await crypto.subtle.digest('SHA-256', b));

// A File-like entry: what zipFolder reads (size, lastModified, arrayBuffer()).
const fakeFile = (text, lastModified) => {
  const bytes = utf8(text);
  return { size: bytes.length, lastModified, arrayBuffer: async () => bytes.slice().buffer };
};
const entry = (relativePath, text, lastModified) => ({ relativePath, file: fakeFile(text, lastModified) });

const FOLDER = () => [
  entry('b/clip.mov', 'moving pictures'.repeat(50), Date.UTC(2026, 9, 7, 21, 15, 31)),
  entry('a.txt', 'first', Date.UTC(2024, 1, 29, 0, 0, 0)),
  entry('b/ä-note.md', '# notes', Date.UTC(2026, 5, 1, 23, 59, 59)),
  entry('old.bin', 'from before zips had dates', 0),            // out of range → 1 Jan 1980
];

const zipBytes = async (entries) => new Uint8Array(await (await zipFolder(entries)).arrayBuffer());

// Each local file header: the date field at +10 and the 0x5455 stamp after the name.
function localHeaders(z) {
  const dv = new DataView(z.buffer, z.byteOffset, z.byteLength);
  const out = [];
  for (let o = 0; o + 4 <= z.length; o++) {
    if (dv.getUint32(o, true) !== 0x04034b50) continue;
    const nameLen = dv.getUint16(o + 26, true), extraLen = dv.getUint16(o + 28, true);
    const name = new TextDecoder().decode(z.subarray(o + 30, o + 30 + nameLen));
    const extra = new DataView(z.buffer, z.byteOffset + o + 30 + nameLen, extraLen);
    out.push({ name, dos: dv.getUint32(o + 10, true), id: extra.getUint16(0, true), stamp: extra.getUint32(5, true) });
  }
  return out;
}

// The page loads fflate.min.js as a plain script (global fflate); here it loads as CommonJS.
beforeAll(() => {
  globalThis.fflate = fflateModule.default ?? fflateModule;
  expect(typeof globalThis.fflate.Zip).toBe('function');
});

describe('zipFolder', () => {
  it('zips the same folder to the same bytes, whatever order it was read in', async () => {
    const a = await zipBytes(FOLDER());
    const b = await zipBytes(FOLDER().reverse());
    expect(await sha256(a)).toBe(await sha256(b));
  });

  it('is exactly zipSize() bytes', async () => {
    expect((await zipBytes(FOLDER())).length).toBe(zipSize(FOLDER()));
  });

  it('writes entries in path order, each with its own date: zipDosTime in the zip field, UTC seconds in 0x5455', async () => {
    const heads = localHeaders(await zipBytes(FOLDER()));
    const sorted = sortZipEntries(FOLDER());
    expect(heads.map(h => h.name)).toEqual(sorted.map(e => e.relativePath));
    heads.forEach((h, i) => {
      const t = zipDate(sorted[i].file);
      expect(h.dos).toBe(zipDosTime(t));
      expect(h.id).toBe(0x5455);
      expect(h.stamp).toBe(Math.floor(t / 1000));
    });
  });
});

describe('folderPrint', () => {
  it('is the same for the same folder in any order', async () => {
    const p = await folderPrint(FOLDER());
    expect(await folderPrint(FOLDER().reverse())).toEqual(p);
    expect(p.files).toBe(4);
    expect(p.list).toMatch(/^[0-9a-f]{64}$/);
    expect(p.local).toMatch(/^[0-9a-f]{64}$/);
  });

  it('list changes when a file is added, removed, edited (size) or re-dated', async () => {
    const base = await folderPrint(FOLDER());
    const added = [...FOLDER(), entry('c.txt', 'new', Date.UTC(2026, 9, 8))];
    const removed = FOLDER().slice(1);
    const edited = FOLDER(); edited[1] = entry('a.txt', 'first!', edited[1].file.lastModified);
    const redated = FOLDER(); redated[1] = entry('a.txt', 'first', redated[1].file.lastModified + 2000);
    const renamed = FOLDER(); renamed[1] = entry('A.txt', 'first', renamed[1].file.lastModified);
    for (const f of [added, removed, edited, redated, renamed]) {
      expect((await folderPrint(f)).list).not.toBe(base.list);
    }
  });

  it('local follows the zip date fields: a sub-2 s date change moves list and the stamp, not the zip field', async () => {
    const base = await folderPrint(FOLDER());
    const nudged = FOLDER(); nudged[1] = entry('a.txt', 'first', nudged[1].file.lastModified + 1000);
    const p = await folderPrint(nudged);
    expect(p.list).not.toBe(base.list);
    expect(p.local).not.toBe(base.local);   // the UTC stamp (whole seconds) is in the bytes too
  });

  it('is domain-separated from a plain hash of the same rows', async () => {
    const rows = sortZipEntries(FOLDER()).map(e => [e.relativePath, e.file.size, e.file.lastModified]);
    expect((await folderPrint(FOLDER())).list).not.toBe(await sha256(utf8(JSON.stringify(rows))));
  });
});
