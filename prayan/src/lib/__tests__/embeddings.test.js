// PLAN.md §4.1 — embedding retrieval client. Network (`embed` Edge
// Function) is mocked via ../supabase.js; the Dexie `vectors` cache is
// real (fake-indexeddb, wired in src/test/setup.js) so cache-hit vs
// cache-miss behavior is genuinely exercised.
import { describe, it, expect, vi, beforeEach } from 'vitest'

let mockSupabase = null
vi.mock('../supabase.js', () => ({
  backendConfigured: true,
  getSupabase: () => mockSupabase,
}))

import { db } from '../db.js'
import { chunkKey, cosineSimilarity, getVectors, coverage, ensureEmbeddings, embedQuery, pruneVectors } from '../embeddings.js'

beforeEach(async () => {
  mockSupabase = null
  await db.vectors.clear()
})

describe('chunkKey', () => {
  it('is stable for identical noteId+text and changes when the text changes', () => {
    expect(chunkKey('note-1', 'hello world')).toBe(chunkKey('note-1', 'hello world'))
    expect(chunkKey('note-1', 'hello world')).not.toBe(chunkKey('note-1', 'hello world!'))
  })

  it('differs across notes even with identical text', () => {
    expect(chunkKey('a', 'same text')).not.toBe(chunkKey('b', 'same text'))
  })
})

describe('cosineSimilarity', () => {
  it('is 1 for identical vectors, ~0 for orthogonal, -1 for opposite', () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1)
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0)
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1)
  })

  it('is 0 for a degenerate all-zero vector rather than NaN', () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0)
  })
})

describe('ensureEmbeddings / coverage — cache behavior', () => {
  it('embeds a chunk once, then serves it from cache without a second network call', async () => {
    const invoke = vi.fn(async (_name, { body }) => ({
      data: { vectors: body.texts.map(() => [1, 0, 0]), model: 'test-model' },
      error: null,
    }))
    mockSupabase = { functions: { invoke } }

    const chunks = [{ noteId: 'n1', title: 'N1', text: 'hello world' }]
    const first = await ensureEmbeddings(chunks)
    expect(first.size).toBe(1)
    expect(invoke).toHaveBeenCalledTimes(1)
    expect(await coverage(chunks)).toBe(1)

    const second = await ensureEmbeddings(chunks)
    expect(second.size).toBe(1)
    expect(invoke).toHaveBeenCalledTimes(1) // cache hit — no second call
  })

  it('re-embeds a chunk whose text changed while an unchanged sibling chunk stays cached', async () => {
    const invoke = vi.fn(async (_name, { body }) => ({
      data: { vectors: body.texts.map(() => [0, 1, 0]), model: 'test-model' },
      error: null,
    }))
    mockSupabase = { functions: { invoke } }

    const chunkB = { noteId: 'n2', title: 'N2', text: 'unrelated note, never edited' }
    await ensureEmbeddings([{ noteId: 'n1', title: 'N1', text: 'version one' }, chunkB])
    expect(invoke).toHaveBeenCalledTimes(1)

    invoke.mockClear()
    const chunkAEdited = { noteId: 'n1', title: 'N1', text: 'version two — edited' }
    const result = await ensureEmbeddings([chunkAEdited, chunkB])

    expect(invoke).toHaveBeenCalledTimes(1) // only the edited chunk re-embedded
    expect(invoke.mock.calls[0][1].body.texts).toEqual(['version two — edited'])
    expect(result.size).toBe(2) // both chunks still resolve to a vector (one cached, one fresh)
  })

  it('falls back to whatever is cached (never throws) when the embed function errors', async () => {
    mockSupabase = { functions: { invoke: vi.fn(async () => ({ data: null, error: new Error('boom') })) } }
    const chunks = [{ noteId: 'n1', title: 'N1', text: 'x' }]
    const result = await ensureEmbeddings(chunks)
    expect(result.size).toBe(0)
    expect(await coverage(chunks)).toBe(0)
  })

  it('coverage() is cache-only and never calls the network', async () => {
    const invoke = vi.fn()
    mockSupabase = { functions: { invoke } }
    expect(await coverage([{ noteId: 'n1', title: 'N1', text: 'x' }])).toBe(0)
    expect(invoke).not.toHaveBeenCalled()
  })
})

describe('embedQuery', () => {
  it('returns the vector for a live query embed', async () => {
    mockSupabase = { functions: { invoke: vi.fn(async () => ({ data: { vectors: [[1, 2, 3]], model: 'm' }, error: null })) } }
    expect(await embedQuery('what do you value?')).toEqual([1, 2, 3])
  })

  it('returns null (not throws) when there is no supabase client', async () => {
    mockSupabase = null
    expect(await embedQuery('anything')).toBeNull()
  })

  it('returns null for an empty query', async () => {
    mockSupabase = { functions: { invoke: vi.fn() } }
    expect(await embedQuery('  ')).toBeNull()
  })
})

describe('getVectors', () => {
  it('returns only the chunks that have a cached vector', async () => {
    mockSupabase = { functions: { invoke: vi.fn(async () => ({ data: { vectors: [[1]], model: 'm' }, error: null })) } }
    const cached = { noteId: 'n1', title: 'N1', text: 'cached' }
    const notCached = { noteId: 'n2', title: 'N2', text: 'never embedded' }
    await ensureEmbeddings([cached])

    const map = await getVectors([cached, notCached])
    expect(map.size).toBe(1)
    expect(map.get(chunkKey('n1', 'cached'))).toEqual([1])
  })
})

describe('pruneVectors', () => {
  it('drops cached vectors for chunks that no longer exist', async () => {
    mockSupabase = { functions: { invoke: vi.fn(async () => ({ data: { vectors: [[1]], model: 'm' }, error: null })) } }
    const stale = [{ noteId: 'gone', title: 'Gone', text: 'old text' }]
    await ensureEmbeddings(stale)
    expect(await coverage(stale)).toBe(1)

    await pruneVectors([]) // nothing is valid anymore
    expect(await coverage(stale)).toBe(0)
  })

  it('keeps vectors for chunks that are still current', async () => {
    mockSupabase = { functions: { invoke: vi.fn(async () => ({ data: { vectors: [[1]], model: 'm' }, error: null })) } }
    const keep = { noteId: 'n1', title: 'N1', text: 'still here' }
    await ensureEmbeddings([keep])
    await pruneVectors([keep])
    expect(await coverage([keep])).toBe(1)
  })
})
