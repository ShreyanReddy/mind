// PLAN.md §4.1 — retrieve() blends either BM25+strength (lexical, the v2
// default/fallback) or cosine+strength (semantic, opt-in). Embeddings are
// mocked here so the semantic path is exercised deterministically with
// injected fake vectors, without any real network/Dexie involvement.
import { describe, it, expect, vi, beforeEach } from 'vitest'

// vi.mock factories are hoisted above imports/top-level consts, so the mock
// object itself must be created via vi.hoisted() to be visible inside it.
const embeddingsMock = vi.hoisted(() => ({
  embeddingsConfigured: vi.fn(() => false),
  coverage: vi.fn(async () => 0),
  embedQuery: vi.fn(async () => null),
  getVectors: vi.fn(async () => new Map()),
  cosineSimilarity: (a, b) => {
    const n = Math.min(a.length, b.length)
    let dot = 0, na = 0, nb = 0
    for (let i = 0; i < n; i++) {
      dot += a[i] * b[i]
      na += a[i] * a[i]
      nb += b[i] * b[i]
    }
    if (!na || !nb) return 0
    return dot / (Math.sqrt(na) * Math.sqrt(nb))
  },
  chunkKey: (noteId, text) => `${noteId}:${text.length}`,
}))

vi.mock('../embeddings.js', () => embeddingsMock)

import { retrieve, retrievalMode, chunkVault, knowledgeGaps } from '../retrieval.js'

function note({ id, title, body, edits = 1 }) {
  const now = Date.now()
  return { id, title, body, folder: '', tags: [], aliases: [], createdAt: now, updatedAt: now, edits }
}

function state(notes, persona = {}) {
  return { notes, persona: { semanticRetrieval: false, ...persona } }
}

beforeEach(() => {
  vi.clearAllMocks()
  embeddingsMock.embeddingsConfigured.mockReturnValue(false)
  embeddingsMock.coverage.mockResolvedValue(0)
  embeddingsMock.embedQuery.mockResolvedValue(null)
  embeddingsMock.getVectors.mockResolvedValue(new Map())
})

const notes = [
  note({ id: 'a', title: 'Cooking', body: 'I love slow-cooked stews and braises on cold weekends.' }),
  note({ id: 'b', title: 'Travel', body: 'I want to visit Japan and Peru someday.' }),
]

describe('retrieve — lexical (default / fallback)', () => {
  it('ranks the chunk whose words actually match the query first', async () => {
    const results = await retrieve(state(notes), 'stews and braises', 5)
    expect(results[0].noteId).toBe('a')
  })

  it('returns [] for an empty query or an empty vault', async () => {
    expect(await retrieve(state([]), 'anything')).toEqual([])
    expect(await retrieve(state(notes), '')).toEqual([])
  })

  it('never calls the embedding module when semanticRetrieval is off', async () => {
    await retrieve(state(notes, { semanticRetrieval: false }), 'stews', 5)
    expect(embeddingsMock.embedQuery).not.toHaveBeenCalled()
  })
})

describe('retrieve / retrievalMode — semantic path (PLAN.md §4.1)', () => {
  it('uses cosine+strength scoring when opted in, backend configured, and coverage is sufficient', async () => {
    embeddingsMock.embeddingsConfigured.mockReturnValue(true)
    embeddingsMock.coverage.mockResolvedValue(1)
    embeddingsMock.embedQuery.mockResolvedValue([1, 0])

    const chunks = chunkVault(notes)
    const vectors = new Map()
    for (const c of chunks) vectors.set(embeddingsMock.chunkKey(c.noteId, c.text), c.noteId === 'a' ? [1, 0] : [0, 1])
    embeddingsMock.getVectors.mockResolvedValue(vectors)

    const s = state(notes, { semanticRetrieval: true })
    const results = await retrieve(s, 'irrelevant keywords', 5)
    expect(results[0].noteId).toBe('a') // cosine similarity to [1,0] wins, even with keyword-free query
    expect(await retrievalMode(s)).toBe('semantic')
  })

  it('falls back to lexical when cached-vector coverage is too low', async () => {
    embeddingsMock.embeddingsConfigured.mockReturnValue(true)
    embeddingsMock.coverage.mockResolvedValue(0.1)
    const s = state(notes, { semanticRetrieval: true })

    expect(await retrievalMode(s)).toBe('lexical')
    const results = await retrieve(s, 'stews and braises', 5)
    expect(results[0].noteId).toBe('a')
    expect(embeddingsMock.embedQuery).not.toHaveBeenCalled() // never even tries the live embed
  })

  it('falls back to lexical when the live query embed fails', async () => {
    embeddingsMock.embeddingsConfigured.mockReturnValue(true)
    embeddingsMock.coverage.mockResolvedValue(1)
    embeddingsMock.embedQuery.mockResolvedValue(null)

    const results = await retrieve(state(notes, { semanticRetrieval: true }), 'stews and braises', 5)
    expect(results[0].noteId).toBe('a')
  })

  it('stays lexical when the owner has not opted in, even with full coverage available', async () => {
    embeddingsMock.embeddingsConfigured.mockReturnValue(true)
    embeddingsMock.coverage.mockResolvedValue(1)
    embeddingsMock.embedQuery.mockResolvedValue([1, 0])
    expect(await retrievalMode(state(notes, { semanticRetrieval: false }))).toBe('lexical')
  })

  it('stays lexical when the backend is not configured, even with the opt-in on', async () => {
    embeddingsMock.embeddingsConfigured.mockReturnValue(false)
    expect(await retrievalMode(state(notes, { semanticRetrieval: true }))).toBe('lexical')
  })
})

describe('chunkVault / knowledgeGaps (unchanged v2 behavior)', () => {
  it('splits a note into chunks tagged with its own noteId', () => {
    const chunks = chunkVault([note({ id: 'a', title: 'A', body: 'para one\n\npara two' })])
    expect(chunks.length).toBeGreaterThan(0)
    expect(chunks.every((c) => c.noteId === 'a')).toBe(true)
  })

  it('surfaces the weakest (least-edited/connected) notes first', () => {
    const gapNotes = [
      note({ id: 'a', title: 'Strong', body: 'x', edits: 10 }),
      note({ id: 'b', title: 'Weak', body: 'x', edits: 0 }),
    ]
    expect(knowledgeGaps(state(gapNotes), 2)[0]).toBe('Weak')
  })
})
