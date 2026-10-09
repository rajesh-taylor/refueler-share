/**
 * progress-helpers.test.js — time left, speed and retry waits (Share-Progress-1)
 *
 * Imports the browser's own frontend/progress.js, as part-crypto.test.js does.
 */
import { describe, it, expect } from 'vitest';
import { RETRY_DELAYS_MS, timeLeftText, makeRateMeter, progressBytesText } from '../../frontend/progress.js';

describe('RETRY_DELAYS_MS', () => {
  it('never waits more than 10 s, about 2 min in all', () => {
    expect(Math.max(...RETRY_DELAYS_MS)).toBe(10_000);
    const total = RETRY_DELAYS_MS.reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThanOrEqual(110_000);
    expect(total).toBeLessThanOrEqual(130_000);
  });
});

describe('timeLeftText', () => {
  it('rounds seconds up to 10, at least 10', () => {
    expect(timeLeftText(0)).toBe('about 10 s left');
    expect(timeLeftText(3)).toBe('about 10 s left');
    expect(timeLeftText(36)).toBe('about 40 s left');
    expect(timeLeftText(49)).toBe('about 50 s left');
  });
  it('minutes from 50 s, hours from 60 min', () => {
    expect(timeLeftText(50)).toBe('about 1 min left');
    expect(timeLeftText(56)).toBe('about 1 min left');
    expect(timeLeftText(170)).toBe('about 3 min left');
    expect(timeLeftText(3569)).toBe('about 59 min left');
    expect(timeLeftText(3600)).toBe('about 1 h 0 min left');
    expect(timeLeftText(4200)).toBe('about 1 h 10 min left');
  });
  it('says nothing for a bad figure', () => {
    expect(timeLeftText(NaN)).toBe('');
    expect(timeLeftText(Infinity)).toBe('');
    expect(timeLeftText(-1)).toBe('');
  });
});

describe('makeRateMeter', () => {
  it('waits for 5 s of bytes, then uses the speed', () => {
    const m = makeRateMeter();
    m.add(0, 0);
    m.add(4e6, 4000);
    expect(m.left(100e6, 4000)).toBe('');                 // under 5 s
    m.add(5e6, 5000);
    expect(m.left(60e6, 5000)).toBe('about 1 min left');  // 1 MB/s
    expect(m.rate(5000)).toBe(1e6);
  });
  it('uses the last 10 s only', () => {
    const m = makeRateMeter();
    m.add(0, 0);
    m.add(1e6, 10_000);                                   // slow start: 0.1 MB/s
    for (let t = 11_000; t <= 30_000; t += 1000) m.add(1e6 + (t - 10_000) * 1000, t);   // then 1 MB/s
    expect(m.left(30e6, 30_000)).toBe('about 30 s left');
  });
  it('holds a figure for 2 s so the line doesn\'t keep changing', () => {
    const m = makeRateMeter();
    m.add(0, 0); m.add(5e6, 5000);
    expect(m.left(60e6, 5000)).toBe('about 1 min left');
    m.add(15e6, 6000);                                    // much faster now
    expect(m.left(20e6, 6000)).toBe('about 1 min left');  // held
    expect(m.left(20e6, 7000)).not.toBe('about 1 min left');
  });
  it('starts again after a step back or a reset', () => {
    const m = makeRateMeter();
    m.add(0, 0); m.add(10e6, 10_000);
    m.add(5e6, 11_000);                                   // a part starts again
    expect(m.left(50e6, 11_000)).toBe('');
    const r = makeRateMeter();
    r.add(0, 0); r.add(10e6, 10_000);
    r.reset();
    expect(r.left(50e6, 10_000)).toBe('');
  });
});

describe('progressBytesText', () => {
  const MiB = 1024 ** 2, GiB = 1024 ** 3;
  it('whole MB under 1 GB, one decimal GB above, both in the total\'s unit', () => {
    expect(progressBytesText(362.4 * MiB, 404.4 * MiB)).toBe('362 MB of 404 MB');
    expect(progressBytesText(0, 404.4 * MiB)).toBe('0 MB of 404 MB');
    expect(progressBytesText(1.24 * GiB, 3.8 * GiB)).toBe('1.2 GB of 3.8 GB');
    expect(progressBytesText(5 * GiB, 3.8 * GiB)).toBe('3.8 GB of 3.8 GB');
    expect(progressBytesText(300 * 1024, 900 * 1024)).toBe('300 KB of 900 KB');
  });
});
