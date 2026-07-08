// Growth semantics — the product's soul (PLAN.md §2.2).
//
// Pure functions mapping vault history onto the living graph's visual
// language: node mass (edits + connectivity + recency-decayed activity),
// edge weight (repeated links × co-edit frequency), consolidation (edges
// whose endpoints go 90 days without activity fade to a floor opacity but
// are never removed — old memories fade, they don't die), the 2-hop local
// neighborhood, and the time-lapse frame builder for "Watch your mind grow".

/** Recency decay time constant: an activity event "cools" over ~2 weeks. */
export const TAU_MS = 14 * 24 * 3600 * 1000
/** Two notes edited within the same 1-hour window count as co-edited. */
export const CO_EDIT_WINDOW_MS = 3600 * 1000
/** Edges untouched for 90 days fade (never break). */
export const FADE_AFTER_MS = 90 * 24 * 3600 * 1000
/** Faded edges thin to this opacity — visible forever, never zero. */
export const FADE_FLOOR_ALPHA = 0.06

export const pairKey = (a, b) => (a < b ? a + '~' + b : b + '~' + a)

/** Σ exp(-(now - t)/τ) over a note's activity events — recent work glows. */
export function recencyActivity(events, now = Date.now(), tau = TAU_MS) {
  let sum = 0
  for (const e of events) {
    const age = now - e.t
    if (age >= 0) sum += Math.exp(-age / tau)
  }
  return sum
}

/**
 * Node mass = base + a·log1p(edits) + b·degree + c·recency-decayed activity.
 * `activity` is that note's events ([{ t }]). Returns the raw mass (feeds
 * the physics) plus a normalized visual radius and brightness in [0, 1]:
 * radius saturates with mass, brightness leans on recency + connectivity so
 * a freshly-worked neuron glows even when it is still small.
 */
export function nodeMass(note, { degree = 0, activity = [], now = Date.now() } = {}) {
  const recency = recencyActivity(activity, now)
  const mass = 1 + 0.6 * Math.log1p(note?.edits || 0) + 0.25 * degree + 0.5 * recency
  const radius = mass / (mass + 5)
  const brightness = Math.min(
    1,
    0.3 + 0.5 * (recency / (recency + 1)) + 0.2 * Math.min(1, degree / 6)
  )
  return { mass, radius, brightness }
}

/** Edge weight = repeated-link count × (1 + log1p(co-edit count)). */
export function edgeWeight(linkCount, coEditCount = 0) {
  return linkCount * (1 + Math.log1p(coEditCount))
}

/**
 * Count co-edits from the activity log: for every event, each *distinct*
 * other note with an event in the preceding 1-hour window earns the pair one
 * co-edit. A sliding window start pointer keeps this O(activity · window
 * size), never O(n²) over all note pairs. Returns Map pairKey → count.
 */
export function coEditCounts(activity, windowMs = CO_EDIT_WINDOW_MS) {
  const sorted = activity
    .filter((a) => a && typeof a.t === 'number' && a.noteId)
    .sort((x, y) => x.t - y.t)
  const counts = new Map()
  let start = 0
  for (let i = 0; i < sorted.length; i++) {
    const cur = sorted[i]
    while (sorted[start].t < cur.t - windowMs) start++
    const seen = new Set()
    for (let j = start; j < i; j++) {
      const other = sorted[j].noteId
      if (other === cur.noteId || seen.has(other)) continue
      seen.add(other)
      const key = pairKey(other, cur.noteId)
      counts.set(key, (counts.get(key) || 0) + 1)
    }
  }
  return counts
}

/**
 * Consolidation pass: an edge whose endpoints have BOTH been inactive for 90
 * days gets `faded: true` — a visual thinning to FADE_FLOOR_ALPHA, never a
 * removal. `lastUsed` is Map noteId → last activity timestamp (callers fold
 * in note.updatedAt so notes older than the capped activity log still
 * count). Pure: returns new edge objects, never mutates the input.
 */
export function consolidate(edges, lastUsed, now = Date.now()) {
  return edges.map((e) => {
    const la = lastUsed.get(e.a) ?? 0
    const lb = lastUsed.get(e.b) ?? 0
    return { ...e, faded: now - Math.max(la, lb) > FADE_AFTER_MS }
  })
}

