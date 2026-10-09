// ── frontend/upload-start.js — a new transfer: key, upload pass, /initiate ───
// Moved out of upload.js at Share-JS-Split-2 (9 Oct 2026). No behaviour change.
// ─────────────────────────────────────────────────────────────────────────────

import { sha256Hex, generateBlindedCredential, unblindSignature, CredentialProofError, bufToHex,
         blake3CreateHash } from './crypto.js';
import { WORKER_URL, CHUNK_SIZE, FREE_EXPIRY } from './config.js';
import { generateSealNonce } from './timestamp.js';
import { SCHEME } from './upload-store.js';
import { UploadStop, _loadDepsOrSay } from './upload-stop.js';
import { _send } from './upload-net.js';
import { UPLOAD_LABEL, _spendTurnstileToken } from './upload-turnstile.js';
import { _updatePaidFeaturesVisibility, _pickerToUnix, _validateTidal, _showTidalError } from './upload-options.js';
import { _carryOn, _stopped } from './upload-send.js';

export async function startUpload(domRefs, state, helpers, transferOpts) {
  if (!state.selectedFile) return;
  let job = null;
  try {
    job = await _setUp(domRefs, state, helpers, transferOpts);
    if (job) await _carryOn(job, domRefs, state, helpers);
  } catch (e) {
    _stopped(e, job, domRefs, state, helpers);
  }
}

