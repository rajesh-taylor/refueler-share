/**
 * share-copy-2.test.js — failure copy the Notes article quotes (Share-Copy-2, 16 Oct 2026)
 *
 * 1. classifyLink: a cut link opens "Link incomplete", not the upload page.
 * 2. The security check that never loads says so and gives the button back.
 * 3. The receiver's stop lines, word for word as Rajesh approved them.
 *
 * Imports the browser's own modules, as part-crypto.test.js does.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { assembleFragment, classifyLink, LINK_INCOMPLETE } from '../../frontend/fragment.js';
import { DL_TEXT } from '../../frontend/download-fetch.js';
import { CHECK_BLOCKED, UPLOAD_LABEL, pressWhenChecked } from '../../frontend/upload-turnstile.js';

const UUID = '0b6f6d3c-5a1e-4c2b-9f0e-1d2c3b4a5f60';
const frag = assembleFragment({ keyBytes: new Uint8Array(32).fill(7), filename: 'notes.pdf', sizeBytes: 1234 });

describe('classifyLink — whole links still download', () => {
  it('v2 link with ?uuid= → download', () => {
    const r = classifyLink(`?uuid=${UUID}`, `#${frag}`);
    expect(r.mode).toBe('download');
    expect(r.detected).toMatchObject({ v: 2, uuid: UUID, filename: 'notes.pdf', sizeBytes: 1234 });
  });
  it('legacy #uuid=&key= → download (v0)', () => {
    const r = classifyLink('', `#uuid=${UUID}&key=ab&iv=cd`);
    expect(r).toEqual({ mode: 'download', detected: { v: 0, uuid: UUID, key: 'ab', iv: 'cd', sn: null } });
  });
});

describe('classifyLink — half a link → incomplete', () => {
  it('?uuid= and no # part', () => {
    expect(classifyLink(`?uuid=${UUID}`, '')).toEqual({ mode: 'incomplete', code: 'no_fragment' });
    expect(classifyLink(`?uuid=${UUID}`, '#')).toEqual({ mode: 'incomplete', code: 'no_fragment' });
  });
  it('?uuid= and a # part cut short', () => {
    for (const n of [1, 10, frag.length - 5]) {
      expect(classifyLink(`?uuid=${UUID}`, `#${frag.slice(0, n)}`)).toEqual({ mode: 'incomplete', code: 'bad_fragment' });
    }
  });
  it('a whole # part with no ?uuid=', () => {
    expect(classifyLink('', `#${frag}`)).toEqual({ mode: 'incomplete', code: 'no_uuid' });
  });
  it('never hands back anything from the fragment', () => {
    const r = classifyLink(`?uuid=${UUID}`, `#${frag.slice(0, 20)}`);
    expect(Object.keys(r).sort()).toEqual(['code', 'mode']);
  });
});

describe('classifyLink — plain visits stay on the upload page', () => {
  it('no query, no # part', () => expect(classifyLink('', '')).toEqual({ mode: 'upload' }));
  it('a # part that is not ours, no ?uuid=', () => expect(classifyLink('', '#!')).toEqual({ mode: 'upload' }));
  it('an empty ?uuid=', () => expect(classifyLink('?uuid=', '')).toEqual({ mode: 'upload' }));
});

describe('approved wording', () => {
  it('link incomplete', () => {
    expect(LINK_INCOMPLETE).toEqual({
      eyebrow: 'Link incomplete',
      head:    'This link isn’t complete.',
      lede:    'Part of it was lost on the way. Ask the sender to send it again, in full.',
    });
  });
  it('security check blocked', () => {
    expect(CHECK_BLOCKED).toBe('The security check couldn’t load. A content blocker or VPN may be stopping it; allow challenges.cloudflare.com and gate.share.refueler.io, or try once without it.');
  });
  it('download stop lines', () => {
    expect(DL_TEXT).toEqual({
      decrypt:          'The file couldn’t be decrypted. The link may be damaged; ask the sender to send it again. Nothing was saved.',
      incomplete:       'Refueler’s answer was incomplete. Open the link again; if it keeps happening, check the Status page.',
      metaError:        'Refueler couldn’t open this transfer just now. Open the link again in a minute; if it keeps happening, check the Status page.',
      unreachable:      'Refueler couldn’t be reached. Check your connection, then open the link again.',
      unreachableTried: 'Refueler couldn’t be reached after several tries. Nothing was saved. Check your connection, then open the link again.',
      refused:          'Refueler didn’t accept this download. Open the link again to start over.',
      saveSpot:         'The file couldn’t be saved there. Open the link again and choose another place.',
      browser:          'Something went wrong in this browser. Open the link again; if it keeps happening, try another browser.',
      unlockFailed:     'Refueler couldn’t check the password. Try again.',
      unlockUnreachable:'Refueler couldn’t be reached. Try again.',
    });
  });
  it('the voice: no "Please", no dashes', () => {
    for (const s of [...Object.values(DL_TEXT), ...Object.values(LINK_INCOMPLETE), CHECK_BLOCKED]) {
      expect(s).not.toMatch(/Please|—|–/);
    }
  });
  it('Stopped-sheet lines never say "Try again" (the address bar is cleared; reload shows the upload page)', () => {
    const { unlockFailed, unlockUnreachable, ...sheet } = DL_TEXT;
    for (const s of Object.values(sheet)) expect(s).not.toMatch(/Try again/);
  });
});

describe('security check that never loads (upload-turnstile.js, through the gate)', () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  // Turnstile-Gate-1: the check runs in a framed gate page. Here the gate never answers.
  function fakePage() {
    const frames = [];
    const el = (tag) => ({ tag, attrs: {}, classList: { add() {}, remove() {} }, setAttribute(k, v) { this.attrs[k] = v; },
      remove() { this.removed = true; }, appendChild(c) { if (c.tag === 'iframe') frames.push(c); }, contentWindow: { postMessage() {} } });
    const container = el('div'), wrap = el('div');
    vi.stubGlobal('document', {
      getElementById: (id) => (id === 'cf-turnstile' ? container : id === 'turnstile-wrap' ? wrap : null),
      createElement: (tag) => el(tag),
      documentElement: { getAttribute: () => null },
    });
    const listeners = [];
    vi.stubGlobal('window', { addEventListener: (t, f) => listeners.push(f), removeEventListener: (t, f) => listeners.splice(listeners.indexOf(f), 1) });
    vi.stubGlobal('MutationObserver', class { observe() {} disconnect() {} });
    return { frames, listeners };
  }

  it('after 15 s with no gate: the line shows, gate_load is reported, the button reads "Encrypt and upload" again', () => {
    vi.useFakeTimers();
    const { frames, listeners } = fakePage();
    const domRefs = {
      uploadBtn: { textContent: UPLOAD_LABEL, disabled: false },
      passphraseToggle: { checked: false }, passphraseInput: { value: '' },
    };
    const state = { selectedFile: {}, turnstileToken: null };
    const msgs = [], reports = [];
    const helpers = { setDropMsg: (m) => msgs.push(m), reportError: (...a) => reports.push(a) };
    const go = vi.fn();

    pressWhenChecked(go, state, domRefs, helpers);
    expect(domRefs.uploadBtn.textContent).toBe('Checking…');
    expect(domRefs.uploadBtn.disabled).toBe(true);
    expect(frames).toHaveLength(1);
    expect(frames[0].src).toBe('https://gate.share.refueler.io/');
    expect(frames[0].attrs.sandbox).toBe('allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox');
    expect(frames[0].attrs.referrerpolicy).toBe('no-referrer');

    vi.advanceTimersByTime(15500);
    expect(msgs).toEqual([CHECK_BLOCKED]);
    expect(reports).toEqual([['gate_load', 'timeout', '']]);
    expect(domRefs.uploadBtn.textContent).toBe(UPLOAD_LABEL);
    expect(domRefs.uploadBtn.disabled).toBe(false);
    expect(go).not.toHaveBeenCalled();

    // The next press removes the frame and inserts a fresh one.
    pressWhenChecked(go, state, domRefs, helpers);
    expect(frames[0].removed).toBe(true);
    expect(frames).toHaveLength(2);
    expect(listeners).toHaveLength(1);
  });
});
