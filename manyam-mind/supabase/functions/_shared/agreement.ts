// Plain-language transfer agreement — canonical Deno copy of
// src/lib/agreement.js (kept as a literal duplicate, same reasoning as
// stateMachine.ts: Edge Functions can't import the app's JS bundle, and a
// URL-import round trip isn't worth it for one pure function). Any change
// here MUST be mirrored there, and vice versa — src/lib/agreement.test.js
// covers the client copy; keep the wording identical so
// transfers.listing_snapshot.agreement (written by this file, from
// create-transfer) always matches what the client rendered.

export interface AgreementArgs {
  sellerHandle: string
  title: string
  mode: 'exclusive' | 'license'
  priceCents: number
  date: string
}

export function transferAgreement({ sellerHandle, title, mode, priceCents, date }: AgreementArgs): string {
  const price = formatUsd(priceCents)
  const when = formatDate(date)
  const modeClause =
    mode === 'exclusive'
      ? `This is an EXCLUSIVE transfer. Once you confirm receipt, ${sellerHandle}'s synced copy of this mind ` +
        `is revoked on our servers and they agree not to keep or resell it. We cannot, however, technically ` +
        `revoke any copies ${sellerHandle} may already have exported to their own device before this sale — ` +
        `that is a contractual promise this agreement makes, not a technical guarantee.`
      : `This is a LICENSE. ${sellerHandle} keeps their own copy and may license it to other buyers. You are ` +
        `receiving a personal-use copy, not exclusive ownership.`

  return [
    `MIND TRANSFER AGREEMENT`,
    ``,
    `Mind: "${title}"`,
    `Seller: ${sellerHandle}`,
    `Price: ${price}`,
    `Date: ${when}`,
    ``,
    modeClause,
    ``,
    `${sellerHandle} confirms, as a condition of this listing, that the mind contains no personal data ` +
      `about third parties without consent, and that ${sellerHandle} owns the content being transferred.`,
    ``,
    `The mind bundle is end-to-end encrypted: our servers never see its plaintext content, before or after ` +
      `this sale. Payment is held in escrow until you confirm the imported bundle's integrity (its hash ` +
      `matches what was listed); only then is the seller paid and the sale finalized. You may dispute or ` +
      `request a refund within 72 hours of the content key being delivered to you.`,
  ].join('\n')
}

function formatUsd(cents: number): string {
  return `$${(Math.max(0, Math.trunc(cents)) / 100).toFixed(2)}`
}

function formatDate(date: string): string {
  const d = new Date(date)
  if (Number.isNaN(d.getTime())) return String(date)
  return d.toISOString().slice(0, 10)
}
