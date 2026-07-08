// Vault store — the mind's substrate.
//
// State lives in memory so `vault.get()` stays synchronous for components
// (unchanged interface). Dexie (IndexedDB, db.js) is the durable source of
// truth: writes are debounced write-behind flushes of only the dirty
// records. `vault.ready()` resolves once the store has hydrated from Dexie
// (migrating a legacy localStorage vault in, if present); main.jsx awaits it
// before rendering. See PLAN.md §1.1.

import { db } from './db.js'
import { linkIndex } from './linkIndex.js'
import { parseLinks, extractTags } from './links.js'
import { nodeMass, edgeWeight, coEditCounts, consolidate, pairKey } from './growth.js'

const LOCALSTORAGE_KEY = 'manyam.vault.v1'
const FLUSH_DEBOUNCE_MS = 300
const MAX_ACTIVITY_DEXIE = 5000
const MAX_ACTIVITY_MEMORY = 500
const MAX_UNDO_SNAPSHOTS = 100
const UNDO_COALESCE_MS = 500

const listeners = new Set()
function notify() {
  listeners.forEach((fn) => fn(state))
}

function defaultPersona() {
  return {
    name: 'My Mind Clone',
    voice: 'first person, direct, warm',
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    keys: { anthropic: '', openai: '', gemini: '' }, // browser-only, never exported
    developerMode: false, // PLAN.md §4.3 — the browser-key path above only runs when this is on
    semanticRetrieval: false, // PLAN.md §4.1 — opt-in; sends note text to the embedding provider transiently
    refusalTopics: [], // PLAN.md §4.5 — owner-excluded topics; intentionally NOT stripped on export
    exportedBy: null, // PLAN.md §4.4 — stamped at first export; the mind's origin owner, carried through import
    imported: false, // PLAN.md §4.4 — true once this vault arrived via importBundle (buyer-facing framing)
    defaultNoteScope: 'private', // PLAN.md §5.3 — scope newly-created notes inherit; editable per-note afterward
  }
}

/** Valid values for note.scope — PLAN.md §5.3. 'private' (default, never leaves this device),
 * 'mind' (server-side retrieval may use it to inform an answer, never quoted verbatim),
 * 'published' (retrievable AND directly quotable in a hosted mind's answers). */
export const NOTE_SCOPES = ['private', 'mind', 'published']

function normalizeNote(n, now = Date.now()) {
  return {
    id: n?.id || crypto.randomUUID(),
    title: n?.title ?? 'Untitled',
    body: n?.body ?? '',
    folder: n?.folder ?? '',
    tags: Array.isArray(n?.tags) ? n.tags : extractTags(n?.body ?? ''),
    aliases: Array.isArray(n?.aliases) ? n.aliases : [],
    scope: NOTE_SCOPES.includes(n?.scope) ? n.scope : 'private', // PLAN.md §5.3 — survives export/import via this normalization
    createdAt: n?.createdAt ?? now,
    updatedAt: n?.updatedAt ?? now,
    edits: n?.edits ?? 0,
  }
}

function seed() {
  const now = Date.now()
  const mk = (title, body, ago) => normalizeNote({ title, body, createdAt: now - ago, updatedAt: now - ago, edits: 1 })
  return {
    notes: [
      mk(
        'Welcome to your mind',
        'This vault is the substrate of your **mind clone**.\n\nEvery note is a neuron. Every [[How linking works|link]] is a synapse. Write, connect, and watch the network on the graph tab grow and strengthen.\n\nStart by writing what you know, believe, and value:\n\n- [[My principles]]\n- [[How I make decisions]]\n- [[Things I know deeply]]\n\nWhen the vault has enough signal, open the **Persona** tab and talk to yourself.',
        86400000 * 3
      ),
      mk(
        'How linking works',
        'Type `[[` anywhere in a note to link to another note — an autocomplete will appear.\n\nLinks are *bidirectional*: the note you link to shows this note under **Backlinks**. Links you make repeatedly, and notes you edit often, grow brighter and larger in the graph — like synapses strengthening with use.\n\nLinking to a note that does not exist yet (like [[My principles]]) creates it the moment you click it.',
        86400000 * 2
      ),
      mk(
        'My principles',
        'What do you refuse to compromise on? What do you optimize for?\n\nWrite it here. Your mind clone will inherit it. See also [[How I make decisions]].',
        86400000
      ),
      mk(
        'How I make decisions',
        'Describe your decision process — heuristics, red lines, examples of calls you made and why. Connect it to [[My principles]].',
        3600000 * 5
      ),
    ],
    persona: defaultPersona(),
    activity: [], // { t, noteId, kind } — feeds the graph's growth animation & Phase 2's time-lapse
  }
}

