// Retrieval — the mind finds its own relevant memories per question.
// PLAN.md §4.1: two modes behind the same interface.
//
//   - semantic: cosine(query embedding, cached chunk embedding) blended
//     0.6/0.4 with normalized synaptic strength, engaged only when the
//     owner opted in (persona.semanticRetrieval), the backend is
//     configured, and enough of the vault's chunks already have a cached
//     vector (src/lib/embeddings.js — populated by a debounced idle
//     background refresh, never inline here) — and the live query embed
//     succeeds.
//   - lexical: the original v2 behavior — BM25 over paragraph chunks
//     blended 0.7/0.3 with synaptic strength, fully in-browser and
//     offline. This is also the automatic fallback whenever semantic isn't
//     available or the live query-embed call fails (offline, rate-limited,
//     no provider configured, etc.) — retrieval never goes empty just
//     because the network did.
//
// retrieve() is async (embedding lookups are inherently async: Dexie reads
// plus, in semantic mode, one network call to embed the query). Every call
// site in this codebase (persona.js) already awaits it.

import { buildGraph, plainText } from './links.js'
import { embeddingsConfigured, coverage, embedQuery, getVectors, cosineSimilarity, chunkKey } from './embeddings.js'

const CHUNK_TARGET = 600 // chars

/** Fraction of a vault's chunks that must already have a cached vector before semantic mode engages. */
export const SEMANTIC_MIN_COVERAGE = 0.5

const tokenize = (s) =>
  (s.toLowerCase().match(/[a-z0-9]{2,}/g) || []).filter((t) => !STOP.has(t))

const STOP = new Set(
  'the a an and or but if then of to in on for with at by from is are was were be been this that it as i you he she we they my your our their not do does did have has had what which who how why when where'.split(' ')
)

/** Split a note into ~600-char paragraph chunks, each tagged with its note. */
export function chunkVault(notes) {
  const chunks = []
  for (const n of notes) {
    const text = plainText(n.body)
    if (!text) continue
    let buf = ''
    for (const para of text.split(/\n{1,}/)) {
      if (buf && buf.length + para.length > CHUNK_TARGET) {
        chunks.push({ noteId: n.id, title: n.title, text: buf.trim() })
        buf = ''
      }
      buf += para + '\n'
    }
    if (buf.trim()) chunks.push({ noteId: n.id, title: n.title, text: buf.trim() })
  }
  return chunks
}

function synapticStrength(state) {
  const { nodes } = buildGraph(state.notes)
  const strength = new Map(nodes.map((n) => [n.id, n.edits + n.degree * 2]))
  const max = Math.max(...[...strength.values()], 1)
  return { strength, max }
}

/** The original BM25-over-chunks blend, unchanged since v2. */
function lexicalScore(chunks, query, k, strength, maxSt) {
  const docs = chunks.map((c) => tokenize(c.title + ' ' + c.text))
  const q = tokenize(query)
  if (!q.length) return []

  const N = docs.length
  const avgLen = docs.reduce((s, d) => s + d.length, 0) / N
  const df = new Map()
  for (const d of docs) for (const t of new Set(d)) df.set(t, (df.get(t) || 0) + 1)

  const k1 = 1.4, b = 0.75
  const bm25 = docs.map((d) => {
    const tf = new Map()
    for (const t of d) tf.set(t, (tf.get(t) || 0) + 1)
    let s = 0
    for (const t of q) {
      const f = tf.get(t)
      if (!f) continue
      const idf = Math.log(1 + (N - df.get(t) + 0.5) / (df.get(t) + 0.5))
      s += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + b * (d.length / avgLen))))
    }
    return s
  })

  const maxBm = Math.max(...bm25, 1e-9)

  return chunks
    .map((c, i) => ({
      ...c,
      score: 0.7 * (bm25[i] / maxBm) + 0.3 * ((strength.get(c.noteId) || 0) / maxSt),
      bm: bm25[i],
    }))
    .filter((c) => c.bm > 0 || chunks.length <= k)
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
}

/** The semantic blend. Returns null (never []) whenever it can't confidently produce results, so the caller falls back to lexical rather than returning nothing. */
async function semanticScore(state, chunks, query, k, strength, maxSt) {
  if (!state?.persona?.semanticRetrieval) return null
  if (!embeddingsConfigured()) return null

  const cov = await coverage(chunks)
  if (cov < SEMANTIC_MIN_COVERAGE) return null

  const queryVec = await embedQuery(query)
  if (!queryVec) return null

  const vectors = await getVectors(chunks)
  const scored = chunks
    .map((c) => {
      const vec = vectors.get(chunkKey(c.noteId, c.text))
      if (!vec) return null
      return {
        ...c,
        score: 0.6 * cosineSimilarity(queryVec, vec) + 0.4 * ((strength.get(c.noteId) || 0) / maxSt),
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)

  return scored.length ? scored.slice(0, k) : null
}

/**
 * retrieve(state, query, k) -> Promise<[{ noteId, title, text, score }]>
 * See module header for the semantic/lexical split and fallback rules.
 */
export async function retrieve(state, query, k = 6) {
  const chunks = chunkVault(state.notes)
  if (!chunks.length) return []

  const { strength, max: maxSt } = synapticStrength(state)

  const semantic = await semanticScore(state, chunks, query, k, strength, maxSt)
  if (semantic) return semantic

  return lexicalScore(chunks, query, k, strength, maxSt)
}

/**
 * Which mode retrieve() would currently use for this vault, for the UI
 * (PersonaChat's status row) — purely eligibility-based (opt-in + backend +
 * cached-vector coverage), computed without spending a live query-embed
 * call. Async: coverage is a Dexie read.
 */
export async function retrievalMode(state) {
  if (!state?.persona?.semanticRetrieval || !embeddingsConfigured()) return 'lexical'
  const chunks = chunkVault(state.notes)
  if (!chunks.length) return 'lexical'
  const cov = await coverage(chunks)
  return cov >= SEMANTIC_MIN_COVERAGE ? 'semantic' : 'lexical'
}

/** Titles of the weakest, least-connected notes — where the mind has gaps. */
export function knowledgeGaps(state, k = 5) {
  const { nodes } = buildGraph(state.notes)
  return [...nodes]
    .sort((a, b) => a.edits + a.degree * 2 - (b.edits + b.degree * 2))
    .slice(0, k)
    .map((n) => n.title)
}
