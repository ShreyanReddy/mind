import { describe, it, expect } from 'vitest'
import { fuzzyScore } from '../fuzzy.js'

describe('fuzzyScore (subsequence fuzzy match)', () => {
  it('matches an exact case-insensitive string with a high score', () => {
    expect(fuzzyScore('graph', 'Open Graph')).toBeGreaterThan(0)
  })

  it('matches a subsequence spread across the target', () => {
    expect(fuzzyScore('opgh', 'Open Graph')).toBeGreaterThan(0)
  })

  it('returns -1 when the query is not a subsequence of the target', () => {
    expect(fuzzyScore('xyz', 'Open Graph')).toBe(-1)
  })

  it('scores consecutive-character matches higher than scattered ones', () => {
    const consecutive = fuzzyScore('new', 'New note')
    const scattered = fuzzyScore('new', 'Not everyone wins')
    expect(consecutive).toBeGreaterThan(scattered)
  })

  it('treats an empty query as a zero-score match (matches everything)', () => {
    expect(fuzzyScore('', 'Anything')).toBe(0)
  })
})
