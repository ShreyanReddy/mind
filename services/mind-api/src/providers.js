// Provider router with fallback — PLAN.md §5.2, mirroring the shape of the
// main app's src/lib/llm.js and supabase/functions/llm-proxy/index.ts (same
// three providers, same request/response shapes) but written for this
// service's own runtime: platform keys come from process.env here, never
// from a user-supplied key, and a failed provider falls through to the
// next configured one rather than surfacing the error immediately — that
// fallback is this module's whole reason to exist (PLAN.md §5.2).

export const PROVIDER_ORDER = ['anthropic', 'openai', 'gemini']

export const ENV_KEY_NAME = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  gemini: 'GEMINI_API_KEY',
}

const DEFAULT_MODEL = {
  anthropic: 'claude-sonnet-4-6',
  openai: 'gpt-4o-mini',
  gemini: 'gemini-2.0-flash',
}

/** Providers with a platform key present in `env`, in canonical order. */
export function configuredProviders(env = process.env) {
  return PROVIDER_ORDER.filter((p) => env[ENV_KEY_NAME[p]])
}

/** Fallback order for one call: the mind's preferred provider first (if configured), then the rest in canonical order, de-duplicated. */
export function providerOrder(preferred, env = process.env) {
  const configured = configuredProviders(env)
  if (!configured.length) return []
  const withPreferredFirst = [preferred, ...PROVIDER_ORDER]
  const seen = new Set()
  return withPreferredFirst.filter((p) => configured.includes(p) && !seen.has(p) && seen.add(p))
}

async function ok(res) {
  if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 220)}`)
  return res.json()
}

async function callAnthropic({ model, system, messages, maxTokens, apiKey, fetchImpl }) {
  const res = await fetchImpl('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model, max_tokens: maxTokens, system, messages }),
  })
  const data = await ok(res)
  return (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n')
}

async function callOpenAI({ model, system, messages, maxTokens, apiKey, fetchImpl }) {
  const res = await fetchImpl('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, max_tokens: maxTokens, messages: [{ role: 'system', content: system }, ...messages] }),
  })
  const data = await ok(res)
  return data.choices?.[0]?.message?.content ?? ''
}

async function callGemini({ model, system, messages, maxTokens, apiKey, fetchImpl }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: system }] },
      contents: messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
      generationConfig: { maxOutputTokens: maxTokens },
    }),
  })
  const data = await ok(res)
  return (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('')
}

const CALL_FN = { anthropic: callAnthropic, openai: callOpenAI, gemini: callGemini }

/**
 * chatWithFallback({ preferred, system, messages, maxTokens, env, fetchImpl })
 * -> { content, provider, model }
 *
 * Tries providers in `providerOrder(preferred, env)`; the first to succeed
 * wins. Throws only when every configured provider failed (or none are
 * configured at all) — the thrown message includes the last provider's
 * error for diagnosability.
 */
export async function chatWithFallback({ preferred, system, messages, maxTokens = 800, env = process.env, fetchImpl = fetch }) {
  const order = providerOrder(preferred, env)
  if (!order.length) throw new Error('No LLM provider is configured on this server.')

  let lastErr = null
  for (const provider of order) {
    try {
      const model = DEFAULT_MODEL[provider]
      const content = await CALL_FN[provider]({ model, system, messages, maxTokens, apiKey: env[ENV_KEY_NAME[provider]], fetchImpl })
      return { content, provider, model }
    } catch (err) {
      lastErr = err
    }
  }
  throw new Error(`All configured providers failed to answer. Last error: ${lastErr?.message || 'unknown'}`)
}

// ---------------------------------------------------------------------
// Query embedding (PLAN.md §5.1's "cosine over embeddings when present")
// — best-effort only. Mirrors supabase/functions/embed/index.ts's provider
// order (Voyage, then OpenAI) but embeds only the live query text; chunk
// vectors themselves are computed client-side at publish time
// (src/lib/mindPublish.js) and stored in mind_chunks. Returns null on any
// failure or when neither key is configured — retrieval.js falls back to
// the lexical (BM25-style) scorer whenever this returns null.
// ---------------------------------------------------------------------
export async function embedQuery(text, env = process.env, fetchImpl = fetch) {
  try {
    if (env.VOYAGE_API_KEY) {
      const res = await fetchImpl('https://api.voyageai.com/v1/embeddings', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${env.VOYAGE_API_KEY}` },
        body: JSON.stringify({ input: [text], model: 'voyage-3-lite' }),
      })
      const data = await ok(res)
      return data.data?.[0]?.embedding || null
    }
    if (env.OPENAI_API_KEY) {
      const res = await fetchImpl('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${env.OPENAI_API_KEY}` },
        body: JSON.stringify({ input: [text], model: 'text-embedding-3-small' }),
      })
      const data = await ok(res)
      return data.data?.[0]?.embedding || null
    }
    return null
  } catch {
    return null
  }
}
