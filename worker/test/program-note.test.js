/**
 * program-note.test.js — "is this a program?" on the finished screen (Share-MIME-1)
 *
 * Imports the browser's own frontend/download-program.js, as part-crypto.test.js does.
 */
import { describe, it, expect } from 'vitest';
import { programByName, programByBytes, zipNames, zipHoldsProgram, makeProgramCheck, PROGRAM_NOTE,
         SEND_NOTE, PICK_HEAD_BYTES, programBeforeDownload, programOnPick }
  from '../../frontend/download-program.js';

const enc = new TextEncoder();
const bytes = (...a) => new Uint8Array(a);

// A store-only zip (no data needed by the rule beyond the contents list, but laid out properly).
function makeZip(names, { zip64 = false, comment = '' } = {}) {
  const parts = [], cd = [];
  let off = 0;
  for (const n of names) {
    const nb = enc.encode(n);
    const lh = new Uint8Array(30 + nb.length + 1);
    const lv = new DataView(lh.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(26, nb.length, true); lh.set(nb, 30); lh[30 + nb.length] = 0x41;
    const ch = new Uint8Array(46 + nb.length);
    const cv = new DataView(ch.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(28, nb.length, true); cv.setUint32(42, off, true); ch.set(nb, 46);
    parts.push(lh); cd.push(ch); off += lh.length;
  }
  const cdSize = cd.reduce((s, c) => s + c.length, 0);
  const tailRecs = [];
  if (zip64) {
    const rec = new Uint8Array(56); const rv = new DataView(rec.buffer);
    rv.setUint32(0, 0x06064b50, true); rv.setBigUint64(4, 44n, true);
    rv.setBigUint64(24, BigInt(names.length), true); rv.setBigUint64(32, BigInt(names.length), true);
    rv.setBigUint64(40, BigInt(cdSize), true); rv.setBigUint64(48, BigInt(off), true);
    const loc = new Uint8Array(20); const lv = new DataView(loc.buffer);
    lv.setUint32(0, 0x07064b50, true); lv.setBigUint64(8, BigInt(off + cdSize), true); lv.setUint32(16, 1, true);
    tailRecs.push(rec, loc);
  }
  const cb = enc.encode(comment);
  const eocd = new Uint8Array(22 + cb.length); const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, zip64 ? 0xffff : names.length, true); ev.setUint16(10, zip64 ? 0xffff : names.length, true);
  ev.setUint32(12, zip64 ? 0xffffffff : cdSize, true); ev.setUint32(16, zip64 ? 0xffffffff : off, true);
  ev.setUint16(20, cb.length, true); eocd.set(cb, 22);
  const all = [...parts, ...cd, ...tailRecs, eocd];
  const out = new Uint8Array(all.reduce((s, a) => s + a.length, 0));
  let p = 0; for (const a of all) { out.set(a, p); p += a.length; }
  return out;
}

function pe() {
  const b = new Uint8Array(0x100);
  b[0] = 0x4d; b[1] = 0x5a; b[0x3c] = 0x80;
  b.set([0x50, 0x45, 0, 0], 0x80);
  return b;
}

describe('programByName', () => {
  it.each(['Setup.exe', 'x.MSI', 'install.sh', 'run.command', 'a.bat', 'a.ps1', 'b.pkg', 'c.dmg',
           'd.apk', 'e.ipa', 'f.AppImage', 'g.jar', 'h.deb', 'dir/sub/i.cmd'])('%s → program', (n) => {
    expect(programByName(n)).toBe(true);
  });
  it.each(['report.pdf', 'photo.jpg', 'notes.txt', 'app.js', 'folder.zip', 'Makefile', '.bashrc', 'exe'])(
    '%s → not a program', (n) => { expect(programByName(n)).toBe(false); });
});

describe('programByBytes', () => {
  it('ELF', () => expect(programByBytes(bytes(0x7f, 0x45, 0x4c, 0x46, 2))).toBe(true));
  it('Mach-O 64 (little-endian on disk)', () => expect(programByBytes(bytes(0xcf, 0xfa, 0xed, 0xfe))).toBe(true));
  it('Mach-O 32 big-endian', () => expect(programByBytes(bytes(0xfe, 0xed, 0xfa, 0xce))).toBe(true));
  it('Mach-O universal (2 architectures)', () =>
    expect(programByBytes(bytes(0xca, 0xfe, 0xba, 0xbe, 0, 0, 0, 2))).toBe(true));
  it('Java .class shares the magic but is not a Mach-O', () =>
    expect(programByBytes(bytes(0xca, 0xfe, 0xba, 0xbe, 0, 0, 0, 0x41))).toBe(false));
  it('PE (MZ + PE header)', () => expect(programByBytes(pe())).toBe(true));
  it('bare MZ with no PE header is not enough', () => {
    const b = pe(); b[0x80] = 0; expect(programByBytes(b)).toBe(false);
  });
  it('xar installer', () => expect(programByBytes(enc.encode('xar!\0\x1c'))).toBe(true));
  it('#! script', () => expect(programByBytes(enc.encode('#!/bin/sh\necho hi\n'))).toBe(true));
  it('PDF, PNG, text, empty, short', () => {
    expect(programByBytes(enc.encode('%PDF-1.7'))).toBe(false);
    expect(programByBytes(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe(false);
    expect(programByBytes(enc.encode('hello world'))).toBe(false);
    expect(programByBytes(new Uint8Array(0))).toBe(false);
    expect(programByBytes(null)).toBe(false);
  });
});

describe('zipNames / zipHoldsProgram', () => {
  it('reads every name in order', () => {
    expect(zipNames(makeZip(['a/', 'a/b.txt', 'a/c.png']))).toEqual(['a/', 'a/b.txt', 'a/c.png']);
  });
  it('reads past a zip comment', () => {
    expect(zipNames(makeZip(['x.txt'], { comment: 'made by hand' }))).toEqual(['x.txt']);
  });
  it('reads a Zip64 end record', () => {
    expect(zipNames(makeZip(['big/one.bin', 'big/two.exe'], { zip64: true }))).toEqual(['big/one.bin', 'big/two.exe']);
  });
  it('null when the contents list starts before the bytes kept', () => {
    const z = makeZip(['a.txt', 'b.txt', 'c.txt']);
    expect(zipNames(z.subarray(z.length - 40))).toBe(null);
  });
  it('null for bytes that are not a zip', () => {
    expect(zipNames(enc.encode('x'.repeat(100)))).toBe(null);
  });
  it('a program inside → yes; a macOS .app bundle → yes; documents → no', () => {
    expect(zipHoldsProgram(['f/', 'f/readme.txt', 'f/setup.exe'])).toBe(true);
    expect(zipHoldsProgram(['Thing.app/', 'Thing.app/Contents/Info.plist'])).toBe(true);
    expect(zipHoldsProgram(['f/', 'f/a.pdf', 'f/b.docx', 'f/.app'])).toBe(false);
  });
});

describe('makeProgramCheck', () => {
  const parts = (u8, size) => { const out = []; for (let i = 0; i < u8.length; i += size) out.push(u8.slice(i, i + size)); return out; };

  it('by name', () => {
    const c = makeProgramCheck('Installer.dmg'); c.see(enc.encode('anything'));
    expect(c.verdict()).toBe('file');
  });
  it('by bytes, whatever the name', () => {
    const c = makeProgramCheck('holiday.jpg'); c.see(bytes(0x7f, 0x45, 0x4c, 0x46, 2, 1, 1)); c.see(new Uint8Array(50));
    expect(c.verdict()).toBe('file');
  });
  it('a folder holding a program, its list split across the last two parts', () => {
    const z = makeZip(Array.from({ length: 40 }, (_, i) => `photos/p${i}.jpg`).concat(['photos/tools/fix.command']));
    const c = makeProgramCheck('photos.zip');
    for (const p of parts(z, 700)) c.see(p);
    expect(c.verdict()).toBe('folder');
  });
  it('a folder of documents → no line', () => {
    const c = makeProgramCheck('docs.zip');
    for (const p of parts(makeZip(['docs/a.pdf', 'docs/b.txt']), 64)) c.see(p);
    expect(c.verdict()).toBe(null);
  });
  it('an ordinary file → no line; nothing seen → no line; never throws', () => {
    const c = makeProgramCheck('report.pdf'); c.see(enc.encode('%PDF-1.7 ...'));
    expect(c.verdict()).toBe(null);
    expect(makeProgramCheck('report.pdf').verdict()).toBe(null);
    const d = makeProgramCheck('x.zip'); d.see(null);
    expect(d.verdict()).toBe(null);
  });
  it('leaves the bytes it is shown untouched', () => {
    const u = enc.encode('#!/bin/sh\n'); const copy = u.slice();
    const c = makeProgramCheck('a'); c.see(u); c.verdict();
    expect(u).toEqual(copy);
  });
  it('copy: one calm line each, no warning words', () => {
    for (const t of Object.values(PROGRAM_NOTE)) {
      expect(t).toMatch(/^This (file is|folder holds) a program\. Open only if you were expecting it\.$/);
      expect(t).not.toMatch(/warning|danger|malware|virus|!/i);
    }
  });
});

// ── Share-MIME-2: the same rule, earlier ────────────────────────────────────
describe('programBeforeDownload (receiver card, name only)', () => {
  it('says program for a program name', () => {
    expect(programBeforeDownload('hello.sh')).toBe(true);
    expect(programBeforeDownload('Setup.EXE')).toBe(true);
  });
  it('says nothing for a document, a folder or no extension', () => {
    expect(programBeforeDownload('hello.txt')).toBe(false);
    expect(programBeforeDownload('fix-it.zip')).toBe(false);   // contents come with the download
    expect(programBeforeDownload('run')).toBe(false);          // bytes unknown before download
  });
});

describe('programOnPick (send card)', () => {
  it('file by name', () => {
    expect(programOnPick({ name: 'hello.sh' })).toBe('file');
  });
  it('file by its first bytes, whatever the name', () => {
    expect(programOnPick({ name: 'notes', head: enc.encode('#!/bin/sh\necho hi\n') })).toBe('file');
    expect(programOnPick({ name: 'photo.jpg', head: bytes(0x7f, 0x45, 0x4c, 0x46) })).toBe('file');
  });
  it('a document says nothing', () => {
    expect(programOnPick({ name: 'hello.txt', head: enc.encode('hello\n') })).toBe(null);
    expect(programOnPick({ name: 'hello.txt' })).toBe(null);
  });
  it('folder by entry names: a script or an .app bundle', () => {
    expect(programOnPick({ name: 'tools.zip', entryNames: ['readme.txt', 'bin/fix.command'] })).toBe('folder');
    expect(programOnPick({ name: 'apps.zip', entryNames: ['Thing.app/Contents/Info.plist'] })).toBe('folder');
  });
  it('folder of documents says nothing, even though the zip itself starts "PK"', () => {
    expect(programOnPick({ name: 'docs.zip', entryNames: ['a.txt', 'b/c.pdf'] })).toBe(null);
    expect(programOnPick({ name: 'docs.zip', entryNames: [] })).toBe(null);
  });
  it('empty or odd input never throws', () => {
    expect(programOnPick()).toBe(null);
    expect(programOnPick({ name: '', head: new Uint8Array(0) })).toBe(null);
  });
  it('reads 4 KiB, as the receiver does', () => {
    expect(PICK_HEAD_BYTES).toBe(4096);
  });
  it('copy: one calm line each, no timing promise, no role word', () => {
    for (const t of Object.values(SEND_NOTE)) {
      expect(t).toMatch(/^This (file is|folder holds) a program\. The link will say so\.$/);
      expect(t).not.toMatch(/before|after|person|receiver|recipient|warning|!/i);
    }
  });
});
