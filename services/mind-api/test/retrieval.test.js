import { describe, it, expect } from 'vitest'
import { cosineSimilarity, lexicalScore, retrieveChunks } from '../src/retrieval.js'

describe('cosineSimilarity', () => {
  it('is 1 for identical vectors, 0 for orthogonal, -1 for opposite', () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1)
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0)
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1)
  })

  it('is 0 for a degenerate all-zero vector', () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0)
  })
})

describe('lexicalScore', () => {
  const chunks = [
    { title: 'Cooking', content: 'I love cooking pasta on weekends with fresh basil.' },
    { title: 'Finance', content: 'Budgeting and saving money is a core value of mine.' },
    { title: 'Empty', content: '' },
  ]

  it('ranks the chunk whose content matches the query terms highest', () => {
    const results = lexicalScore(chunks, 'cooking pasta', 5)
    expect(results[0].title).toBe('Cooking')
  })

  it('returns [] for an empty query or an empty chunk list', () => {
    expect(lexicalScore(chunks, '', 5)).toEqual([])
    expect(lexicalScore([], 'anything', 5)).toEqual([])
  })

  it('excludes chunks that score zero (no term overlap) once the chunk set is bigger than k', () => {
    const bigger = [...chunks, { title: 'D', content: 'more filler text here' }, { title: 'E', content: 'and yet more filler' }]
    const results = lexicalScore(bigger, 'cooking', 2)
    expect(results.map((r) => r.title)).toEqual(['Cooking'])
  })

  it('still includes a zero-score chunk when the whole set is no bigger than k — a small/new mind should not retrieval-starve', () => {
    const results = lexicalScore(chunks, 'cooking', 5)
    expect(results.map((r) => r.title)).toContain('Finance')
    expect(results.map((r) => r.title)).toContain('Empty')
  })

  it('respects the k limit', () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ title: `T${i}`, content: 'shared keyword content here' }))
    expect(lexicalScore(many, 'shared keyword', 3)).toHaveLength(3)
  })
})

describe('retrieveChunks', () => {
  const chunks = [
    { title: 'A', content: 'alpha content about mountains', embedding: [1, 0, 0] },
    { title: 'B', content: 'beta content about oceans', embedding: [0, 1, 0] },
    { title: 'C', content: 'gamma content, no embedding yet', embedding: null },
  ]

  it('uses cosine similarity against chunks that have an embedding when a query vector is available', () => {
    const results = retrieveChunks(chunks, { queryVector: [1, 0, 0], query: 'mountains' }, 2)
    expect(results[0].title).toBe('A')
    expect(results.some((r) => r.title === 'C')).toBe(false) // no embedding — excluded from the semantic pass
  })

  it('falls back to lexical scoring when no query vector is available', () => {
    const results = retrieveChunks(chunks, { queryVector: null, query: 'gamma' }, 5)
    expect(results[0].title).toBe('C')
  })

  it('falls back to lexical scoring when no chunk has an embedding at all', () => {
    const noVectors = chunks.map(({ title, content }) => ({ title, content, embedding: null }))
    const results = retrieveChunks(noVectors, { queryVector: [1, 0, 0], query: 'oceans' }, 5)
    expect(results[0].title).toBe('B')
  })
})
