// ── frontend/upload-options.js — delete-after-download, tidal window, permanent record ───
// Moved out of upload.js at Share-JS-Split-2 (9 Oct 2026). No behaviour change.
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Tidal + permanent-record option injection
// ─────────────────────────────────────────────────────────────────────────────
// H8 Trusted-Types-1: markup is built with DOM calls, never innerHTML (CSP require-trusted-types-for).
// el('div', { className: 'x', id: 'y', role: 'alert' }, 'text', childEl) — role goes in as an attribute.
function el(tag, props, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'role') n.setAttribute('role', v); else n[k] = v;
  }
  n.append(...children);
  return n;
}

export function _injectTransferOptions(domRefs, transferOpts) {
  // 1–2. Delete after download: static markup since Share-Upload-2 (ids kept).
  transferOpts.destroyToggle = domRefs.destroyToggle;
  transferOpts.destroyNotice = domRefs.destroyNotice;
  transferOpts.destroyToggle.addEventListener('change', () => {
    transferOpts.destroyNotice.hidden = !transferOpts.destroyToggle.checked;
  });

  // 3–5. Paid only and unreachable today (F-10): injected into #paid-options, which stays hidden.
  const paid = domRefs.paidOptions;
  if (!paid) return;

  // 3. Tidal window
  const tidal = document.createElement('div');
  tidal.id = 'tidal-window-section';
  tidal.className = 'tidal-window hidden';
  tidal.setAttribute('aria-label', 'Transfer availability window');
  tidal.append(
    el('div', { className: 'tidal-heading' },
      el('div', { className: 'toggle-label' }, 'Availability window'),
      el('div', { className: 'toggle-desc' }, 'Optionally restrict when this transfer can be downloaded')),
    el('div', { className: 'tidal-pickers' },
      el('div', { className: 'tidal-field' },
        el('label', { htmlFor: 'available-from', className: 'tidal-label' }, 'Available from'),
        el('input', { type: 'datetime-local', id: 'available-from', className: 'tidal-input' })),
      el('div', { className: 'tidal-field' },
        el('label', { htmlFor: 'available-until', className: 'tidal-label', id: 'available-until-label' }, 'Available until'),
        el('input', { type: 'datetime-local', id: 'available-until', className: 'tidal-input' }))),
    el('div', { id: 'tidal-error', className: 'tidal-error hidden', role: 'alert' }));
  paid.appendChild(tidal);
  transferOpts.tidalSection   = document.getElementById('tidal-window-section');
  transferOpts.availableFrom  = document.getElementById('available-from');
  transferOpts.availableUntil = document.getElementById('available-until');
  transferOpts.tidalError     = document.getElementById('tidal-error');

  function _setPickerMin() {
    const nowMs  = Date.now();
    const nowMin = new Date(nowMs - (nowMs % 60000));
    const iso    = nowMin.toISOString().slice(0, 16);
    transferOpts.availableFrom.min  = iso;
    transferOpts.availableUntil.min = iso;
  }
  _setPickerMin();
  transferOpts.availableFrom.addEventListener('focus', _setPickerMin);
  transferOpts.availableUntil.addEventListener('focus', _setPickerMin);
  transferOpts.availableFrom.addEventListener('change', () => _clearTidalError(transferOpts));
  transferOpts.availableUntil.addEventListener('change', () => _clearTidalError(transferOpts));

  // 4. Permanent-record toggle (TH-2)
  const permanentRow = document.createElement('div');
  permanentRow.className = 'mt16 hidden';
  permanentRow.id = 'permanent-record-row';
  permanentRow.append(
    el('div', { className: 'toggle-row' },
      el('div', {},
        el('div', { className: 'toggle-label' }, 'Permanent record'),
        el('div', { className: 'toggle-desc' }, 'A Bitcoin-anchored date stamp is added to this transfer')),
      el('label', { className: 'switch' },
        el('input', { type: 'checkbox', id: 'permanent-record-toggle' }),
        el('span', { className: 'slider' }))));
  tidal.insertAdjacentElement('afterend', permanentRow);
  transferOpts.permanentRecordToggle = document.getElementById('permanent-record-toggle');

  // 5. Amber permanent-record notice (TH-2)
  const prNotice = document.createElement('div');
  prNotice.id = 'permanent-record-notice';
  prNotice.className = 'destroy-notice hidden';
  // Wording unchanged (H8); "unforgeable" / "proves" go at OSA-Copy-1.
  prNotice.append(el('strong', {}, 'This creates an unforgeable record that this file existed.'),
    ' The stamp is public — it proves when, not who.');
  permanentRow.insertAdjacentElement('afterend', prNotice);
  transferOpts.permanentRecordNotice = prNotice;

  transferOpts.permanentRecordToggle.addEventListener('change', () => {
    prNotice.classList.toggle('hidden', !transferOpts.permanentRecordToggle.checked);
  });
}

export function _updatePaidFeaturesVisibility(tier, transferOpts) {
  const isPaid = tier && tier !== 'free' && tier !== 'citizen';
  if (transferOpts.tidalSection) transferOpts.tidalSection.classList.toggle('hidden', !isPaid);
  const permanentRow = document.getElementById('permanent-record-row');
  if (permanentRow) permanentRow.classList.toggle('hidden', !isPaid);
}

export function _pickerToUnix(input) {
  if (!input || !input.value) return null;
  return Math.floor(new Date(input.value).getTime() / 1000);
}

export function _validateTidal(fromUnix, untilUnix, expiryTimestamp) {
  if (fromUnix !== null && untilUnix !== null && fromUnix > untilUnix) {
    return '"Available from" must be before "Available until".';
  }
  if (untilUnix !== null && untilUnix > expiryTimestamp) {
    return '"Available until" cannot be after the transfer expiry date.';
  }
  if (fromUnix !== null && fromUnix > expiryTimestamp) {
    return '"Available from" cannot be after the transfer expiry date.';
  }
  return null;
}

export function _showTidalError(msg, transferOpts) {
  if (!transferOpts.tidalError) return;
  transferOpts.tidalError.textContent = msg;
  transferOpts.tidalError.classList.remove('hidden');
}

function _clearTidalError(transferOpts) {
  if (!transferOpts.tidalError) return;
  transferOpts.tidalError.textContent = '';
  transferOpts.tidalError.classList.add('hidden');
}
