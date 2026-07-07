// LLM adapter — one interface, any frontier model underneath.
// The generic model supplies reasoning; the vault supplies the mind.
//
// MVP: direct browser calls with user-supplied keys (localStorage only).
// Production (PLAN.md §4.3): server proxy with metering + provider fallback.

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

/**
 * chat({ provider, model, apiKey, system, messages }) -> string
 * messages: [{ role: 'user'|'assistant', content: string }]
 */
export async function chat({ provider, model, apiKey, system, messages, maxTokens = 1200 }) {
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
