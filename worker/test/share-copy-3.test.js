/**
 * share-copy-3.test.js — the reference + "What to try →" on the Stopped sheets (Share-Copy-3, 24 Oct 2026)
 *
 * 1. Every receiver Stopped sheet shows the reference (first 8 of the ?uuid= part) and the link.
 * 2. The reference never carries anything from the # part, and nothing that isn't 8 hex characters.
 * 3. Other notice sheets (Link closed, Link incomplete) don't show them; the closed-link page
 *    after a report keeps its email + reference.
 * 4. The markup: the link opens the article's table, in a new tab, on both Stopped sheets.
 *
 * Imports the browser's own module against a small stand-in document.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import shareBody from '../../src/_includes/share-body.njk?raw';

const IDS = ['receiver-card', 'unlock-screen', 'download-card', 'rx-done', 'rx-notice',
  'rx-notice-eyebrow', 'rx-notice-head', 'rx-notice-lede', 'rx-notice-send', 'rx-notice-mail-row',
  'rx-notice-mail', 'rx-notice-ref', 'rx-notice-ledger', 'rx-notice-try'];
const els = {};
const fakeEl = () => ({ hidden: true, textContent: '', href: '', children: [], style: {},
  classList: { add() {}, remove() {} }, getClientRects: () => [] });
globalThis.document = { getElementById: (id) => els[id] ?? null };

const S = await import('../../frontend/download-sheets.js');

const UUID = '0b6f6d3c-5a1e-4c2b-9f0e-1d2c3b4a5f60';
const shown = () => ({
  eyebrow: els['rx-notice-eyebrow'].textContent,
  ref:     els['rx-notice-ledger'].hidden ? null : els['rx-notice-ref'].textContent,
  mail:    !els['rx-notice-ledger'].hidden && !els['rx-notice-mail-row'].hidden,
  tryLink: !els['rx-notice-try'].hidden,
});

beforeEach(() => { for (const id of IDS) els[id] = fakeEl(); S._setReference(UUID); });

describe('Stopped sheets carry the reference and "What to try →"', () => {
  it('a download stop', () => {
    S._showDownloadError('Refueler couldn’t be reached. Check your connection, then open the link again.');
    expect(shown()).toEqual({ eyebrow: 'Stopped', ref: '0b6f6d3c', mail: false, tryLink: true });
  });
  it('the integrity stop and the setup stop (via _showStopped)', () => {
    S._showStopped("This file didn't pass its check.", 'Nothing was saved to your device.');
    expect(shown()).toEqual({ eyebrow: 'Stopped', ref: '0b6f6d3c', mail: false, tryLink: true });
  });
  it('no reference before the link was read: the link still shows, the ledger does not', () => {
    S._setReference(undefined);
    S._showStopped('Share couldn’t start in this browser.', 'Reload to try again, or use another browser.');
    expect(shown()).toEqual({ eyebrow: 'Stopped', ref: null, mail: false, tryLink: true });
  });
});

describe('the reference is only ever 8 hex characters from the ?uuid= part', () => {
  it('upper case is folded, the rest of the id is dropped', () => {
    S._setReference(UUID.toUpperCase());
    S._showDownloadError('x');
    expect(els['rx-notice-ref'].textContent).toBe('0b6f6d3c');
  });
  it('anything that is not 8 hex characters gives no reference', () => {
    for (const bad of ['', 'abc', 'k4Rw9Tq2Lm7X', '#0b6f6d3c', ' 0b6f6d3c', 'key=0b6f6d3c', null]) {
      S._setReference(bad);
      S._showDownloadError('x');
      expect(shown().ref).toBe(null);
    }
  });
});

describe('other notice sheets', () => {
  it('Link closed (time ran out) and Link incomplete: no reference, no link', () => {
    S._showWindowClosed(1798761600);
    expect(shown()).toMatchObject({ eyebrow: 'Link closed', ref: null, tryLink: false });
    S._showNotice('Link incomplete', 'This link isn’t complete.', '…');
    expect(shown()).toMatchObject({ ref: null, tryLink: false });
  });
  it('after a stop, a later closed-link sheet does not keep the stop’s link', () => {
    S._showDownloadError('x');
    S._showLinkRemoved('0b6f6d3c');
    expect(shown()).toEqual({ eyebrow: 'Link closed', ref: '0b6f6d3c', mail: true, tryLink: false });
    expect(els['rx-notice-mail'].href).toBe('mailto:report@refueler.io?subject=Reference%200b6f6d3c');
  });
});

describe('markup', () => {
  const TRY = 'href="https://refueler.io/notes/when-a-transfer-doesnt-work/#what-the-page-says" target="_blank" rel="noopener"><span>What to try →</span>';
  it('the link sits on the receiver notice and on the sender’s Stopped view', () => {
    expect(shareBody.split(TRY).length - 1).toBe(2);
    expect(shareBody).toMatch(/id="rx-notice-try" hidden>[^\n]*What to try/);
    expect(shareBody).toMatch(/<div class="up-for-stopped">[\s\S]*?What to try →[\s\S]*?<\/div>\s*\n\s*<!-- Link ready -->/);
  });
});
