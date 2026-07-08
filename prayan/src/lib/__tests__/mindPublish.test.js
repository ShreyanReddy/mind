// Publish pipeline — PLAN.md §5.3. Network (`getSupabase`, `getMyProfile`,
// and the `embed` Edge Function via supabase.functions.invoke) is mocked;
// chunking/gap-detection is the real retrieval.js so the shapes it produces
// are genuinely exercised.
import { describe, it, expect, vi, beforeEach } from 'vitest'

let mockClient = null

vi.mock('../supabase.js', () => ({
  backendConfigured: true,
  getSupabase: () => mockClient,
}))

vi.mock('../marketplace.js', () => ({
  getMyProfile: vi.fn(async () => ({ handle: 'alice' })),
}))

import { vault } from '../store.js'
import { getMyProfile } from '../marketplace.js'
import { chunkKey } from '../embeddings.js'
import { publishPreview, publishMind, unpublishMind, getMyMind, rateSampleAnswer } from '../mindPublish.js'

/** A minimal chainable query-builder stand-in, same shape as marketplace.test.js's. */
function chain(result) {
  const calls = []
  const b = {
    select: (...a) => (calls.push(['select', a]), b),
    eq: (...a) => (calls.push(['eq', a]), b),
    order: (...a) => (calls.push(['order', a]), b),
    maybeSingle: (...a) => (calls.push(['maybeSingle', a]), b),
    single: (...a) => (calls.push(['single', a]), b),
    insert: (...a) => (calls.push(['insert', a]), b),
    update: (...a) => (calls.push(['update', a]), b),
    upsert: (...a) => (calls.push(['upsert', a]), b),
    delete: (...a) => (calls.push(['delete', a]), b),
    then: (resolve, reject) => Promise.resolve(typeof result === 'function' ? result() : result).then(resolve, reject),
    calls,
  }
  return b
}

function makeSupabase({ tables = {}, invoke, user = { id: 'user-1' } } = {}) {
  const fromCalls = []
  return {
    auth: { getUser: async () => ({ data: { user } }) },
    from: (table) => {
      fromCalls.push(table)
      const spec = tables[table]
      return chain(typeof spec === 'function' ? spec : spec ?? { data: null, error: null })
    },
    functions: { invoke: invoke || vi.fn(async () => ({ data: { vectors: [], model: 'test' }, error: null })) },
    _fromCalls: fromCalls,
  }
}

beforeEach(() => {
  mockClient = null
  vi.clearAllMocks()
  getMyProfile.mockResolvedValue({ handle: 'alice' })
})

describe('publishPreview', () => {
  it('counts shareable chunks per scope and reports private/shareable note totals, from an explicit state (no network)', () => {
    const state = {
      notes: [
        { id: 'a', title: 'A', body: 'private stuff', scope: 'private' },
        { id: 'b', title: 'B', body: 'mind stuff, shared for retrieval only', scope: 'mind' },
        { id: 'c', title: 'C', body: 'published stuff, quotable', scope: 'published' },
      ],
    }
    const preview = publishPreview(state)
    expect(preview.totalNotes).toBe(3)
    expect(preview.privateNotes).toBe(1)
    expect(preview.shareableNotes).toBe(2)
    expect(preview.mindChunks).toBe(1)
    expect(preview.publishedChunks).toBe(1)
    expect(preview.totalChunks).toBe(2)
  })

  it('never counts private notes into any shareable bucket, even with a large body', () => {
    const state = { notes: [{ id: 'a', title: 'A', body: 'x'.repeat(5000), scope: 'private' }] }
    const preview = publishPreview(state)
    expect(preview.mindChunks).toBe(0)
    expect(preview.publishedChunks).toBe(0)
    expect(preview.totalChunks).toBe(0)
  })
})

