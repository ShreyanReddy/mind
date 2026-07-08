// PLAN.md §4.2 — persona profile: distilled "who I am" doc, auto-maintained
// from the vault's strongest notes. Uses the real store.js vault singleton
// directly (synchronous in-memory API — no Dexie hydration needed for
// createNote/updateNote to work, same as marketplace.test.js's pattern).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { vault } from '../store.js'
import {
  PROFILE_TITLE,
  vaultFingerprint,
  profileStale,
  profileText,
  regenerateProfile,
  topNotes,
} from '../personaProfile.js'

function strongNote(title, edits = 5) {
  const note = vault.createNote(title)
  vault.updateNote(note.id, { body: `content for ${title}` })
  // bump edits directly to simulate a well-used note without many updateNote calls
  note.edits = edits
  return note
}

beforeEach(() => {
  vault.get().notes.length = 0
})

describe('topNotes / vaultFingerprint', () => {
  it('excludes the Persona Profile note itself from the top-note set', () => {
    strongNote('Alpha')
    const profile = vault.createNote(PROFILE_TITLE)
    vault.updateNote(profile.id, { body: 'anything' })
    const top = topNotes(vault.get())
    expect(top.some((n) => n.title === PROFILE_TITLE)).toBe(false)
  })

  it('produces a fingerprint that changes when a top note is edited', () => {
    const a = strongNote('Alpha')
    const fp1 = vaultFingerprint(vault.get())
    // Bump updatedAt directly rather than via vault.updateNote() — a
    // same-millisecond real edit would otherwise produce an identical
    // timestamp and make this assertion flaky.
    a.updatedAt += 1000
    const fp2 = vaultFingerprint(vault.get())
    expect(fp2).not.toBe(fp1)
  })
})

describe('profileStale — fingerprint drift (PLAN.md §4.2)', () => {
  it('is stale when no Persona Profile note exists yet', () => {
    strongNote('Alpha')
    expect(profileStale(vault.get())).toBe(true)
  })

  it('is fresh right after a matching fingerprint is stored, and stale once >20% of the top-note set changes', () => {
    const a = strongNote('Alpha')
    strongNote('Beta')
    const fp = vaultFingerprint(vault.get())
    const profile = vault.createNote(PROFILE_TITLE)
    vault.updateNote(profile.id, { body: `<!-- fingerprint: ${fp} -->\n\nProfile text.` })

    expect(profileStale(vault.get())).toBe(false)

    // Editing one of two top notes changes 1/2 = 50% of the fingerprint's entries — over the 20% threshold.
    // Bump updatedAt directly (see the fingerprint test above for why).
    a.updatedAt += 1000
    expect(profileStale(vault.get())).toBe(true)
  })

  it('is stale when the profile note has no embedded fingerprint at all', () => {
    strongNote('Alpha')
    const profile = vault.createNote(PROFILE_TITLE)
    vault.updateNote(profile.id, { body: 'no banner here' })
    expect(profileStale(vault.get())).toBe(true)
  })
})

describe('profileText', () => {
  it('strips the auto-generation banner/fingerprint comments', () => {
    const profile = vault.createNote(PROFILE_TITLE)
    vault.updateNote(profile.id, {
      body: '<!-- auto-generated -->\n<!-- fingerprint: x -->\n\nI value honesty and clarity.',
    })
    expect(profileText(vault.get())).toBe('I value honesty and clarity.')
  })

  it('returns "" when no profile note exists', () => {
    expect(profileText(vault.get())).toBe('')
  })
})

describe('regenerateProfile', () => {
  it('creates the Persona Profile note on first run with a banner + fingerprint + LLM content', async () => {
    strongNote('Alpha')
    const llmCall = vi.fn(async () => 'Distilled profile text.')
    const note = await regenerateProfile(vault.get(), llmCall)

    expect(note.title).toBe(PROFILE_TITLE)
    expect(note.body).toContain('auto-generated')
    expect(note.body).toMatch(/fingerprint:/)
    expect(note.body).toContain('Distilled profile text.')
    expect(llmCall).toHaveBeenCalledTimes(1)
    expect(profileStale(vault.get())).toBe(false) // freshly regenerated => not stale
  })

  it('overwrites an existing profile note in place rather than creating a second one', async () => {
    strongNote('Alpha')
    const llmCall = vi.fn(async () => 'First version.')
    await regenerateProfile(vault.get(), llmCall)
    const countAfterFirst = vault.get().notes.filter((n) => n.title === PROFILE_TITLE).length

    llmCall.mockResolvedValueOnce('Second version.')
    const note2 = await regenerateProfile(vault.get(), llmCall)
    const countAfterSecond = vault.get().notes.filter((n) => n.title === PROFILE_TITLE).length

    expect(countAfterFirst).toBe(1)
    expect(countAfterSecond).toBe(1)
    expect(note2.body).toContain('Second version.')
  })
})
