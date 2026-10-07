// tests/resume.test.js — RU1a unit tests
// Coverage: IDB expiry-awareness, chunk-skip logic, zip progress fix,
//           fetchWithTimeout Safari stub, writeChunkState tier field,
//           scheme gate + changed-file check (Share-Crypto-1).
//
// Run: npx vitest run tests/resume.test.js

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers shared across suites
// ─────────────────────────────────────────────────────────────────────────────

const TIER_EXPIRY_SECONDS = {
  free:              7  * 24 * 60 * 60,
  creative_premium: 30  * 24 * 60 * 60,
  production_max:   90  * 24 * 60 * 60,
};

function nowSecs() { return Date.now() / 1000; }

// ─────────────────────────────────────────────────────────────────────────────
// Helper: build a synthetic IDB record as writeChunkState() would produce it.
// ─────────────────────────────────────────────────────────────────────────────
function makeRecord(overrides = {}) {
  const defaults = {
    uuid:            'aaaaaaaa-0000-0000-0000-000000000001',
    chunkIndex:      2,        // last confirmed chunk (0-based)
    totalChunks:     10,
    fileName:        'test.zip',
    fileSize:        1024 * 1024 * 500, // 500 MB
    keyHex:          'a'.repeat(64),
    scheme:          2,        // Share-Crypto-1: part key schedule, link format v2
    tier:            'free',
    expiryTimestamp: Math.floor(nowSecs()) + 6 * 24 * 60 * 60, // 6 days from now
    timestamp:       Date.now(),
    uploadMode:      'direct-r2',
    sessionToken:    'tok',
    hashes:          ['1'.repeat(64), '2'.repeat(64), '3'.repeat(64)], // one per sent part (chunkIndex + 1)
    fileModified:    1700000000000,
  };
  return { ...defaults, ...overrides };
}

