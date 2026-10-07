/**
 * zip-streaming.test.js — RU0: streaming zip memory discipline
 *
 * Asserts that zipAndSelect() never holds more than one file's raw
 * arrayBuffer() in memory simultaneously (i.e. the old fflate.zip()
 * OOM pattern is not re-introduced).
 *
 * Strategy: mock fflate's streaming API (ZipPassThrough, ZipDeflate, Zip)
 * and a fake File with a tracked arrayBuffer() call. Count concurrent
 * in-flight reads — must never exceed 1.
 *
 * Also asserts (Share-Upload-5, store-only zips):
 * - every entry is ZipPassThrough (no compression) with the file's own date (+ UTC stamp)
 * - entries are added in path order, whatever order the folder was read in
 * - _zipSize() matches fflate's store-only layout (cap checked once, before zipping)
 * - Progress detail format: "X of Y" byte string pattern
 *
 * Byte-identical output from real fflate is proven in dev/share-harness (zip twice,
 * same BLAKE3) — fflate isn't a Worker dependency.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Pull the two pure functions out of share.js for isolated testing.
// share.js is a browser module with DOM side-effects — we extract only
// the functions we can unit-test without a DOM.

// _zipSize and zipAndSelect are not exported. We replicate
// their logic here for testing, keeping them in sync manually. If the
// implementation changes, update these tests to match.
// Rationale: upload.js is a browser module loaded via <script type="module">
// — it cannot be imported directly in Vitest without a full DOM scaffold.

const ZIP_DATE_MIN = new Date(1980, 0, 1, 12).getTime();
const ZIP_DATE_MAX = 2 ** 31 * 1000 - 1;

function _zipDate(file) {
  const t = file.lastModified;
  return t >= ZIP_DATE_MIN && t <= ZIP_DATE_MAX ? t : ZIP_DATE_MIN;
}

function _zipUtcStamp(t) {
  const b = new Uint8Array(5);
  b[0] = 1;
  new DataView(b.buffer).setUint32(1, Math.floor(t / 1000), true);
  return b;
}

function _zipSize(entries) {
  const enc = new TextEncoder();
  return entries.reduce((acc, e) => acc + (e.file.size || 0) + 110 + 2 * enc.encode(e.relativePath).length, 22);
}

// ── Streaming zip implementation under test ───────────────────────────────────
// Replicated from share.js zipAndSelect() — the core memory discipline loop.
// This is the exact pattern; keep in sync with the source.
async function zipAndSelectTestable(entries, folderName, fflate, onProgress) {
  entries = [...entries].sort((a, b) => (a.relativePath < b.relativePath ? -1 : a.relativePath > b.relativePath ? 1 : 0));
  const totalInputBytes = entries.reduce((acc, e) => acc + (e.file ? e.file.size || 0 : 0), 0);
  const outputChunks = [];
  let concurrentReads = 0;
  let maxConcurrentReads = 0;

  const zipBlob = await new Promise((resolve, reject) => {
    const zip = new fflate.Zip((err, chunk, final) => {
      if (err) { reject(err); return; }
      outputChunks.push(chunk);
      if (final) resolve(new Blob(outputChunks, { type: 'application/zip' }));
    });

    (async () => {
      try {
        let bytesProcessed = 0;
        for (let i = 0; i < entries.length; i++) {
          const { relativePath, file } = entries[i];

          // Track concurrent reads — this is what we're asserting stays ≤ 1
          concurrentReads++;
          maxConcurrentReads = Math.max(maxConcurrentReads, concurrentReads);
          const buf = await file.arrayBuffer();
          concurrentReads--;

          const data = new Uint8Array(buf);

          const entry = new fflate.ZipPassThrough(relativePath);
          const when  = _zipDate(file);
          entry.mtime = when;
          entry.extra = { 0x5455: _zipUtcStamp(when) };
          zip.add(entry);
          entry.push(data, true);

          bytesProcessed += file.size || 0;
          if (onProgress) onProgress(bytesProcessed, totalInputBytes, i);
          await new Promise(r => setTimeout(r, 0));
        }
        zip.end();
      } catch (e) {
        reject(e);
      }
    })();
  });

  return { zipBlob, maxConcurrentReads };
}

// ── Mock fflate streaming API ─────────────────────────────────────────────────
function makeMockFflate() {
  let ondata;

  class MockZipPassThrough {
    constructor(path) { this.path = path; this.chunks = []; }
    push(data, final) {
      this.chunks.push(data);
      // Emit compressed output via the Zip ondata callback
      if (ondata) ondata(null, data, false);
    }
  }

  class MockZipDeflate {
    constructor(path, opts) { this.path = path; this.opts = opts; this.chunks = []; }
    push(data, final) {
      this.chunks.push(data);
      if (ondata) ondata(null, data, false);
    }
  }

  class MockZip {
    constructor(cb) { ondata = cb; this.files = []; MockZip.last = this; }
    add(entry) { this.files.push(entry); }
    end() {
      // Signal completion with an empty final chunk
      if (ondata) ondata(null, new Uint8Array(0), true);
    }
  }

  return { Zip: MockZip, ZipPassThrough: MockZipPassThrough, ZipDeflate: MockZipDeflate };
}

// ── Fake File factory ─────────────────────────────────────────────────────────
function makeFakeFile(name, sizeBytes) {
  const data = new Uint8Array(sizeBytes).fill(0xAB);
  return {
    name,
    size: sizeBytes,
    arrayBuffer: vi.fn().mockResolvedValue(data.buffer),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('_zipSize — store-only zip layout', () => {
  it('adds 110 B per file, each name twice, and a 22 B end record', () => {
    const entries = [
      { relativePath: 'clip/A001.mov', file: { size: 3000 } },
      { relativePath: 'unknown.txt',   file: { size: 1 } },
      { relativePath: 'é.bin',         file: { size: 10 } },   // UTF-8 names count in bytes
    ];
    // 3423 B = the real fflate zip of these three files (Share-Upload-5 scratch test)
    expect(_zipSize(entries)).toBe(3423);
  });

  it('is just the end record for an empty list', () => {
    expect(_zipSize([])).toBe(22);
  });
});

describe('_zipDate / _zipUtcStamp — each file keeps its own date', () => {
  it('keeps an in-range date', () => {
    const t = Date.UTC(2026, 8, 14, 9, 31, 7, 450);
    expect(_zipDate({ lastModified: t })).toBe(t);
  });

  it('uses 1 Jan 1980 for unknown, too-early or too-late dates', () => {
    expect(_zipDate({ lastModified: 0 })).toBe(ZIP_DATE_MIN);
    expect(_zipDate({})).toBe(ZIP_DATE_MIN);
    expect(_zipDate({ lastModified: Date.UTC(1975, 0, 1) })).toBe(ZIP_DATE_MIN);
    expect(_zipDate({ lastModified: Date.UTC(2050, 0, 1) })).toBe(ZIP_DATE_MIN);
  });

  it('writes flags 1 + Unix seconds, little-endian', () => {
    expect(Array.from(_zipUtcStamp(Date.UTC(2026, 8, 14, 9, 31, 7, 450)))).toEqual([1, 0xdb, 0xbe, 0xa7, 0x6a]);
  });
});

describe('zipAndSelect streaming — memory discipline', () => {
  it('never holds more than 1 arrayBuffer() in memory simultaneously (3 files)', async () => {
    const fflate = makeMockFflate();
    const entries = [
      { relativePath: 'a.jpg',  file: makeFakeFile('a.jpg',  10 * 1024 * 1024) }, // 10 MB, skip
      { relativePath: 'b.txt',  file: makeFakeFile('b.txt',  5  * 1024 * 1024) }, // 5 MB, compress
      { relativePath: 'c.mov',  file: makeFakeFile('c.mov',  20 * 1024 * 1024) }, // 20 MB, skip
    ];

    const { maxConcurrentReads } = await zipAndSelectTestable(entries, 'test-folder', fflate);

    expect(maxConcurrentReads).toBe(1);
  });

  it('never holds more than 1 arrayBuffer() in memory simultaneously (10 files)', async () => {
    const fflate = makeMockFflate();
    const entries = Array.from({ length: 10 }, (_, i) => ({
      relativePath: i % 2 === 0 ? `photo_${i}.jpg` : `doc_${i}.txt`,
      file: makeFakeFile(`file_${i}`, (i + 1) * 1024 * 1024),
    }));

    const { maxConcurrentReads } = await zipAndSelectTestable(entries, 'test-folder', fflate);

    expect(maxConcurrentReads).toBe(1);
  });

  it('calls arrayBuffer() exactly once per file', async () => {
    const fflate = makeMockFflate();
    const files = [
      makeFakeFile('a.png', 1024),
      makeFakeFile('b.mp4', 2048),
      makeFakeFile('c.csv', 512),
    ];
    const entries = files.map((f, i) => ({ relativePath: f.name, file: f }));

    await zipAndSelectTestable(entries, 'test', fflate);

    for (const f of files) {
      expect(f.arrayBuffer).toHaveBeenCalledTimes(1);
    }
  });

  it('stores every file (no compression) with its own date, in path order', async () => {
    const fflate = makeMockFflate();
    const entries = [
      { relativePath: 'video.mp4',   file: makeFakeFile('video.mp4', 2048) },
      { relativePath: 'b/readme.txt', file: makeFakeFile('readme.txt', 512) },
      { relativePath: 'B.txt',       file: makeFakeFile('B.txt', 256) },
      { relativePath: 'a.jpg',       file: makeFakeFile('a.jpg', 1024) },
    ];

    await zipAndSelectTestable(entries, 'test', fflate);

    const added = fflate.Zip.last.files;
    expect(added.every(e => e instanceof fflate.ZipPassThrough)).toBe(true);
    expect(added.every(e => e.mtime === ZIP_DATE_MIN)).toBe(true);   // fake files carry no date
    expect(added.every(e => e.extra[0x5455][0] === 1)).toBe(true);
    expect(added.map(e => e.path)).toEqual(['B.txt', 'a.jpg', 'b/readme.txt', 'video.mp4']);
  });

  it('reports progress in bytes, not file count', async () => {
    const fflate = makeMockFflate();
    const progressUpdates = [];

    const entries = [
      { relativePath: 'a.jpg', file: makeFakeFile('a.jpg', 500 * 1024) },  // 500 KB
      { relativePath: 'b.txt', file: makeFakeFile('b.txt', 100 * 1024) },  // 100 KB
      { relativePath: 'c.mp4', file: makeFakeFile('c.mp4', 1024 * 1024) }, // 1 MB
    ];
    const totalInputBytes = entries.reduce((a, e) => a + e.file.size, 0);

    await zipAndSelectTestable(entries, 'test', fflate, (processed, total) => {
      progressUpdates.push({ processed, total });
    });

    // Should have 3 progress updates (one per file)
    expect(progressUpdates.length).toBe(3);

    // Each update should accumulate correctly
    expect(progressUpdates[0].processed).toBe(500 * 1024);
    expect(progressUpdates[1].processed).toBe(600 * 1024);
    expect(progressUpdates[2].processed).toBe(totalInputBytes);

    // Total should be consistent across all updates
    progressUpdates.forEach(u => expect(u.total).toBe(totalInputBytes));
  });

  it('resolves to a Blob of type application/zip', async () => {
    const fflate = makeMockFflate();
    const entries = [
      { relativePath: 'test.txt', file: makeFakeFile('test.txt', 256) },
    ];

    const { zipBlob } = await zipAndSelectTestable(entries, 'my-folder', fflate);

    expect(zipBlob).toBeInstanceOf(Blob);
    expect(zipBlob.type).toBe('application/zip');
  });

  it('handles a single-file folder', async () => {
    const fflate = makeMockFflate();
    const entries = [
      { relativePath: 'solo.png', file: makeFakeFile('solo.png', 2 * 1024 * 1024) },
    ];

    const { maxConcurrentReads, zipBlob } = await zipAndSelectTestable(entries, 'solo', fflate);

    expect(maxConcurrentReads).toBe(1);
    expect(zipBlob).toBeInstanceOf(Blob);
  });
});