describe('publishMind', () => {
  it('chunks only mind/published notes, embeds them, deletes+reinserts mind_chunks, and upserts the minds row under a bumped version', async () => {
    vault.createNote('Private note')
    const mindNote = vault.createNote('Mind note')
    vault.updateNote(mindNote.id, { body: 'informs answers but is never quoted verbatim', scope: 'mind' })
    const pubNote = vault.createNote('Published note')
    vault.updateNote(pubNote.id, { body: 'fully quotable content', scope: 'published' })

    let insertedChunks = null
    let upsertedMind = null
    const deleteCalls = []
    mockClient = makeSupabase({
      invoke: vi.fn(async (name, { body }) => {
        expect(name).toBe('embed')
        return { data: { vectors: body.texts.map(() => [0.1, 0.2, 0.3]), model: 'test-embed' }, error: null }
      }),
    })
    mockClient.from = (table) => {
      mockClient._fromCalls.push(table)
      if (table === 'minds') {
        // Distinguishing the initial select() (current_version lookup) from the
        // terminal upsert().select().single() by call shape isn't worth the
        // complexity here — .maybeSingle()/.single() are overridden directly
        // instead, since each is only ever called once, in a known position.
        const b = chain(() => ({ data: upsertedMind, error: null }))
        b.maybeSingle = () => Promise.resolve({ data: { current_version: 2 }, error: null })
        b.upsert = (row) => {
          upsertedMind = { ...row }
          return b
        }
        b.single = () => Promise.resolve({ data: upsertedMind, error: null })
        return b
      }
      if (table === 'mind_chunks') {
        const b = chain({ data: null, error: null })
        b.delete = (...a) => {
          deleteCalls.push(a)
          return b
        }
        b.insert = (rows) => {
          insertedChunks = rows
          return Promise.resolve({ data: null, error: null })
        }
        return b
      }
      throw new Error(`unexpected table: ${table}`)
    }

    const result = await publishMind({
      bio: 'A test mind',
      sampleQuestions: ['What do you believe?'],
      pricePerQueryCents: 5,
      freeQueriesPerDay: 10,
      digestOptIn: true,
    })

    expect(deleteCalls).toHaveLength(1)
    expect(insertedChunks).toHaveLength(2)
    expect(insertedChunks.map((r) => r.scope).sort()).toEqual(['mind', 'published'])
    expect(insertedChunks.every((r) => r.version === 3)).toBe(true)
    expect(insertedChunks.every((r) => Array.isArray(r.embedding))).toBe(true)
    expect(insertedChunks.some((r) => r.title === 'Mind note')).toBe(true)
    expect(insertedChunks.some((r) => r.title === 'Published note')).toBe(true)
    // chunk_key is deterministic — matches embeddings.js's own chunkKey for the same noteId+text.
    const pub = insertedChunks.find((r) => r.title === 'Published note')
    expect(pub.chunk_key).toBe(chunkKey(pubNote.id, 'fully quotable content'))

    expect(upsertedMind.handle).toBe('alice')
    expect(upsertedMind.current_version).toBe(3)
    expect(upsertedMind.published).toBe(true)
    expect(upsertedMind.price_per_query_cents).toBe(5)
    expect(upsertedMind.free_queries_per_day).toBe(10)
    expect(upsertedMind.digest_opt_in).toBe(true)
    expect(upsertedMind.note_count).toBe(vault.get().notes.length)

    expect(result).toBe(upsertedMind)
  })

  it('still publishes (with null embeddings) when the embed function fails — BM25 fallback covers it server-side', async () => {
    const note = vault.createNote('Fallback note')
    vault.updateNote(note.id, { body: 'some shareable content here', scope: 'mind' })

    let insertedChunks = null
    mockClient = makeSupabase({ invoke: vi.fn(async () => ({ data: null, error: new Error('embed down') })) })
    mockClient.from = (table) => {
      if (table === 'minds') {
        const b = chain({ data: null, error: null })
        b.maybeSingle = () => Promise.resolve({ data: null, error: null })
        b.single = () => Promise.resolve({ data: { handle: 'alice' }, error: null })
        return b
      }
      if (table === 'mind_chunks') {
        const b = chain({ data: null, error: null })
        b.insert = (rows) => {
          insertedChunks = rows
          return Promise.resolve({ data: null, error: null })
        }
        return b
      }
      throw new Error(`unexpected table: ${table}`)
    }

    await publishMind({})
    expect(insertedChunks.every((r) => r.embedding === null)).toBe(true)
  })

  it('refuses to publish when the caller has no profile handle', async () => {
    getMyProfile.mockResolvedValueOnce({ handle: '' })
    mockClient = makeSupabase()
    await expect(publishMind({})).rejects.toThrow(/handle/i)
  })
})

describe('unpublishMind', () => {
  it('deletes this owner\'s mind_chunks and flips published off', async () => {
    let deleted = false
    let updated = null
    mockClient = makeSupabase()
    mockClient.from = (table) => {
      if (table === 'mind_chunks') {
        const b = chain({ data: null, error: null })
        b.delete = () => {
          deleted = true
          return b
        }
        b.eq = () => Promise.resolve({ data: null, error: null })
        return b
      }
      if (table === 'minds') {
        const b = chain({ data: null, error: null })
        b.update = (patch) => {
          updated = patch
          return b
        }
        b.eq = () => Promise.resolve({ data: null, error: null })
        return b
      }
      throw new Error(`unexpected table: ${table}`)
    }

    await unpublishMind()
    expect(deleted).toBe(true)
    expect(updated).toEqual({ published: false, published_at: null })
  })
})

describe('getMyMind / rateSampleAnswer', () => {
  it('getMyMind returns the caller\'s own row, or null if never published', async () => {
    mockClient = makeSupabase({ tables: { minds: { data: { handle: 'alice', published: false }, error: null } } })
    const mind = await getMyMind()
    expect(mind.handle).toBe('alice')
  })

  it('rateSampleAnswer merges into voice_rating without clobbering other questions', async () => {
    let updatedPatch = null
    mockClient = makeSupabase()
    mockClient.from = (table) => {
      if (table === 'minds') {
        const b = chain({ data: { handle: 'alice', voice_rating: { 'Q1?': 4 } }, error: null })
        b.update = (patch) => {
          updatedPatch = patch
          return { eq: () => Promise.resolve({ data: null, error: null }) }
        }
        return b
      }
      throw new Error(`unexpected table: ${table}`)
    }

    const result = await rateSampleAnswer('Q2?', 5)
    expect(updatedPatch.voice_rating).toEqual({ 'Q1?': 4, 'Q2?': 5 })
    expect(result).toEqual({ 'Q1?': 4, 'Q2?': 5 })
  })
})
