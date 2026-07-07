// Vault store — the mind's substrate.
// LocalStorage-persisted in the MVP; PLAN.md swaps this for a synced,
// encrypted vault (Supabase + CRDT) without changing the component API.

const KEY = 'manyam.vault.v1'
const listeners = new Set()

const seed = () => {
  const now = Date.now()
  const mk = (title, body, ago) => ({
    id: crypto.randomUUID(),
    title,
    body,
    createdAt: now - ago,
    updatedAt: now - ago,
    edits: 1, // "synaptic strength" — grows with use
  })
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
    persona: {
      name: 'My Mind Clone',
      voice: 'first person, direct, warm',
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      keys: { anthropic: '', openai: '', gemini: '' }, // browser-only, never exported
    },
    activity: [], // { t, noteId } — feeds the graph's growth animation
  }
}

let state = null
try {
  state = JSON.parse(localStorage.getItem(KEY))
} catch { /* corrupted — reseed */ }
if (!state || !Array.isArray(state.notes)) state = seed()

function persist() {
  localStorage.setItem(KEY, JSON.stringify(state))
  listeners.forEach((fn) => fn(state))
}

export const vault = {
  get: () => state,
  subscribe(fn) {
    listeners.add(fn)
    return () => listeners.delete(fn)
  },

  createNote(title = 'Untitled') {
    const note = {
      id: crypto.randomUUID(),
      title,
      body: '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      edits: 0,
    }
    state.notes.unshift(note)
    state.activity.push({ t: Date.now(), noteId: note.id })
    persist()
    return note
  },

  updateNote(id, patch) {
    const n = state.notes.find((n) => n.id === id)
    if (!n) return
    Object.assign(n, patch, { updatedAt: Date.now(), edits: n.edits + 1 })
    state.activity.push({ t: Date.now(), noteId: id })
    if (state.activity.length > 500) state.activity.splice(0, 100)
    persist()
  },

  deleteNote(id) {
    state.notes = state.notes.filter((n) => n.id !== id)
    persist()
  },

  findByTitle(title) {
    const t = title.trim().toLowerCase()
    return state.notes.find((n) => n.title.trim().toLowerCase() === t)
  },

  /** Resolve a wiki-link target, creating the note if it doesn't exist. */
  resolveOrCreate(title) {
    return this.findByTitle(title) || this.createNote(title.trim())
  },

  setPersona(patch) {
    Object.assign(state.persona, patch)
    persist()
  },

  /** Export the whole mind as a portable JSON bundle — the unit of transfer/sale. */
  exportBundle() {
    const { apiKey, keys, ...persona } = state.persona // never export secrets
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
      throw new Error('Not a Manyam mind bundle')
    }
    if (!Array.isArray(bundle.notes)) throw new Error('Bundle notes must be an array')

    const now = Date.now()
    state.notes = bundle.notes.map((n) => ({
      ...n,
      id: n?.id || crypto.randomUUID(),
      title: n?.title ?? 'Untitled',
      body: n?.body ?? '',
      createdAt: n?.createdAt ?? now,
      updatedAt: n?.updatedAt ?? now,
      edits: n?.edits ?? 0,
    }))

    // Never import secrets, even from a malicious/malformed bundle — keys
    // and legacy apiKey are dropped, not merged, regardless of what the
    // bundle claims.
    const { apiKey, keys, ...importedPersona } = bundle.persona || {}
    state.persona = { ...state.persona, ...importedPersona }
    state.activity = []
    persist()
  },
}
