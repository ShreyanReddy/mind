// First-run tour logic (PLAN.md §6.2) — the pure, testable half. The
// Onboarding component drives UI off these two functions; the "aha moment"
// is the graph reveal after the user grows three neurons and one synapse.

import { parseLinks } from './links.js'

export const TOUR_META_KEY = 'onboardingDone'
export const NOTES_GOAL = 3

/**
 * A vault is "fresh" when it's still just the seed: nothing beyond the seed
 * note count, and no note edited past its initial write. Existing minds
 * (imports, migrations, long-lived vaults) must never see the tour.
 */
export function isFreshVault(state) {
  return state.notes.length <= 4 && state.notes.every((n) => (n.edits || 0) <= 1)
}

/**
 * Progress since the tour started: how many notes the user has created
 * (anything not in `startIds`), and whether any of those new notes contains
 * a [[link]] that resolves to a DIFFERENT note (by title or alias,
 * case-insensitive). Links written into pre-existing notes don't count —
 * the tour asks the user to write and connect their own neurons.
 */
export function tourProgress(state, startIds) {
  const newNotes = state.notes.filter((n) => !startIds.has(n.id))

  const titles = new Map()
  for (const n of state.notes) {
    titles.set(n.title.trim().toLowerCase(), n.id)
    for (const a of n.aliases || []) titles.set(String(a).trim().toLowerCase(), n.id)
  }

  let linked = false
  for (const n of newNotes) {
    for (const l of parseLinks(n.body)) {
      const targetId = titles.get(l.target.toLowerCase())
      if (targetId && targetId !== n.id) {
        linked = true
        break
      }
    }
    if (linked) break
  }

  return { created: newNotes.length, linked }
}
