import { describe, it, expect } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { renderMindPage } from '../src/routes/minds.js'
import { makeFakeDb } from './fakeDb.js'

function publicMindRow(overrides = {}) {
  return {
    handle: 'alice',
    bio: 'A test mind.',
    note_count: 12,
    link_count: 30,
    sample_questions: ['What do you believe?'],
    price_per_query_cents: 0,
    free_queries_per_day: 25,
    current_version: 1,
    published_at: '2026-07-08T00:00:00.000Z',
    ...overrides,
  }
}

describe('GET /minds/:handle', () => {
  it('returns the public profile for a published mind', async () => {
    const supabase = makeFakeDb({ public_minds: [publicMindRow()] })
    const app = createApp({ supabase, env: {} })
    const res = await request(app).get('/minds/alice')
    expect(res.status).toBe(200)
    expect(res.body.handle).toBe('alice')
    expect(res.body.refusal_topics).toBeUndefined() // public_minds never exposes this
  })

  it('404s for an unknown or unpublished handle', async () => {
    const supabase = makeFakeDb({ public_minds: [] })
    const app = createApp({ supabase, env: {} })
    const res = await request(app).get('/minds/nobody')
    expect(res.status).toBe(404)
  })
})

describe('GET /minds/:handle/page', () => {
  it('renders self-contained HTML with bio, stats, sample questions, and a curl example', async () => {
    const supabase = makeFakeDb({ public_minds: [publicMindRow()] })
    const app = createApp({ supabase, env: {}, apiBaseUrl: 'https://mind-api.example.com' })
    const res = await request(app).get('/minds/alice/page')
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/text\/html/)
    expect(res.text).toContain('A test mind.')
    expect(res.text).toContain('What do you believe?')
    expect(res.text).toContain('curl -X POST https://mind-api.example.com/minds/alice/ask')
    expect(res.text).not.toMatch(/<script src=/) // no external script requests
    expect(res.text).not.toMatch(/https?:\/\/(?!mind-api\.example\.com)/) // no other external references
  })

  it('404s (plain text) for an unpublished handle', async () => {
    const supabase = makeFakeDb({ public_minds: [] })
    const app = createApp({ supabase, env: {} })
    const res = await request(app).get('/minds/nobody/page')
    expect(res.status).toBe(404)
  })

  it('escapes HTML in bio/handle/questions to prevent injection', () => {
    const html = renderMindPage(publicMindRow({ bio: '<script>alert(1)</script>', sample_questions: ['<img src=x onerror=alert(1)>'] }))
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).not.toContain('<img src=x onerror=alert(1)>')
  })
})
