import { describe, it, expect } from 'vitest'
import {
  nodeMass,
  edgeWeight,
  coEditCounts,
  consolidate,
  recencyActivity,
  neighborhood,
  timelapseFrame,
  pairKey,
  TAU_MS,
  FADE_AFTER_MS,
} from '../growth.js'

const HOUR = 3600 * 1000
const DAY = 24 * HOUR
const NOW = 1750000000000

describe('nodeMass', () => {
  it('grows with edits, degree, and recent activity', () => {
    const base = nodeMass({ edits: 0 }, { degree: 0, activity: [], now: NOW })
    const edited = nodeMass({ edits: 20 }, { degree: 0, activity: [], now: NOW })
    const connected = nodeMass({ edits: 0 }, { degree: 5, activity: [], now: NOW })
    const active = nodeMass({ edits: 0 }, { degree: 0, activity: [{ t: NOW - HOUR }], now: NOW })

    expect(edited.mass).toBeGreaterThan(base.mass)
    expect(connected.mass).toBeGreaterThan(base.mass)
    expect(active.mass).toBeGreaterThan(base.mass)
  })

  it('returns radius and brightness normalized to [0, 1]', () => {
    const huge = nodeMass(
      { edits: 5000 },
      { degree: 200, activity: Array.from({ length: 300 }, () => ({ t: NOW })), now: NOW }
    )
    const tiny = nodeMass({ edits: 0 }, { degree: 0, activity: [], now: NOW })
    for (const v of [huge.radius, huge.brightness, tiny.radius, tiny.brightness]) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(1)
    }
    expect(huge.radius).toBeGreaterThan(tiny.radius)
    expect(huge.brightness).toBeGreaterThan(tiny.brightness)
  })

  it('recency decays exponentially with τ ≈ 14 days', () => {
    // one event exactly 2τ (28 days) old contributes e⁻²
    expect(recencyActivity([{ t: NOW - 2 * TAU_MS }], NOW)).toBeCloseTo(Math.exp(-2), 10)
    // fresher activity always outweighs staler activity
    const fresh = nodeMass({ edits: 1 }, { activity: [{ t: NOW - DAY }], now: NOW })
    const stale = nodeMass({ edits: 1 }, { activity: [{ t: NOW - 60 * DAY }], now: NOW })
    expect(fresh.mass).toBeGreaterThan(stale.mass)
    expect(fresh.brightness).toBeGreaterThan(stale.brightness)
  })
})

describe('edgeWeight', () => {
  it('is linkCount × (1 + log1p(coEdits))', () => {
    expect(edgeWeight(2, 0)).toBe(2)
    expect(edgeWeight(3, Math.E - 1)).toBeCloseTo(6, 10)
    expect(edgeWeight(1, 10)).toBeGreaterThan(edgeWeight(1, 2))
  })
})

describe('coEditCounts', () => {
  it('counts pairs of notes edited within the same 1-hour window', () => {
    const co = coEditCounts([
      { t: NOW, noteId: 'a', kind: 'edit' },
      { t: NOW + 10 * 60000, noteId: 'b', kind: 'edit' }, // 10min later — co-edit
      { t: NOW + 3 * HOUR, noteId: 'c', kind: 'edit' }, // hours later — not
    ])
    expect(co.get(pairKey('a', 'b'))).toBe(1)
    expect(co.has(pairKey('a', 'c'))).toBe(false)
    expect(co.has(pairKey('b', 'c'))).toBe(false)
  })

  it('never pairs a note with itself, and dedupes partners per event', () => {
    const co = coEditCounts([
      { t: NOW, noteId: 'a' },
      { t: NOW + 1000, noteId: 'a' },
      { t: NOW + 2000, noteId: 'a' },
      { t: NOW + 3000, noteId: 'b' }, // sees 'a' (3 events) but counts the pair once
    ])
    expect(co.get(pairKey('a', 'b'))).toBe(1)
    expect(co.has(pairKey('a', 'a'))).toBe(false)
  })

  it('accumulates repeated co-edit sessions across windows', () => {
    const co = coEditCounts([
      { t: NOW, noteId: 'a' },
      { t: NOW + 1000, noteId: 'b' },
      { t: NOW + 5 * HOUR, noteId: 'a' },
      { t: NOW + 5 * HOUR + 1000, noteId: 'b' },
    ])
    expect(co.get(pairKey('a', 'b'))).toBe(2)
  })

  it('stays fast on a full-size activity log (O(activity·window), not O(n²) pairs)', () => {
    const acts = []
    for (let i = 0; i < 5000; i++) {
      acts.push({ t: NOW + i * 60000, noteId: 'n' + (i % 400) })
    }
    const t0 = performance.now()
    coEditCounts(acts)
    expect(performance.now() - t0).toBeLessThan(500)
  })
})