/**
 * The `hops`-hop neighborhood of `centerId` — local graph mode ("Around this
 * note", PLAN.md §2.3). Returns a filtered { nodes, edges }.
 */
export function neighborhood(graph, centerId, hops = 2) {
  const adj = new Map()
  for (const e of graph.edges) {
    if (!adj.has(e.a)) adj.set(e.a, [])
    if (!adj.has(e.b)) adj.set(e.b, [])
    adj.get(e.a).push(e.b)
    adj.get(e.b).push(e.a)
  }
  const keep = new Set([centerId])
  let frontier = [centerId]
  for (let hop = 0; hop < hops; hop++) {
    const next = []
    for (const id of frontier) {
      for (const nb of adj.get(id) || []) {
        if (!keep.has(nb)) {
          keep.add(nb)
          next.push(nb)
        }
      }
    }
    frontier = next
  }
  return {
    nodes: graph.nodes.filter((n) => keep.has(n.id)),
    edges: graph.edges.filter((e) => keep.has(e.a) && keep.has(e.b)),
  }
}

/**
 * Time-lapse frame at time T for "Watch your mind grow" (PLAN.md §2.3).
 *
 * Documented approximation: the durable activity log records per-note
 * events, and a 'link' event names the note that gained a link but not which
 * edge it created. So an edge's birth is approximated as the earliest 'link'
 * event on either endpoint at or after both endpoints exist — falling back
 * to the moment both endpoints exist when no such event survives in the
 * (capped) log. A node's birth is min(note.createdAt, its earliest logged
 * event).
 *
 * Node sizes at T are computed from activity ≤ T only: edits ≈ that note's
 * event count up to T, recency decays relative to T. `recentWindow` marks
 * nodes with an event within that window before T as `recent` so pulses
 * ripple as the scrubber passes real activity.
 */
export function timelapseFrame({ notes, edges, activity }, T, { recentWindow = 0 } = {}) {
  const eventsByNote = new Map()
  const linkTimes = new Map()
  const sorted = [...activity].sort((x, y) => x.t - y.t)
  for (const a of sorted) {
    if (!eventsByNote.has(a.noteId)) eventsByNote.set(a.noteId, [])
    eventsByNote.get(a.noteId).push(a)
    if (a.kind === 'link') {
      if (!linkTimes.has(a.noteId)) linkTimes.set(a.noteId, [])
      linkTimes.get(a.noteId).push(a.t)
    }
  }

  const birth = new Map()
  for (const n of notes) {
    const first = eventsByNote.get(n.id)?.[0]?.t ?? Infinity
    birth.set(n.id, Math.min(n.createdAt ?? Infinity, first))
  }

  const visible = notes.filter((n) => birth.get(n.id) <= T)
  const visibleIds = new Set(visible.map((n) => n.id))

  const edgeBirth = (e) => {
    const both = Math.max(birth.get(e.a) ?? Infinity, birth.get(e.b) ?? Infinity)
    let t = Infinity
    for (const id of [e.a, e.b]) {
      for (const lt of linkTimes.get(id) || []) {
        if (lt >= both && lt < t) t = lt
      }
    }
    return t === Infinity ? both : t
  }
  const frameEdges = edges
    .filter((e) => visibleIds.has(e.a) && visibleIds.has(e.b) && edgeBirth(e) <= T)
    .map((e) => ({ ...e, weight: e.w, faded: false }))

  const degree = new Map()
  for (const e of frameEdges) {
    degree.set(e.a, (degree.get(e.a) || 0) + e.w)
    degree.set(e.b, (degree.get(e.b) || 0) + e.w)
  }

  const frameNodes = visible.map((n) => {
    const upToT = (eventsByNote.get(n.id) || []).filter((ev) => ev.t <= T)
    const deg = degree.get(n.id) || 0
    const { mass, radius, brightness } = nodeMass(
      { edits: Math.max(1, upToT.length) },
      { degree: deg, activity: upToT, now: T }
    )
    const last = upToT.length ? upToT[upToT.length - 1].t : birth.get(n.id)
    return {
      id: n.id,
      title: n.title,
      folder: n.folder || '',
      tags: n.tags || [],
      aliases: n.aliases || [],
      edits: upToT.length,
      degree: deg,
      recent: recentWindow > 0 && T - last <= recentWindow,
      mass,
      radius01: radius,
      brightness,
    }
  })

  return { nodes: frameNodes, edges: frameEdges }
}
