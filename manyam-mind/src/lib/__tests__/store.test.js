// store.js reads localStorage once at module load and keeps its state in a
// closure, so each test gets a clean module instance via vi.resetModules()
// + a fresh dynamic import, after seeding/clearing localStorage as needed.
import { describe, it, expect, beforeEach } from 'vitest'

async function freshVault() {
  vi.resetModules()
  const mod = await import('../store.js')
  return mod.vault
}

beforeEach(() => {
  localStorage.clear()
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

    expect(bundle.format).toBe('manyam-mind/1')
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

  it('accepts the current manyam-mind/1 format', async () => {
    const vault = await freshVault()
    const bundle = { format: 'manyam-mind/1', persona: { name: 'X' }, notes: [] }
    expect(() => vault.importBundle(bundle)).not.toThrow()
    expect(vault.get().persona.name).toBe('X')
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
