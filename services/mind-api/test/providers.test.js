import { describe, it, expect, vi } from 'vitest'
import { configuredProviders, providerOrder, chatWithFallback, embedQuery } from '../src/providers.js'

function jsonResponse(body, ok = true, status = 200) {
  return { ok, status, json: async () => body, text: async () => JSON.stringify(body) }
}

describe('configuredProviders / providerOrder', () => {
  it('lists only providers with an env key set, in canonical order', () => {
    expect(configuredProviders({ ANTHROPIC_API_KEY: 'x', GEMINI_API_KEY: 'y' })).toEqual(['anthropic', 'gemini'])
    expect(configuredProviders({})).toEqual([])
  })

  it('puts the preferred provider first, then the rest, de-duplicated', () => {
    const env = { ANTHROPIC_API_KEY: 'x', OPENAI_API_KEY: 'y', GEMINI_API_KEY: 'z' }
    expect(providerOrder('gemini', env)).toEqual(['gemini', 'anthropic', 'openai'])
    expect(providerOrder('anthropic', env)).toEqual(['anthropic', 'openai', 'gemini'])
  })

  it('drops a preferred provider that has no key configured, without crashing', () => {
    const env = { OPENAI_API_KEY: 'y' }
    expect(providerOrder('anthropic', env)).toEqual(['openai'])
  })

  it('returns [] when nothing is configured', () => {
    expect(providerOrder('anthropic', {})).toEqual([])
  })
})

describe('chatWithFallback', () => {
  it('calls the preferred provider and returns its content on success', async () => {
    const fetchImpl = vi.fn(async (url) => {
      expect(url).toContain('anthropic.com')
      return jsonResponse({ content: [{ type: 'text', text: 'hello from claude' }] })
    })
    const result = await chatWithFallback({
      preferred: 'anthropic',
      system: 's',
      messages: [{ role: 'user', content: 'hi' }],
      env: { ANTHROPIC_API_KEY: 'k' },
      fetchImpl,
    })
    expect(result).toEqual({ content: 'hello from claude', provider: 'anthropic', model: 'claude-sonnet-4-6' })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('falls back to the next configured provider when the first errors', async () => {
    const fetchImpl = vi.fn(async (url) => {
      if (url.includes('anthropic.com')) return jsonResponse({}, false, 500)
      if (url.includes('openai.com')) return jsonResponse({ choices: [{ message: { content: 'hello from gpt' } }] })
      throw new Error(`unexpected url ${url}`)
    })
    const result = await chatWithFallback({
      preferred: 'anthropic',
      system: 's',
      messages: [{ role: 'user', content: 'hi' }],
      env: { ANTHROPIC_API_KEY: 'k', OPENAI_API_KEY: 'k2' },
      fetchImpl,
    })
    expect(result.provider).toBe('openai')
    expect(result.content).toBe('hello from gpt')
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('falls all the way through to gemini when both anthropic and openai fail', async () => {
    const fetchImpl = vi.fn(async (url) => {
      if (url.includes('anthropic.com')) throw new Error('network down')
      if (url.includes('openai.com')) return jsonResponse({}, false, 429)
      if (url.includes('generativelanguage')) {
        return jsonResponse({ candidates: [{ content: { parts: [{ text: 'hello from gemini' }] } }] })
      }
      throw new Error(`unexpected url ${url}`)
    })
    const result = await chatWithFallback({
      preferred: 'anthropic',
      system: 's',
      messages: [{ role: 'user', content: 'hi' }],
      env: { ANTHROPIC_API_KEY: 'k', OPENAI_API_KEY: 'k2', GEMINI_API_KEY: 'k3' },
      fetchImpl,
    })
    expect(result.provider).toBe('gemini')
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  it('throws a clear error when every configured provider fails', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, false, 500))
    await expect(
      chatWithFallback({ preferred: 'anthropic', system: 's', messages: [], env: { ANTHROPIC_API_KEY: 'k' }, fetchImpl })
    ).rejects.toThrow(/all configured providers failed/i)
  })

  it('throws immediately (no fetch calls) when nothing is configured', async () => {
    const fetchImpl = vi.fn()
    await expect(chatWithFallback({ preferred: 'anthropic', system: 's', messages: [], env: {}, fetchImpl })).rejects.toThrow(
      /no llm provider is configured/i
    )
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

describe('embedQuery', () => {
  it('prefers Voyage when configured', async () => {
    const fetchImpl = vi.fn(async (url) => {
      expect(url).toContain('voyageai.com')
      return jsonResponse({ data: [{ embedding: [0.1, 0.2] }] })
    })
    const vec = await embedQuery('hello', { VOYAGE_API_KEY: 'k' }, fetchImpl)
    expect(vec).toEqual([0.1, 0.2])
  })

  it('falls back to OpenAI when Voyage is not configured', async () => {
    const fetchImpl = vi.fn(async (url) => {
      expect(url).toContain('openai.com')
      return jsonResponse({ data: [{ embedding: [0.3, 0.4] }] })
    })
    const vec = await embedQuery('hello', { OPENAI_API_KEY: 'k' }, fetchImpl)
    expect(vec).toEqual([0.3, 0.4])
  })

  it('returns null (never throws) when nothing is configured or the call fails', async () => {
    expect(await embedQuery('hello', {}, vi.fn())).toBeNull()
    const failing = vi.fn(async () => jsonResponse({}, false, 500))
    expect(await embedQuery('hello', { OPENAI_API_KEY: 'k' }, failing)).toBeNull()
  })
})
