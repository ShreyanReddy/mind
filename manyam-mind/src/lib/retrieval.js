// Retrieval — the mind finds its own relevant memories per question.
// BM25 over paragraph chunks, blended with synaptic strength (edits+degree),
// fully in-browser and offline. PLAN.md §4.1 upgrades to embeddings+pgvector,
// keeping this exact interface.

import { buildGraph, plainText } from './links.js'

const CHUNK_TARGET = 600 // chars

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

/**
 * retrieve(state, query, k) -> [{ noteId, title, text, score }]
 * score = 0.7·BM25(normalized) + 0.3·synaptic strength(normalized)
 */
export function retrieve(state, query, k = 6) {
  const chunks = chunkVault(state.notes)
  if (!chunks.length) return []

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

  const { nodes } = buildGraph(state.notes)
  const strength = new Map(nodes.map((n) => [n.id, n.edits + n.degree * 2]))
  const maxBm = Math.max(...bm25, 1e-9)
  const maxSt = Math.max(...[...strength.values()], 1)

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

/** Titles of the weakest, least-connected notes — where the mind has gaps. */
export function knowledgeGaps(state, k = 5) {
  const { nodes } = buildGraph(state.notes)
  return [...nodes]
    .sort((a, b) => a.edits + a.degree * 2 - (b.edits + b.degree * 2))
    .slice(0, k)
    .map((n) => n.title)
}
