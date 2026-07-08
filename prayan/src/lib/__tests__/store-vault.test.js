// Phase 1 additions to store.js: Dexie hydration/migration, undo/redo,
// tags/aliases, the incremental graph, activity kinds, and daily
// notes/templates. See store.test.js for the pre-existing export/import
// secret-stripping coverage this file doesn't repeat.
import { describe, it, expect, beforeEach } from 'vitest'

async function freshVault() {
  vi.resetModules()
  const mod = await import('../store.js')
  await mod.vault.ready()
  return mod.vault
}

function resetIndexedDb() {
  return new Promise((resolve) => {
    const req = indexedDB.deleteDatabase('manyam-mind')
    req.onsuccess = () => resolve()
    req.onerror = () => resolve()
    req.onblocked = () => resolve()
  })
}

beforeEach(async () => {
  localStorage.clear()
  await resetIndexedDb()
})

describe('note.scope — PLAN.md §5.3 privacy scopes', () => {
  it('defaults new notes to "private", or to persona.defaultNoteScope when set', async () => {
    const vault = await freshVault()
    expect(vault.createNote('Default scope').scope).toBe('private')

    vault.setPersona({ defaultNoteScope: 'mind' })
    expect(vault.createNote('Inherits mind scope').scope).toBe('mind')
  })

  it('updateNote can change a note\'s scope to any of the three values', async () => {
    const vault = await freshVault()
    const note = vault.createNote('Scoped')
    vault.updateNote(note.id, { scope: 'published' })
    expect(vault.get().notes.find((n) => n.id === note.id).scope).toBe('published')
  })

  it('normalizes an invalid/missing scope to "private" (e.g. a malformed import)', async () => {
    const vault = await freshVault()
    vault.importBundle({ format: 'manyam-mind/1', persona: {}, notes: [{ id: 'x', title: 'X', body: '', scope: 'not-a-real-scope' }] })
    expect(vault.get().notes.find((n) => n.id === 'x').scope).toBe('private')
  })

  it('scope survives export/import round-trip', async () => {
    const vault = await freshVault()
    const note = vault.createNote('Round trip')
    vault.updateNote(note.id, { scope: 'mind' })
    const bundle = vault.exportBundle()
    vault.importBundle(bundle)
    expect(vault.get().notes.find((n) => n.title === 'Round trip').scope).toBe('mind')
  })
})

describe('tags & aliases', () => {
  it('extracts #tags from the body on every update', async () => {
    const vault = await freshVault()
    const note = vault.createNote('Tagged')
    vault.updateNote(note.id, { body: 'about #cooking and #travel, also #cooking again' })
    expect(vault.get().notes.find((n) => n.id === note.id).tags.sort()).toEqual(['cooking', 'travel'])
  })

  it('resolveOrCreate resolves an existing note by alias, case-insensitively', async () => {
    const vault = await freshVault()
    const countBefore = vault.get().notes.length
    const note = vault.createNote('Zzyzx Note') // a title guaranteed not to collide with seed data
    vault.updateNote(note.id, { aliases: ['Core Values'] })
    const resolved = vault.resolveOrCreate('core values')
    expect(resolved.id).toBe(note.id)
    expect(vault.get().notes).toHaveLength(countBefore + 1) // did not create a duplicate
  })
})

describe('undo/redo', () => {
  it('reverts a note to its state before a coalesced burst of edits, and redo re-applies it', async () => {
    const vault = await freshVault()
    const note = vault.createNote('Undo me')
    vault.updateNote(note.id, { body: 'v1' })
    vault.updateNote(note.id, { body: 'v2' }) // same coalescing window (< 500ms in a test)

    expect(vault.canUndo(note.id)).toBe(true)
    expect(vault.undo(note.id)).toBe(true)
    expect(vault.get().notes.find((n) => n.id === note.id).body).toBe('')

    expect(vault.canRedo(note.id)).toBe(true)
    expect(vault.redo(note.id)).toBe(true)
    expect(vault.get().notes.find((n) => n.id === note.id).body).toBe('v2')
  })

  it('returns false and is a no-op when there is nothing to undo/redo', async () => {
    const vault = await freshVault()
    const note = vault.createNote('Fresh')
    expect(vault.canUndo(note.id)).toBe(false)
    expect(vault.undo(note.id)).toBe(false)
    expect(vault.canRedo(note.id)).toBe(false)
    expect(vault.redo(note.id)).toBe(false)
  })

  it('a new edit after an undo clears the redo stack', async () => {
    const vault = await freshVault()
    const note = vault.createNote('Branch')
    vault.updateNote(note.id, { body: 'a' })
    vault.undo(note.id)
    vault.updateNote(note.id, { body: 'b' })
    expect(vault.canRedo(note.id)).toBe(false)
  })
})

