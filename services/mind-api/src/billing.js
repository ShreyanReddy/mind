// Billing-provider interface — PLAN.md §5.4, as amended 2026-07-08.
//
// PRODUCT DECISION: Stripe metered billing is ON HOLD, same as the main
// app's marketplace escrow (see prayan/supabase/functions/_shared/
// payments.ts for the sibling decision there). Today, monetization is
// metering + free-tier limits + an owner-set price that's stored and
// DISPLAYED (minds.price_per_query_cents, returned in /ask's 429 body and
// shown on the public mind page) — no money actually changes hands yet.
// `InternalBillingStub` records what *would* have been billed so the
// counters/UI are honest and testable; it never calls out to a payment
// processor because there isn't one wired up.
//
// PLATFORM_FEE_BPS documents the take rate the eventual Stripe integration
// will apply (basis points of price_per_query_cents) — used nowhere yet,
// kept here so it has one obvious home when billing activates.
export const PLATFORM_FEE_BPS = 2000 // 20% platform fee on metered query revenue, once billing is live

export class InternalBillingStub {
  /**
   * Record that a query was served and what it would have cost, without
   * moving any money. `priceCents` is the mind's price_per_query_cents;
   * `billable` is false for free-tier/API-key-metered queries that a real
   * biller wouldn't separately charge for under this mind's plan.
   */
  async recordQuery({ mindHandle, priceCents, billable }) {
    return {
      billed: false,
      reason: 'stripe-metered-billing-on-hold',
      mindHandle,
      wouldHaveChargedCents: billable ? priceCents : 0,
    }
  }
}

/**
 * Interface-conforming stub for later activation. TODO (when reactivated):
 * implement Stripe metered billing here — a Stripe Billing meter event per
 * query (stripe.billing.meterEvents.create(...)), keyed to the mind
 * owner's connected account, with PLATFORM_FEE_BPS applied as an
 * application_fee_amount on the resulting invoice item — mirroring how
 * prayan/supabase/functions/_shared/payments.ts's StripeStub documents
 * its own reactivation path for escrow.
 */
export class StripeMeteringStub {
  async recordQuery() {
    throw new Error('Stripe metered billing on hold — see services/mind-api/src/billing.js')
  }
}

/** Selects the provider. Defaults to internal; BILLING_PROVIDER=stripe selects the (throwing) stub. */
export function getBillingProvider(env = process.env) {
  return env.BILLING_PROVIDER === 'stripe' ? new StripeMeteringStub() : new InternalBillingStub()
}