describe('consolidate', () => {
  const edges = [
    { a: 'a', b: 'b', w: 1 },
    { a: 'b', b: 'c', w: 2 },
  ]

  it('fades edges whose endpoints have both been inactive for 90 days', () => {
    const lastUsed = new Map([
      ['a', NOW - 100 * DAY],
      ['b', NOW - 95 * DAY],
      ['c', NOW - DAY],
    ])
    const out = consolidate(edges, lastUsed, NOW)
    expect(out.find((e) => e.a === 'a').faded).toBe(true) // both stale
    expect(out.find((e) => e.b === 'c').faded).toBe(false) // c is fresh — one active endpoint keeps it alive
  })

  it('never removes edges — old memories fade, they do not die', () => {
    const lastUsed = new Map()
    const out = consolidate(edges, lastUsed, NOW)
    expect(out).toHaveLength(edges.length)
    expect(out.every((e) => e.faded)).toBe(true) // unknown endpoints are treated as long-stale
  })

  it('does not mutate the input edges', () => {
    const lastUsed = new Map([['a', NOW]])
    consolidate(edges, lastUsed, NOW)
    expect(edges[0]).not.toHaveProperty('faded')
  })

  it('flips exactly at the 90-day boundary', () => {
    const just = new Map([
      ['a', NOW - FADE_AFTER_MS + 1000],
      ['b', NOW - FADE_AFTER_MS + 1000],
    ])
    const past = new Map([
      ['a', NOW - FADE_AFTER_MS - 1000],
      ['b', NOW - FADE_AFTER_MS - 1000],
    ])
    expect(consolidate([edges[0]], just, NOW)[0].faded).toBe(false)
    expect(consolidate([edges[0]], past, NOW)[0].faded).toBe(true)
  })
})

describe('neighborhood (local graph mode)', () => {
  // chain: a — b — c — d — e
  const g = {
    nodes: ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id })),
    edges: [
      { a: 'a', b: 'b' },
      { a: 'b', b: 'c' },
      { a: 'c', b: 'd' },
      { a: 'd', b: 'e' },
    ],
  }

  it('returns the 2-hop neighborhood with only internal edges', () => {
    const local = neighborhood(g, 'a', 2)
    expect(local.nodes.map((n) => n.id).sort()).toEqual(['a', 'b', 'c'])
    expect(local.edges).toHaveLength(2)
  })

  it('re-centering moves the window', () => {
    const local = neighborhood(g, 'c', 2)
    expect(local.nodes.map((n) => n.id).sort()).toEqual(['a', 'b', 'c', 'd', 'e'])
  })
})

describe('timelapseFrame (watch your mind grow)', () => {
  const T0 = NOW
  const notes = [
    { id: 'a', title: 'A', createdAt: T0 },
    { id: 'b', title: 'B', createdAt: T0 + DAY },
    { id: 'c', title: 'C', createdAt: T0 + 2 * DAY },
  ]
  const edges = [
    { a: 'a', b: 'b', w: 1 },
    { a: 'a', b: 'c', w: 1 },
  ]
  const activity = [
    { t: T0, noteId: 'a', kind: 'create' },
    { t: T0 + DAY, noteId: 'b', kind: 'create' },
    { t: T0 + 2 * DAY, noteId: 'c', kind: 'create' },
    { t: T0 + 2.5 * DAY, noteId: 'a', kind: 'link' },
    { t: T0 + 3 * DAY, noteId: 'a', kind: 'edit' },
  ]

  it('shows only notes created at or before T', () => {
    const f = timelapseFrame({ notes, edges, activity }, T0 + 0.5 * DAY)
    expect(f.nodes.map((n) => n.id)).toEqual(['a'])
    expect(f.edges).toHaveLength(0)
  })

  it('edges appear at the first link event of either endpoint after both exist (documented approximation)', () => {
    // at 1.5d both a and b exist, but a's link event is at 2.5d — no edge yet
    const early = timelapseFrame({ notes, edges, activity }, T0 + 1.5 * DAY)
    expect(early.nodes.map((n) => n.id).sort()).toEqual(['a', 'b'])
    expect(early.edges).toHaveLength(0)

    // at 2.6d the link event has fired — both edges (a~b, a~c) are visible
    const late = timelapseFrame({ notes, edges, activity }, T0 + 2.6 * DAY)
    expect(late.edges).toHaveLength(2)
  })

  it('falls back to "both endpoints exist" when no link event survives in the log', () => {
    const noLinkActs = activity.filter((a) => a.kind !== 'link')
    const f = timelapseFrame({ notes, edges, activity: noLinkActs }, T0 + 1.5 * DAY)
    expect(f.edges).toHaveLength(1) // a~b appears as soon as b exists
  })

  it('node growth reflects only activity up to T', () => {
    const early = timelapseFrame({ notes, edges, activity }, T0 + DAY)
    const late = timelapseFrame({ notes, edges, activity }, T0 + 4 * DAY)
    const aEarly = early.nodes.find((n) => n.id === 'a')
    const aLate = late.nodes.find((n) => n.id === 'a')
    expect(aEarly.edits).toBe(1) // just the create event
    expect(aLate.edits).toBe(3) // create + link + edit
    expect(aLate.mass).toBeGreaterThan(aEarly.mass)
  })

  it('marks nodes with events inside the recent window as recent (for pulses)', () => {
    const f = timelapseFrame({ notes, edges, activity }, T0 + 3 * DAY + 1000, {
      recentWindow: HOUR,
    })
    expect(f.nodes.find((n) => n.id === 'a').recent).toBe(true)
    expect(f.nodes.find((n) => n.id === 'b').recent).toBe(false)
  })
})
