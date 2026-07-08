// POST /minds/:handle/ask  { question, history? } -> { answer, citations, mind_version, cached }
//
// The pipeline (PLAN.md §5.1/§5.2/§5.5), in order:
//   1. rate limit (IP always; API key too, if one was presented)
//   2. resolve the mind (404 if unpublished/unknown)
//   3. resolve an API key from the Authorization header, if any
//   4. free-tier check (ask_usage per day) — skipped entirely when a valid
//      API key is presented; 429 with price info when exceeded
//   5. refusal-topic check (server-side, from minds.refusal_topics)
//   6. cache lookup (question_hash, keyed by current mind_version)
//   7. on a miss: retrieve mind_chunks, build the system prompt, route to
//      an LLM provider with fallback, extract citations, strip verbatim
//      quotes of 'mind'-scoped content, cache the result
//   8. meter (ask_usage + the API key's usage_count, if any) and respond

import { Router } from 'express'
import { resolveApiKey } from '../auth.js'
import { checkRefusal, buildSystemPrompt, extractCitations, renderCitations, stripVerbatimQuotes } from '../persona.js'
import { retrieveChunks } from '../retrieval.js'
import { getCached, setCached } from '../cache.js'
import { chatWithFallback, embedQuery } from '../providers.js'

const MAX_QUESTION_LEN = 2000
const RETRIEVAL_K = 6

function todayUTC() {
  return new Date().toISOString().slice(0, 10)
}

async function fetchMind(supabase, handle) {
  const { data, error } = await supabase.from('minds').select('*').eq('handle', handle).maybeSingle()
  if (error) throw new Error(`minds lookup failed: ${error.message}`)
  return data
}

async function fetchChunks(supabase, mind) {
  const { data, error } = await supabase
    .from('mind_chunks')
    .select('note_id, title, scope, content, embedding')
    .eq('user_id', mind.user_id)
    .eq('version', mind.current_version)
  if (error) throw new Error(`mind_chunks lookup failed: ${error.message}`)
  return data || []
}

async function todaysAskCount(supabase, mindHandle) {
  const { data, error } = await supabase
    .from('ask_usage')
    .select('count')
    .eq('mind_handle', mindHandle)
    .eq('day', todayUTC())
    .maybeSingle()
  if (error) throw new Error(`ask_usage lookup failed: ${error.message}`)
  return data?.count || 0
}

/** Best-effort +1; a lost race under concurrent requests just undercounts slightly — acceptable for a v1, single-instance-limiter deploy (see rateLimit.js's header comment for the same tradeoff). */
async function bumpAskUsage(supabase, mindHandle) {
  const day = todayUTC()
  const { data } = await supabase.from('ask_usage').select('id, count').eq('mind_handle', mindHandle).eq('day', day).maybeSingle()
  if (data) {
    await supabase.from('ask_usage').update({ count: data.count + 1 }).eq('id', data.id)
  } else {
    await supabase.from('ask_usage').insert({ mind_handle: mindHandle, day, count: 1 })
  }
}

async function bumpKeyUsage(supabase, apiKey) {
  await supabase.from('api_keys').update({ usage_count: (apiKey.usage_count || 0) + 1 }).eq('id', apiKey.id)
}

function normalizeHistory(history) {
  if (!Array.isArray(history)) return []
  return history
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_QUESTION_LEN) }))
}

export function askRouter({ supabase, env = process.env, fetchImpl = fetch, ipLimiter, keyLimiter, billing }) {
  const router = Router()

  router.post('/minds/:handle/ask', async (req, res) => {
    try {
      const handle = req.params.handle
      const ip = req.ip || req.socket?.remoteAddress || 'unknown'
      if (ipLimiter && !ipLimiter(ip)) {
        return res.status(429).json({ error: 'Too many requests from this address — slow down.' })
      }

      const question = typeof req.body?.question === 'string' ? req.body.question.trim() : ''
      if (!question) return res.status(400).json({ error: '"question" is required.' })
      if (question.length > MAX_QUESTION_LEN) {
        return res.status(400).json({ error: `"question" must be at most ${MAX_QUESTION_LEN} characters.` })
      }

      const mind = await fetchMind(supabase, handle)
      if (!mind || !mind.published) return res.status(404).json({ error: 'No published mind at this handle.' })

      const apiKey = await resolveApiKey(supabase, req, handle)
      if (apiKey && keyLimiter && !keyLimiter(apiKey.id)) {
        return res.status(429).json({ error: 'Too many requests with this API key — slow down.' })
      }

      if (!apiKey) {
        const usedToday = await todaysAskCount(supabase, handle)
        if (usedToday >= mind.free_queries_per_day) {
          return res.status(429).json({
            error: 'This mind\'s free daily query limit has been reached. Use an API key for metered access.',
            price_per_query_cents: mind.price_per_query_cents,
            free_queries_per_day: mind.free_queries_per_day,
          })
        }
      }

      const meter = async () => {
        await bumpAskUsage(supabase, handle)
        if (apiKey) await bumpKeyUsage(supabase, apiKey)
        if (billing) {
          await billing.recordQuery({ mindHandle: handle, priceCents: mind.price_per_query_cents, billable: Boolean(apiKey) })
        }
      }

      const refusal = checkRefusal(question, mind.refusal_topics)
      if (refusal.refused) {
        await meter()
        return res.json({ answer: refusal.message, citations: [], mind_version: mind.current_version, cached: false })
      }

      const cached = await getCached(supabase, { mindHandle: handle, version: mind.current_version, question })
      if (cached) {
        await meter()
        return res.json({ ...cached, cached: true })
      }

      const chunks = await fetchChunks(supabase, mind)
      const queryVector = await embedQuery(question, env, fetchImpl)
      const memories = retrieveChunks(chunks, { queryVector, query: question }, RETRIEVAL_K)

      const system = buildSystemPrompt({ mind, memories })
      const messages = [...normalizeHistory(req.body?.history), { role: 'user', content: question }]

      const { content } = await chatWithFallback({ preferred: mind.preferred_provider, system, messages, env, fetchImpl })

      const citations = extractCitations(content, memories)
      const answerText = stripVerbatimQuotes(renderCitations(content), memories)
      const answer = { answer: answerText, citations, mind_version: mind.current_version }

      await setCached(supabase, { mindHandle: handle, version: mind.current_version, question, answer })
      await meter()

      res.json({ ...answer, cached: false })
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })

  return router
}
