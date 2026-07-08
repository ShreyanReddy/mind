// Payment-provider interface — PLAN.md §3.3, as amended 2026-07-08.
//
// PRODUCT DECISION: Stripe is ON HOLD. The full escrow/transfer machinery
// is built against this interface so switching providers later is a
// one-line config change, not a rewrite. Today `getPaymentProvider()`
// always returns InternalEscrowProvider: no real money moves, no Stripe
// SDK is installed, no Stripe API calls exist, no Stripe keys exist
// anywhere in this codebase. `StripeStub` conforms to the same interface
// and throws clearly on every method — it's the slot where Stripe's
// manual-capture PaymentIntent flow (authorize → capture → refund) and
// webhook-verified confirmation would plug in when reactivated. Reference
// PLAN.md §3.3's original spec when that day comes.
//
// `transfers.payment_ref` (migration 0003, renamed from
// stripe_payment_intent) is provider-agnostic on purpose: the internal
// provider stamps `int_<uuid>`, a future Stripe provider would stamp a
// PaymentIntent id — callers never need to know which.

export interface PaymentProvider {
  /** Reserve funds for a transfer without capturing them (escrow entry). */
  authorize(params: { transferId: string; amountCents: number }): Promise<{ paymentRef: string; status: 'authorized' }>
  /** Capture previously-authorized funds (escrow release to the seller). */
  capture(paymentRef: string): Promise<{ status: 'captured' }>
  /** Release authorized (or captured) funds back to the buyer. */
  refund(paymentRef: string): Promise<{ status: 'refunded' }>
}

/**
 * The active provider. No real money moves: `authorize` immediately
 * "succeeds" and mints an opaque reference; `capture`/`refund` are no-ops
 * that just report the requested outcome. This is enough to exercise and
 * test the FULL transfer state machine (escrow → delivered → completed /
 * refunded / disputed) honestly, without pretending to be a payment
 * processor.
 */
export class InternalEscrowProvider implements PaymentProvider {
  async authorize({ transferId }: { transferId: string; amountCents: number }) {
    return { paymentRef: `int_${transferId}`, status: 'authorized' as const }
  }
  async capture(_paymentRef: string) {
    return { status: 'captured' as const }
  }
  async refund(_paymentRef: string) {
    return { status: 'refunded' as const }
  }
}

/**
 * Interface-conforming stub for later activation. Every method throws —
 * this is deliberate, not a bug: nothing in this codebase is allowed to
 * call a real Stripe API while the integration is on hold. TODO (when
 * reactivated): implement manual-capture PaymentIntents here
 * (stripe.paymentIntents.create({ capture_method: 'manual', ... })  for
 * authorize, .capture() for capture, .refunds.create() for refund) and add
 * a `stripe-webhook` Edge Function deployed with verify_jwt = false that
 * verifies the Stripe-Signature header instead of a Supabase JWT — that
 * function is the "webhook-verified" transition path CLAUDE.md describes
 * for payments; the internal provider's transitions are function-verified
 * + event-logged instead, since there's no external webhook to verify.
 */
export class StripeStub implements PaymentProvider {
  async authorize(): Promise<never> {
    throw new Error('Stripe integration on hold — see supabase/functions/_shared/payments.ts')
  }
  async capture(): Promise<never> {
    throw new Error('Stripe integration on hold — see supabase/functions/_shared/payments.ts')
  }
  async refund(): Promise<never> {
    throw new Error('Stripe integration on hold — see supabase/functions/_shared/payments.ts')
  }
}

/** Selects the provider. Defaults to internal; PAYMENT_PROVIDER=stripe would select the (throwing) stub. */
export function getPaymentProvider(): PaymentProvider {
  const name = (typeof Deno !== 'undefined' ? Deno.env.get('PAYMENT_PROVIDER') : undefined) || 'internal'
  return name === 'stripe' ? new StripeStub() : new InternalEscrowProvider()
}
