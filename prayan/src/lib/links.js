// Link engine — parses [[wiki-links]] and builds the graph model.

const LINK_RE = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g

/** All [[targets]] in a body: [{ target, label }] */
export function parseLinks(body = '') {
  const out = []
  let m
  LINK_RE.lastIndex = 0
  while ((m = LINK_RE.exec(body))) out.push({ target: m[1].trim(), label: (m[2] || m[1]).trim() })
  return out
}

/** Notes that link TO the given title (or, when given, any of its aliases). Case-insensitive. */
export function backlinksTo(notes, title, aliases = []) {
  const targets = new Set([title, ...aliases].filter(Boolean).map((t) => t.trim().toLowerCase()))
  return notes.filter((n) => parseLinks(n.body).some((l) => targets.has(l.target.toLowerCase())))
}

/** Map every note to all of its resolution keys: title + aliases, lowercased. */
function resolutionKeys(notes) {
  const byKey = new Map()
  for (const n of notes) {
    const keys = [n.title, ...(Array.isArray(n.aliases) ? n.aliases : [])]
    for (const raw of keys) {
      const k = raw?.trim().toLowerCase()
      if (k && !byKey.has(k)) byKey.set(k, n) // first writer wins on collision
    }
  }
  return byKey
}

/**
 * Build the graph model. Pure — reparses every note; the store maintains an
 * incremental equivalent in linkIndex.js (vault.graph()) for scale.
 * Node weight = edits (use) + degree (connectivity) → visual "synaptic strength".
 * Edge weight = number of repeated links between the pair. Link targets
 * resolve against both titles and aliases (case-insensitive).
 */
export function buildGraph(notes, activity = []) {
  const byKey = resolutionKeys(notes)
  const nodes = new Map()
  const edges = new Map()

  const recentCut = Date.now() - 8000
  const recent = new Set(activity.filter((a) => a.t > recentCut).map((a) => a.noteId))

  for (const n of notes) {
    nodes.set(n.id, {
      id: n.id,
      title: n.title,
      edits: n.edits,
      degree: 0,
      recent: recent.has(n.id),
    })
  }

  for (const n of notes) {
    for (const l of parseLinks(n.body)) {
      const target = byKey.get(l.target.toLowerCase())
      if (!target || target.id === n.id) continue
      const key = [n.id, target.id].sort().join('~')
      edges.set(key, {
        a: n.id,
        b: target.id,
        w: (edges.get(key)?.w || 0) + 1,
      })
      nodes.get(n.id).degree++
      nodes.get(target.id).degree++
    }
  }

  return { nodes: [...nodes.values()], edges: [...edges.values()] }
}

const TAG_RE = /#([a-zA-Z][\w/-]*)/g

/** #tag tokens found in a note body, lowercased and de-duplicated. */
export function extractTags(body = '') {
  const out = new Set()
  let m
  TAG_RE.lastIndex = 0
  while ((m = TAG_RE.exec(body))) out.add(m[1].toLowerCase())
  return [...out]
}

/** Strip markdown & links to plain text for persona context / previews. */
export function plainText(body = '') {
  return body
    .replace(LINK_RE, (_, t, label) => label || t)
    .replace(/[#*_>`]/g, '')
    .trim()
}
