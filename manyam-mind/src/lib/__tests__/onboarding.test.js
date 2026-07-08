import { describe, it, expect } from 'vitest'
import { isFreshVault, tourProgress, NOTES_GOAL } from '../onboarding.js'

const note = (id, title, body = '', extra = {}) => ({
  id,
  title,
  body,
  edits: 1,
  ...extra,
})

describe('onboarding.isFreshVault (tour must only ever show on a brand-new vault)', () => {
  it('is fresh for the untouched seed (4 notes, one edit each)', () => {
    const state = { notes: ['a', 'b', 'c', 'd'].map((id) => note(id, id)) }
    expect(isFreshVault(state)).toBe(true)
  })

  it('is not fresh once any note has been edited beyond its initial write', () => {
    const state = { notes: [note('a', 'A'), note('b', 'B', '', { edits: 5 })] }
    expect(isFreshVault(state)).toBe(false)
  })

  it('is not fresh for a vault with more notes than the seed (e.g. an import)', () => {
    const state = { notes: ['a', 'b', 'c', 'd', 'e'].map((id) => note(id, id)) }
    expect(isFreshVault(state)).toBe(false)
  })
})

describe('onboarding.tourProgress', () => {
  const seedIds = new Set(['s1', 's2'])
  const seed = [note('s1', 'Welcome'), note('s2', 'How linking works')]

  it('counts only notes created after the tour started', () => {
    const state = { notes: [...seed, note('n1', 'Mine'), note('n2', 'Also mine')] }
    expect(tourProgress(state, seedIds)).toEqual({ created: 2, linked: false })
  })

  it('detects a link from a new note to another note (case-insensitive)', () => {
    const state = { notes: [...seed, note('n1', 'Mine', 'see [[welcome]]')] }
    expect(tourProgress(state, seedIds).linked).toBe(true)
  })

  it('detects labeled links and alias targets', () => {
    const withAlias = note('s2', 'How linking works', '', { aliases: ['Linking'] })
    const state = {
      notes: [seed[0], withAlias, note('n1', 'Mine', 'read [[Linking|this guide]]')],
    }
    expect(tourProgress(state, seedIds).linked).toBe(true)
  })

  it('ignores self-links and links to notes that do not exist', () => {
    const state = {
      notes: [...seed, note('n1', 'Mine', 'me: [[Mine]], ghost: [[Nope]]')],
    }
    expect(tourProgress(state, seedIds).linked).toBe(false)
  })

  it('ignores links written into pre-existing notes', () => {
    const editedSeed = note('s1', 'Welcome', 'now links [[How linking works]]')
    const state = { notes: [editedSeed, seed[1], note('n1', 'Mine')] }
    expect(tourProgress(state, seedIds).linked).toBe(false)
  })

  it('NOTES_GOAL is the advertised three neurons', () => {
    expect(NOTES_GOAL).toBe(3)
  })
})
