// PLAN.md §4.3 — chat() routes to the server proxy, the developer-mode
// direct call, or a clear error. resolveRoute() is the pure decision table;
// chat() is exercised end-to-end against mocked fetch (direct path) and a
// mocked supabase client (proxy path).
import { describe, it, expect, vi, beforeEach } from 'vitest'

let mockSupabase = null
vi.mock('../supabase.js', () => ({
  getSupabase: () => mockSupabase,
}))

import { chat, resolveRoute, PROVIDERS } from '../llm.js'

beforeEach(() => {
  mockSupabase = null
})

describe('resolveRoute — routing matrix', () => {
  const persona = { provider: 'anthropic', keys: { anthropic: 'sk-x' } }

  it('proxy: backend configured + signed in + developer mode off', () => {
    expect(resolveRoute({ persona, backendConfigured: true, signedIn: true })).toEqual({ mode: 'proxy' })
  })

  it('direct: developer mode on with a key set, regardless of backend/sign-in', () => {
    const devPersona = { ...persona, developerMode: true }
    expect(resolveRoute({ persona: devPersona, backendConfigured: true, signedIn: true })).toEqual({
      mode: 'direct',
      apiKey: 'sk-x',
    })
    expect(resolveRoute({ persona: devPersona, backendConfigured: false, signedIn: false })).toEqual({
      mode: 'direct',
      apiKey: 'sk-x',
    })
  })

  it('developer mode wins over an available proxy path', () => {
    const devPersona = { ...persona, developerMode: true }
    expect(resolveRoute({ persona: devPersona, backendConfigured: true, signedIn: true }).mode).toBe('direct')
  })

  it('error: developer mode on but no key configured for the active provider', () => {
    const route = resolveRoute({
      persona: { provider: 'anthropic', developerMode: true, keys: {} },
      backendConfigured: true,
      signedIn: true,
    })
    expect(route.mode).toBe('error')
    expect(route.reason).toMatch(/api key/i)
  })

  it('error: backend configured but signed out, developer mode off', () => {
    const route = resolveRoute({ persona, backendConfigured: true, signedIn: false })
    expect(route.mode).toBe('error')
    expect(route.reason).toMatch(/sign in/i)
  })

  it('error: no backend configured, developer mode off', () => {
    const route = resolveRoute({ persona, backendConfigured: false, signedIn: false })
    expect(route.mode).toBe('error')
    expect(route.reason).toMatch(/developer mode/i)
  })
})

describe('chat() — dispatch', () => {
  it('proxy path calls the llm-proxy Edge Function and returns its content', async () => {
    const invoke = vi.fn(async () => ({ data: { content: 'hi from proxy' }, error: null }))
    mockSupabase = { functions: { invoke } }

    const result = await chat({
      persona: { provider: 'anthropic', model: 'claude-x', keys: {} },
      backendConfigured: true,
      signedIn: true,
      system: 'sys',
      messages: [{ role: 'user', content: 'hey' }],
    })

    expect(result).toBe('hi from proxy')
    expect(invoke).toHaveBeenCalledWith(
      'llm-proxy',
      expect.objectContaining({ body: expect.objectContaining({ provider: 'anthropic', model: 'claude-x', system: 'sys' }) })
    )
  })

  it('proxy path surfaces an Edge Function error rather than swallowing it', async () => {
    mockSupabase = { functions: { invoke: vi.fn(async () => ({ data: null, error: new Error('Daily token cap exceeded.') })) } }
    await expect(
      chat({
        persona: { provider: 'anthropic', model: 'claude-x', keys: {} },
        backendConfigured: true,
        signedIn: true,
        system: 'sys',
        messages: [{ role: 'user', content: 'hey' }],
      })
    ).rejects.toThrow(/token cap/i)
  })

  it('developer-mode path calls the provider directly from the browser', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ content: [{ type: 'text', text: 'hi direct' }] }),
    }))
    globalThis.fetch = fetchMock

    const result = await chat({
      persona: { provider: 'anthropic', model: 'claude-x', developerMode: true, keys: { anthropic: 'sk-x' } },
      backendConfigured: true, // proxy would otherwise be eligible — dev mode must still win
      signedIn: true,
      system: 'sys',
      messages: [{ role: 'user', content: 'hey' }],
    })

    expect(result).toBe('hi direct')
    expect(fetchMock).toHaveBeenCalledWith('https://api.anthropic.com/v1/messages', expect.objectContaining({ method: 'POST' }))
  })

  it('throws a clear, actionable error with no network call when neither path is available', async () => {
    const fetchMock = vi.fn()
    globalThis.fetch = fetchMock

    await expect(
      chat({
        persona: { provider: 'anthropic', keys: {} },
        backendConfigured: false,
        signedIn: false,
        system: 'sys',
        messages: [{ role: 'user', content: 'hey' }],
      })
    ).rejects.toThrow(/developer mode/i)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('PROVIDERS', () => {
  it('lists anthropic/openai/gemini, each with a non-empty model list', () => {
    expect(Object.keys(PROVIDERS)).toEqual(['anthropic', 'openai', 'gemini'])
    for (const p of Object.values(PROVIDERS)) {
      expect(Array.isArray(p.models)).toBe(true)
      expect(p.models.length).toBeGreaterThan(0)
    }
  })
})
