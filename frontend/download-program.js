// ── frontend/download-program.js — "is this a program?" (Share-MIME-1) ───────
// Born Share-MIME-1 (16 Oct 2026). The file-type deny list stays retired (26 Sep lock);
// instead the finished screen says one calm line when the decrypted file is a program.
//
// Browser only: reads the decrypted name and bytes as they pass, never changes them,
// never sends anything anywhere, never blocks the download.
//
// The rule, in order:
//   1. Name: the extension is one a double-click runs (PROGRAM_EXTS)        → 'file'
//   2. Bytes: the first decrypted part starts like a program (Mach-O, PE,
//      ELF, xar installer, a #! script)                                   → 'file'
//   3. A .zip whose list of contents (read from the last decrypted bytes)
//      holds a name from rule 1 or a macOS .app bundle                     → 'folder'
// Anything else, or anything that can't be read, → null (no line).
//
// Share-MIME-2 (16 Oct 2026): the same rule, earlier, on both cards.
//   Receiver card, above Download: rule 1 only (bytes and zip contents aren't known yet).
//   Send card: rules 1–3 on the sender's own plaintext (name, first 4 KiB, folder entries).
// ─────────────────────────────────────────────────────────────────────────────

export const PROGRAM_NOTE = {
  file:   'This file is a program. Open only if you were expecting it.',
  folder: 'This folder holds a program. Open only if you were expecting it.',
};

// Share-MIME-2: the sender's line. "The link will say so" makes no promise about when.
export const SEND_NOTE = {
  file:   'This file is a program. The link will say so.',
  folder: 'This folder holds a program. The link will say so.',
};

// Extensions a double-click (or one tap) runs or installs. .js is left out on purpose:
// too common in developer transfers to say anything useful.
export const PROGRAM_EXTS = new Set([
  // Windows
  'exe', 'msi', 'msix', 'msixbundle', 'appx', 'appxbundle', 'com', 'scr', 'cpl',
  'bat', 'cmd', 'ps1', 'vbs', 'vbe', 'jse', 'wsf', 'wsh', 'hta',
  // macOS
  'app', 'pkg', 'mpkg', 'dmg', 'command', 'tool',
  // Linux and other Unix
  'sh', 'bash', 'zsh', 'csh', 'ksh', 'run', 'appimage', 'deb', 'rpm', 'snap', 'flatpak',
  // Phones
  'apk', 'apks', 'xapk', 'aab', 'ipa',
  // Java: runs with a double-click where Java is installed
  'jar',
]);

const HEAD_BYTES = 4096;                      // the first part's opening bytes kept for rule 2
const TAIL_BYTES = 1024 * 1024 + 65557;       // 1 MiB of zip contents list + the end record and its longest comment

function ext(name) {
  const base = String(name).split(/[\\/]/).pop();
  const dot  = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
}

export function programByName(name) {
  return PROGRAM_EXTS.has(ext(name));
}

