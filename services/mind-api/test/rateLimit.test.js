import { describe, it, expect, vi, afterEach } from 'vitest'
import { makeLimiter } from '../src/rateLimit.js'

afterEach(() => {
  vi.useRealTimers()
})

describe('makeLimiter (token bucket)', () => {
  it('allows up to `capacity` requests immediately, then denies', () => {
    const allow = makeLimiter({ capacity: 3, refillPerSec: 0 })
    expect(allow('k')).toBe(true)
    expect(allow('k')).toBe(true)
    expect(allow('k')).toBe(true)
    expect(allow('k')).toBe(false)
  })

  it('tracks separate buckets per key', () => {
    const allow = makeLimiter({ capacity: 1, refillPerSec: 0 })
    expect(allow('a')).toBe(true)
    expect(allow('b')).toBe(true) // different key — its own bucket
    expect(allow('a')).toBe(false)
  })

  it('refills over time', () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const allow = makeLimiter({ capacity: 1, refillPerSec: 1 })
    expect(allow('k')).toBe(true)
    expect(allow('k')).toBe(false)
    vi.setSystemTime(1500) // 1.5s later — one token back
    expect(allow('k')).toBe(true)
  })
})
