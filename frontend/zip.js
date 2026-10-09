// ── frontend/zip.js — store-only folder zips + resume print ──────────────────
// Moved out of crypto.js at Share-JS-Split-2 (9 Oct 2026). No behaviour change.
// ─────────────────────────────────────────────────────────────────────────────

import { sha256Hex } from './crypto.js';

// ─────────────────────────────────────────────────────────────────────────────
// Folder zips (Share-Upload-5; moved here Share-Folder-Resume-1 so tests run the
// real thing). Store-only: no compression, entries in path order, each file's own
// modified date — the same folder always zips to the same bytes, which is what
// lets an interrupted folder upload carry on (S-031). Dates go in twice: the zip's
// own field (local time, 2 s steps) and the extended UTC timestamp (0x5455) most
// unzip tools restore exactly. Unknown or out-of-range dates (zip fields run
// 1980–2038) use 1 Jan 1980. Needs the global fflate (fflate.min.js).
// ─────────────────────────────────────────────────────────────────────────────
const ZIP_DATE_MIN = new Date(1980, 0, 1, 12).getTime();
const ZIP_DATE_MAX = 2 ** 31 * 1000 - 1;

// The date a file gets in the zip.
export function zipDate(file) {
  const t = file.lastModified;
  return t >= ZIP_DATE_MIN && t <= ZIP_DATE_MAX ? t : ZIP_DATE_MIN;
}

// The zip's own date field for t, exactly as fflate writes it: local time, so it
// depends on the device's time zone (the only part of the bytes that does).
export function zipDosTime(t) {
  const d = new Date(t);
  return ((d.getFullYear() - 1980) << 25 | (d.getMonth() + 1) << 21 | d.getDate() << 16
    | d.getHours() << 11 | d.getMinutes() << 5 | d.getSeconds() >> 1) >>> 0;
}

function _zipUtcStamp(t) {
  const b = new Uint8Array(5);
  b[0] = 1;   // flags: modified time only
  new DataView(b.buffer).setUint32(1, Math.floor(t / 1000), true);
  return b;
}

// Entries ({ relativePath, file }) in zip order: path order by code unit.
export function sortZipEntries(entries) {
  return [...entries].sort((a, b) => (a.relativePath < b.relativePath ? -1 : a.relativePath > b.relativePath ? 1 : 0));
}

// Exact size of the zip: per file a 30 B local header, 16 B data descriptor,
// 46 B central entry, a 9 B timestamp in each header and the name twice; 22 B end record.
export function zipSize(entries) {
  const enc = new TextEncoder();
  return entries.reduce((acc, e) => acc + (e.file.size || 0) + 110 + 2 * enc.encode(e.relativePath).length, 22);
}

// What identifies a folder for resume (Share-Folder-Resume-1), kept only in this
// browser's resume record, never sent. list: every path, size and modified date
// (changes when a file is added, removed or edited). local: the dates as the zip
// writes them (changes when only the device's time zone moved). Both hex SHA-256.
export async function folderPrint(entries) {
  const sorted = sortZipEntries(entries);
  const tagged = (tag, rows) => new TextEncoder().encode(`refueler.share.${tag}.v1\u0000${JSON.stringify(rows)}`);
  return {
    files: sorted.length,
    list:  await sha256Hex(tagged('folder-list', sorted.map(e => [e.relativePath, e.file.size, e.file.lastModified]))),
    local: await sha256Hex(tagged('folder-local', sorted.map(e => { const t = zipDate(e.file); return [zipDosTime(t), t]; }))),
  };
}

// Zip the entries (one file read at a time) → Blob. onFile(bytesDoneSoFar) after each file.
export function zipFolder(entries, onFile) {
  const sorted = sortZipEntries(entries);
  const zipChunks = [];
  let zipError = null;
  return new Promise((resolve, reject) => {
    const zipper = new fflate.Zip((err, chunk, final) => {
      if (err) { zipError = err; reject(err); return; }
      zipChunks.push(chunk);
      if (final) resolve(new Blob(zipChunks, { type: 'application/zip' }));
    });
    (async () => {
      let done = 0;
      try {
        for (const { relativePath, file } of sorted) {
          if (zipError) break;
          const data = new Uint8Array(await file.arrayBuffer());
          const entry = new fflate.ZipPassThrough(relativePath);
          const when  = zipDate(file);
          entry.mtime = when;
          entry.extra = { 0x5455: _zipUtcStamp(when) };
          zipper.add(entry);
          entry.push(data, true);
          done += file.size;
          if (onFile) onFile(done);
          await new Promise(r => setTimeout(r, 0));
        }
        if (!zipError) zipper.end();
      } catch (e) { reject(e); }
    })();
  });
}