// Rule 2. `head` = the first bytes of the decrypted file.
export function programByBytes(head) {
  const b = head;
  if (!b || b.length < 4) return false;
  const u32be = (o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
  const m = u32be(0);
  if (m === 0x7f454c46) return true;                                     // ELF
  if (m === 0xfeedface || m === 0xfeedfacf ||
      m === 0xcefaedfe || m === 0xcffaedfe) return true;                 // Mach-O
  if ((m === 0xcafebabe || m === 0xcafebabf) && b.length >= 8) {         // Mach-O universal —
    const n = u32be(4);                                                  // a Java .class shares the magic,
    if (n >= 1 && n <= 30) return true;                                  // but has a version (≥ 45) there
  }
  if (m === 0x78617221) return true;                                     // "xar!" — .pkg installer
  if (b[0] === 0x23 && b[1] === 0x21) return true;                       // "#!" — a script
  if (b[0] === 0x4d && b[1] === 0x5a && b.length >= 0x40) {              // "MZ" — check for the PE header
    const pe = (b[0x3c] | (b[0x3d] << 8) | (b[0x3e] << 16) | (b[0x3f] << 24)) >>> 0;
    if (pe + 4 <= b.length && b[pe] === 0x50 && b[pe + 1] === 0x45 && b[pe + 2] === 0 && b[pe + 3] === 0) return true;
  }
  return false;
}

// Rule 3. The names in a zip, read from its last bytes (`tail`), or null if the contents
// list isn't all there (a very large folder) or isn't a zip.
export function zipNames(tail) {
  const b = tail;
  if (!b || b.length < 22) return null;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return null;

  let cdSize = dv.getUint32(eocd + 12, true);
  let cdEnd  = eocd;
  if (cdSize === 0xffffffff || dv.getUint16(eocd + 10, true) === 0xffff) {   // Zip64
    const loc = eocd - 20;
    if (loc < 0 || dv.getUint32(loc, true) !== 0x07064b50) return null;
    const rec = loc - 56;
    if (rec < 0 || dv.getUint32(rec, true) !== 0x06064b50) return null;
    const size = Number(dv.getBigUint64(rec + 40, true));
    if (!Number.isSafeInteger(size)) return null;
    cdSize = size;
    cdEnd  = rec;
  }
  const start = cdEnd - cdSize;
  if (start < 0) return null;

  const names = [];
  const dec   = new TextDecoder();
  let p = start;
  while (p + 46 <= cdEnd) {
    if (dv.getUint32(p, true) !== 0x02014b50) return null;
    const nLen = dv.getUint16(p + 28, true);
    const xLen = dv.getUint16(p + 30, true);
    const cLen = dv.getUint16(p + 32, true);
    if (p + 46 + nLen > cdEnd) return null;
    names.push(dec.decode(b.subarray(p + 46, p + 46 + nLen)));
    p += 46 + nLen + xLen + cLen;
  }
  return names;
}

export function zipHoldsProgram(names) {
  return names.some((n) =>
    programByName(n.replace(/\/+$/, '')) ||
    n.split('/').some((seg) => seg.toLowerCase().endsWith('.app') && seg.length > 4));
}

// Share-MIME-2, receiver card: what the page knows before Download is the name.
// A .zip never matches (its contents come with the download).
export function programBeforeDownload(fileName) {
  return programByName(fileName);
}

// Share-MIME-2, send card. `name` = the picked file's name, `head` = its first bytes,
// `entryNames` = a folder's entry paths (null for a single file). 'file' | 'folder' | null.
export function programOnPick({ name, head = null, entryNames = null } = {}) {
  try {
    if (entryNames) return zipHoldsProgram(entryNames) ? 'folder' : null;
    if (programByName(name) || programByBytes(head)) return 'file';
  } catch {}
  return null;
}

export const PICK_HEAD_BYTES = HEAD_BYTES;

// Watches decrypted parts go by, in order, and keeps only what the rule needs:
// the first HEAD_BYTES, and (for a .zip) the last TAIL_BYTES for the contents list.
// see() never throws and never touches the bytes it is shown.
export function makeProgramCheck(fileName) {
  const isZip = ext(fileName) === 'zip';
  let head = null;
  const recent = [];          // the newest parts, just enough of them to cover TAIL_BYTES
  let recentBytes = 0;
  return {
    see(plain) {
      try {
        const u = plain instanceof Uint8Array ? plain : new Uint8Array(plain);
        if (!head) head = u.slice(0, HEAD_BYTES);
        if (isZip) {
          recent.push(u); recentBytes += u.length;
          while (recent.length > 1 && recentBytes - recent[0].length >= TAIL_BYTES) recentBytes -= recent.shift().length;
        }
      } catch {}
    },
    // 'file' | 'folder' | null
    verdict() {
      try {
        if (programByName(fileName)) return 'file';
        if (programByBytes(head))    return 'file';
        if (isZip && recentBytes) {
          const n    = Math.min(recentBytes, TAIL_BYTES);
          const tail = new Uint8Array(n);
          let p = n;
          for (let i = recent.length - 1; i >= 0 && p > 0; i--) {
            const u = recent[i], take = Math.min(u.length, p);
            tail.set(u.subarray(u.length - take), p - take);
            p -= take;
          }
          const names = zipNames(tail);
          if (names && zipHoldsProgram(names)) return 'folder';
        }
      } catch {}
      return null;
    },
  };
}
