/* ─── reports-view.js — Navy Office → Reports (OSA-Tools-3 · 22 Oct 2026; route order OSA-Tools-4 · 23 Oct 2026) ─────
 * The report route's staff tools, one case at a time, in route order, one column:
 *   Find the link (look it up; continue its open case, or "the report has no link") · Open the case ·
 *   Acknowledgement · Take down · Close · Outcome — then the case record (print / Save as PDF), the
 *   appeal reply and "Start a new case". CSEA and terrorism: take down before the acknowledgement.
 * One step is open at a time (gold rule, the cursor in it); a finished step shrinks to one line.
 * No motion. Why: in the OSA-Tools-3 live run the tools sat side by side and the way through
 * them got lost; this is the route itself.
 * Design: private docs/OSA-Tools-plan-v1.md §7. Worker answers: refueler-share
 * worker/src/handlers/reports.js. Terminal twins: private strategy/osa/tools/.
 *
 * Rules:
 *   • a pasted link is cut at the # before anything else runs, so the key part after the #
 *     is never in a field, a request, storage or this page
 *   • the transfer ID (UUID) travels only in X-Transfer-UUID; the register keeps uuid8 only. The
 *     page keeps the full transfer ID of a case in memory only (never sessionStorage), to fill the
 *     templates and the look-up
 *   • what the register doesn't record (template A / B sent, "not taking it down") is kept for this
 *     tab only in sessionStorage, by case reference and time — nothing else
 *   • admin and helper keys both reach this section; the Worker enforces the helper's limits
 *     (CSEA/terrorism cases only, no export) — the page explains them, it doesn't decide them
 *   • the case record holds no email, no full transfer ID and no key part (the register has none)
 *   • strict CSP, as navy-office.js: no inline handlers, no style=; every Worker value in an
 *     HTML string passes esc(); times in London time
 * ─────────────────────────────────────────────────────────────────────────── */
'use strict';

