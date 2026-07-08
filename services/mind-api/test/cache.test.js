import { describe, it, expect } from 'vitest'
import { normalizeQuestion, questionHash, getCached, setCached } from '../src/cache.js'
import { makeMockSupabase } from './mockSupabase.js'

describe('normalizeQuestion / questionHash', () => {
  it('normalizes whitespace and case so trivially-different questions hash the same', () => {
    expect(normalizeQuestion('  What Do   You Think?  ')).toBe('what do you think?')
    expect(questionHash('What do you think?')).toBe(questionHash('  what   DO you think?  '))
  })

  it('produces different hashes for genuinely different questions', () => {
    expect(questionHash('a')).not.toBe(questionHash('b'))
  })

  it('is a hex sha-256 (64 chars)', () => {
    expect(questionHash('anything')).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('getCached / setCached', () => {
  it('getCached queries by mind_handle, version, and question_hash', async () => {
    const supabase = makeMockSupabase({ tables: { ask_cache: { data: { answer: { answer: 'hi', citations: [] } }, error: null } } })
    const result = await getCached(supabase, { mindHandle: 'alice', version: 3, question: 'What do you think?' })
    expect(result).toEqual({ answer: 'hi', citations: [] })
    expect(supabase._fromCalls).toContain('ask_cache')
  })

  it('getCached returns null on a cache miss', async () => {
    const supabase = makeMockSupabase({ tables: { ask_cache: { data: null, error: null } } })
    expect(await getCached(supabase, { mindHandle: 'alice', version: 1, question: 'x' })).toBeNull()
  })

  it('setCached upserts keyed by mind_handle/version/question_hash', async () => {
    let upserted = null
    const supabase = makeMockSupabase()
    supabase.from = (table) => {
      expect(table).toBe('ask_cache')
      return {
        upsert: (row) => {
          upserted = row
          return Promise.resolve({ data: null, error: null })
        },
      }
    }
    await setCached(supabase, { mindHandle: 'alice', version: 2, question: 'Hello?', answer: { answer: 'hi' } })
    expect(upserted.mind_handle).toBe('alice')
    expect(upserted.version).toBe(2)
    expect(upserted.question_hash).toBe(questionHash('Hello?'))
    expect(upserted.answer).toEqual({ answer: 'hi' })
  })
})
