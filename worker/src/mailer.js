// ─────────────────────────────────────────────────────────────────────────────
// mailer.js — sign-in email (B12-4a · 13 Oct 2026)
//
// Provider: Cloudflare Email Sending (beta), `send_email` binding EMAIL, from
// signin@mail.refueler.io (own subdomain: own reputation, DMARC p=reject).
// Cloudflare already processes /auth/magic, so it learns nothing new — no new
// processor (B12-SR S6.3). Swapping provider later changes this file only.
//
// Plain text only: no HTML, no images, no tracking, no links but the sign-in
// links themselves. Never logs the address or a link.
// ─────────────────────────────────────────────────────────────────────────────

import { count } from './ops.js';

const LABELS = { citizen: 'Your account', org_admin: 'Your organisation (admin)' };

export function signInEmailText(links) {
  const body = links.length === 1
    ? [links[0].url]
    : links.flatMap(l => [`${LABELS[l.kind] ?? 'Sign in'}:`, l.url, '']).slice(0, -1);
  return [
    'Here is your sign-in link for Refueler Share.',
    'It works once and expires in 15 minutes.',
    '',
    ...body,
    '',
    "If you didn't ask for this, ignore this email. Nothing changes.",
    '',
    'This address does not receive replies.',
  ].join('\n');
}

/** Throws on any failure; the caller (inside waitUntil) logs without details. */
export async function sendSignInEmail(env, to, links) {
  if (!env.EMAIL?.send) throw new Error('mailer: EMAIL binding missing');
  try {
    await env.EMAIL.send({
      from: env.AUTH_MAIL_FROM,
      to,
      subject: 'Your Refueler Share sign-in link',
      text: signInEmailText(links),
    });
  } catch (e) {
    await count(env, 'email_send_fail');   // Ops-Alerts-1: the count only, never who
    throw e;
  }
}
