// ── frontend/upload-store.js — the IndexedDB resume record ───────────────────
// Moved out of upload.js at Share-JS-Split-2 (9 Oct 2026). No behaviour change.
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// IndexedDB — chunk resume state (RU1)
//
// Schema: DB = 'refueler-share-resume', store = 'transfers', keyPath = 'uuid'
// One record per interrupted transfer. Overwritten on each 200 ACK.
// Cleared on discard or successful completion.
//
// Record shape (TH-2: added sealNonceHex — additive, no schema bump required):
// { uuid, chunkIndex, totalChunks, fileName, fileSize, keyHex, ivHex,
//   tier, expiryTimestamp, timestamp, sealNonceHex }
// Share-6 added uploadMode, sessionToken, sourceType. B12-1c added tailUrl
// { url, expires } — the size-signed tail URL, issued only at /initiate.
// Share-Upload-6 added hashes, fileModified. Share-Crypto-1 added scheme: 2 (part
// key schedule, link format v2) and dropped ivHex; a record without scheme 2 is
// discarded, never resumed. Share-Folder-Resume-1 added folder { name, files, list,
// local } (zip.js folderPrint) on folder uploads; a folder record without it is discarded.
// ─────────────────────────────────────────────────────────────────────────────
const IDB_NAME    = 'refueler-share-resume';
const IDB_STORE   = 'transfers';
const IDB_VERSION = 1;

function idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE, { keyPath: 'uuid' });
      }
    };
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = e => reject(e.target.error);
  });
}

export async function writeChunkState(record, reportError) {
  try {
    const db = await idbOpen();
    await new Promise((resolve, reject) => {
      const tx  = db.transaction(IDB_STORE, 'readwrite');
      const req = tx.objectStore(IDB_STORE).put(record);
      req.onsuccess = resolve;
      req.onerror   = e => reject(e.target.error);
      tx.oncomplete = resolve;
    });
    db.close();
  } catch (e) {
    reportError('idb_write', e.message, record.uuid?.slice(0, 8) ?? '');
  }
}

export async function readResumeState() {
  try {
    const db = await idbOpen();
    const record = await new Promise((resolve, reject) => {
      const tx  = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).openCursor();
      req.onsuccess = e => resolve(e.target.result ? e.target.result.value : null);
      req.onerror   = e => reject(e.target.error);
    });
    db.close();
    return record;
  } catch {
    return null;
  }
}

export async function clearResumeState(uuid, reportError) {
  try {
    const db = await idbOpen();
    await new Promise((resolve, reject) => {
      const tx  = db.transaction(IDB_STORE, 'readwrite');
      const req = tx.objectStore(IDB_STORE).delete(uuid);
      req.onsuccess = resolve;
      req.onerror   = e => reject(e.target.error);
      tx.oncomplete = resolve;
    });
    db.close();
  } catch (e) {
    reportError('idb_clear', e.message, uuid?.slice(0, 8) ?? '');
  }
}

export const SCHEME = 2;   // part key schedule + link format v2 (crypto.js, fragment.js)

// The IndexedDB resume record for a job (chunkIndex = last part that arrived).
export function _recordOf(job) {
  return {
    uuid: job.uuid, chunkIndex: job.sent - 1, totalChunks: job.totalChunks,
    fileName: job.file.name, fileSize: job.file.size,
    keyHex: job.keyHex, scheme: job.scheme, tier: job.tier || 'free',
    expiryTimestamp: job.expiryTimestamp, timestamp: Date.now(),
    sealNonceHex: job.sealNonceHex || undefined,
    uploadMode: 'direct-r2', sessionToken: job.sessionToken, // Share-6: resume needs these
    tailUrl: job.tailUrl || undefined,                       // B12-1c: /urls cannot re-issue the tail
    sourceType: job.sourceType,
    folder: job.folder || undefined,                         // Share-Folder-Resume-1: { name, files, list, local }
    hashes: job.hashes.slice(0, job.sent),                   // Share-Upload-6: sent parts' ciphertext hashes (resume skips re-encrypting)
    fileModified: job.file.lastModified,                     // …trusted only while the chosen file is unchanged
  };
}
