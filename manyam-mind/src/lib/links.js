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

/** Notes that link TO the given title. */
export function backlinksTo(notes, title) {
  const t = title.trim().toLowerCase()
  return notes.filter((n) =>
    parseLinks(n.body).some((l) => l.target.toLowerCase() === t)
  )
}

/**
 * Build the graph model.
 * Node weight = edits (use) + degree (connectivity) → visual "synaptic strength".
 * Edge weight = number of repeated links between the pair.
 */
export function buildGraph(notes, activity = []) {
  const byTitle = new Map(notes.map((n) => [n.title.trim().toLowerCase(), n]))
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
      const target = byTitle.get(l.target.toLowerCase())
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

/** Strip markdown & links to plain text for persona context / previews. */
export function plainText(body = '') {
  return body
    .replace(LINK_RE, (_, t, label) => label || t)
    .replace(/[#*_>`]/g, '')
    .trim()
}
