// Incremental link index — PLAN.md §1.5.
//
// Reparsing every note's [[links]] on every render doesn't scale past a few
// thousand notes. This index is maintained incrementally by the store: only
// the edited note's entries (and, when its title/aliases change, the
// resolution map) are touched on each update. `links.buildGraph` remains the
// pure, reparse-everything fallback used by tests and any caller that just
// has a plain notes array (e.g. retrieval.js).

import { parseLinks } from './links.js'

function aliasKeys(note) {
  const keys = [note.title, ...(Array.isArray(note.aliases) ? note.aliases : [])]
  return keys
    .filter(Boolean)
    .map((k) => k.trim().toLowerCase())
    .filter(Boolean)
}

export function createLinkIndex() {
  const linksByNote = new Map() // noteId -> [{ target, label }]
  const idByKey = new Map() // lowercased title/alias -> noteId

  function removeNoteKeys(id) {
    for (const [k, v] of idByKey) if (v === id) idByKey.delete(k)
  }

  function upsertResolution(note) {
    removeNoteKeys(note.id)
    for (const k of aliasKeys(note)) {
      if (!idByKey.has(k)) idByKey.set(k, note.id) // first writer wins on collision
    }
  }

  /** Resolve a [[target]] string (title or alias, case-insensitive) to a note id. */
  function resolve(target) {
    return idByKey.get(target.trim().toLowerCase())
  }

  /** Re-index a single note's outgoing links and its resolution keys. */
  function updateNote(note) {
    linksByNote.set(note.id, parseLinks(note.body))
    upsertResolution(note)
  }

  function removeNote(id) {
    linksByNote.delete(id)
    removeNoteKeys(id)
  }

  /** Full rebuild — used at hydration and by the scale test. */
  function rebuild(notes) {
    linksByNote.clear()
    idByKey.clear()
    for (const n of notes) updateNote(n)
  }

  /** Build the graph model using the maintained index (no reparsing). */
  function graph(notes, activity = []) {
    const nodes = new Map()
    const edges = new Map()
    const recentCut = Date.now() - 8000
    const recent = new Set(activity.filter((a) => a.t > recentCut).map((a) => a.noteId))

    for (const n of notes) {
      nodes.set(n.id, { id: n.id, title: n.title, edits: n.edits, degree: 0, recent: recent.has(n.id) })
    }

    for (const n of notes) {
      const links = linksByNote.get(n.id) ?? parseLinks(n.body)
      for (const l of links) {
        const targetId = resolve(l.target)
        if (!targetId || targetId === n.id || !nodes.has(targetId)) continue
        const key = [n.id, targetId].sort().join('~')
        edges.set(key, { a: n.id, b: targetId, w: (edges.get(key)?.w || 0) + 1 })
        nodes.get(n.id).degree++
        nodes.get(targetId).degree++
      }
    }

    return { nodes: [...nodes.values()], edges: [...edges.values()] }
  }

  return { updateNote, removeNote, rebuild, resolve, graph, linksByNote, idByKey }
}

/** Singleton used by store.js — components read the graph through vault.graph(). */
export const linkIndex = createLinkIndex()