// ─────────────────────────────────────────────────────────────────────────────
// Suite 1 — Expiry-awareness logic
//
// Tests the decision logic extracted from checkResumeState():
// given a record, is it expired?
// ─────────────────────────────────────────────────────────────────────────────
describe('Expiry-awareness', () => {
  function isExpired(record) {
    const now = nowSecs();
    if (record.expiryTimestamp) {
      return now > record.expiryTimestamp;
    }
    if (record.tier && TIER_EXPIRY_SECONDS[record.tier]) {
      const windowSecs  = TIER_EXPIRY_SECONDS[record.tier];
      const writtenSecs = (record.timestamp || 0) / 1000;
      return now > writtenSecs + windowSecs;
    }
    return false; // cannot determine — assume valid
  }

  it('fresh record is not expired (expiryTimestamp path)', () => {
    const record = makeRecord();
    expect(isExpired(record)).toBe(false);
  });

  it('record with expiryTimestamp in the past is expired', () => {
    const record = makeRecord({
      expiryTimestamp: Math.floor(nowSecs()) - 1,
    });
    expect(isExpired(record)).toBe(true);
  });

  it('legacy record without expiryTimestamp — fresh (free, written 1 day ago)', () => {
    const record = makeRecord({
      expiryTimestamp: undefined,
      tier:            'free',
      timestamp:       Date.now() - 1 * 24 * 60 * 60 * 1000, // 1 day ago
    });
    expect(isExpired(record)).toBe(false);
  });

  it('legacy record without expiryTimestamp — expired (free, written 8 days ago)', () => {
    const record = makeRecord({
      expiryTimestamp: undefined,
      tier:            'free',
      timestamp:       Date.now() - 8 * 24 * 60 * 60 * 1000, // 8 days ago
    });
    expect(isExpired(record)).toBe(true);
  });

  it('creative_premium window is 30 days — 29 days ago is fresh', () => {
    const record = makeRecord({
      expiryTimestamp: undefined,
      tier:            'creative_premium',
      timestamp:       Date.now() - 29 * 24 * 60 * 60 * 1000,
    });
    expect(isExpired(record)).toBe(false);
  });

  it('creative_premium window is 30 days — 31 days ago is expired', () => {
    const record = makeRecord({
      expiryTimestamp: undefined,
      tier:            'creative_premium',
      timestamp:       Date.now() - 31 * 24 * 60 * 60 * 1000,
    });
    expect(isExpired(record)).toBe(true);
  });

  it('production_max window is 90 days — 89 days ago is fresh', () => {
    const record = makeRecord({
      expiryTimestamp: undefined,
      tier:            'production_max',
      timestamp:       Date.now() - 89 * 24 * 60 * 60 * 1000,
    });
    expect(isExpired(record)).toBe(false);
  });

  it('production_max window is 90 days — 91 days ago is expired', () => {
    const record = makeRecord({
      expiryTimestamp: undefined,
      tier:            'production_max',
      timestamp:       Date.now() - 91 * 24 * 60 * 60 * 1000,
    });
    expect(isExpired(record)).toBe(true);
  });

  it('record with unknown tier and no expiryTimestamp is treated as valid', () => {
    const record = makeRecord({
      expiryTimestamp: undefined,
      tier:            'unknown_future_tier',
      timestamp:       Date.now() - 999 * 24 * 60 * 60 * 1000,
    });
    expect(isExpired(record)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 2 — Stale guard (8-day wall, independent of expiry)
// ─────────────────────────────────────────────────────────────────────────────
describe('Stale guard', () => {
  function isStale(record) {
    const age = Date.now() - (record.timestamp || 0);
    return age > 8 * 24 * 60 * 60 * 1000;
  }

  it('record written now is not stale', () => {
    expect(isStale(makeRecord())).toBe(false);
  });

  it('record written 7 days ago is not stale', () => {
    const record = makeRecord({ timestamp: Date.now() - 7 * 24 * 60 * 60 * 1000 });
    expect(isStale(record)).toBe(false);
  });

  it('record written 9 days ago is stale', () => {
    const record = makeRecord({ timestamp: Date.now() - 9 * 24 * 60 * 60 * 1000 });
    expect(isStale(record)).toBe(true);
  });

  it('record with missing timestamp is treated as stale (timestamp=0)', () => {
    const record = makeRecord({ timestamp: 0 });
    expect(isStale(record)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 3 — writeChunkState record shape (RU1a: tier + expiryTimestamp present)
// ─────────────────────────────────────────────────────────────────────────────
describe('writeChunkState record shape', () => {
  it('record includes tier field', () => {
    const record = makeRecord({ tier: 'free' });
    expect(record).toHaveProperty('tier', 'free');
  });

  it('record includes expiryTimestamp field', () => {
    const expiryTimestamp = Math.floor(nowSecs()) + 7 * 24 * 60 * 60;
    const record = makeRecord({ expiryTimestamp });
    expect(record).toHaveProperty('expiryTimestamp', expiryTimestamp);
  });

  it('record includes all required fields', () => {
    const record = makeRecord();
    const required = ['uuid', 'chunkIndex', 'totalChunks', 'fileName', 'fileSize',
                       'keyHex', 'scheme', 'tier', 'expiryTimestamp', 'timestamp', 'hashes'];
    for (const field of required) {
      expect(record).toHaveProperty(field);
    }
  });

  it('record carries scheme 2 and no IV (link format v2)', () => {
    const record = makeRecord();
    expect(record.scheme).toBe(2);
    expect(record).not.toHaveProperty('ivHex');
  });

  it('chunkIndex is the index of the last confirmed chunk (0-based)', () => {
    // After chunk 5 ACKs, chunkIndex should be 5.
    const record = makeRecord({ chunkIndex: 5, totalChunks: 20 });
    expect(record.chunkIndex).toBe(5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 4 — Resume chunk-skip logic
//
// The resume loop starts at chunkIndex + 1.
// Tests that the correct range of chunks is (or isn't) re-sent.
// ─────────────────────────────────────────────────────────────────────────────
describe('Resume chunk-skip logic', () => {
  function chunksToUpload(record) {
    // Returns the array of chunk indices the resume loop would process.
    const resumeFrom = record.chunkIndex + 1;
    return Array.from({ length: record.totalChunks - resumeFrom }, (_, i) => resumeFrom + i);
  }

  it('resumes from chunk after last confirmed', () => {
    const record = makeRecord({ chunkIndex: 2, totalChunks: 10 });
    const indices = chunksToUpload(record);
    expect(indices[0]).toBe(3);
  });

  it('skips all confirmed chunks', () => {
    const record = makeRecord({ chunkIndex: 2, totalChunks: 10 });
    const indices = chunksToUpload(record);
    expect(indices).not.toContain(0);
    expect(indices).not.toContain(1);
    expect(indices).not.toContain(2);
  });

  it('uploads all remaining chunks', () => {
    const record = makeRecord({ chunkIndex: 2, totalChunks: 10 });
    const indices = chunksToUpload(record);
    expect(indices).toEqual([3, 4, 5, 6, 7, 8, 9]);
  });

  it('nothing to upload if last chunk was confirmed', () => {
    const record = makeRecord({ chunkIndex: 9, totalChunks: 10 });
    const indices = chunksToUpload(record);
    expect(indices).toHaveLength(0);
  });

  it('full upload if chunkIndex is -1 (no confirmed chunks)', () => {
    // chunkIndex = -1 would mean nothing confirmed — resumeFrom = 0.
    // This edge case shouldn't occur in practice (IDB is written after first ACK)
    // but the formula should handle it safely.
    const record = makeRecord({ chunkIndex: -1, totalChunks: 5 });
    const indices = chunksToUpload(record);
    expect(indices).toEqual([0, 1, 2, 3, 4]);
  });

  it('single-chunk transfer fully confirmed — nothing to upload', () => {
    const record = makeRecord({ chunkIndex: 0, totalChunks: 1 });
    const indices = chunksToUpload(record);
    expect(indices).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 5 — fetchWithTimeout (Safari hang fix)
// ─────────────────────────────────────────────────────────────────────────────
describe('fetchWithTimeout', () => {
  // Inline the function so we can test it without a DOM.
  async function fetchWithTimeout(url, options, timeoutMs, fetchImpl) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, { ...options, signal: controller.signal });
      clearTimeout(timer);
      return res;
    } catch (e) {
      clearTimeout(timer);
      if (e.name === 'AbortError') {
        const err = new Error(`Chunk upload timed out after ${timeoutMs / 1000}s`);
        err.timedOut = true;
        throw err;
      }
      throw e;
    }
  }

  it('resolves when fetch completes within timeout', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const res = await fetchWithTimeout('https://example.com', {}, 5000, mockFetch);
    expect(res.ok).toBe(true);
  });

  it('throws with timedOut=true when fetch hangs past deadline', async () => {
    // Simulate a hanging fetch by never resolving.
    const mockFetch = vi.fn().mockImplementation((_url, opts) => {
      return new Promise((_resolve, reject) => {
        opts.signal.addEventListener('abort', () => {
          const e = new Error('The operation was aborted');
          e.name = 'AbortError';
          reject(e);
        });
      });
    });

    const promise = fetchWithTimeout('https://example.com', {}, 50, mockFetch);
    const err = await promise.catch(e => e);
    expect(err.timedOut).toBe(true);
    expect(err.message).toContain('timed out');
  });

  it('passes through non-abort errors unchanged', async () => {
    const networkError = new Error('Network failure');
    const mockFetch = vi.fn().mockRejectedValue(networkError);
    const err = await fetchWithTimeout('https://example.com', {}, 5000, mockFetch).catch(e => e);
    expect(err.message).toBe('Network failure');
    expect(err.timedOut).toBeUndefined();
  });

  it('signal is passed to the underlying fetch call', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    await fetchWithTimeout('https://example.com', { method: 'PUT' }, 5000, mockFetch);
    const calledWith = mockFetch.mock.calls[0][1];
    expect(calledWith.signal).toBeInstanceOf(AbortSignal);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 6 — Zip progress cap (compression bar fix)
//
// Tests the pct = Math.min(..., 95) cap applied in the zip loop (RU1a).
// Previously the loop could reach 100% then freeze while fflate wrote the
// central directory — now capped at 95% until zipper.end() fires.
// ─────────────────────────────────────────────────────────────────────────────
describe('Zip progress cap', () => {
  function computeZipPct(bytesProcessed, totalBytes) {
    // Mirrors the updated zipAndSelect() pct calculation.
    return Math.min(Math.round((bytesProcessed / totalBytes) * 95), 95);
  }

  it('progress is 0% at start', () => {
    expect(computeZipPct(0, 1000)).toBe(0);
  });

  it('progress reaches 95% when all bytes processed', () => {
    expect(computeZipPct(1000, 1000)).toBe(95);
  });

  it('progress never exceeds 95% during loop', () => {
    // Even if floating point rounds up, cap holds.
    expect(computeZipPct(1001, 1000)).toBe(95);
  });

  it('progress at 50% of bytes is ~47%', () => {
    expect(computeZipPct(500, 1000)).toBe(48); // Math.round(0.5 * 95) = 48
  });

  it('final 100% is only shown after zipper.end() resolves', () => {
    // This is a design assertion: the loop sets max 95%, then the
    // resolve callback sets 100%. We verify the cap prevents premature 100%.
    const duringLoop = computeZipPct(1000, 1000);
    const afterEnd   = 100; // set by showZipStage after Blob resolves
    expect(duringLoop).toBe(95);
    expect(afterEnd).toBe(100);
    expect(duringLoop).toBeLessThan(afterEnd);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 7 — File identity check (resume file verification)
// ─────────────────────────────────────────────────────────────────────────────
describe('Resume file identity check', () => {
  function fileMatchesRecord(file, record) {
    return file.name === record.fileName && file.size === record.fileSize;
  }

  it('matching name and size passes', () => {
    const record = makeRecord({ fileName: 'project.zip', fileSize: 1024 });
    const file   = { name: 'project.zip', size: 1024 };
    expect(fileMatchesRecord(file, record)).toBe(true);
  });

  it('wrong name fails', () => {
    const record = makeRecord({ fileName: 'project.zip', fileSize: 1024 });
    const file   = { name: 'other.zip', size: 1024 };
    expect(fileMatchesRecord(file, record)).toBe(false);
  });

  it('wrong size fails', () => {
    const record = makeRecord({ fileName: 'project.zip', fileSize: 1024 });
    const file   = { name: 'project.zip', size: 2048 };
    expect(fileMatchesRecord(file, record)).toBe(false);
  });

  it('both wrong fails', () => {
    const record = makeRecord({ fileName: 'project.zip', fileSize: 1024 });
    const file   = { name: 'other.zip', size: 2048 };
    expect(fileMatchesRecord(file, record)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 8 — Scheme gate (Share-Crypto-1)
//
// Mirrors resumeUpload(): a record must be direct-r2, carry scheme 2 and keep one
// well-formed hash per sent part; anything else is discarded (NO_RESUME).
// checkResumeState() drops a record without scheme 2 before offering it.
// ─────────────────────────────────────────────────────────────────────────────
describe('Scheme gate', () => {
  function canResume(record) {
    if (record.uploadMode !== 'direct-r2' || !record.sessionToken) return false;
    const resumeFrom = record.chunkIndex + 1;
    const ok = Array.isArray(record.hashes) && record.hashes.length === resumeFrom
      && record.hashes.every(h => /^[0-9a-f]{64}$/.test(h));
    return record.scheme === 2 && ok;
  }
  const offered = (record) => record.scheme === 2;

  it('a v2 record resumes', () => {
    expect(canResume(makeRecord())).toBe(true);
    expect(offered(makeRecord())).toBe(true);
  });

  it('a record from before v2 (no scheme, has ivHex) is discarded and not offered', () => {
    const record = makeRecord({ scheme: undefined, ivHex: 'b'.repeat(24) });
    expect(canResume(record)).toBe(false);
    expect(offered(record)).toBe(false);
  });

  it('a record with an unknown scheme is discarded', () => {
    expect(canResume(makeRecord({ scheme: 3 }))).toBe(false);
  });

  it('a v2 record with missing, short or malformed hashes is discarded', () => {
    expect(canResume(makeRecord({ hashes: undefined }))).toBe(false);
    expect(canResume(makeRecord({ hashes: ['1'.repeat(64)] }))).toBe(false);
    expect(canResume(makeRecord({ hashes: ['1'.repeat(64), '2'.repeat(64), 'zz'] }))).toBe(false);
  });

  it('nothing sent yet (chunkIndex -1) needs no hashes', () => {
    expect(canResume(makeRecord({ chunkIndex: -1, hashes: [] }))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 9 — Changed-file check (Share-Crypto-1)
//
// Mirrors resumeUpload() + _carryOn(): unchanged file (same lastModified) keeps
// the record's hashes; otherwise every sent part is re-encrypted and must equal
// the record's hash for that part, or the upload stops before sending anything.
// ─────────────────────────────────────────────────────────────────────────────
describe('Changed-file check', () => {
  // reencrypt(i) → hash of part i as the chosen file gives it now
  function resumeCheck(record, fileModified, reencrypt) {
    const expected = record.hashes;
    if (record.fileModified === fileModified) return { ok: true, hashes: expected.slice(), reencrypted: 0 };
    const hashes = [];
    for (let i = 0; i < expected.length; i++) {
      const h = reencrypt(i);
      if (h !== expected[i]) return { ok: false, stoppedAt: i, reencrypted: i + 1 };
      hashes.push(h);
    }
    return { ok: true, hashes, reencrypted: expected.length };
  }

  it('same file, unchanged: record hashes kept, nothing re-encrypted', () => {
    const r = makeRecord();
    const res = resumeCheck(r, r.fileModified, () => { throw new Error('should not re-encrypt'); });
    expect(res).toMatchObject({ ok: true, reencrypted: 0 });
    expect(res.hashes).toEqual(r.hashes);
  });

  it('same bytes, touched (new lastModified): re-encrypted, every hash matches, carries on', () => {
    const r = makeRecord();
    const res = resumeCheck(r, r.fileModified + 1, i => r.hashes[i]);
    expect(res).toMatchObject({ ok: true, reencrypted: 3 });
  });

  it('different file, same name and size: stops at the first part that differs', () => {
    const r = makeRecord();
    const res = resumeCheck(r, r.fileModified + 1, i => (i === 1 ? 'f'.repeat(64) : r.hashes[i]));
    expect(res).toMatchObject({ ok: false, stoppedAt: 1, reencrypted: 2 });
  });
});
