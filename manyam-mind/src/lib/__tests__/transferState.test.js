import { describe, it, expect } from 'vitest'
import { canTransition, isTerminal, TRANSFER_STATUSES } from '../transferState.js'

describe('transferState.canTransition (client mirror of supabase/functions/_shared/stateMachine.ts)', () => {
  it('allows the happy path: escrowed -> delivered -> completed', () => {
    expect(canTransition('escrowed', 'delivered')).toBe(true)
    expect(canTransition('delivered', 'completed')).toBe(true)
  })

  it('allows refund/dispute only from delivered, and dispute can resolve to refunded', () => {
    expect(canTransition('delivered', 'refunded')).toBe(true)
    expect(canTransition('delivered', 'disputed')).toBe(true)
    expect(canTransition('disputed', 'refunded')).toBe(true)
  })

  it('also allows escrow-stage refund/dispute (before the key is ever delivered)', () => {
    expect(canTransition('escrowed', 'refunded')).toBe(true)
    expect(canTransition('escrowed', 'disputed')).toBe(true)
  })

  it('rejects skipping states (escrowed -> completed directly)', () => {
    expect(canTransition('escrowed', 'completed')).toBe(false)
  })

  it('rejects any transition out of a terminal state', () => {
    for (const terminal of ['completed', 'refunded']) {
      for (const to of TRANSFER_STATUSES) {
        expect(canTransition(terminal, to)).toBe(false)
      }
    }
  })

  it('rejects moving backwards (delivered -> escrowed)', () => {
    expect(canTransition('delivered', 'escrowed')).toBe(false)
  })

  it('rejects unknown states without throwing', () => {
    expect(canTransition('bogus', 'escrowed')).toBe(false)
    expect(canTransition('escrowed', 'bogus')).toBe(false)
  })

  it('identifies terminal states correctly', () => {
    expect(isTerminal('completed')).toBe(true)
    expect(isTerminal('refunded')).toBe(true)
    expect(isTerminal('escrowed')).toBe(false)
    expect(isTerminal('disputed')).toBe(false) // can still resolve to refunded
  })
})