// Synchronous placeholder until ready() resolves — keeps vault.get() safe to
// call immediately after import (components must never see `null`).
let state = { notes: [], persona: defaultPersona(), activity: [] }
let hydrated = false

/* ---------------- write-behind persistence (Dexie) ---------------- */

let flushTimer = null
const dirtyNoteIds = new Set()
const deletedNoteIds = new Set()
const dirtyMetaKeys = new Set()
let pendingActivity = []

function scheduleFlush() {
  if (!hydrated || flushTimer) return
  flushTimer = setTimeout(() => {
    flushTimer = null
    flush()
  }, FLUSH_DEBOUNCE_MS)
}

function markNoteDirty(id) {
  dirtyNoteIds.add(id)
  scheduleFlush()
}

function markMetaDirty(key) {
  dirtyMetaKeys.add(key)
  scheduleFlush()
}

function queueActivity(noteId, kind) {
  const entry = { t: Date.now(), noteId, kind }
  state.activity.push(entry)
  if (state.activity.length > MAX_ACTIVITY_MEMORY) state.activity.splice(0, state.activity.length - MAX_ACTIVITY_MEMORY)
  pendingActivity.push(entry)
  scheduleFlush()
}

async function pruneActivityTable() {
  const count = await db.activity.count()
  if (count <= MAX_ACTIVITY_DEXIE) return
  const excess = count - MAX_ACTIVITY_DEXIE
  const oldestKeys = await db.activity.orderBy('t').limit(excess).primaryKeys()
  if (oldestKeys.length) await db.activity.bulkDelete(oldestKeys)
}

/**
 * Force an immediate write of everything currently dirty. Safe to call
 * anytime. Never throws — a failed background save (quota, a torn-down
 * IndexedDB in tests, etc.) is logged, not fatal to the app.
 */
export async function flush() {
  if (!hydrated) return
  if (flushTimer) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
  const noteIds = [...dirtyNoteIds]
  dirtyNoteIds.clear()
  const delIds = [...deletedNoteIds]
  deletedNoteIds.clear()
  const metaKeys = [...dirtyMetaKeys]
  dirtyMetaKeys.clear()
  const acts = pendingActivity
  pendingActivity = []

  try {
    await db.transaction('rw', db.notes, db.meta, db.activity, async () => {
      const toPut = noteIds.map((id) => state.notes.find((n) => n.id === id)).filter(Boolean)
      if (toPut.length) await db.notes.bulkPut(toPut)
      if (delIds.length) await db.notes.bulkDelete(delIds)
      for (const key of metaKeys) {
        if (key === 'persona') await db.meta.put({ key, value: state.persona })
      }
      if (acts.length) await db.activity.bulkAdd(acts)
    })
    if (acts.length) await pruneActivityTable()
  } catch (err) {
    console.error('[store] flush failed', err)
  }
}

/* ---------------- hydration / migration ---------------- */

let readyPromise = null

/** Resolves once the store has hydrated from Dexie (migrating localStorage in, or seeding). */
export function ready() {
  if (!readyPromise) readyPromise = hydrate()
  return readyPromise
}

async function hydrate() {
  const [dexieNotes, dexieMeta] = await Promise.all([db.notes.toArray(), db.meta.toArray()])
  const metaMap = new Map(dexieMeta.map((m) => [m.key, m.value]))
  const dexieEmpty = dexieNotes.length === 0 && !metaMap.has('persona')

  let legacy = null
  if (dexieEmpty && typeof localStorage !== 'undefined') {
    try {
      legacy = JSON.parse(localStorage.getItem(LOCALSTORAGE_KEY))
    } catch {
      legacy = null // corrupted — fall through to fresh seed
    }
  }

  if (dexieEmpty && legacy && Array.isArray(legacy.notes)) {
    // One-time migration: localStorage vault -> Dexie.
    const now = Date.now()
    state.notes = legacy.notes.map((n) => normalizeNote(n, now))
    state.persona = { ...defaultPersona(), ...(legacy.persona || {}) }
    state.activity = Array.isArray(legacy.activity)
      ? legacy.activity.slice(-MAX_ACTIVITY_MEMORY).map((a) => ({ kind: 'edit', ...a }))
      : []

    await db.notes.bulkPut(state.notes)
    await db.meta.put({ key: 'persona', value: state.persona })
    if (state.activity.length) await db.activity.bulkAdd(state.activity.map((a) => ({ ...a })))
    localStorage.removeItem(LOCALSTORAGE_KEY)
  } else if (dexieEmpty) {
    // Fresh install: seed only when both localStorage and Dexie are empty.
    const s = seed()
    state.notes = s.notes
    state.persona = s.persona
    state.activity = s.activity
    await db.notes.bulkPut(state.notes)
    await db.meta.put({ key: 'persona', value: state.persona })
  } else {
    state.notes = dexieNotes.map((n) => normalizeNote(n, n.createdAt))
    state.persona = { ...defaultPersona(), ...(metaMap.get('persona') || {}) }
    const acts = await db.activity.orderBy('t').reverse().limit(MAX_ACTIVITY_MEMORY).toArray()
    state.activity = acts.reverse()
  }

  linkIndex.rebuild(state.notes)
  hydrated = true
  notify()
  return state
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    // best-effort synchronous-ish flush; IndexedDB writes started here may
    // not finish before unload, but this minimizes the loss window.
    flush()
  })
}

