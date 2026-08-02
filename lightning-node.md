# lightning-node.md — Refueler Share Lightning Node
> **Version:** 1.0 | **Created:** AP-7 ad-hoc · 2 Aug 2026
> Operational policy and architecture for the Share-dedicated Lightning node.
> Build scope: B9. Lives in repo root — not `docs/`.
> Load when planning or operating the Share Lightning node. Not by default.

---

## Purpose

A dedicated Lightning node for Refueler Share, separate from the personal node
and the refueler.io node. Graph isolation and ledger separation are the primary
goals — Share's payment flows must not be correlatable to personal or other
business activity.

---

## Infrastructure

| Component | Decision |
|-----------|----------|
| Host | Hetzner CX22 (same server as SimpleX SMP, B9) |
| Transport | Tor — no clearnet IP exposed |
| Channel direction | **Inbound only** — other nodes open channels to us |
| Implementation | TBD at B9 node planning session (LND / CLN — evaluate) |

**Inbound-only rationale:** A sink node that does not forward payments generates
no routing metadata. No outbound channels means no routing table entries at peer
nodes, no flow data accumulated over time. The node pubkey and channel-open
events are still on-chain and publicly visible — inbound-only is harder to graph,
not invisible. Combined with Tor, the practical result is: pubkey known, IP
unknown, no routing history, on-chain channel events visible.

---

## Channel partners

**ACINQ** — evaluate as a channel partner at B9 node planning session. ACINQ run
Phoenix wallet infrastructure and have operated a major routing node for years.
Their enclave-adjacent services may be relevant for attested node operation.
No commitment before the planning session.

Other channel partners: select for reliability and privacy-consciousness. Avoid
opening channels to KYC-heavy exchanges or custodial services — their graph
analysis of payment flows is more aggressive.

---

## Liquidation policy

**Default method: Boltz submarine swap (non-custodial)**

Boltz swaps Lightning sats to on-chain Bitcoin without requiring an account.
The on-chain destination is a Silent Payments address (see §Silent Payments below).
Boltz sees the Lightning payment and the on-chain output — this is the minimum
trust footprint for a non-custodial swap.

**Do not** open outbound channels to route funds out unless the swap fee is
prohibitive on a specific transaction. Channel-open and channel-close events
are noisier on-chain and add outbound peers to the graph.

**Operational reserve:** maintain sufficient sats on the node to cover Hetzner
costs for at least 30 days during traffic spikes. Do not liquidate below this
buffer. Hetzner accepts Bitcoin — direct payment where possible avoids an
additional on-chain hop.

---

## Silent Payments (BIP-352)

Silent Payments is the target on-chain destination format for Boltz liquidation
outputs. A single static address produces a unique on-chain output per payment,
with no interaction or notification transaction required. No sender can link
two payments to the same address.

**Dependency:** requires the `refueler-multi-core` blockchain scanning
infrastructure (Esplora/Mempool.space fork, post-B9) to detect incoming payments
to the static address without a full node on the receiving side.

Until `refueler-multi-core` is live: use a standard on-chain address generated
fresh per liquidation. Less private but correct. Do not reuse addresses.

---

## Treasury and tax policy

No Bitcoin treasury strategy. The operational policy is:

1. Lightning revenue received → recognised as GBP income at spot price on
   receipt date (HMRC guidance for crypto receipts).
2. Liquidate via Boltz to on-chain → convert to GBP for costs and salary
   as needed. This is a disposal for CGT purposes — record cost basis (the
   spot price at receipt) and disposal proceeds.
3. Buy personal Bitcoin privately, outside the company, from post-tax salary.
   Cleaner separation of business and personal CGT positions.
4. Keep operational reserve on node (see above). Reserve sats are not treasury —
   they are working capital.

**Rationale:** holding a corporate Bitcoin treasury creates CGT complexity on
every disposal, requires mark-to-market accounting for management accounts,
and invites HMRC scrutiny disproportionate to the benefit at this stage.
Paying costs promptly in GBP and buying BTC personally is simpler, lower-risk,
and consistent with how a professional services business would treat any
foreign currency receipt.

---

## Dashboard cards (B9 scope, greyed at B7)

The following admin dashboard cards are stubbed at B7 with "available at B9"
tooltips. They become live when the node is operational:

| Card | Metric | Source |
|------|--------|--------|
| Routing fee income | Sats earned per 24h / 7d | Node REST API |
| Channel liquidity health | Inbound vs outbound balance per channel | Node REST API |
| Boltz swap history | Last 5 swaps, amount, on-chain txid | Boltz API or local log |
| Operational reserve | Current node balance vs 30-day Hetzner buffer | Node REST API |

---

## Relationship to other nodes

| Node | Owner | Purpose | Separation |
|------|-------|---------|-----------|
| Personal node | Rajesh (personal) | Personal payments | Separate seed, separate host |
| refueler.io node | Refueler POS | Merchant receipts | Separate seed, separate host |
| Share node | Refueler Share | Share Lightning revenue | Separate seed, Hetzner CX22 |

No channels between these three nodes. Graph isolation requires zero direct
channel links — payments between them go via the wider network if needed.

---

## Security notes

- Node seed: generated offline, stored on Coldcard (personal device, not Share
  infrastructure). Never stored on the Hetzner server.
- Macaroon / API credentials for dashboard access: scoped read-only for the
  dashboard card integration. No admin macaroon exposed to the Worker.
- Watchtower: configure at B9 node planning session. Required before the node
  handles meaningful volume — channel breach protection.
- Backup: static channel backup (`channel.backup` for LND or equivalent) stored
  encrypted off-host. Procedure documented in `docs/incident-response.md` at B9.

---

## Build sequence (B9)

1. B9-plan session: implementation choice (LND vs CLN), channel partner
   evaluation (ACINQ and others), Boltz integration plan, watchtower selection.
2. Hetzner CX22 provisioned, full-disk encryption, Tor configured.
3. Node synced to chain tip. Seed generated offline, stored on Coldcard.
4. First inbound channel opened by selected partner.
5. Blink migration trigger evaluated (see Share-Master-Context.md §Lightning
   infrastructure): if 2 of 3 conditions met, begin migration from Blink primary
   to own node primary.
6. Boltz swap tested end-to-end. Silent Payments destination if
   `refueler-multi-core` is live; fresh address per swap otherwise.
7. Dashboard cards wired and live.
8. `docs/incident-response.md` updated with node-specific breach scenario.

---

## ACINQ note

ACINQ build and maintain Phoenix wallet and Eclair (Lightning implementation).
They have operated one of the most reliable routing nodes on the network and
have a strong privacy-consciousness track record. Their enclave services
(attestable node operation) are worth evaluating — consistent with Share's
architecture if they provide a verifiable attestation that the node software
is unmodified. No commitment before B9 planning session. Do not conflate
with ASINQ — different entity.

---

*"Nothing stops this train."*