describe('activity log', () => {
  it('logs create, edit, link, and delete kinds', async () => {
    const vault = await freshVault()
    const a = vault.createNote('A')
    const b = vault.createNote('B')
    vault.updateNote(a.id, { body: 'plain edit, no links' })
    vault.updateNote(a.id, { body: `now linking to [[${b.title}]]` })
    vault.deleteNote(b.id)

    const kinds = vault.get().activity.filter((e) => [a.id, b.id].includes(e.noteId)).map((e) => e.kind)
    expect(kinds).toContain('create')
    expect(kinds).toContain('edit')
    expect(kinds).toContain('link')
    expect(kinds).toContain('delete')
  })
})

describe('vault.graph()', () => {
  it('matches links.buildGraph on the same vault state', async () => {
    const { buildGraph } = await import('../links.js')
    const vault = await freshVault()
    const a = vault.createNote('Alpha')
    const b = vault.createNote('Beta')
    vault.updateNote(a.id, { body: `see [[${b.title}]]` })

    const fromIndex = vault.graph()
    const pure = buildGraph(vault.get().notes, vault.get().activity)
    expect(fromIndex.nodes.length).toBe(pure.nodes.length)
    expect(fromIndex.edges.length).toBe(pure.edges.length)
  })
})

describe('daily notes & templates', () => {
  it('todayNote creates one note in the Daily folder and is idempotent for the same day', async () => {
    const vault = await freshVault()
    const first = vault.todayNote()
    const second = vault.todayNote()
    expect(first.id).toBe(second.id)
    expect(first.folder).toBe('Daily')
    expect(first.title).toBe(new Date().toISOString().slice(0, 10))
  })

  it('newFromTemplate substitutes {{date}} and {{title}}', async () => {
    const vault = await freshVault()
    const tpl = vault.createNote('Meeting template')
    vault.updateNote(tpl.id, { folder: 'Templates', body: '# {{title}} on {{date}}\n\nAgenda:' })

    expect(vault.templates().map((t) => t.id)).toEqual([tpl.id])

    const created = vault.newFromTemplate(tpl.id, 'Standup')
    const today = new Date().toISOString().slice(0, 10)
    expect(created.title).toBe('Standup')
    expect(created.body).toBe(`# Standup on ${today}\n\nAgenda:`)
  })
})

describe('localStorage -> Dexie migration', () => {
  it('migrates a legacy vault on first hydration and removes the localStorage key', async () => {
    localStorage.setItem(
      'manyam.vault.v1',
      JSON.stringify({
        notes: [{ id: 'legacy-1', title: 'Legacy note', body: 'from before', createdAt: 1, updatedAt: 1, edits: 2 }],
        persona: { name: 'Legacy Mind', keys: { anthropic: 'sk-should-not-survive' } },
        activity: [],
      })
    )

    const vault = await freshVault()

    expect(vault.get().notes).toHaveLength(1)
    expect(vault.get().notes[0].title).toBe('Legacy note')
    expect(vault.get().persona.name).toBe('Legacy Mind')
    expect(localStorage.getItem('manyam.vault.v1')).toBeNull()
  })

  it('seeds a fresh vault when both localStorage and Dexie are empty', async () => {
    const vault = await freshVault()
    expect(vault.get().notes.length).toBeGreaterThan(0)
    expect(vault.get().notes.some((n) => n.title === 'Welcome to your mind')).toBe(true)
  })
})

describe('graphEnriched (PLAN.md §2.2)', () => {
  it('returns growth-model nodes (mass/radius01/brightness) and weighted edges', async () => {
    const vault = await freshVault()
    const a = vault.createNote('Growth source')
    vault.updateNote(a.id, { body: 'links to [[Welcome to your mind]] #growth', folder: 'Lab' })

    const g = vault.graphEnriched()
    const node = g.nodes.find((n) => n.id === a.id)
    expect(node.mass).toBeGreaterThan(1)
    expect(node.radius01).toBeGreaterThan(0)
    expect(node.radius01).toBeLessThanOrEqual(1)
    expect(node.brightness).toBeGreaterThan(0)
    expect(node.brightness).toBeLessThanOrEqual(1)
    expect(node.folder).toBe('Lab')
    expect(node.tags).toContain('growth')

    const edge = g.edges.find((e) => e.a === a.id || e.b === a.id)
    // create + edit events land in the same 1-hour window as the linked
    // note's seed activity is absent, but the co-edit boost never shrinks
    // the weight below the raw link count
    expect(edge.weight).toBeGreaterThanOrEqual(edge.w)
    expect(edge.faded).toBe(false) // fresh edits — consolidation leaves it alive
  })
})
