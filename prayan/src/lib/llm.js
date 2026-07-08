// LLM adapter — one interface, any frontier model underneath.
// The generic model supplies reasoning; the vault supplies the mind.
//
// PLAN.md §4.3: `chat()` keeps its name and its options-object shape, but is
// now a router rather than always dialing the provider directly from the
// browser:
//
//   - backend configured + signed in + NOT developer mode  -> the
//     `llm-proxy` Edge Function (platform-owned keys, per-user metering;
//     this app's Supabase project never sees the user's own key).
//   - developer mode ON (persona.developerMode, Settings)   -> the original
//     v1/v2 direct browser call, using the user's own locally-stored key.
//     This is the ONLY way the browser-key path still runs.
//   - neither available                                     -> a clear
//     error explaining the two ways to enable chat, thrown before any
//     network call.
//
// `resolveRoute()` makes that decision without touching the network, so the
// UI (and tests) can inspect it directly.

import { getSupabase } from './supabase.js'

export const PROVIDERS = {
  anthropic: {
    label: 'Anthropic (Claude)',
    models: ['claude-sonnet-4-6', 'claude-haiku-4-5-20251001', 'claude-opus-4-8'],
  },
  openai: {
    label: 'OpenAI (GPT)',
    models: ['gpt-4o', 'gpt-4o-mini'],
  },
  gemini: {
    label: 'Google (Gemini)',
    models: ['gemini-2.0-flash', 'gemini-1.5-pro'],
  },
}

function directApiKey(persona = {}) {
  return (persona.keys || {})[persona.provider || 'anthropic'] || persona.apiKey || ''
}

/**
 * Decide which path chat() will take, without making any network call.
 * `signedIn` must be resolved by the caller (auth is async; this stays
 * synchronous) — pass `false` when unknown/unchecked, which just means the
 * proxy path is never chosen, matching "sign in required" honestly.
 */
export function resolveRoute({ persona = {}, backendConfigured = false, signedIn = false } = {}) {
  const devMode = Boolean(persona.developerMode)

  if (backendConfigured && signedIn && !devMode) {
    return { mode: 'proxy' }
  }
  if (devMode) {
    const apiKey = directApiKey(persona)
    if (!apiKey) {
      return {
        mode: 'error',
        reason: `Developer mode is on but no ${PROVIDERS[persona.provider]?.label || persona.provider || 'Anthropic'} API key is set in Settings.`,
      }
    }
    return { mode: 'direct', apiKey }
  }
  return {
    mode: 'error',
    reason: backendConfigured
      ? 'Sign in to chat with your mind, or turn on Developer mode in Settings to use your own API key from this browser.'
      : 'This mind has no backend configured. Turn on Developer mode in Settings to use your own API key directly from this browser.',
  }
}

/**
 * chat({ provider, model, system, messages, maxTokens, persona, backendConfigured, signedIn }) -> string
 * messages: [{ role: 'user'|'assistant', content: string }]
 *
 * `persona` (the vault's persona object) drives routing; `provider`/`model`
 * fall back to `persona.provider`/`persona.model` when persona is supplied,
 * and remain usable standalone (e.g. tests) when it isn't.
 */
export async function chat({
  provider,
  model,
  system,
  messages,
  maxTokens = 1200,
  persona,
  backendConfigured = false,
  signedIn = false,
}) {
  const p = persona || { provider, model, keys: {} }
  const resolvedProvider = provider || p.provider || 'anthropic'
  const resolvedModel = model || p.model

  const route = resolveRoute({ persona: p, backendConfigured, signedIn })

  if (route.mode === 'proxy') {
    return chatViaProxy({ provider: resolvedProvider, model: resolvedModel, system, messages, maxTokens })
  }
  if (route.mode === 'direct') {
    return chatDirect({ provider: resolvedProvider, model: resolvedModel, apiKey: route.apiKey, system, messages, maxTokens })
  }
  throw new Error(route.reason)
}

/** Server-proxied call (PLAN.md §4.3) — platform keys, per-user metering, no user key ever leaves the browser. */
async function chatViaProxy({ provider, model, system, messages, maxTokens }) {
  const supabase = getSupabase()
  if (!supabase) throw new Error('Backend not configured — cannot reach the model proxy.')
  const { data, error } = await supabase.functions.invoke('llm-proxy', {
    body: { provider, model, system, messages, maxTokens },
  })
  if (error) throw new Error(error.message || 'The model proxy returned an error.')
  if (typeof data?.content !== 'string') throw new Error('The model proxy returned no content.')
  return data.content
}

/** Direct browser call with the user's own key — v1/v2 behavior, now reachable only via Developer mode. */
async function chatDirect({ provider, model, apiKey, system, messages, maxTokens }) {
  if (!apiKey) throw new Error(`No API key set for ${provider}. Add one in Settings.`)

  if (provider === 'anthropic') {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({ model, max_tokens: maxTokens, system, messages }),
    })
    const data = await ok(res)
    return data.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n')
  }

  if (provider === 'openai') {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        messages: [{ role: 'system', content: system }, ...messages],
      }),
    })
    const data = await ok(res)
    return data.choices?.[0]?.message?.content ?? ''
  }

  if (provider === 'gemini') {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: system }] },
        contents: messages.map((m) => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }],
        })),
        generationConfig: { maxOutputTokens: maxTokens },
      }),
    })
    const data = await ok(res)
    return data.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') ?? ''
  }

  throw new Error(`Unknown provider: ${provider}`)
}

async function ok(res) {
  if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 220)}`)
  return res.json()
}