const NavyReports = (() => {
  const S = {
    worker: '', key: '', role: '', rows: [], selected: null, look: null,
    links: {},       // case_ref → full transfer ID, memory only (from New report or a look-up)
    tookDown: null,  // { case_ref, at, recorded } — the last take-down from this page
    prefilled: {},   // case_ref → true once the Close form was pre-set from the facts
    focus: '',       // `${case_ref}:${step}` — the cursor moves only when the step changes
    tplHere: null,   // 'finish' when the replies were opened under a closed case
    draft: null,     // { uuid } (or { uuid: null }, no link) while the Open the case form is up
  };

  // ── Fixed choices (the database's lists; register.sh offers the same) ─────
  const CATEGORY = {
    csea: 'CSEA — child sexual abuse', terrorism: 'Terrorism', iia: 'Intimate image abuse',
    extreme_porn: 'Extreme pornography', fraud: 'Fraud', other_illegal: 'Other illegal content',
    terms: 'Breaks our terms', complaint: 'Complaint', appeal: 'Appeal', no_link: 'No link given',
  };
  const ROUTE    = { 'report@': 'report@', 'support@': 'support@', 'privacy@': 'privacy@', signal: 'Signal', other: 'Other' };
  // "Nothing to act on" is the everyday word; the legal term stays beside it (Rajesh, 23 Oct).
  const DECISION = { open: 'Open', removed: 'Removed', not_removed: 'Not removed', already_gone: 'Already gone', manifestly_unfounded: 'Nothing to act on (manifestly unfounded)' };
  const DECISION_SHORT = { manifestly_unfounded: 'Nothing to act on' };
  const TOLD     = { y: 'Yes', n: 'No', no_contact: 'No contact given' };
  const TIER     = { free: 'Pro Bono', citizen: 'Citizen', api: 'Chartered (API)' };
  const short = (c) => (CATEGORY[c] ?? c).split(' — ')[0];
  const HELPER_CATEGORIES = ['csea', 'terrorism'];
  const ONLY_RAJESH = 'Only Rajesh can take this down. It can wait for him.';
  const ONLY_8 = 'That’s only the first 8 characters. Paste the whole link.';

  const UUID_RE = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
  const UUID8_RE = /^[0-9a-f]{8}$/i;
  const FORBIDDEN = /@|#|http/i;
  const SHARE = 'https://share.refueler.io/?uuid=';

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const say = (id, text) => { $(id).textContent = text ?? ''; };
  const now = () => Math.floor(Date.now() / 1000);

  // ── London time ───────────────────────────────────────────────────────────
  const fmt = (opts) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour12: false, ...opts });
  const F_FULL  = fmt({ weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const F_SHORT = fmt({ day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const F_CLOCK = fmt({ hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const F_DAY   = fmt({ day: 'numeric', month: 'short', year: 'numeric' });
  const F_LONG  = fmt({ day: 'numeric', month: 'long', year: 'numeric' });
  const t = (f, s) => (Number.isFinite(s) && s > 0 ? f.format(new Date(s * 1000)) : '—');

  // ── The # cut ─────────────────────────────────────────────────────────────
  // Paste and drop are taken over: only the part before the # is ever put in the field.
  // Typing a # cuts the field there, and what is typed after it at the end is not taken until the
  // field is edited another way (so a typed key part never lands in it); an autofill is cut on input.
  function cutAtHash(s) { const i = s.indexOf('#'); return (i < 0 ? s : s.slice(0, i)).trim(); }
  function guard(input, after) {
    let sealed = null;   // the field's value when a typed # cut it; any other value (cleared, changed) unseals
    const put = (text) => { input.value = cutAtHash(text); sealed = null; after?.(); };
    input.addEventListener('paste', (e) => { e.preventDefault(); put(e.clipboardData?.getData('text') ?? ''); });
    input.addEventListener('drop', (e) => { e.preventDefault(); put(e.dataTransfer?.getData('text/plain') ?? ''); });
    input.addEventListener('beforeinput', (e) => {
      if (sealed !== null && input.value !== sealed) sealed = null;
      if (!e.inputType.startsWith('insert')) { sealed = null; return; }
      if (input.selectionStart !== input.value.length || input.selectionEnd !== input.value.length) sealed = null;
      if (sealed !== null) { e.preventDefault(); return; }
      if (e.data?.includes('#')) {
        e.preventDefault();
        input.value = cutAtHash(input.value.slice(0, input.selectionStart) + e.data);
        sealed = input.value;
      }
    });
    input.addEventListener('input', () => { if (input.value.includes('#')) input.value = cutAtHash(input.value); });
  }
  const uuidIn = (s) => (UUID_RE.exec(cutAtHash(s)) ?? [])[1]?.toLowerCase() ?? null;

  // ── What the register doesn't record, for this tab only ───────────────────
  // { case_ref: { a: unix | 'none', b: unix | 'none', skip: unix } }
  const MARKS_KEY = 'rp-marks';
  let marks = {};
  try { marks = JSON.parse(sessionStorage.getItem(MARKS_KEY) ?? '{}') ?? {}; } catch { marks = {}; }
  const markOf = (ref) => marks[ref] ?? {};
  function mark(ref, k, v) {
    marks[ref] = { ...markOf(ref), [k]: v };
    try { sessionStorage.setItem(MARKS_KEY, JSON.stringify(marks)); } catch { /* this tab only; fine */ }
  }

  // ── Worker ────────────────────────────────────────────────────────────────
  async function api(method, route, { uuid, body } = {}) {
    const headers = { 'X-Admin-Key': S.key };
    if (uuid) headers['X-Transfer-UUID'] = uuid;
    if (body) headers['Content-Type'] = 'application/json';
    try {
      const res = await fetch(`${S.worker}${route}`, { method, headers, cache: 'no-store', body: body ? JSON.stringify(body) : undefined });
      let data = {};
      try { data = await res.json(); } catch { /* not JSON */ }
      return { status: res.status, data };
    } catch { return { status: 0, data: {} }; }
  }
  // The answers every route can give (the scripts' common_error, in the same words).
  function common(status) {
    if (status === 0)   return 'Could not reach Share (network, or Mullvad?). Nothing was done.';
    if (status === 401) return 'The key was not accepted (or it is not allowed to do this). Nothing was done.';
    if (status === 429) return 'Too many requests. Wait a minute and try again. Nothing was done.';
    if (status === 503) return 'The register is not answering. Try again in a few minutes. Nothing was done.';
    if (status >= 500)  return `Share answered with an error (${status}). Nothing was done; try again shortly.`;
    return null;
  }
  const REFUSAL = {
    reason_forbidden:       'The register refused it: no email addresses, # or links in the reason. Nothing was saved.',
    refused_by_database:    'The register refused it: one of its checks failed (no email addresses, # or links; an NCA reference is letters, digits and - only). Nothing was saved.',
    bad_reason:             'The reason is too long (500 characters at most). Nothing was saved.',
    bad_nca_ref:            'An NCA reference is letters, digits and - only. Nothing was saved.',
    bad_uuid8:              'That is not a Share link or transfer ID (UUID). Nothing was saved.',
    helper_category:        'Only Rajesh can change this case. It can wait for him.',
    helper_category_change: 'Only Rajesh can change a category.',
    not_found:              'No such case in the register.',
  };
  const refusal = (r) => common(r.status) ?? REFUSAL[r.data.error] ?? `The register refused it (${r.data.error ?? r.status}). Nothing was saved.`;

  // ── Register (step 1's list) ──────────────────────────────────────────────
  async function loadRegister() {
    const r = await api('GET', '/admin/reports/register');
    if (r.status !== 200) {
      say('rp-register-msg', common(r.status) ?? `Unexpected answer (${r.status}).`);
      return false;
    }
    S.rows = Array.isArray(r.data.rows) ? r.data.rows : [];
    if (S.selected && !S.rows.some((c) => c.case_ref === S.selected)) S.selected = null;   // training rows deleted
    renderRegister();
    route();
    return true;
  }

  function renderRegister() {
    const tb = $('rp-tbody');
    if (!S.rows.length) { tb.innerHTML = '<tr><td colspan="6" class="dock-empty">The register is empty.</td></tr>'; return; }
    tb.innerHTML = S.rows.map((r) => {
      const td = r.takedown_at ? `${esc(t(F_SHORT, r.takedown_at))} · ${esc(r.takedown_by ?? '')}` : '—';
      return `<tr data-case="${esc(r.case_ref)}" tabindex="0">
        <td class="dock-uuid">${esc(r.case_ref)}${r.training ? ' <span class="rp-tag">TRAINING DRILL</span>' : ''}</td>
        <td class="rp-col-rec">${esc(t(F_SHORT, r.received_at))}</td>
        <td class="rp-col-cat">${esc(short(r.category))}</td>
        <td>${esc(r.uuid8 ?? '—')}</td>
        <td>${esc(DECISION_SHORT[r.decision] ?? DECISION[r.decision] ?? r.decision)}</td>
        <td class="rp-col-td">${td}</td>
      </tr>`;
    }).join('');
  }

  function pick(ref) {
    if (S.selected !== ref) {
      $('rp-close').reset();
      say('rp-close-msg', ''); say('rp-td-msg', ''); say('rp-td-look-msg', '');
      $('rp-td-confirm').value = '';
      S.tplHere = null;
    }
    S.selected = ref;
    S.draft = null;
    const c = S.rows.find((r) => r.case_ref === ref);
    if (S.look && !(c?.uuid8 && S.look.uuid.startsWith(c.uuid8))) S.look = null;
    $('rp-td-link').value = S.links[ref] ? SHARE + S.links[ref] : '';
    say('rp-register-msg', '');
    route();
  }

  // Back to the start: a new link, or another case.
  function change() {
    S.selected = null;
    S.draft = null;
    S.look = null;
    S.tplHere = null;
    $('rp-link').value = '';
    $('rp-found').hidden = true;
    say('rp-lookup-msg', '');
    say('rp-register-msg', '');
    route();
    $('rp-link').focus();
  }

  // ── New case ──────────────────────────────────────────────────────────────
  // From a looked-up link (the link filled in), or "The report has no link" (category No link given).
  function openNew(uuid) {
    $('rp-new').reset();
    $('rp-new-link').value = uuid ? SHARE + uuid : '';
    if (!uuid) $('rp-new-category').value = 'no_link';
    say('rp-new-msg', '');
    S.draft = { uuid: uuid ?? null };
    route();
  }
  function backFromNew() { S.draft = null; route(); }

  async function submitNew() {
    const linkText = $('rp-new-link').value.trim();
    const uuid = linkText ? uuidIn(linkText) : null;
    if (linkText && !uuid) {
      return say('rp-new-msg', UUID8_RE.test(linkText) ? ONLY_8 : 'That is not a Share link or transfer ID (UUID). Nothing was saved.');
    }
    const category = $('rp-new-category').value;
    if (category === 'no_link' && uuid) {
      return say('rp-new-msg', '“No link given” is for a report without a link. Remove the link, or choose another category. Nothing was saved.');
    }
    const reason = $('rp-new-reason').value.trim();
    if (FORBIDDEN.test(reason)) return say('rp-new-msg', 'No email addresses, # or links in the note. Nothing was saved.');
    const training = $('rp-new-training').value === 'yes';
    const body = { training, route: $('rp-new-route').value, category, uuid8: uuid ? uuid.slice(0, 8) : null };
    if (reason) body.reason = reason;
    say('rp-new-msg', 'Opening…');
    const r = await api('POST', '/admin/reports/open', { body });
    if (r.status !== 200) return say('rp-new-msg', refusal(r));
    const ref = r.data.case_ref;
    if (uuid) S.links[ref] = uuid;
    if (uuid && S.look?.uuid !== uuid) await lookUpUuid(uuid);
    await loadRegister();
    pick(ref);
    say('rp-register-msg', `Opened ${ref}${training ? ' (training drill)' : ''}. Use this reference in every email to the reporter.`);
  }

  // ── The route: which step is where ────────────────────────────────────────
  // Each step is resolved (done ✓ · skipped — · past = not recorded here) or still open; the
  // first open step in route order is the current one (gold rule, the cursor), the rest wait.
  // CSEA and terrorism: take down first, acknowledge after.
  const STATE = {
    live:      ['Live', ''],
    expired:   ['Time ran out — parts not yet cleared', 'It can still be taken down.'],
    gone:      ['Gone', 'Deleted after download, its time ran out, or deleted by its owner.'],
    removed:   ['Removed after a report', ''],
    not_found: ['No such link', 'It never existed, or its record was cleared after 30 days.'],
  };
  const STEPS = ['find', 'open', 'ack', 'td', 'close', 'out'];
  const orderFor = (c) => (c && HELPER_CATEGORIES.includes(c.category)
    ? ['find', 'open', 'td', 'ack', 'close', 'out'] : STEPS);
  const linkLine = (u8, L) => (u8 ? `Link ${u8}${L ? ` · ${STATE[L.state]?.[0] ?? L.state}` : ''}` : 'No link in the report');

  function plan(c) {
    if (!c) {
      const d = S.draft;
      return d ? { find: ['done', linkLine(d.uuid?.slice(0, 8), d.uuid ? S.look : null)], open: ['open', 'Open the case'] }
        : { find: ['open', 'Find the link'] };
    }
    const m = markOf(c.case_ref);
    const closed = c.decision !== 'open';
    const L = S.look && c.uuid8 && S.look.uuid.startsWith(c.uuid8) ? S.look : null;
    const td = S.tookDown?.case_ref === c.case_ref ? S.tookDown : null;
    const st = {};
    st.find = ['done', linkLine(c.uuid8, L)];
    st.open = ['done', `${c.case_ref}${c.training ? ' · TRAINING DRILL' : ''} · ${short(c.category)} · received ${t(F_SHORT, c.received_at)}`];

    if (m.a) st.ack = ['done', m.a === 'none' ? 'Acknowledgement · no way to reply' : `Acknowledgement sent ${t(F_CLOCK, m.a)}`];
    else st.ack = closed ? ['past', 'Acknowledgement'] : ['open', 'Acknowledgement'];

    if (c.takedown_at) st.td = ['done', `Taken down ${t(F_CLOCK, c.takedown_at)}${c.takedown_by === 'helper' ? ' · by the helper' : ''}`];
    else if (td && !td.recorded) st.td = ['done', `Taken down ${t(F_CLOCK, td.at)} · not in the register — write it in when you close`];
    else if (!c.uuid8) st.td = ['skipped', 'No link given — nothing to take down'];
    else if (closed) st.td = ['skipped', 'Not taken down'];
    else if (L?.state === 'removed') st.td = ['skipped', 'Nothing to take down — already removed after a report'];
    else if (L?.state === 'gone') st.td = ['skipped', 'Nothing to take down — already gone'];
    else if (L?.state === 'not_found') st.td = ['skipped', 'Nothing to take down — no such link'];
    else if (L && m.skip) st.td = ['skipped', 'Not taken down'];
    else st.td = ['open', 'Take down'];

    if (closed) st.close = ['done', `Closed ${t(F_CLOCK, c.closed_at)} · ${DECISION[c.decision] ?? c.decision}`];
    else st.close = ['open', 'Close the case'];

    if (m.b) st.out = ['done', m.b === 'none' ? 'Outcome · no way to reply' : `Outcome sent ${t(F_CLOCK, m.b)}`];
    else st.out = ['open', 'Outcome'];

    st.L = L; st.td_ = td; st.closed = closed;
    st.helperRefused = S.role === 'helper' && !HELPER_CATEGORIES.includes(c.category);
    return st;
  }

  function route() {
    const c = S.rows.find((r) => r.case_ref === S.selected) ?? null;
    const st = plan(c);
    const order = orderFor(c);
    let current = null;
    order.forEach((k, i) => {
      const li = $(`rp-s-${k}`), txt = $(`rp-s-${k}-text`);
      if (!txt.dataset.name) txt.dataset.name = txt.textContent;
      $('rp-route').append(li);   // the order on screen is the route's order
      li.querySelector('.rp-step-n').textContent = String(i + 1);
      const [state, text] = st[k] ?? ['todo', txt.dataset.name];
      li.dataset.state = state === 'open' ? (current ? 'todo' : (current = k, 'current')) : state;
      txt.textContent = text ?? txt.dataset.name;
      $(`rp-s-${k}-body`).hidden = li.dataset.state !== 'current';
    });
    $('rp-change-btn').hidden = !(c || S.draft);

    // After-notes: what to do next once a step has shrunk.
    const aTd = $('rp-s-td-after'), aClose = $('rp-s-close-after');
    aTd.hidden = true; aClose.hidden = true;
    // Drills only: in a real case staff never open the reported link.
    if (c && c.training && st.td[0] === 'done' && !st.closed) {
      aTd.textContent = 'Training drill: open the full link in Safari; it should say “This file is no longer available.”';
      aTd.hidden = false;
    }
    if (c && st.closed) {
      aClose.textContent = S.role === 'admin'
        ? 'Export the register when the case is finished (Register → Export below, or export-register.sh on the Mac).'
        : 'Rajesh exports the register.';
      aClose.hidden = false;
    }

    if (c) {
      if (current === 'td') renderTakedown(c, st);
      if (current === 'close') renderClose(c, st);
      renderTemplates(c, st);
    }
    placeTemplates(current);

    // Finish: the case record and the templates, once the case is closed.
    $('rp-finish').hidden = !(c && st.closed);
    if (c && st.closed) {
      const folder = `refueler-share-private/strategy/osa/cases/${c.training ? 'training' : (c.case_ref.slice(2, 6))}/`;
      say('rp-finish-note', S.role === 'admin'
        ? `${st.out[0] === 'done' ? `${c.case_ref} is finished. ` : ''}Save the case record in ${folder} and commit it.`
        : `${st.out[0] === 'done' ? `${c.case_ref} is finished. ` : ''}Save the case record and send it to Rajesh.`);
    }

    // The cursor goes to the step that just opened (not on every redraw).
    // A hidden page takes no focus: the key stays unset until Reports is on screen (shown()).
    const key = `${c?.case_ref ?? ''}:${current ?? ''}:${st.L ? 'L' : ''}:${S.draft ? 'd' : ''}`;
    if (key !== S.focus && !$('card-reports').hidden) {
      S.focus = key;
      if (current) focusStep(current);
      else if (c && st.closed) $('rp-record-btn').focus({ preventScroll: true });
    }
  }

  function focusStep(k) {
    const body = $(`rp-s-${k}-body`);
    const first = k === 'find' ? $('rp-link')
      : k === 'open' ? $('rp-new-training')
      : k === 'ack' || k === 'out' ? $('rp-tpl-copy')
      : k === 'td' ? (!$('rp-td-look').hidden ? ($('rp-td-link').value ? $('rp-td-lookup-btn') : $('rp-td-link'))
        : $('rp-td-confirm').disabled ? null : $('rp-td-confirm'))
      : body.querySelector('input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])');
    first?.focus({ preventScroll: true });
    $(`rp-s-${k}`).scrollIntoView({ block: 'nearest' });
  }

  // Called when the Reports page comes on screen: the cursor goes to the open step.
  function shown() { S.focus = ''; route(); }

  // ── Look up ───────────────────────────────────────────────────────────────
  // Two places: the start (the link in the report, before any case) and the take-down step of
  // a case picked from the register (the register keeps 8 characters, not the link).
  async function lookUpUuid(uuid) {
    const r = await api('GET', '/admin/reports/lookup', { uuid });
    if (r.status !== 200) return common(r.status) ?? `Unexpected answer (${r.status}). Nothing was done.`;
    S.look = { uuid, ...r.data, at: now() };
    return null;
  }

  function readLink(fieldId, msgId) {
    const text = $(fieldId).value.trim();
    const uuid = uuidIn(text);
    if (!uuid) {
      say(msgId, !text ? '' : UUID8_RE.test(text) ? ONLY_8 : 'That is not a Share link or transfer ID (UUID). Nothing was looked up.');
      return null;
    }
    $(fieldId).value = SHARE + uuid;   // the field shows only the transfer ID part, whatever came with it
    return uuid;
  }

  // The start: look the link up, then offer the open cases for it or a new case.
  async function lookUpStart() {
    const uuid = readLink('rp-link', 'rp-lookup-msg');
    if (!uuid) return;
    say('rp-lookup-msg', 'Looking up…');
    const err = await lookUpUuid(uuid);
    if (err) { $('rp-found').hidden = true; return say('rp-lookup-msg', err); }
    say('rp-lookup-msg', '');
    await loadRegister();   // a case opened elsewhere (the scripts, a helper) must show
    renderFound();
  }

  function renderFound() {
    const L = S.look;
    renderCard(L, 'rp-card');
    const u8 = L.uuid.slice(0, 8);
    const open = S.rows.filter((r) => r.uuid8 === u8 && r.decision === 'open');
    const closed = S.rows.filter((r) => r.uuid8 === u8 && r.decision !== 'open');
    say('rp-found-note', open.length
      ? `There ${open.length === 1 ? 'is an open case' : `are ${open.length} open cases`} for this link. Continue it, or open a new case if this is a different report.`
      : closed.length ? `Earlier cases for this link: ${closed.map((r) => r.case_ref).join(', ')} (closed).` : 'No case for this link yet.');
    const btn = (id, label, strong) => `<button class="${strong ? 'rp-strong' : 'toggle-btn'}" type="button" data-rp="${esc(id)}">${esc(label)}</button>`;
    $('rp-found-actions').innerHTML = [
      ...open.map((r) => btn(`continue:${r.case_ref}`, `Continue ${r.case_ref}`, true)),
      btn('new', 'Open a case for this link', !open.length),
    ].join('');
    $('rp-found').hidden = false;
    (open.length ? $('rp-found-actions').firstElementChild : $('rp-found-actions').lastElementChild)?.focus({ preventScroll: true });
  }

  function foundAction(e) {
    const b = e.target.closest('[data-rp]');
    if (!b) return;
    const a = b.dataset.rp;
    if (a === 'new') return openNew(S.look.uuid);
    if (a.startsWith('continue:')) {
      const ref = a.slice('continue:'.length);
      S.links[ref] = S.look.uuid;
      pick(ref);
    }
  }

  // The take-down step of a case picked from the register, before its link is known.
  async function lookUpCase() {
    const c = S.rows.find((r) => r.case_ref === S.selected);
    if (!c) return;
    const uuid = readLink('rp-td-link', 'rp-td-look-msg');
    if (!uuid) return;
    if (c.uuid8 && !uuid.startsWith(c.uuid8)) {
      return say('rp-td-look-msg', `That link starts ${uuid.slice(0, 8)}; case ${c.case_ref} is about ${c.uuid8}. Check the link in the report. Nothing was looked up.`);
    }
    say('rp-td-look-msg', 'Looking up…');
    const err = await lookUpUuid(uuid);
    if (err) return say('rp-td-look-msg', err);
    say('rp-td-look-msg', '');
    S.links[c.case_ref] = uuid;
    await loadRegister();
  }

  const row = (k, v) => `<div class="rp-dl-row"><span class="rp-dl-k">${esc(k)}</span><span class="rp-dl-v">${v}</span></div>`;

  function renderCard(L, id) {
    const [word, sub] = STATE[L.state] ?? [L.state, ''];
    const rows = [
      row('Transfer ID', `<span class="rp-u8">${esc(L.uuid.slice(0, 8))}</span>${esc(L.uuid.slice(8))}`),
      row('State', `<strong>${esc(word)}</strong>${sub ? `<span class="rp-sub">${esc(sub)}</span>` : ''}`),
    ];
    if (L.state === 'live' || L.state === 'expired') {
      rows.push(
        row('Tier', esc(TIER[L.tier] ? `${TIER[L.tier]} (${L.tier})` : (L.tier ?? '—'))),
        row('Created', esc(t(F_FULL, L.created_at))),
        row('Expires', esc(t(F_FULL, L.expires_at))),
        row('Upload complete', L.upload_complete ? 'Yes' : 'No — still uploading'),
        row('Downloaded and closed', L.consumed ? 'Yes' : 'No'),
      );
    }
    $(id).innerHTML = rows.join('') + `<p class="rp-hint">Read from the live record at ${esc(t(F_CLOCK, L.at))}.</p>`;
  }

  // ── Take down ─────────────────────────────────────────────────────────────
  function renderTakedown(c, st) {
    const L = st.L;
    $('rp-td-look').hidden = !!L;
    $('rp-td-ready').hidden = !L;
    if (!L) { if (S.links[c.case_ref] && !$('rp-td-link').value) $('rp-td-link').value = SHARE + S.links[c.case_ref]; return; }
    renderCard(L, 'rp-td-card');
    // The 8 characters are shown, never offered to copy: typing them is the deliberate pause.
    $('rp-td-u8').textContent = L.uuid.slice(0, 8);
    $('rp-td-confirm').disabled = st.helperRefused;
    $('rp-td-skip').hidden = st.helperRefused;
    say('rp-td-note', st.helperRefused ? ONLY_RAJESH : '');
    updateTakedownButton();
  }

  function updateTakedownButton() {
    const L = S.look, c = S.rows.find((r) => r.case_ref === S.selected);
    if (!L || !c) return;
    const refused = S.role === 'helper' && !HELPER_CATEGORIES.includes(c.category);
    $('rp-td-btn').disabled = refused || $('rp-td-confirm').value.trim().toLowerCase() !== L.uuid.slice(0, 8);
  }

  async function takeDown() {
    const L = S.look, caseRef = S.selected, confirm = $('rp-td-confirm').value.trim().toLowerCase();
    const btn = $('rp-td-btn');
    btn.disabled = true; btn.textContent = 'Taking down…';
    const r = await api('POST', '/admin/reports/takedown', { uuid: L.uuid, body: { case_ref: caseRef, confirm } });
    btn.textContent = 'Take down';
    const d = r.data, at = d.removed_at;
    let msg = '', rerun = false;
    if (r.status === 200 && d.already_removed) {
      rerun = true;   // the step then says "already removed"; Close: Removed, naming the first case
    } else if (r.status === 200) {
      S.tookDown = { case_ref: caseRef, at, recorded: !!d.register_updated };
      if (!d.register_updated) {
        $('rp-close-reason').value = `Taken down ${t(F_CLOCK, at)} (London), ${t(F_DAY, at)}. The register did not record it.`;
      }
      rerun = true;
    } else if (r.status === 202) {
      msg = `Part-way: ${d.remaining ?? 'some'} part(s) are still there. Press Take down again — it carries on where it stopped.`;
    } else if (r.status === 400 && d.error === 'confirm_mismatch') {
      msg = 'Those 8 characters don’t match. Nothing was taken down.';
    } else if (r.status === 403) {
      msg = `${ONLY_RAJESH} Nothing was taken down.`;
    } else if (r.status === 404) {
      msg = 'No such link. Nothing was taken down.';
    } else if (r.status === 409) {
      msg = { no_such_case: `There is no case ${caseRef} in the register. Nothing was taken down.`,
              other_link:   `Case ${caseRef} is about a different link. Check the case. Nothing was taken down.`,
              case_closed:  `Case ${caseRef} is already closed. Nothing was taken down.` }[d.why]
        ?? 'The case doesn’t match this link. Nothing was taken down.';
    } else if (r.status === 410) {
      msg = 'Already gone (deleted after download, or its time ran out). Nothing to take down.';
      rerun = true;
    } else {
      msg = common(r.status) ?? `Share refused the request (${d.error ?? r.status}). Look it up again before trying again.`;
    }
    $('rp-td-confirm').value = '';
    say('rp-td-msg', msg);
    if (rerun) { await lookUpUuid(L.uuid); await loadRegister(); }
    else updateTakedownButton();
  }

  function notTakingDown() {
    mark(S.selected, 'skip', now());
    route();
  }

  // ── Close ─────────────────────────────────────────────────────────────
  // The decision is pre-set once from what the route found (it can be changed); nothing else is.
  function renderClose(c, st) {
    const refused = S.role === 'helper' && !HELPER_CATEGORIES.includes(c.category);
    for (const el of $('rp-close').elements) el.disabled = refused;
    say('rp-close-note', refused ? 'Only Rajesh can close this case. It can wait for him.' : '');
    if (S.prefilled[c.case_ref]) return;
    S.prefilled[c.case_ref] = true;
    const L = st.L, m = markOf(c.case_ref);
    const decision = c.takedown_at || st.td_ ? 'removed'
      : !c.uuid8 ? 'manifestly_unfounded'
      : L?.state === 'removed' ? 'removed'
      : L?.state === 'gone' ? 'already_gone'
      : L?.state === 'not_found' ? 'manifestly_unfounded'
      : m.skip ? 'not_removed' : '';
    $('rp-close-decision').value = decision;
    if (m.a === 'none') $('rp-close-told').value = 'no_contact';
    if (L?.state === 'removed' && !c.takedown_at && !$('rp-close-reason').value) {
      const first = S.rows.find((r) => r.uuid8 === c.uuid8 && r.takedown_at && r.case_ref !== c.case_ref);
      if (first) $('rp-close-reason').value = `Already removed under ${first.case_ref}.`;
    }
  }

  async function submitClose() {
    const ref = S.selected;
    const reason = $('rp-close-reason').value.trim();
    if (FORBIDDEN.test(reason)) return say('rp-close-msg', 'No email addresses, # or links in the reason. Nothing was saved.');
    const nca = $('rp-close-nca').value.trim();
    if (!/^[A-Za-z0-9-]{0,64}$/.test(nca)) return say('rp-close-msg', REFUSAL.bad_nca_ref);
    const decision = $('rp-close-decision').value;
    // Empty reason or NCA reference: left out, so the opening note (and any NCA reference) stays.
    const body = { case_ref: ref, decision, reporter_told: $('rp-close-told').value, key_removed: $('rp-close-key').value === 'yes' };
    if (reason) body.reason = reason;
    if (nca) body.nca_ref = nca;
    say('rp-close-msg', 'Closing…');
    const r = await api('POST', '/admin/reports/update', { body });
    if (r.status !== 200) return say('rp-close-msg', refusal(r));
    say('rp-close-msg', '');
    await loadRegister();
  }

  // ── Templates ─────────────────────────────────────────────────────
  // Route §9 text, the case reference on top (drill 1, change 1). No sign-off here: the report@
  // mailbox signature says "Kind regards, / Refueler Share / refueler.io" (drill 1 re-run, 24 Oct). [ ] marks
  // what is still to fill in. The link is the part before the # — known once it was pasted in New
  // report or looked up here (the register keeps the first 8 characters, not the transfer ID).
  function renderTemplates(c, st) {
    const uuid = S.links[c.case_ref];
    const link = uuid ? SHARE + uuid : '[link up to #]';
    const head = `Reference: ${c.case_ref}\n\n`;
    const urgent = HELPER_CATEGORIES.includes(c.category);
    const a = `Thank you. We have your report about ${link} and will look at it ${urgent ? 'today' : 'within two working days'}.\n\n` +
      'We cannot see the contents of files on Share, so anything you can tell us about what you saw helps. ' +
      'Please don’t send us the file itself.';
    let outcome;
    if (c.category === 'csea' && c.decision !== 'not_removed') outcome = 'We have acted on it.';
    else if (c.decision === 'removed' || c.decision === 'already_gone') outcome = 'We have removed the link.';
    else if (c.decision === 'not_removed') outcome = 'We have not removed the link because [reason].';
    else if (c.decision === 'manifestly_unfounded') outcome = 'There was nothing we could act on [because …].';
    else outcome = 'We have [removed the link / not removed the link because …].';
    const b = `We have looked at your report about ${link}. ${outcome} If you disagree, reply to this email.`;
    const took = S.rows.find((r) => r.uuid8 && r.uuid8 === c.uuid8 && r.takedown_at);
    const cText = `We have looked again at the link we removed on ${took ? t(F_LONG, took.takedown_at) : '[date]'}. ` +
      '[We stand by the decision because … / We were wrong, and we’re sorry.] ' +
      'Files we remove are deleted and cannot be restored, because we never hold the key.';
    for (const [k, v] of [['a', head + a], ['b', head + b], ['c', head + cText]]) {
      const ta = $(`rp-tpl-${k}`);
      if (ta.dataset.case !== c.case_ref) { ta.readOnly = true; $('rp-tpl-edit').textContent = 'Edit'; }
      if (ta.dataset.case !== c.case_ref || ta.dataset.auto === ta.value) { ta.value = v; ta.dataset.auto = v; ta.dataset.case = c.case_ref; }
    }

  }

  // One templates block (tabs A/B/C, one Copy), moved into the step that needs it.
  function placeTemplates(current) {
    const tpl = $('rp-templates');
    const slot = current === 'ack' ? 's-ack' : current === 'out' ? 's-out' : S.tplHere === 'finish' && !$('rp-finish').hidden ? 'finish' : null;
    if (!slot) { tpl.hidden = true; return; }
    const host = $(`rp-${slot}-slot`);
    if (tpl.parentElement !== host) {
      host.append(tpl);
      if (slot === 's-ack') showTab('a');
      if (slot === 's-out') showTab('b');
    }
    tpl.hidden = false;
  }

  // The replies are read-only; the admin key's Edit unlocks this one copy (nothing typed is saved:
  // the standard wording lives in this file, so a permanent change is a reviewed code change).
  function toggleEdit() {
    const on = $('rp-tpl-a').readOnly;
    for (const x of ['a', 'b', 'c']) $(`rp-tpl-${x}`).readOnly = !on;
    $('rp-tpl-edit').textContent = on ? 'Done' : 'Edit';
    if (on) $(`rp-tpl-${['a', 'b', 'c'].find((x) => !$(`rp-tpl-${x}`).hidden)}`).focus();
  }

  function showTab(k) {
    for (const x of ['a', 'b', 'c']) {
      $(`rp-tab-${x}`).setAttribute('aria-selected', String(x === k));
      $(`rp-tpl-${x}`).hidden = x !== k;
    }
  }
  async function copy(btn) {
    const k = ['a', 'b', 'c'].find((x) => !$(`rp-tpl-${x}`).hidden);
    const ta = $(`rp-tpl-${k}`);
    try {
      await navigator.clipboard.writeText(ta.value);
      btn.textContent = /\[[^\]]*\]/.test(ta.value) ? 'Copied — [ ] still to fill' : 'Copied';
    } catch { btn.textContent = 'Copy failed — select and copy'; }
    setTimeout(() => { btn.textContent = 'Copy'; }, 2500);
  }

  function sent(k, v) {
    mark(S.selected, k, v);
    route();
  }

  // ── Case record (print / Save as PDF) ─────────────────────────────────────
  // The register row and its events — never an email, the full transfer ID or the key part.
  // Admin: the events come from the export (the only route that returns them). Helper: no export,
  // so the timeline is built from the row's own times and says so.
  const FIELD = {
    training: 'training', received_at: 'time received', route: 'route', uuid8: 'link', category: 'category',
    decision: 'decision', reason: 'reason', takedown_at: 'take-down time', takedown_by: 'taken down by',
    nca_ref: 'NCA reference', reporter_told: 'reporter told', key_removed: 'key part removed',
  };
  const ACTION = { open: 'Opened', update: 'Updated', takedown: 'Taken down', close: 'Closed', category_change: 'Category changed' };
  const BY = { admin: 'admin', helper: 'helper' };

  async function caseRecord() {
    const c = S.rows.find((r) => r.case_ref === S.selected);
    if (!c) return;
    const btn = $('rp-record-btn');
    btn.disabled = true;
    let events = null;
    if (S.role === 'admin') {
      const r = await api('GET', c.training ? '/admin/reports/export-training' : '/admin/reports/export');
      if (r.status === 200 && Array.isArray(r.data.events)) events = r.data.events.filter((e) => e.case_ref === c.case_ref);
    }
    btn.disabled = false;
    const derived = !events;
    if (derived) {
      events = [{ at: c.received_at, by: c.opened_by, action: 'open', fields: [] }];
      if (c.takedown_at) events.push({ at: c.takedown_at, by: c.takedown_by, action: 'takedown', fields: [] });
      if (c.closed_at) events.push({ at: c.closed_at, by: null, action: 'close', fields: [] });
    }
    events.sort((x, y) => x.at - y.at);
    const printed = now();
    const R = (k, v) => `<tr><th>${esc(k)}</th><td>${v}</td></tr>`;
    const when = (s) => (s ? `${esc(t(F_FULL, s))}` : '—');
    const ev = events.map((e) => `<tr>
        <td class="cr-when">${esc(t(F_FULL, e.at))}</td>
        <td>${esc(ACTION[e.action] ?? e.action)}${e.by ? ` · ${esc(BY[e.by] ?? e.by)}` : ''}</td>
        <td class="cr-fields">${esc((e.fields ?? []).map((f) => FIELD[f] ?? f).join(', '))}</td>
      </tr>`).join('');
    $('case-record').innerHTML = `
      <header class="cr-head">
        <div class="cr-eyebrow">Refueler Share · Report register</div>
        ${c.training ? '<div class="cr-training">TRAINING SIMULATION</div>' : ''}
      </header>
      <h1 class="cr-title">Case record</h1>
      <div class="cr-ref">${esc(c.case_ref)}</div>
      <table class="cr-table">
        ${R('Received', `${when(c.received_at)} · by ${esc(ROUTE[c.route] ?? c.route)}`)}
        ${R('Opened by', esc(BY[c.opened_by] ?? c.opened_by))}
        ${R('Category', esc(CATEGORY[c.category] ?? c.category))}
        ${R('Link', c.uuid8 ? `<span class="cr-mono">${esc(c.uuid8)}</span> <span class="cr-quiet">the first 8 characters of the transfer ID</span>` : 'No link given')}
        ${R('Decision', esc(DECISION[c.decision] ?? c.decision))}
        ${R('Reason', c.reason ? esc(c.reason) : '—')}
        ${R('Taken down', c.takedown_at ? `${when(c.takedown_at)} · by ${esc(BY[c.takedown_by] ?? c.takedown_by)}` : 'No')}
        ${R('Closed', when(c.closed_at))}
        ${R('Reporter told', esc(c.reporter_told ? (TOLD[c.reporter_told] ?? c.reporter_told) : '—'))}
        ${R('NCA reference', c.nca_ref ? `<span class="cr-mono">${esc(c.nca_ref)}</span>` : '—')}
        ${R('Key part removed', c.key_removed ? 'Yes — removed from the mailbox thread' : 'No (or no full link was sent)')}
      </table>
      <h2 class="cr-h2">Timeline</h2>
      <table class="cr-events">${ev}</table>
      ${derived ? '<p class="cr-quiet">Built from the case’s own times. The full event list is in Rajesh’s export of the register.</p>' : '<p class="cr-quiet">From the register’s event list. Events name the fields changed, never their values.</p>'}
      <footer class="cr-foot">
        <p>All times London time. Printed ${esc(t(F_FULL, printed))} from Navy Office.</p>
        <p>This record holds no email address, no full transfer ID and no key part.</p>
      </footer>`;
    // A4 portrait for this one print (navy-office.css makes every print landscape for the growth chart).
    const page = document.createElement('link');
    page.rel = 'stylesheet';
    page.href = 'case-record-page.css';
    await new Promise((res) => { page.onload = res; page.onerror = res; document.head.append(page); });
    const title = document.title;
    // Safari's Save as PDF suggests the title: "R-2026-001 case record", filed in the private repo's
    // strategy/osa/cases/ (Rajesh, 23 Oct; the record never leaves his disks).
    document.title = `${c.case_ref} case record`;
    document.body.classList.add('printing-case');
    const done = () => {
      document.body.classList.remove('printing-case');
      document.title = title;
      page.remove();
      window.removeEventListener('afterprint', done);
    };
    window.addEventListener('afterprint', done);
    window.print();
  }

  // ── Export (admin) — the same JSON as export-register.sh (jq --sort-keys .) ─
  const sortKeys = (v) => Array.isArray(v) ? v.map(sortKeys)
    : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])) : v;

  async function exportRegister(training) {
    const name = training ? 'training-export.json' : 'report-register.json';
    say('rp-export-msg', 'Exporting…');
    const r = await api('GET', training ? '/admin/reports/export-training' : '/admin/reports/export');
    if (r.status !== 200 || !Array.isArray(r.data.rows)) {
      return say('rp-export-msg', common(r.status) ?? `Unexpected answer (${r.status}). Nothing was saved.`);
    }
    const blob = new Blob([JSON.stringify(sortKeys(r.data), null, 2) + '\n'], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    say('rp-export-msg', `Downloaded ${name} (${r.data.rows.length} row${r.data.rows.length === 1 ? '' : 's'}). ` +
      'The copy in the private repo comes from export-register.sh on the Mac.');
  }

  function askDeleteTraining() {
    const n = S.rows.filter((r) => r.training).length;
    say('rp-delete-confirm-text', n ? `Delete ${n} training (T-) row${n === 1 ? '' : 's'}? Real rows can never be deleted.`
      : 'There are no training rows to delete.');
    $('rp-delete-yes').hidden = !n;
    $('rp-delete-confirm').hidden = false;
  }
  async function deleteTraining() {
    $('rp-delete-confirm').hidden = true;
    const r = await api('POST', '/admin/reports/delete-training');
    if (r.status !== 200) return say('rp-export-msg', common(r.status) ?? `Unexpected answer (${r.status}). Nothing was deleted.`);
    await loadRegister();
    say('rp-export-msg', `Deleted ${r.data.deleted ?? 0} training row(s).`);
  }

  // ── Mount ─────────────────────────────────────────────────────────────────
  function fill(id, map, placeholder) {
    const sel = $(id);
    const opts = Object.entries(map).map(([v, label]) => new Option(label, v));
    if (placeholder) opts.unshift(new Option(placeholder, ''));
    sel.replaceChildren(...opts);
  }

  function formButton(formId, buttonId, run) {
    const form = $(formId), btn = $(buttonId);
    let busy = false;
    const go = async () => {
      if (busy || btn.disabled || !form.reportValidity()) return;
      busy = true;
      try { await run(); } finally { busy = false; }
    };
    form.addEventListener('submit', (e) => e.preventDefault());
    btn.addEventListener('click', go);
    form.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'BUTTON') { e.preventDefault(); go(); }
    });
  }

  let wired = false;
  function mount({ worker, key, role }) {
    Object.assign(S, { worker, key, role });
    if (!wired) {
      wired = true;
      fill('rp-new-training', { no: 'A real report (R-)', yes: 'A training drill (T-)' }, 'Choose…');
      fill('rp-new-route', ROUTE, 'Choose…');
      fill('rp-new-category', CATEGORY, 'Choose…');
      fill('rp-close-decision', Object.fromEntries(Object.entries(DECISION).filter(([k]) => k !== 'open')), 'Choose…');
      fill('rp-close-told', TOLD, 'Choose…');
      fill('rp-close-key', { no: 'No (or no full link was sent)', yes: 'Yes — removed from the mailbox thread' });

      // A paste only fills the box (cut at the #); nothing runs until Look up or Enter (23 Oct).
      guard($('rp-link'));
      guard($('rp-td-link'));
      guard($('rp-new-link'));
      $('rp-link').addEventListener('keydown', (e) => { if (e.key === 'Enter') lookUpStart(); });
      $('rp-lookup-btn').addEventListener('click', lookUpStart);
      $('rp-td-link').addEventListener('keydown', (e) => { if (e.key === 'Enter') lookUpCase(); });
      $('rp-td-lookup-btn').addEventListener('click', lookUpCase);
      $('rp-found-actions').addEventListener('click', foundAction);
      $('rp-td-confirm').addEventListener('input', updateTakedownButton);
      $('rp-td-confirm').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !$('rp-td-btn').disabled) takeDown(); });
      $('rp-td-btn').addEventListener('click', takeDown);
      $('rp-td-skip').addEventListener('click', notTakingDown);
      $('rp-nolink-btn').addEventListener('click', () => openNew(null));
      $('rp-new-cancel').addEventListener('click', backFromNew);
      $('rp-new-case-btn').addEventListener('click', change);
      $('rp-tpl-edit').addEventListener('click', toggleEdit);
      // The forms are never submitted (CSP form-action 'none'; WebKit then fires no submit event):
      // the buttons and Enter run the same check-then-send.
      formButton('rp-new', 'rp-new-submit', submitNew);
      formButton('rp-close', 'rp-close-btn', submitClose);
      $('rp-change-btn').addEventListener('click', change);
      $('rp-a-sent').addEventListener('click', () => sent('a', now()));
      $('rp-a-none').addEventListener('click', () => sent('a', 'none'));
      $('rp-b-sent').addEventListener('click', () => sent('b', now()));
      $('rp-b-none').addEventListener('click', () => sent('b', 'none'));
      $('rp-record-btn').addEventListener('click', caseRecord);
      $('rp-tpl-show').addEventListener('click', () => { S.tplHere = S.tplHere === 'finish' ? null : 'finish'; route(); });
      $('rp-reload-btn').addEventListener('click', async () => { say('rp-register-msg', ''); await loadRegister(); });
      $('rp-export-btn').addEventListener('click', () => exportRegister(false));
      $('rp-export-training-btn').addEventListener('click', () => exportRegister(true));
      $('rp-delete-training-btn').addEventListener('click', askDeleteTraining);
      $('rp-delete-yes').addEventListener('click', deleteTraining);
      $('rp-delete-no').addEventListener('click', () => { $('rp-delete-confirm').hidden = true; });
      $('rp-tbody').addEventListener('click', (e) => { const tr = e.target.closest('tr[data-case]'); if (tr) pick(tr.dataset.case); });
      $('rp-tbody').addEventListener('keydown', (e) => {
        const tr = e.target.closest?.('tr[data-case]');
        if (tr && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); pick(tr.dataset.case); }
      });
      $('rp-templates').addEventListener('click', (e) => { const b = e.target.closest('[data-tpl]'); if (b) showTab(b.dataset.tpl); });
      $('rp-tpl-copy').addEventListener('click', (e) => copy(e.currentTarget));
    }
    loadRegister();
  }

  return { mount, shown, guard, uuidIn, ONLY_8 };
})();
