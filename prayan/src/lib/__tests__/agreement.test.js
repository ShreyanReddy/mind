import { describe, it, expect } from 'vitest'
import { transferAgreement } from '../agreement.js'

const base = { sellerHandle: 'ada', title: 'My Mind', priceCents: 1234, date: '2026-07-08T00:00:00.000Z' }

describe('transferAgreement (PLAN.md §3.6)', () => {
  it('includes the seller, title, formatted price, and date', () => {
    const text = transferAgreement({ ...base, mode: 'license' })
    expect(text).toContain('ada')
    expect(text).toContain('My Mind')
    expect(text).toContain('$12.34')
    expect(text).toContain('2026-07-08')
  })

  it('describes exclusive transfers honestly: server-side revocation, no technical guarantee over prior exports', () => {
    const text = transferAgreement({ ...base, mode: 'exclusive' })
    expect(text).toMatch(/EXCLUSIVE/)
    expect(text).toMatch(/revoked/i)
    expect(text).toMatch(/cannot.*technically revoke/i)
  })

  it('describes license mode as non-exclusive, seller keeps their copy', () => {
    const text = transferAgreement({ ...base, mode: 'license' })
    expect(text).toMatch(/LICENSE/)
    expect(text).toMatch(/keeps their own copy/)
  })

  it('always states the no-third-party-data and ownership consent, and the 72h dispute window', () => {
    const text = transferAgreement({ ...base, mode: 'license' })
    expect(text).toMatch(/no personal data about third parties/)
    expect(text).toMatch(/owns the content/)
    expect(text).toMatch(/72 hours/)
  })

  it('is a pure function: same input, same output', () => {
    const a = transferAgreement({ ...base, mode: 'exclusive' })
    const b = transferAgreement({ ...base, mode: 'exclusive' })
    expect(a).toBe(b)
  })

  it('clamps negative price cents to $0.00 rather than printing a negative price', () => {
    const text = transferAgreement({ ...base, mode: 'license', priceCents: -500 })
    expect(text).toContain('$0.00')
  })
})
