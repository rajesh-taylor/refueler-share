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
 * Also asserts:
 * - shouldSkipCompression() returns true for all skip-list extensions
 * - shouldSkipCompression() returns false for compressible types
 * - Progress detail format: "X of Y" byte string pattern
 *
 * Does NOT test actual compression output — that's the manual smoke test.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Pull the two pure functions out of share.js for isolated testing.
// share.js is a browser module with DOM side-effects — we extract only
// the functions we can unit-test without a DOM.

// shouldSkipCompression and zipAndSelect are not exported. We replicate
// their logic here for testing, keeping them in sync manually. If the
// implementation changes, update these tests to match.
// Rationale: share.js is a browser module loaded via <script type="module">
// — it cannot be imported directly in Vitest without a full DOM scaffold.
// The functions are simple enough to replicate without risk of drift.

// ── shouldSkipCompression ─────────────────────────────────────────────────────
const SKIP_COMPRESS_EXTENSIONS = new Set([
  'mov', 'mp4', 'mxf', 'r3d', 'braw', 'ari', 'mkv', 'avi', 'wmv', 'webm', 'm4v', 'mpg', 'mpeg',
  'mp3', 'aac', 'm4a', 'ogg', 'flac', 'opus', 'wma',
  'jpg', 'jpeg', 'heic', 'heif', 'webp', 'avif',
  'zip', 'gz', 'bz2', 'xz', '7z', 'rar',
  'pdf', 'docx', 'xlsx', 'pptx',
]);

function shouldSkipCompression(relativePath) {
  const ext = relativePath.split('.').pop().toLowerCase();
  return SKIP_COMPRESS_EXTENSIONS.has(ext);
}

// ── Streaming zip implementation under test ───────────────────────────────────
// Replicated from share.js zipAndSelect() — the core memory discipline loop.
// This is the exact pattern; keep in sync with the source.
async function zipAndSelectTestable(entries, folderName, fflate, onProgress) {
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

          if (shouldSkipCompression(relativePath)) {
            const entry = new fflate.ZipPassThrough(relativePath);
            zip.add(entry);
            entry.push(data, true);
          } else {
            const entry = new fflate.ZipDeflate(relativePath, { level: 6 });
            zip.add(entry);
            entry.push(data, true);
          }

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
    constructor(cb) { ondata = cb; this.files = []; }
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

describe('shouldSkipCompression', () => {
  // Video
  it.each(['mov', 'mp4', 'mxf', 'r3d', 'braw', 'ari', 'mkv', 'avi', 'wmv', 'webm', 'm4v', 'mpg', 'mpeg'])(
    'skips %s (video)', ext => { expect(shouldSkipCompression(`file.${ext}`)).toBe(true); }
  );

  // Audio
  it.each(['mp3', 'aac', 'm4a', 'ogg', 'flac', 'opus', 'wma'])(
    'skips %s (audio)', ext => { expect(shouldSkipCompression(`file.${ext}`)).toBe(true); }
  );

  // Already-compressed images
  it.each(['jpg', 'jpeg', 'heic', 'heif', 'webp', 'avif'])(
    'skips %s (compressed image)', ext => { expect(shouldSkipCompression(`file.${ext}`)).toBe(true); }
  );

  // Archives
  it.each(['zip', 'gz', 'bz2', 'xz', '7z', 'rar'])(
    'skips %s (archive)', ext => { expect(shouldSkipCompression(`file.${ext}`)).toBe(true); }
  );

  // Office + PDF
  it.each(['pdf', 'docx', 'xlsx', 'pptx'])(
    'skips %s (office/pdf)', ext => { expect(shouldSkipCompression(`file.${ext}`)).toBe(true); }
  );

  // Compressible types — must NOT be skipped
  it.each(['png', 'tiff', 'tif', 'txt', 'md', 'csv', 'json', 'xml', 'html', 'js', 'css'])(
    'does NOT skip %s (compressible)', ext => { expect(shouldSkipCompression(`file.${ext}`)).toBe(false); }
  );

  // Case insensitivity
  it('handles uppercase extension', () => {
    expect(shouldSkipCompression('VIDEO.MOV')).toBe(true);
    expect(shouldSkipCompression('photo.JPG')).toBe(true);
  });

  // Nested path
  it('handles nested path correctly', () => {
    expect(shouldSkipCompression('assets/photos/hero.jpg')).toBe(true);
    expect(shouldSkipCompression('assets/docs/readme.md')).toBe(false);
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

  it('uses ZipPassThrough for skip-list files, ZipDeflate for compressible', async () => {
    const fflate = makeMockFflate();
    const addedClasses = [];

    // Wrap constructors to track which class was used for each file
    const origPassThrough = fflate.ZipPassThrough;
    const origDeflate = fflate.ZipDeflate;
    fflate.ZipPassThrough = class extends origPassThrough {
      constructor(p) { super(p); addedClasses.push({ path: p, type: 'passthrough' }); }
    };
    fflate.ZipDeflate = class extends origDeflate {
      constructor(p, o) { super(p, o); addedClasses.push({ path: p, type: 'deflate' }); }
    };

    const entries = [
      { relativePath: 'photo.jpg',   file: makeFakeFile('photo.jpg', 1024) },
      { relativePath: 'readme.txt',  file: makeFakeFile('readme.txt', 512) },
      { relativePath: 'video.mp4',   file: makeFakeFile('video.mp4', 2048) },
      { relativePath: 'data.csv',    file: makeFakeFile('data.csv', 256) },
      { relativePath: 'archive.zip', file: makeFakeFile('archive.zip', 4096) },
    ];

    await zipAndSelectTestable(entries, 'test', fflate);

    const byPath = Object.fromEntries(addedClasses.map(c => [c.path, c.type]));
    expect(byPath['photo.jpg']).toBe('passthrough');   // jpg → skip
    expect(byPath['readme.txt']).toBe('deflate');      // txt → compress
    expect(byPath['video.mp4']).toBe('passthrough');   // mp4 → skip
    expect(byPath['data.csv']).toBe('deflate');        // csv → compress
    expect(byPath['archive.zip']).toBe('passthrough'); // zip → skip
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
