// Provider adapter — the interchangeable engine under the mind.
// One interface, three backends. The persona layer never knows or cares
// which base model is running; the mind (vault + profile + voice) is the
// product, the LLM is the utility. PLAN.md §6 moves this server-side.

export const PROVIDERS = {
  anthropic: {
    label: 'Claude (Anthropic)',
    models: ['claude-sonnet-4-6', 'claude-haiku-4-5-20251001', 'claude-opus-4-8'],
  },
  openai: {
    label: 'GPT (OpenAI)',
    models: ['gpt-4.1', 'gpt-4.1-mini', 'gpt-4o'],
  },
  gemini: {
    label: 'Gemini (Google)',
    models: ['gemini-2.5-pro', 'gemini-2.5-flash'],
  },
}

/**
 * Unified chat call.
 * @param {object} o { provider, model, key, system, messages, maxTokens }
 * messages: [{ role: 'user'|'assistant', content: string }]
 * @returns {Promise<string>} assistant text
 */
export async function chat({ provider, model, key, system, messages, maxTokens = 1000 }) {
  if (!key) throw new Error(`No API key set for ${PROVIDERS[provider]?.label || provider} — add one in Settings.`)
  const fn = { anthropic, openai, gemini }[provider]
  if (!fn) throw new Error(`Unknown provider: ${provider}`)
  return fn({ model, key, system, messages, maxTokens })
}

async function anthropic({ model, key, system, messages, maxTokens }) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({ model, max_tokens: maxTokens, system, messages }),
  })
  const data = await ok(res)
  return data.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n')
}

async function openai({ model, key, system, messages, maxTokens }) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [{ role: 'system', content: system }, ...messages],
    }),
  })
  const data = await ok(res)
  return data.choices?.[0]?.message?.content || ''
}

async function gemini({ model, key, system, messages, maxTokens }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      generationConfig: { maxOutputTokens: maxTokens },
      contents: messages.map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      })),
    }),
  })
  const data = await ok(res)
  return (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('')
}

async function ok(res) {
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`${res.status}: ${body.slice(0, 200)}`)
  }
  return res.json()
}
