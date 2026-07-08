import { describe, it, expect, vi } from 'vitest'
import { hashApiKey, generateApiKey, requireSupabaseUser, resolveApiKey, API_KEY_PREFIX } from '../src/auth.js'
import { makeMockSupabase } from './mockSupabase.js'

describe('generateApiKey / hashApiKey', () => {
  it('generates a key with the expected prefix, and hashes it deterministically', () => {
    const { key, hash, prefix } = generateApiKey()
    expect(key.startsWith(API_KEY_PREFIX)).toBe(true)
    expect(prefix.startsWith(API_KEY_PREFIX)).toBe(true)
    expect(hash).toBe(hashApiKey(key))
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('generates distinct keys on each call', () => {
    expect(generateApiKey().key).not.toBe(generateApiKey().key)
  })
})

describe('requireSupabaseUser', () => {
  function mockReqRes(authHeader) {
    const req = { headers: authHeader ? { authorization: authHeader } : {} }
    const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this }, json(b) { this.body = b; return this } }
    const next = vi.fn()
    return { req, res, next }
  }

  it('401s when no bearer token is present', async () => {
    const supabase = makeMockSupabase()
    const { req, res, next } = mockReqRes(undefined)
    await requireSupabaseUser(supabase)(req, res, next)
    expect(res.statusCode).toBe(401)
    expect(next).not.toHaveBeenCalled()
  })

  it('401s when the token is invalid', async () => {
    const supabase = makeMockSupabase({ getUserResult: { data: { user: null }, error: new Error('bad token') } })
    const { req, res, next } = mockReqRes('Bearer garbage')
    await requireSupabaseUser(supabase)(req, res, next)
    expect(res.statusCode).toBe(401)
    expect(next).not.toHaveBeenCalled()
  })

  it('sets req.user and calls next() on a valid token', async () => {
    const user = { id: 'user-1' }
    const supabase = makeMockSupabase({ getUserResult: { data: { user }, error: null } })
    const { req, res, next } = mockReqRes('Bearer good-token')
    await requireSupabaseUser(supabase)(req, res, next)
    expect(req.user).toBe(user)
    expect(next).toHaveBeenCalledTimes(1)
    expect(supabase.auth.getUser).toHaveBeenCalledWith('good-token')
  })
})

describe('resolveApiKey', () => {
  it('returns null when no bearer token is present, or it is not shaped like an api key', async () => {
    const supabase = makeMockSupabase()
    expect(await resolveApiKey(supabase, { headers: {} }, 'alice')).toBeNull()
    expect(await resolveApiKey(supabase, { headers: { authorization: 'Bearer some.jwt.token' } }, 'alice')).toBeNull()
  })

  it('returns null for a key that does not match any row, is revoked, or belongs to a different mind', async () => {
    const { key } = generateApiKey()
    const req = { headers: { authorization: `Bearer ${key}` } }

    const notFound = makeMockSupabase({ tables: { api_keys: { data: null, error: null } } })
    expect(await resolveApiKey(notFound, req, 'alice')).toBeNull()

    const revoked = makeMockSupabase({ tables: { api_keys: { data: { mind_handle: 'alice', revoked_at: '2026-01-01' }, error: null } } })
    expect(await resolveApiKey(revoked, req, 'alice')).toBeNull()

    const wrongMind = makeMockSupabase({ tables: { api_keys: { data: { mind_handle: 'bob', revoked_at: null }, error: null } } })
    expect(await resolveApiKey(wrongMind, req, 'alice')).toBeNull()
  })

  it('returns the row for a valid, unrevoked key belonging to the requested mind', async () => {
    const { key } = generateApiKey()
    const req = { headers: { authorization: `Bearer ${key}` } }
    const row = { id: 'k1', mind_handle: 'alice', revoked_at: null, usage_count: 4 }
    const supabase = makeMockSupabase({ tables: { api_keys: { data: row, error: null } } })
    expect(await resolveApiKey(supabase, req, 'alice')).toEqual(row)
  })
})
