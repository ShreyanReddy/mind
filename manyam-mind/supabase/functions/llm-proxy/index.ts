// POST /llm-proxy  { provider, model, system, messages, maxTokens? }  ->  { content: string }
//
// verify_jwt: true (default) — the caller must be signed in.
//
// PLAN.md §4.3: this is the ONLY place a real LLM provider key lives —
// ANTHROPIC_API_KEY / OPENAI_API_KEY / GEMINI_API_KEY are this function's
// OWN environment secrets (platform-owned), never a user's. The user's own
// browser-supplied key (src/lib/llm.js's direct-call path) is used only
// behind their client-side "Developer mode" flag and never reaches this
// function. Every call is metered per user (_shared/usage.ts) against a
// shared daily token cap (env LLM_DAILY_TOKEN_CAP, default 200000),
// enforced BEFORE the provider is called.

import { handlePreflight, json, errorResponse } from '../_shared/cors.ts'
import { serviceClient } from '../_shared/db.ts'
import { getCallerUser } from '../_shared/auth.ts'
import { parseJsonBody, requireString, requireOneOf, ValidationError } from '../_shared/validate.ts'
import { enforceDailyCap, recordUsage, UsageCapExceededError } from '../_shared/usage.ts'

const PROVIDERS = ['anthropic', 'openai', 'gemini'] as const
type Provider = (typeof PROVIDERS)[number]

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

interface ProviderResult {
  content: string
  tokensIn: number
  tokensOut: number
}

function requireMessages(body: Record<string, unknown>): ChatMessage[] {
  const messages = body.messages
  if (!Array.isArray(messages) || !messages.length) throw new ValidationError('"messages" must be a non-empty array')
  return messages.map((m, i) => {
    if (!m || typeof m !== 'object') throw new ValidationError(`messages[${i}] must be an object`)
    const { role, content } = m as Record<string, unknown>
    if (role !== 'user' && role !== 'assistant') throw new ValidationError(`messages[${i}].role must be "user" or "assistant"`)
    if (typeof content !== 'string') throw new ValidationError(`messages[${i}].content must be a string`)
    return { role, content }
  })
}

async function callAnthropic(model: string, system: string, messages: ChatMessage[], maxTokens: number, apiKey: string): Promise<ProviderResult> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model, max_tokens: maxTokens, system, messages }),
  })
  if (!res.ok) throw new Error(`Anthropic: ${res.status} ${(await res.text()).slice(0, 200)}`)
  const data = await res.json()
  const content = (data.content || [])
    .filter((b: { type: string }) => b.type === 'text')
    .map((b: { text: string }) => b.text)
    .join('\n')
  return { content, tokensIn: data.usage?.input_tokens ?? 0, tokensOut: data.usage?.output_tokens ?? 0 }
}

async function callOpenAI(model: string, system: string, messages: ChatMessage[], maxTokens: number, apiKey: string): Promise<ProviderResult> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, max_tokens: maxTokens, messages: [{ role: 'system', content: system }, ...messages] }),
  })
  if (!res.ok) throw new Error(`OpenAI: ${res.status} ${(await res.text()).slice(0, 200)}`)
  const data = await res.json()
  return {
    content: data.choices?.[0]?.message?.content ?? '',
    tokensIn: data.usage?.prompt_tokens ?? 0,
    tokensOut: data.usage?.completion_tokens ?? 0,
  }
}

async function callGemini(model: string, system: string, messages: ChatMessage[], maxTokens: number, apiKey: string): Promise<ProviderResult> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: system }] },
      contents: messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
      generationConfig: { maxOutputTokens: maxTokens },
    }),
  })
  if (!res.ok) throw new Error(`Gemini: ${res.status} ${(await res.text()).slice(0, 200)}`)
  const data = await res.json()
  const content = (data.candidates?.[0]?.content?.parts || []).map((p: { text?: string }) => p.text || '').join('')
  const usage = data.usageMetadata || {}
  return { content, tokensIn: usage.promptTokenCount ?? 0, tokensOut: usage.candidatesTokenCount ?? 0 }
}

const ENV_KEY_NAME: Record<Provider, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  gemini: 'GEMINI_API_KEY',
}

const CALL_FN: Record<Provider, typeof callAnthropic> = {
  anthropic: callAnthropic,
  openai: callOpenAI,
  gemini: callGemini,
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req)
  if (preflight) return preflight
  if (req.method !== 'POST') return errorResponse('POST only', 405)

  try {
    const user = await getCallerUser(req)
    if (!user) return errorResponse('Sign in required.', 401)

    const body = await parseJsonBody(req)
    const provider = requireOneOf(body, 'provider', PROVIDERS)
    const model = requireString(body, 'model')
    const system = typeof body.system === 'string' ? body.system : ''
    const messages = requireMessages(body)
    const maxTokens = typeof body.maxTokens === 'number' && body.maxTokens > 0 ? Math.min(body.maxTokens, 4000) : 1200

    const envKey = Deno.env.get(ENV_KEY_NAME[provider])
    if (!envKey) return errorResponse(`This mind's server isn't configured for ${provider} yet.`, 501)

    const db = serviceClient()
    try {
      await enforceDailyCap(db, user.id)
    } catch (err) {
      if (err instanceof UsageCapExceededError) return errorResponse(err.message, 429)
      throw err
    }

    const { content, tokensIn, tokensOut } = await CALL_FN[provider](model, system, messages, maxTokens, envKey)

    const approxIn = Math.ceil((system.length + messages.reduce((s, m) => s + m.content.length, 0)) / 4)
    await recordUsage(db, {
      userId: user.id,
      kind: 'llm',
      provider,
      model,
      tokensIn: tokensIn || approxIn,
      tokensOut,
    })

    return json({ content })
  } catch (err) {
    if (err instanceof ValidationError) return errorResponse(err.message, 400)
    console.error('[llm-proxy]', err)
    return errorResponse('Internal error calling the model.', 500)
  }
})
