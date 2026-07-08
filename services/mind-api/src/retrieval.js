// Server-side retrieval over one mind's chunks — PLAN.md §5.1. Cosine
// similarity when both the chunk and the live query have an embedding
// (query embedding is best-effort, providers.js embedQuery); a BM25-style
// lexical fallback over `content` otherwise — retrieval never comes back
// empty just because embeddings aren't available, same principle as the
// client's src/lib/retrieval.js.

const STOP = new Set(
  'the a an and or but if then of to in on for with at by from is are was were be been this that it as i you he she we they my your our their not do does did have has had what which who how why when where'.split(
    ' '
  )
)

const tokenize = (s) => (s.toLowerCase().match(/[a-z0-9]{2,}/g) || []).filter((t) => !STOP.has(t))

export function cosineSimilarity(a, b) {
  const n = Math.min(a.length, b.length)
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  if (!na || !nb) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

/** BM25 over chunk title+content. Returns [] for an empty query or empty chunk set. */
export function lexicalScore(chunks, query, k = 6) {
  const q = tokenize(query)
  if (!q.length || !chunks.length) return []

  const docs = chunks.map((c) => tokenize(`${c.title} ${c.content}`))
  const N = docs.length
  const avgLen = docs.reduce((s, d) => s + d.length, 0) / N
  const df = new Map()
  for (const d of docs) for (const t of new Set(d)) df.set(t, (df.get(t) || 0) + 1)

  const k1 = 1.4
  const b = 0.75
  const scores = docs.map((d) => {
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

  return chunks
    .map((c, i) => ({ ...c, score: scores[i] }))
    // A zero-overlap chunk is still worth surfacing when the mind is small
    // (fewer chunks than we'd retrieve anyway) — same "don't retrieval-
    // starve a new mind" rule as the client's src/lib/retrieval.js.
    .filter((c) => c.score > 0 || chunks.length <= k)
    .sort((a, b2) => b2.score - a.score)
    .slice(0, k)
}

/**
 * retrieveChunks(chunks, { queryVector, query }, k) -> scored chunks
 * Semantic when every chunk with an embedding can be scored against a live
 * query vector; falls back to lexical whenever no query vector is
 * available, or the semantic pass finds nothing (e.g. no chunk has an
 * embedding yet).
 */
export function retrieveChunks(chunks, { queryVector, query }, k = 6) {
  if (queryVector) {
    const withVectors = chunks.filter((c) => Array.isArray(c.embedding) && c.embedding.length)
    if (withVectors.length) {
      const scored = withVectors
        .map((c) => ({ ...c, score: cosineSimilarity(queryVector, c.embedding) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, k)
      if (scored.length) return scored
    }
  }
  return lexicalScore(chunks, query, k)
}
