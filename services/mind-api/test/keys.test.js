import { describe, it, expect } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { makeFakeDb } from './fakeDb.js'
import { API_KEY_PREFIX, hashApiKey, generateApiKey } from '../src/auth.js'

function appWithUser(seed, user) {
  const supabase = makeFakeDb(seed)
  supabase.auth.getUser = async (token) =>
    token === 'good-token' ? { data: { user }, error: null } : { data: { user: null }, error: new Error('bad token') }
  const app = createApp({ supabase, env: {} })
  return { app, supabase }
}

describe('POST /keys', () => {
  it('401s without a valid Supabase session', async () => {
    const { app } = appWithUser({}, { id: 'owner-1' })
    const res = await request(app).post('/keys').send({})
    expect(res.status).toBe(401)
  })

  it('400s when the caller has not published a mind yet', async () => {
    const { app } = appWithUser({ minds: [] }, { id: 'owner-1' })
    const res = await request(app).post('/keys').set('Authorization', 'Bearer good-token').send({})
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/publish/i)
  })

  it('creates a key, returning the plaintext exactly once, and persists only its hash', async () => {
    const { app, supabase } = appWithUser(
      { minds: [{ user_id: 'owner-1', handle: 'alice', published: true }] },
      { id: 'owner-1' }
    )
    const res = await request(app).post('/keys').set('Authorization', 'Bearer good-token').send({ label: 'CLI key' })
    expect(res.status).toBe(201)
    expect(res.body.key.startsWith(API_KEY_PREFIX)).toBe(true)
    expect(res.body.label).toBe('CLI key')

    const stored = supabase._state.api_keys.find((k) => k.id === res.body.id)
    expect(stored.key_hash).toBe(hashApiKey(res.body.key))
    expect(stored.mind_handle).toBe('alice')
    expect(JSON.stringify(supabase._state.api_keys)).not.toContain(res.body.key) // plaintext never persisted
  })
})

describe('DELETE /keys/:id', () => {
  it('401s without a valid session', async () => {
    const { app } = appWithUser({}, { id: 'owner-1' })
    const res = await request(app).delete('/keys/key-1')
    expect(res.status).toBe(401)
  })

  it("404s for a key the caller doesn't own", async () => {
    const { hash, prefix } = generateApiKey()
    const { app } = appWithUser(
      { api_keys: [{ id: 'key-1', user_id: 'someone-else', mind_handle: 'alice', key_hash: hash, key_prefix: prefix, revoked_at: null }] },
      { id: 'owner-1' }
    )
    const res = await request(app).delete('/keys/key-1').set('Authorization', 'Bearer good-token')
    expect(res.status).toBe(404)
  })

  it('revokes a key the caller owns', async () => {
    const { hash, prefix } = generateApiKey()
    const { app, supabase } = appWithUser(
      { api_keys: [{ id: 'key-1', user_id: 'owner-1', mind_handle: 'alice', key_hash: hash, key_prefix: prefix, revoked_at: null }] },
      { id: 'owner-1' }
    )
    const res = await request(app).delete('/keys/key-1').set('Authorization', 'Bearer good-token')
    expect(res.status).toBe(200)
    expect(res.body.revoked).toBe(true)
    expect(supabase._state.api_keys.find((k) => k.id === 'key-1').revoked_at).toBeTruthy()
  })
})
