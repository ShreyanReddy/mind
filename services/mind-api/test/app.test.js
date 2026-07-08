import { describe, it, expect } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { makeFakeDb } from './fakeDb.js'

describe('GET /healthz', () => {
  it('always responds ok, even with no supabase configured', async () => {
    const app = createApp({ supabase: null, env: {} })
    const res = await request(app).get('/healthz')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true })
  })
})

describe('missing configuration', () => {
  it('503s every route except /healthz when supabase is not configured', async () => {
    const app = createApp({ supabase: null, env: {} })
    const res = await request(app).get('/minds/alice')
    expect(res.status).toBe(503)
  })
})

describe('CORS', () => {
  it('answers preflight OPTIONS requests and sets permissive CORS headers on real ones', async () => {
    const app = createApp({ supabase: makeFakeDb(), env: {} })
    const preflight = await request(app).options('/minds/alice/ask')
    expect(preflight.status).toBe(204)
    expect(preflight.headers['access-control-allow-origin']).toBe('*')

    const res = await request(app).get('/healthz')
    expect(res.headers['access-control-allow-origin']).toBe('*')
  })
})

describe('unknown routes', () => {
  it('404s with a JSON error', async () => {
    const app = createApp({ supabase: makeFakeDb(), env: {} })
    const res = await request(app).get('/this-route-does-not-exist')
    expect(res.status).toBe(404)
    expect(res.body.error).toBeTruthy()
  })
})
