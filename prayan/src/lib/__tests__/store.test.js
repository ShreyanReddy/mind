// store.js now hydrates asynchronously from Dexie/IndexedDB (write-behind
// persistence, PLAN.md §1.1) rather than reading localStorage synchronously
// at module load, so each test gets a clean module instance via
// vi.resetModules() + a fresh dynamic import, then awaits vault.ready()
// before asserting — this is the one intentional interface change store.js
// picked up in Phase 1 (vault.get() itself is still fully synchronous once
// ready() has resolved, which is what components rely on). IndexedDB is
// reset between tests too, since the underlying fake-indexeddb database
// persists across module reloads by name.
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

describe('exportBundle', () => {
  it('never includes persona.keys or the legacy persona.apiKey', async () => {
    const vault = await freshVault()
    vault.setPersona({ keys: { anthropic: 'sk-secret', openai: 'sk-2', gemini: 'sk-3' } })

    const bundle = vault.exportBundle()

    expect(bundle.persona.keys).toBeUndefined()
    expect(bundle.persona.apiKey).toBeUndefined()
    expect(JSON.stringify(bundle)).not.toContain('sk-secret')
  })

  it('strips a legacy top-level persona.apiKey too', async () => {
    const vault = await freshVault()
    vault.setPersona({ apiKey: 'sk-legacy-secret' })

    const bundle = vault.exportBundle()

    expect(bundle.persona.apiKey).toBeUndefined()
    expect(JSON.stringify(bundle)).not.toContain('sk-legacy-secret')
  })

  it('tags the bundle with the current format and includes notes', async () => {
    const vault = await freshVault()
    const bundle = vault.exportBundle()

    expect(bundle.format).toBe('prayan-mind/1')
    expect(Array.isArray(bundle.notes)).toBe(true)
    expect(bundle.notes.length).toBeGreaterThan(0)
  })
})

describe('importBundle', () => {
  it('round-trips an exported bundle', async () => {
    const vault = await freshVault()
    const before = vault.exportBundle()

    vault.createNote('A note made before import') // mutate state so we can tell import replaced it
    vault.importBundle(before)

    const after = vault.exportBundle()
    expect(after.notes.map((n) => n.title).sort()).toEqual(before.notes.map((n) => n.title).sort())
    expect(after.notes).toHaveLength(before.notes.length)
  })

  it('accepts the current prayan-mind/1 format', async () => {
    const vault = await freshVault()
    const bundle = { format: 'prayan-mind/1', persona: { name: 'X' }, notes: [] }
    expect(() => vault.importBundle(bundle)).not.toThrow()
    expect(vault.get().persona.name).toBe('X')
  })

  it('accepts the legacy manyam-mind/1 format (pre-Prayan rebrand)', async () => {
    const vault = await freshVault()
    const bundle = { format: 'manyam-mind/1', persona: { name: 'Legacy2' }, notes: [] }
    expect(() => vault.importBundle(bundle)).not.toThrow()
    expect(vault.get().persona.name).toBe('Legacy2')
  })

  it('accepts the legacy synapse-mind/1 format (the bug this test guards against)', async () => {
    const vault = await freshVault()
    const bundle = { format: 'synapse-mind/1', persona: { name: 'Legacy' }, notes: [] }
    expect(() => vault.importBundle(bundle)).not.toThrow()
    expect(vault.get().persona.name).toBe('Legacy')
  })

  it('rejects an unrecognized format', async () => {
    const vault = await freshVault()
    expect(() => vault.importBundle({ format: 'something-else/1', notes: [] })).toThrow()
  })

  it('rejects a bundle whose notes is not an array', async () => {
    const vault = await freshVault()
    expect(() =>
      vault.importBundle({ format: 'manyam-mind/1', notes: 'not-an-array', persona: {} })
    ).toThrow()
  })

  it('fills in missing note fields with sane defaults', async () => {
    const vault = await freshVault()
    vault.importBundle({
      format: 'manyam-mind/1',
      persona: {},
      notes: [{ title: 'Sparse note' }, {}],
    })

    const [a, b] = vault.get().notes
    for (const n of [a, b]) {
      expect(typeof n.id).toBe('string')
      expect(n.id.length).toBeGreaterThan(0)
      expect(typeof n.title).toBe('string')
      expect(typeof n.body).toBe('string')
      expect(typeof n.createdAt).toBe('number')
      expect(typeof n.updatedAt).toBe('number')
      expect(typeof n.edits).toBe('number')
    }
    expect(a.title).toBe('Sparse note')
    expect(b.title).toBe('Untitled')
  })

  it('never imports keys or apiKey into persona, even from a malicious bundle', async () => {
    const vault = await freshVault()
    vault.importBundle({
      format: 'manyam-mind/1',
      persona: {
        name: 'Attacker-supplied',
        keys: { anthropic: 'stolen-key' },
        apiKey: 'stolen-legacy-key',
      },
      notes: [],
    })

    const persona = vault.get().persona
    expect(persona.name).toBe('Attacker-supplied')
    expect(persona.keys).not.toEqual({ anthropic: 'stolen-key' })
    expect(persona.apiKey).toBeUndefined()
    expect(JSON.stringify(vault.exportBundle())).not.toContain('stolen')
  })
})
