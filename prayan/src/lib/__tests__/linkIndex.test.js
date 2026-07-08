import { describe, it, expect } from 'vitest'
import { createLinkIndex } from '../linkIndex.js'
import { buildGraph } from '../links.js'

const NOTE_COUNT = 5000
const LINKS_PER_NOTE = 4 // 5000 * 4 = 20,000 links

function genNotes(n, linksPerNote) {
  const notes = []
  for (let i = 0; i < n; i++) {
    notes.push({ id: 'n' + i, title: `Note-${i}`, body: '', edits: i % 7, aliases: [] })
  }
  for (let i = 0; i < n; i++) {
    const links = []
    for (let j = 0; j < linksPerNote; j++) {
      const targetIdx = (i * 7 + j * 13 + 1) % n
      links.push(`[[Note-${targetIdx}]]`)
    }
    notes[i].body = links.join(' ')
  }
  return notes
}

describe('linkIndex at scale (5,000 notes / 20,000 links)', () => {
  const notes = genNotes(NOTE_COUNT, LINKS_PER_NOTE)

  it('builds the full index in under 5s and matches the pure buildGraph fallback', () => {
    const index = createLinkIndex()

    const t0 = performance.now()
    index.rebuild(notes)
    const buildMs = performance.now() - t0
    expect(buildMs).toBeLessThan(5000)

    const indexed = index.graph(notes, [])
    const pure = buildGraph(notes, [])

    expect(indexed.nodes.length).toBe(pure.nodes.length)
    expect(indexed.edges.length).toBe(pure.edges.length)
    expect(indexed.nodes.length).toBe(NOTE_COUNT)

    const totalWeight = (edges) => edges.reduce((s, e) => s + e.w, 0)
    expect(totalWeight(indexed.edges)).toBe(totalWeight(pure.edges))
  })

  it('updates a single edited note incrementally in well under 50ms', () => {
    const index = createLinkIndex()
    index.rebuild(notes)

    const edited = { ...notes[0], body: notes[0].body + ` [[Note-${notes.length - 1}]]` }

    const t0 = performance.now()
    index.updateNote(edited)
    const incMs = performance.now() - t0

    expect(incMs).toBeLessThan(50)
  }, 10000)
}, 20000)
