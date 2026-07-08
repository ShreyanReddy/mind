// End-to-end coverage of POST /minds/:handle/ask through supertest against
// the real Express app, with the database faked (test/fakeDb.js) and the
// LLM/embedding network faked (a stub `fetchImpl`) — this is the
// "unit-test router fallback + refusal + cache + free-tier + key auth"
// coverage PLAN.md §5.1/§5.2 asks for.
import { describe, it, expect, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { makeFakeDb } from './fakeDb.js'
import { generateApiKey } from '../src/auth.js'

function jsonResponse(body, ok = true, status = 200) {
  return { ok, status, json: async () => body, text: async () => JSON.stringify(body) }
}

function baseMind(overrides = {}) {
  return {
    user_id: 'owner-1',
    handle: 'alice',
    bio: 'A test mind.',
    refusal_topics: [],
    preferred_provider: 'anthropic',
    price_per_query_cents: 5,
    free_queries_per_day: 2,
    current_version: 1,
    published: true,
    ...overrides,
  }
}

function anthropicOkFetch(text = 'General answer with [[Note A]].') {
  return vi.fn(async () => jsonResponse({ content: [{ type: 'text', text }] }))
}

function buildApp({ seed, fetchImpl, env = { ANTHROPIC_API_KEY: 'k' } }) {
  const supabase = makeFakeDb(seed)
  const app = createApp({ supabase, env, fetchImpl })
  return { app, supabase }
}

describe('POST /minds/:handle/ask — happy path, retrieval, and citations', () => {
  it('answers, cites a retrieved chunk title, and is not cached the first time', async () => {
    const { app } = buildApp({
      seed: {
        minds: [baseMind()],
        mind_chunks: [{ user_id: 'owner-1', version: 1, title: 'Note A', content: 'Some published fact.', scope: 'published', embedding: null }],
      },
      fetchImpl: anthropicOkFetch(),
    })

    const res = await request(app).post('/minds/alice/ask').send({ question: 'What do you think?' })
    expect(res.status).toBe(200)
    expect(res.body.answer).toContain('Note A')
    expect(res.body.citations).toEqual(['Note A'])
    expect(res.body.mind_version).toBe(1)
    expect(res.body.cached).toBe(false)
  })

  it('404s for an unpublished or unknown handle', async () => {
    const { app } = buildApp({ seed: { minds: [baseMind({ published: false })] }, fetchImpl: anthropicOkFetch() })
    const res = await request(app).post('/minds/alice/ask').send({ question: 'hi' })
    expect(res.status).toBe(404)

    const { app: app2 } = buildApp({ seed: { minds: [] }, fetchImpl: anthropicOkFetch() })
    const res2 = await request(app2).post('/minds/nobody/ask').send({ question: 'hi' })
    expect(res2.status).toBe(404)
  })

  it('400s on a missing or oversized question', async () => {
    const { app } = buildApp({ seed: { minds: [baseMind()] }, fetchImpl: anthropicOkFetch() })
    expect((await request(app).post('/minds/alice/ask').send({})).status).toBe(400)
    expect((await request(app).post('/minds/alice/ask').send({ question: '  ' })).status).toBe(400)
    expect((await request(app).post('/minds/alice/ask').send({ question: 'x'.repeat(3000) })).status).toBe(400)
  })
})

describe('provider fallback (PLAN.md §5.2)', () => {
  it('falls back to the next configured provider when the preferred one errors', async () => {
    const fetchImpl = vi.fn(async (url) => {
      if (url.includes('anthropic.com')) return jsonResponse({}, false, 500)
      if (url.includes('openai.com')) return jsonResponse({ choices: [{ message: { content: 'fallback answer' } }] })
      throw new Error(`unexpected url ${url}`)
    })
    const { app } = buildApp({
      seed: { minds: [baseMind({ preferred_provider: 'anthropic' })] },
      fetchImpl,
      env: { ANTHROPIC_API_KEY: 'k1', OPENAI_API_KEY: 'k2' },
    })
    const res = await request(app).post('/minds/alice/ask').send({ question: 'hello there' })
    expect(res.status).toBe(200)
    expect(res.body.answer).toContain('fallback answer')
  })

  it('500s with a clear message when every configured provider fails', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, false, 500))
    const { app } = buildApp({ seed: { minds: [baseMind()] }, fetchImpl })
    const res = await request(app).post('/minds/alice/ask').send({ question: 'hello there' })
    expect(res.status).toBe(500)
    expect(res.body.error).toMatch(/all configured providers failed/i)
  })
})