// Fresh upload: key, upload pass, /initiate. Returns the job, or null when it has
// already said why it stopped (deps, a bad pass, the paid-only window).
async function _setUp(domRefs, state, helpers, transferOpts) {
  const { uploadBtn, passphraseToggle, passphraseInput } = domRefs;
  const { setStage, setProgress, formatBytes, reportError, showStopped } = helpers;
  const file = state.selectedFile;

  uploadBtn.disabled = true;
  uploadBtn.textContent = UPLOAD_LABEL;
  helpers.setView('uploading');
  setProgress(0, 'Getting an upload pass…');   // Share-Progress-1: say each setup step (option A)

  if (!(await _loadDepsOrSay(domRefs, helpers))) return null;

  // Stage words (build list §1): Preparing · Encrypting and uploading · Finishing.
  setStage('Preparing');
  const aesKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  const keyHex = bufToHex(await crypto.subtle.exportKey('raw', aesKey));   // K: the transfer key in the link

  // The password stays in its field until the link is ready, so a Try again
  // before /initiate can use it again (cleared in _carryOn on success).
  let p2shHashHex = null;
  if (passphraseToggle.checked && passphraseInput.value.trim()) {
    p2shHashHex = await sha256Hex(new TextEncoder().encode(passphraseInput.value.trim()));
  }

  const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
  const blinded = await generateBlindedCredential();

  let issueRes;
  try {
    issueRes = await _send(`${WORKER_URL}/credential/issue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ turnstile_token: state.turnstileToken, blinded_message: blinded.blindedMsg, tier: 'free' }),
    }, 'credential_issue', reportError);
  } finally {
    _spendTurnstileToken(state, domRefs, helpers);   // single-use, whatever the outcome
  }

  if (!issueRes.ok) {
    const errText = await issueRes.text().catch(() => '');
    reportError('credential_issue', `HTTP ${issueRes.status}`, errText.slice(0, 200));
    // 400 no token · 403 check failed · 429 token already used → the check; else refused.
    const check = issueRes.status === 400 || issueRes.status === 403 || (issueRes.status === 429 && /turnstile/i.test(errText));
    throw new UploadStop(check ? 'check' : 'refused', `Credential issue failed: HTTP ${issueRes.status}`);
  }
  const issued = await issueRes.json();
  const { uuid: issuedUuid, issued_tier: issuedTier, commitment } = issued;
  if (!issuedUuid || !commitment || !issuedTier) throw new UploadStop('refused', 'Credential issue response missing uuid, commitment, or issued_tier');
  // Cred-Fix-2b: credential format v2. A bad DLEQ proof stops here, before anything is spent.
  let credential;
  try {
    credential = await unblindSignature(issued, blinded);
  } catch (e) {
    if (!(e instanceof CredentialProofError)) throw e;
    reportError('credential_dleq', e.name, String(e.message).slice(0, 120));
    showStopped('Share couldn’t get a valid upload pass. Reload to try again.');
    return null;
  }

  _updatePaidFeaturesVisibility(issuedTier, transferOpts);

  const expiryTimestamp = Math.floor(Date.now() / 1000) + FREE_EXPIRY;

  const destroyAfterDownload = transferOpts.destroyToggle && transferOpts.destroyToggle.checked ? '1' : null;
  const availableFromUnix    = _pickerToUnix(transferOpts.availableFrom);
  const availableUntilUnix   = _pickerToUnix(transferOpts.availableUntil);

  const tidalErr = _validateTidal(availableFromUnix, availableUntilUnix, expiryTimestamp);
  if (tidalErr) {
    _showTidalError(tidalErr, transferOpts);
    uploadBtn.disabled = false;
    helpers.setView('chosen');
    return null;
  }

  const isPaidTier = issuedTier && issuedTier !== 'free' && issuedTier !== 'citizen';
  const wantsPermanentRecord = isPaidTier && transferOpts.permanentRecordToggle && transferOpts.permanentRecordToggle.checked;
  const sealNonceHex = wantsPermanentRecord ? generateSealNonce() : null;

  // ── Direct-to-R2 upload path (Share-6-6b: only path) ─────────────────────
  // handleInitiate reads headers, not JSON body — matches legacy chunk-0 header schema.
  const initiateHeaders = {
    'X-Cashu-Credential':      credential,
    'X-Credential-Commitment': commitment,
    'X-Issued-Tier':           issuedTier,
    'X-Total-Chunks':          String(totalChunks),
    'X-Total-Bytes':           String(file.size),
    'X-Expiry-Timestamp':      String(expiryTimestamp),
    'X-File-Name':             'encrypted-payload', // D-1 invariant
  };
  if (p2shHashHex)          initiateHeaders['X-P2SH-Secret-Hash']       = p2shHashHex;
  if (destroyAfterDownload) initiateHeaders['X-Destroy-After-Download'] = '1';
  if (availableFromUnix)    initiateHeaders['X-Available-From']         = String(availableFromUnix);
  if (availableUntilUnix)   initiateHeaders['X-Available-Until']        = String(availableUntilUnix);

  setProgress(0, 'Setting up the transfer…');
  const initRes = await _send(`${WORKER_URL}/upload/${issuedUuid}/initiate`, {
    method: 'POST',
    headers: initiateHeaders,
  }, 'initiate', reportError);
  if (!initRes.ok) {
    const txt = await initRes.text().catch(() => '');
    reportError('initiate', `HTTP ${initRes.status}`, txt.slice(0, 200));
    throw new UploadStop('refused', `Initiate failed: HTTP ${initRes.status} — ${txt.slice(0, 120)}`);
  }
  const initData = await initRes.json();

  // URL map: index → presigned URL. First batch arrives in initiate response.
  const urlMap = new Map();
  for (const entry of (initData.urls || [])) urlMap.set(entry.index, entry.url);

  // B12-1c: a size-signing Worker returns the tail URL separately (tail_url) and
  // /urls never covers index N−1. An older Worker has no tail_url → unchanged.
  let tailUrl = null;
  if (initData.tail_url) {
    if (initData.tail_url.index !== totalChunks - 1) {
      throw new UploadStop('refused', `tail_url index ${initData.tail_url.index} ≠ ${totalChunks - 1}`);
    }
    tailUrl = { url: initData.tail_url.url, expires: initData.tail_url.expires };
  }

  return {
    file, uuid: issuedUuid, keyHex, scheme: SCHEME, totalChunks, expiryTimestamp,
    tier: issuedTier, sessionToken: initData.session_token, tailUrl,
    sealNonceHex, sourceType: state.sourceType || 'file',
    folder: state.sourceType === 'folder' ? state.folder : null,   // Share-Folder-Resume-1
    sent: 0, hashes: [], urlMap,
    // Streaming BLAKE3 plaintext root, fed after each part arrives (TH-2; paid only, F-10)
    plainHash: wantsPermanentRecord ? blake3CreateHash() : null,
    info: {
      fileName: file.name, isFolder: state.sourceType === 'folder',
      sizeBytes: file.size, expiryTimestamp,
      isProtected: !!p2shHashHex, destroyAfterDownload: !!destroyAfterDownload,
    },
  };
}
