// POST /embed  { texts: string[] }  ->  { vectors: number[][], model: string }
//
// verify_jwt: true (default) — the caller must be signed in.
//
// PRIVACY NOTE (honest, per CLAUDE.md / PLAN.md §4.1): the E2E vault stays
// E2E — this function is the one deliberate, owner-opted-in exception, and
// only for chunks the owner has turned on "Semantic retrieval" for in
// Settings (src/components/Settings.jsx). Each text you send here is
// relayed TRANSIENTLY to whichever embedding provider is configured below
// (Voyage or OpenAI) purely to compute a vector: this function never logs
// the text, never persists it anywhere, and never writes to any table —
// only the resulting VECTOR is returned to the caller, which caches it
// client-side (src/lib/embeddings.js, Dexie `vectors` table). The
// server-side pgvector table this repo provisions for future use
// (`mind_chunks`, migration 0005_pgvector.sql) also stores vectors only —
// its `content` column stays NULL in this phase. Phase 5 will populate
// `content` for server-side retrieval, and only for notes the owner has
// explicitly scoped 'mind' or 'published'.
//
// Provider order: Voyage AI (VOYAGE_API_KEY, voyage-3-lite) if set, else
// OpenAI (OPENAI_API_KEY, text-embedding-3-small); 501 if neither is set.

import { handlePreflight, json, errorResponse } from '../_shared/cors.ts'
import { serviceClient } from '../_shared/db.ts'
import { getCallerUser } from '../_shared/auth.ts'
import { parseJsonBody, ValidationError } from '../_shared/validate.ts'
import { enforceDailyCap, recordUsage, UsageCapExceededError } from '../_shared/usage.ts'

const MAX_TEXTS = 64
const MAX_CHARS = 4000 // generous ceiling for a ~500-token chunk

function requireTexts(body: Record<string, unknown>): string[] {
  const texts = body.texts
  if (!Array.isArray(texts) || texts.length === 0) {
    throw new ValidationError('"texts" must be a non-empty array of strings')
  }
  if (texts.length > MAX_TEXTS) throw new ValidationError(`"texts" must have at most ${MAX_TEXTS} entries`)
  return texts.map((t, i) => {
    if (typeof t !== 'string' || !t.trim()) throw new ValidationError(`texts[${i}] must be a non-empty string`)
    return t.slice(0, MAX_CHARS)
  })
}

interface EmbedResult {
  vectors: number[][]
  model: string
  totalTokens: number
}

async function embedWithVoyage(texts: string[], apiKey: string): Promise<EmbedResult> {
  const res = await fetch('https://api.voyageai.com/v1/embeddings', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ input: texts, model: 'voyage-3-lite' }),
  })
  if (!res.ok) throw new Error(`Voyage embeddings failed: ${res.status} ${(await res.text()).slice(0, 200)}`)
  const data = await res.json()
  return {
    vectors: data.data.map((d: { embedding: number[] }) => d.embedding),
    model: 'voyage-3-lite',
    totalTokens: data.usage?.total_tokens ?? 0,
  }
}

async function embedWithOpenAI(texts: string[], apiKey: string): Promise<EmbedResult> {
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ input: texts, model: 'text-embedding-3-small' }),
  })
  if (!res.ok) throw new Error(`OpenAI embeddings failed: ${res.status} ${(await res.text()).slice(0, 200)}`)
  const data = await res.json()
  return {
    vectors: data.data.map((d: { embedding: number[] }) => d.embedding),
    model: 'text-embedding-3-small',
    totalTokens: data.usage?.total_tokens ?? 0,
  }
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req)
  if (preflight) return preflight
  if (req.method !== 'POST') return errorResponse('POST only', 405)

  try {
    const user = await getCallerUser(req)
    if (!user) return errorResponse('Sign in required.', 401)

    const body = await parseJsonBody(req)
    const texts = requireTexts(body)

    const voyageKey = Deno.env.get('VOYAGE_API_KEY')
    const openaiKey = Deno.env.get('OPENAI_API_KEY')
    if (!voyageKey && !openaiKey) {
      return errorResponse('no embedding provider configured', 501)
    }

    const db = serviceClient()
    try {
      await enforceDailyCap(db, user.id)
    } catch (err) {
      if (err instanceof UsageCapExceededError) return errorResponse(err.message, 429)
      throw err
    }

    const result = voyageKey ? await embedWithVoyage(texts, voyageKey) : await embedWithOpenAI(texts, openaiKey!)
    const approxTokens = texts.reduce((sum, t) => sum + Math.ceil(t.length / 4), 0)

    await recordUsage(db, {
      userId: user.id,
      kind: 'embed',
      provider: voyageKey ? 'voyage' : 'openai',
      model: result.model,
      tokensIn: result.totalTokens || approxTokens,
    })

    return json({ vectors: result.vectors, model: result.model })
  } catch (err) {
    if (err instanceof ValidationError) return errorResponse(err.message, 400)
    console.error('[embed]', err)
    return errorResponse('Internal error generating embeddings.', 500)
  }
})