/* ---------------- undo/redo (bounded, in-memory, per note) ---------------- */

// noteId -> { past: Snapshot[], future: Snapshot[], pendingBefore: Snapshot|null, lastEditAt: number }
const undoStacks = new Map()

function snapshotNote(n) {
  return { title: n.title, body: n.body, folder: n.folder, tags: [...(n.tags || [])], aliases: [...(n.aliases || [])] }
}

function undoState(id) {
  let st = undoStacks.get(id)
  if (!st) {
    st = { past: [], future: [], pendingBefore: null, lastEditAt: 0 }
    undoStacks.set(id, st)
  }
  return st
}

function recordUndoableEdit(note, isNewWindow) {
  const st = undoState(note.id)
  if (isNewWindow) {
    if (st.pendingBefore) {
      st.past.push(st.pendingBefore)
      if (st.past.length > MAX_UNDO_SNAPSHOTS) st.past.shift()
    }
    st.pendingBefore = snapshotNote(note) // state BEFORE this edit is applied
  }
  st.future = [] // ANY edit invalidates redo, not just the start of a new coalescing window
  st.lastEditAt = Date.now()
}

function applySnapshot(note, snap) {
  Object.assign(note, snap, { updatedAt: Date.now() })
  note.tags = extractTags(note.body)
  linkIndex.updateNote(note)
  markNoteDirty(note.id)
}

/* ---------------- consolidation (PLAN.md §2.2) ---------------- */

// Edges whose endpoints have both been inactive for 90 days fade — visually
// thinned, never removed. Recomputed on idle (requestIdleCallback with a
// setTimeout fallback); it only refreshes this flag set, no data mutation.
let fadedEdgeKeys = new Set()
let consolidationQueued = false

function queueConsolidation() {
  if (consolidationQueued) return
  consolidationQueued = true
  const run = () => {
    consolidationQueued = false
    const lastUsed = new Map()
    for (const n of state.notes) lastUsed.set(n.id, n.updatedAt || 0)
    for (const a of state.activity) {
      if ((lastUsed.get(a.noteId) || 0) < a.t) lastUsed.set(a.noteId, a.t)
    }
    const g = linkIndex.graph(state.notes, [])
    const next = new Set()
    for (const e of consolidate(g.edges, lastUsed, Date.now())) {
      if (e.faded) next.add(pairKey(e.a, e.b))
    }
    fadedEdgeKeys = next
  }
  if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 2000 })
  else setTimeout(run, 250)
}

/* ---------------- vault API ---------------- */

