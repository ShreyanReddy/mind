import { describe, it, expect } from 'vitest'
import { InternalBillingStub, StripeMeteringStub, getBillingProvider, PLATFORM_FEE_BPS } from '../src/billing.js'

describe('InternalBillingStub', () => {
  it('records what would have been billed without moving money', async () => {
    const billing = new InternalBillingStub()
    const result = await billing.recordQuery({ mindHandle: 'alice', priceCents: 5, billable: true })
    expect(result.billed).toBe(false)
    expect(result.wouldHaveChargedCents).toBe(5)
  })

  it('reports 0 would-have-charged for a non-billable (free-tier) query', async () => {
    const billing = new InternalBillingStub()
    const result = await billing.recordQuery({ mindHandle: 'alice', priceCents: 5, billable: false })
    expect(result.wouldHaveChargedCents).toBe(0)
  })
})

describe('StripeMeteringStub', () => {
  it('throws on every call — Stripe metered billing is on hold', async () => {
    await expect(new StripeMeteringStub().recordQuery({})).rejects.toThrow(/on hold/i)
  })
})

describe('getBillingProvider', () => {
  it('defaults to the internal provider', () => {
    expect(getBillingProvider({})).toBeInstanceOf(InternalBillingStub)
  })

  it('selects the (throwing) Stripe stub only when explicitly configured', () => {
    expect(getBillingProvider({ BILLING_PROVIDER: 'stripe' })).toBeInstanceOf(StripeMeteringStub)
  })

  it('documents a platform fee constant for later activation', () => {
    expect(typeof PLATFORM_FEE_BPS).toBe('number')
    expect(PLATFORM_FEE_BPS).toBeGreaterThan(0)
  })
})
