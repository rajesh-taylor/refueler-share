/**
 * progress-helpers.test.js — time left, speed and retry waits (Share-Progress-1)
 *
 * Imports the browser's own frontend/crypto.js, as part-crypto.test.js does.
 */
import { describe, it, expect } from 'vitest';
import { RETRY_DELAYS_MS, timeLeftText, makeRateMeter } from '../../frontend/crypto.js';

describe('RETRY_DELAYS_MS', () => {
  it('never waits more than 10 s, about 2 min in all', () => {
    expect(Math.max(...RETRY_DELAYS_MS)).toBe(10_000);
    const total = RETRY_DELAYS_MS.reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThanOrEqual(110_000);
    expect(total).toBeLessThanOrEqual(130_000);
  });
});

describe('timeLeftText', () => {
  it('rounds seconds up to 5, at least 5', () => {
    expect(timeLeftText(0)).toBe('about 5 s left');
    expect(timeLeftText(3)).toBe('about 5 s left');
    expect(timeLeftText(36)).toBe('about 40 s left');
    expect(timeLeftText(54)).toBe('about 55 s left');
  });
  it('minutes from 55 s, hours from 60 min', () => {
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