export const vault = {
  get: () => state,
  ready,
  flush,
  subscribe(fn) {
    listeners.add(fn)
    return () => listeners.delete(fn)
  },

  createNote(title = 'Untitled') {
    // PLAN.md §5.3 — new notes inherit the persona's default scope
    // ("bulk default respected"); the per-note picker in Editor.jsx can
    // always override it afterward.
    const note = normalizeNote({ title, scope: state.persona.defaultNoteScope || 'private' })
    state.notes.unshift(note)
    linkIndex.updateNote(note)
    markNoteDirty(note.id)
    queueActivity(note.id, 'create')
    notify()
    return note
  },

  updateNote(id, patch, opts = {}) {
    const n = state.notes.find((n) => n.id === id)
    if (!n) return

    const now = Date.now()
    const st = undoState(id)
    const isNewWindow = now - st.lastEditAt > UNDO_COALESCE_MS
    recordUndoableEdit(n, isNewWindow)

    const oldLinkCount = patch.body !== undefined ? parseLinks(n.body).length : 0
    Object.assign(n, patch, { updatedAt: now, edits: n.edits + 1 })
    if (patch.body !== undefined) n.tags = extractTags(n.body)
    linkIndex.updateNote(n)
    markNoteDirty(id)

    queueActivity(id, opts.kind || 'edit')
    if (patch.body !== undefined && parseLinks(n.body).length > oldLinkCount) {
      queueActivity(id, 'link')
    }
    notify()
  },

  deleteNote(id) {
    state.notes = state.notes.filter((n) => n.id !== id)
    linkIndex.removeNote(id)
    undoStacks.delete(id)
    deletedNoteIds.add(id)
    dirtyNoteIds.delete(id)
    scheduleFlush()
    queueActivity(id, 'delete')
    notify()
  },

  findByTitle(title) {
    const t = title.trim().toLowerCase()
    return state.notes.find((n) => n.title.trim().toLowerCase() === t)
  },

  /** Resolve a wiki-link target (title or alias), creating the note if it doesn't exist. */
  resolveOrCreate(title) {
    const t = title.trim().toLowerCase()
    const existing = state.notes.find(
      (n) => n.title.trim().toLowerCase() === t || (n.aliases || []).some((a) => a.trim().toLowerCase() === t)
    )
    return existing || this.createNote(title.trim())
  },

  setPersona(patch) {
    Object.assign(state.persona, patch)
    markMetaDirty('persona')
    notify()
  },

  /** Merge notes parsed from a folder-vault load — upserts by id, then by title. Does not wipe the vault. */
  importNotes(incoming = []) {
    const now = Date.now()
    for (const inc of incoming) {
      const existing = state.notes.find((n) => n.id === inc.id) || this.findByTitle(inc.title || '')
      if (existing) {
        Object.assign(existing, inc, { id: existing.id, updatedAt: inc.updatedAt || now })
        existing.tags = Array.isArray(inc.tags) && inc.tags.length ? inc.tags : extractTags(existing.body)
        linkIndex.updateNote(existing)
        markNoteDirty(existing.id)
      } else {
        const note = normalizeNote(inc, now)
        state.notes.push(note)
        linkIndex.updateNote(note)
        markNoteDirty(note.id)
      }
    }
    notify()
  },

  /** Apply a merged remote CRDT snapshot to a note without re-emitting into sync (loop guard lives in sync.js). */
  applyRemotePatch(id, patch) {
    const n = state.notes.find((n) => n.id === id)
    if (!n) return
    Object.assign(n, patch, { updatedAt: Date.now() })
    n.tags = Array.isArray(patch.tags) ? patch.tags : extractTags(n.body)
    linkIndex.updateNote(n)
    markNoteDirty(id)
    notify()
  },

  /* ---- undo/redo ---- */
  undo(id) {
    const n = state.notes.find((n) => n.id === id)
    const st = undoStacks.get(id)
    if (!n || !st) return false
    if (st.pendingBefore) {
      st.past.push(st.pendingBefore)
      st.pendingBefore = null
    }
    if (!st.past.length) return false
    const prev = st.past.pop()
    st.future.push(snapshotNote(n))
    applySnapshot(n, prev)
    st.lastEditAt = Date.now()
    queueActivity(id, 'edit')
    notify()
    return true
  },

  redo(id) {
    const n = state.notes.find((n) => n.id === id)
    const st = undoStacks.get(id)
    if (!n || !st || !st.future.length) return false
    const next = st.future.pop()
    st.past.push(snapshotNote(n))
    applySnapshot(n, next)
    st.pendingBefore = null
    st.lastEditAt = Date.now()
    queueActivity(id, 'edit')
    notify()
    return true
  },

  canUndo(id) {
    const st = undoStacks.get(id)
    return Boolean(st && (st.past.length > 0 || st.pendingBefore))
  },

  canRedo(id) {
    const st = undoStacks.get(id)
    return Boolean(st && st.future.length > 0)
  },

  /* ---- incremental graph (PLAN.md §1.5) ---- */
  graph() {
    return linkIndex.graph(state.notes, state.activity)
  },

  /* ---- growth-enriched graph (PLAN.md §2.2) ---- */
  /**
   * The graph with growth semantics applied: nodes carry mass / radius01 /
   * brightness (edits + degree + recency-decayed activity, growth.js),
   * edges carry weight (link count × co-edit frequency) and the faded flag
   * from the idle consolidation pass. GraphView consumes this instead of
   * computing visuals ad hoc.
   */
  graphEnriched() {
    const g = linkIndex.graph(state.notes, state.activity)
    const now = Date.now()
    const byId = new Map(state.notes.map((n) => [n.id, n]))
    const eventsByNote = new Map()
    for (const a of state.activity) {
      let list = eventsByNote.get(a.noteId)
      if (!list) eventsByNote.set(a.noteId, (list = []))
      list.push(a)
    }
    const co = coEditCounts(state.activity)

    const nodes = g.nodes.map((n) => {
      const note = byId.get(n.id)
      const { mass, radius, brightness } = nodeMass(note, {
        degree: n.degree,
        activity: eventsByNote.get(n.id) || [],
        now,
      })
      return {
        ...n,
        folder: note?.folder || '',
        tags: note?.tags || [],
        aliases: note?.aliases || [],
        mass,
        radius01: radius,
        brightness,
      }
    })
    const edges = g.edges.map((e) => {
      const key = pairKey(e.a, e.b)
      return { ...e, weight: edgeWeight(e.w, co.get(key) || 0), faded: fadedEdgeKeys.has(key) }
    })
    queueConsolidation()
    return { nodes, edges }
  },

  /* ---- daily notes & templates (PLAN.md §1.4) ---- */
  todayNote() {
    const title = new Date().toISOString().slice(0, 10) // YYYY-MM-DD
    const existing = state.notes.find((n) => n.folder === 'Daily' && n.title === title)
    if (existing) return existing
    const note = this.createNote(title)
    this.updateNote(note.id, { folder: 'Daily' })
    return note
  },

  templates() {
    return state.notes.filter((n) => n.folder === 'Templates')
  },

  newFromTemplate(templateId, title) {
    const tpl = state.notes.find((n) => n.id === templateId)
    if (!tpl) throw new Error('Template not found')
    const dateStr = new Date().toISOString().slice(0, 10)
    const finalTitle = (title || tpl.title).replace(/\{\{date\}\}/g, dateStr)
    const note = this.createNote(finalTitle)
    const body = tpl.body.replace(/\{\{date\}\}/g, dateStr).replace(/\{\{title\}\}/g, finalTitle)
    this.updateNote(note.id, { body })
    return note
  },

  /**
   * Export the whole mind as a portable JSON bundle — the unit of
   * transfer/sale. Stamps `persona.exportedBy` with the origin owner label
   * the FIRST time a mind is exported (PLAN.md §4.4) — if it's already set
   * (this vault was itself imported, then re-exported), the original
   * lineage is preserved rather than overwritten with the current owner's
   * clone name. `refusalTopics` is deliberately NOT stripped — PLAN.md
   * §4.5 requires the seller-defined excluded-topics list to ship baked
   * into the bundle, unlike secrets (apiKey/keys), which always are.
   */
  exportBundle() {
    const { apiKey, keys, ...personaRest } = state.persona // never export secrets
    const persona = { ...personaRest, exportedBy: personaRest.exportedBy || personaRest.name }
    return {
      format: 'manyam-mind/1',
      exportedAt: new Date().toISOString(),
      persona,
      notes: state.notes,
    }
  },

  importBundle(bundle) {
    // 'synapse-mind/1' is the legacy format tag from before the rebrand —
    // bundles exported under the old name must still import cleanly.
    if (bundle?.format !== 'manyam-mind/1' && bundle?.format !== 'synapse-mind/1') {
      throw new Error('Not a Prayan mind bundle')
    }
    if (!Array.isArray(bundle.notes)) throw new Error('Bundle notes must be an array')

    const now = Date.now()
    for (const id of state.notes.map((n) => n.id)) deletedNoteIds.add(id)
    state.notes = bundle.notes.map((n) => normalizeNote(n, now))
    for (const n of state.notes) {
      dirtyNoteIds.add(n.id)
      deletedNoteIds.delete(n.id)
    }
    linkIndex.rebuild(state.notes)
    undoStacks.clear()

    // Never import secrets, even from a malicious/malformed bundle — keys
    // and legacy apiKey are dropped, not merged, regardless of what the
    // bundle claims. `imported: true` marks this vault as a buyer-facing
    // mind from here on (PLAN.md §4.4 — PersonaChat shows an "imported
    // mind" badge and the system prompt frames answers accordingly), and
    // is set unconditionally here regardless of what the bundle contains.
    const { apiKey, keys, ...importedPersona } = bundle.persona || {}
    state.persona = { ...state.persona, ...importedPersona, imported: true }
    state.activity = []
    markMetaDirty('persona')
    scheduleFlush()
    notify()
  },
}
