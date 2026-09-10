# DISCLOSURE-TEMPLATES.md — Refueler Share API onboarding
> Version: 1.0 | Created: SW7 · 10 Sep 2026
> Locked wording — SW-Opus-3 · 7 Sep 2026. Do not paraphrase.
> Global tokens ([recovery credential], [anonymous standing-receive]) resolved at SW7.
> Per-client tokens ({name}, {rail}, etc.) resolved at activation by AM.

---

## Identity rail — onboarding email

Subject: Refueler Share — confirming your rail and next steps

---

{principal_name},

To confirm the point from our call: choosing the identity rail gives you a recoverable
account, invoiced billing, and a data-processing agreement, and means you won't have
access to our identity-free features (such as anonymous standing-receive inboxes and
anonymous machine-to-machine transfer). This is a deliberate one-way choice made by
you at onboarding — it isn't set by how the invoice is later paid, so it's worth
deciding it consciously now rather than letting a payment method decide it for you.

One thing worth sorting before you share our details with your finance team: if they'll
ever need to raise a purchase order or pay by bank transfer, the identity rail is the
one that supports that — and it's worth knowing that choice forecloses the anonymous
features. The rail is set at onboarding, not by how the first invoice gets paid. Better
to have that conversation now than when accounts payable is already holding the bank
details.

Your credentials will be delivered separately by secure physical post.

{am_name}

---

## Anonymous rail — onboarding email

Subject: Refueler Share — confirming your rail and next steps

---

{principal_name},

Confirming the two things we can't undo on the anonymous rail: there is no account,
so if you lose your credentials we cannot recover your access; and your prepaid credit
is held by you, not kept as a recoverable balance with us, so losing it is permanent
and cannot be refunded. These aren't defects — they're the absence of the very records
that would otherwise compromise your anonymity — but they mean the rail is worth
choosing deliberately, and topping up only what you'll use soon.

Your credentials will be available in the authenticated dashboard once your sandbox
validation is complete. Your production credential is a fresh issuance with no
connection to your sandbox tests.

{am_name}

---

## Sandbox advisory — anonymous-rail clients (include with sandbox credential delivery)

The sandbox is a technical integration environment. It is non-anonymous by design —
observable by Refueler for debugging purposes.

Do not upload real documents, real counterparty data, or anything operationally
sensitive. Use the provided refueler-smoke.txt or equivalent synthetic test content.

If you wish to validate your integration against your own file types, that is
acceptable in sandbox — your file content is test cargo only and will be deleted
on our schedule. Your production anonymous credential is a fresh issuance with no
connection to your sandbox tests or sandbox identity.

When you move to production: start from a clean credential, fresh counterparty links,
and real cargo only.

---

## Transition advisory — identity to anonymous rail (use when transition declared)

> Note: available when Silent Drop block ships. Do not send until SD is live.

{principal_name},

Confirming the terms of your transition from identity rail to anonymous rail.

From today, your identity-rail account moves into a 60-day wind-down period. During
this time:

- Your existing transfers remain accessible for download by your counterparties.
- Existing inboxes remain open for inbound delivery.
- No new uploads or inbox provisioning are available on the identity rail.
- Identity-rail billing stops today. The 60-day window is provided at no charge.
- Your new anonymous-rail credentials are active from today and fully functional.

Please advise your counterparties to retrieve any outstanding documents within 60 days.
After {wind_down_end_date}, your identity-rail credentials will be revoked, your
data-processing agreement will be closed, and a final invoice will be issued for any
outstanding balance.

Your anonymous-rail relationship has no connection to your identity-rail history in
our systems.

{am_name}

