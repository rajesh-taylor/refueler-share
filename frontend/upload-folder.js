// ── frontend/upload-folder.js — reading and zipping a folder ─────────────────
// Moved out of upload.js at Share-JS-Split-2 (9 Oct 2026). No behaviour change.
// ─────────────────────────────────────────────────────────────────────────────

import { zipFolder, zipSize, folderPrint } from './zip.js';

// ─────────────────────────────────────────────────────────────────────────────
// Folder helpers
// ─────────────────────────────────────────────────────────────────────────────
const FOLDER_MAX_DEPTH  = 20;
const FOLDER_WARN_FILES = 500;
export const FOLDER_MAX_FILES  = 2000;
const IOS_LOCAL_ROOT    = 'File Provider Storage';
const FOLDER_ZIP_CAP    = 2 * 1024 ** 3; // 2 GiB — folder zips are held in RAM during upload (Share-6-spec §7)

function sanitiseSegment(seg) {
  // eslint-disable-next-line no-control-regex
  let s = seg.replace(/[\x00-\x1F\x7F\u202A-\u202E\u2066-\u2069]/g, '');
  const enc = new TextEncoder();
  let bytes = enc.encode(s);
  if (bytes.length > 200) {
    bytes = bytes.slice(0, 200);
    s = new TextDecoder('utf-8', { fatal: false }).decode(bytes).replace(/\uFFFD$/, '');
  }
  return s;
}

function sanitisePath(rel) {
  return rel.split('/')
    .map(sanitiseSegment)
    .filter(s => s.length > 0 && s !== '..' && s !== '.')
    .join('/');
}

export async function readDirectoryEntry(dirEntry, pathPrefix, depth) {
  const prefix    = pathPrefix || '';
  const currDepth = depth      || 0;
  const results   = [];

  if (currDepth > FOLDER_MAX_DEPTH) {
    throw new Error(`Folder is nested more than ${FOLDER_MAX_DEPTH} levels deep. Please zip it manually first.`);
  }

  await new Promise((resolve, reject) => {
    const reader = dirEntry.createReader();
    function readBatch() {
      reader.readEntries(async entries => {
        if (entries.length === 0) { resolve(); return; }
        for (const entry of entries) {
          if (entry.isFile) {
            const file = await new Promise((res, rej) => entry.file(res, rej));
            const rel  = prefix ? `${prefix}/${entry.name}` : entry.name;
            const safe = sanitisePath(rel);
            if (safe) results.push({ relativePath: safe, file });
          } else if (entry.isDirectory) {
            const subPrefix = prefix ? `${prefix}/${entry.name}` : entry.name;
            try {
              const subResults = await readDirectoryEntry(entry, subPrefix, currDepth + 1);
              results.push(...subResults);
            } catch (e) { reject(e); return; }
          }
        }
        readBatch();
      }, reject);
    }
    readBatch();
  });

  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// Zip streaming (fflate) — the zip itself is zip.js zipFolder (store-only,
// path order, each file's own date: the same folder zips to the same bytes).
// ─────────────────────────────────────────────────────────────────────────────
// Returns the folder's resume print ({ name, files, list, local }), or null when
// it stopped and has said why.
export async function zipAndSelect(entries, folderName, domRefs, helpers) {
  const { showZipStage, hideZipCard, handleFileSelection, formatBytes, setDropMsg, reportError } = helpers;
  const zipName  = `${folderName}.zip`;
  const totalBytes = entries.reduce((acc, e) => acc + (e.file.size || 0), 0);

  // RAM guard (Share-6-spec §7): the zip is held in memory, so refuse BEFORE the
  // read loop. Checked once, on the zip's exact size (files + headers), so the
  // "zip it yourself" copy shows before any zipping starts.
  const zipBytes = zipSize(entries);
  if (zipBytes > FOLDER_ZIP_CAP) {
    hideZipCard();
    helpers.resetRows(); helpers.setView('empty');
    setDropMsg(_folderTooBig(zipBytes, formatBytes));
    return null;
  }

  showZipStage('Zipping', 0, `0 B of ${formatBytes(totalBytes)}`);

  let zipBlob = null, print = null;
  try {
    print = await folderPrint(entries);
    zipBlob = await zipFolder(entries, (done) => {
      showZipStage('Zipping', Math.min(Math.round((done / totalBytes) * 95), 95), `${formatBytes(done)} of ${formatBytes(totalBytes)}`);
    });
  } catch (err) {
    reportError('folder_zip', err?.message || 'fflate error', folderName.slice(0, 100));
    hideZipCard();
    helpers.resetRows(); helpers.setView('empty');
    setDropMsg('Zipping the folder didn’t work. Try again, or zip it yourself and send the .zip as a file.');
    return null;
  }

  showZipStage('Zipping', 100, `${formatBytes(totalBytes)} of ${formatBytes(totalBytes)}`);
  await new Promise(r => setTimeout(r, 300));
  hideZipCard();

  const zipFile = new File([zipBlob], zipName, { type: 'application/zip' });
  handleFileSelection(zipFile, entries.length);
  return { name: folderName, ...print };
}

// Build list §1: folders over the 2 GB in-memory cap (Share-6-spec §7).
function _folderTooBig(bytes, formatBytes) {
  return `This folder is ${formatBytes(bytes)}. Folders can be up to 2 GB. Zip it yourself and send the .zip as a file (free up to 4 GB).`;
}

export function _folderTooMany(n) {
  return `This folder has ${n.toLocaleString()} files. Folders can have up to ${FOLDER_MAX_FILES.toLocaleString()}. Zip it yourself and send the .zip as a file.`;
}

// A folder picker's files → the folder's name and its zip entries (paths without the root).
export function _folderEntries(fileList) {
  const firstPath = fileList[0].webkitRelativePath || fileList[0].name;
  const rootName  = firstPath.includes('/') ? firstPath.split('/')[0] : 'folder';
  // iOS picker: "Open" at the top of On My iPhone reports that root as
  // "File Provider Storage". Name only — entry paths drop the root, so bytes are unchanged.
  const folderName = rootName === IOS_LOCAL_ROOT ? 'On My iPhone' : rootName;
  const entries = fileList.map(f => {
    const rel      = f.webkitRelativePath || f.name;
    const stripped = rel.includes('/') ? rel.slice(rel.indexOf('/') + 1) : rel;
    return { relativePath: sanitisePath(stripped), file: f };
  }).filter(e => e.relativePath.length > 0);
  return { folderName, entries };
}