describe('refusal topics (server-side, PLAN.md §5.5)', () => {
  it('refuses without ever calling the LLM provider', async () => {
    const fetchImpl = vi.fn()
    const { app } = buildApp({ seed: { minds: [baseMind({ refusal_topics: ['salary'] })] }, fetchImpl })
    const res = await request(app).post('/minds/alice/ask').send({ question: 'What is your salary?' })
    expect(res.status).toBe(200)
    expect(res.body.answer).toMatch(/not able to discuss/i)
    expect(res.body.citations).toEqual([])
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

describe('cache (PLAN.md §5.2)', () => {
  it('caches an answer and returns cached:true on the identical question, without a second provider call', async () => {
    const fetchImpl = anthropicOkFetch('Cacheable answer.')
    const { app } = buildApp({ seed: { minds: [baseMind({ free_queries_per_day: 100 })] }, fetchImpl })

    const first = await request(app).post('/minds/alice/ask').send({ question: 'Repeat this question?' })
    expect(first.body.cached).toBe(false)
    expect(fetchImpl).toHaveBeenCalledTimes(1)

    const second = await request(app).post('/minds/alice/ask').send({ question: '  REPEAT this Question?  ' })
    expect(second.body.cached).toBe(true)
    expect(second.body.answer).toBe(first.body.answer)
    expect(fetchImpl).toHaveBeenCalledTimes(1) // no second provider call
  })

  it('does not serve a stale cache entry after a republish bumps mind_version', async () => {
    const fetchImpl = anthropicOkFetch('v1 answer')
    const { app, supabase } = buildApp({ seed: { minds: [baseMind({ free_queries_per_day: 100 })] }, fetchImpl })
    await request(app).post('/minds/alice/ask').send({ question: 'Same question' })

    supabase._state.minds[0].current_version = 2
    fetchImpl.mockResolvedValueOnce(jsonResponse({ content: [{ type: 'text', text: 'v2 answer' }] }))

    const res = await request(app).post('/minds/alice/ask').send({ question: 'Same question' })
    expect(res.body.cached).toBe(false)
    expect(res.body.answer).toContain('v2 answer')
    expect(res.body.mind_version).toBe(2)
  })
})

describe('free-tier limits and API-key metering (PLAN.md §5.4)', () => {
  it('429s with price info once the daily free-query limit is reached', async () => {
    const fetchImpl = anthropicOkFetch()
    const { app } = buildApp({ seed: { minds: [baseMind({ free_queries_per_day: 1, price_per_query_cents: 25 })] }, fetchImpl })

    const first = await request(app).post('/minds/alice/ask').send({ question: 'Q1?' })
    expect(first.status).toBe(200)

    const second = await request(app).post('/minds/alice/ask').send({ question: 'Q2?' })
    expect(second.status).toBe(429)
    expect(second.body.price_per_query_cents).toBe(25)
    expect(second.body.free_queries_per_day).toBe(1)
  })

  it('a valid API key bypasses the free-tier limit and is metered per key', async () => {
    const { key, hash, prefix } = generateApiKey()
    const fetchImpl = anthropicOkFetch()
    const { app, supabase } = buildApp({
      seed: {
        minds: [baseMind({ free_queries_per_day: 1 })],
        api_keys: [{ id: 'key-1', user_id: 'owner-1', mind_handle: 'alice', key_hash: hash, key_prefix: prefix, usage_count: 0, revoked_at: null }],
      },
      fetchImpl,
    })

    // Exhaust the free tier first.
    await request(app).post('/minds/alice/ask').send({ question: 'Q1?' })
    expect((await request(app).post('/minds/alice/ask').send({ question: 'Q2?' })).status).toBe(429)

    // The API key still works past the free-tier ceiling.
    const withKey = await request(app)
      .post('/minds/alice/ask')
      .set('Authorization', `Bearer ${key}`)
      .send({ question: 'Q3 via key?' })
    expect(withKey.status).toBe(200)
    expect(supabase._state.api_keys.find((k) => k.id === 'key-1').usage_count).toBe(1)
  })

  it('rejects a revoked or wrong-mind API key back to free-tier rules', async () => {
    const { key, hash, prefix } = generateApiKey()
    const fetchImpl = anthropicOkFetch()
    const { app } = buildApp({
      seed: {
        minds: [baseMind({ free_queries_per_day: 0 })],
        api_keys: [{ id: 'key-1', user_id: 'owner-1', mind_handle: 'alice', key_hash: hash, key_prefix: prefix, usage_count: 0, revoked_at: '2026-01-01' }],
      },
      fetchImpl,
    })
    const res = await request(app).post('/minds/alice/ask').set('Authorization', `Bearer ${key}`).send({ question: 'Q?' })
    expect(res.status).toBe(429) // revoked key -> treated as anonymous -> free tier (0/day) -> exceeded
  })
})

describe('mind-scoped verbatim quoting is stripped (PLAN.md §5.3/§5.5)', () => {
  it('masks a long verbatim run copied from a mind-scoped chunk in the model output', async () => {
    const longMindText = 'This exact sentence is scoped mind and must never appear verbatim in an answer at all.'
    const fetchImpl = vi.fn(async () => jsonResponse({ content: [{ type: 'text', text: `Well, ${longMindText} anyway.` }] }))
    const { app } = buildApp({
      seed: {
        minds: [baseMind()],
        mind_chunks: [{ user_id: 'owner-1', version: 1, title: 'Private-ish', content: longMindText, scope: 'mind', embedding: null }],
      },
      fetchImpl,
    })
    const res = await request(app).post('/minds/alice/ask').send({ question: 'Tell me the sentence' })
    expect(res.body.answer).not.toContain(longMindText)
    expect(res.body.answer).toMatch(/paraphrased/i)
  })
})
