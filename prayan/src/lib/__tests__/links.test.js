import { describe, it, expect } from 'vitest'
import { parseLinks, backlinksTo, buildGraph, plainText } from '../links.js'

describe('parseLinks', () => {
  it('parses a plain [[Target]] link with no label', () => {
    expect(parseLinks('See [[My Notes]] for more.')).toEqual([
      { target: 'My Notes', label: 'My Notes' },
    ])
  })

  it('parses a labeled [[Target|label]] link', () => {
    expect(parseLinks('See [[My Notes|here]] for more.')).toEqual([
      { target: 'My Notes', label: 'here' },
    ])
  })

  it('parses multiple links in one body', () => {
    expect(parseLinks('[[A]] and [[B|bee]] and [[C]]')).toEqual([
      { target: 'A', label: 'A' },
      { target: 'B', label: 'bee' },
      { target: 'C', label: 'C' },
    ])
  })

  it('returns an empty array when there are no links', () => {
    expect(parseLinks('Just plain text, no synapses here.')).toEqual([])
  })

  it('returns an empty array for empty/undefined input', () => {
    expect(parseLinks('')).toEqual([])
    expect(parseLinks(undefined)).toEqual([])
  })

  it('ignores malformed/unclosed link syntax', () => {
    expect(parseLinks('This has an [[unclosed link and no more')).toEqual([])
    expect(parseLinks('Single brackets [not a link] stay text')).toEqual([])
  })

  it('trims whitespace inside target and label', () => {
    expect(parseLinks('[[  Spacey Target  |  Spacey Label  ]]')).toEqual([
      { target: 'Spacey Target', label: 'Spacey Label' },
    ])
  })
})

describe('backlinksTo', () => {
  const notes = [
    { id: '1', title: 'Alpha', body: 'Refers to [[Beta]].' },
    { id: '2', title: 'Beta', body: 'No outgoing links.' },
    { id: '3', title: 'Gamma', body: 'Also refers to [[BETA]] (different case).' },
    { id: '4', title: 'Delta', body: 'Unrelated content.' },
  ]

  it('finds notes that link to the given title', () => {
    const back = backlinksTo(notes, 'Beta')
    expect(back.map((n) => n.id).sort()).toEqual(['1', '3'])
  })

  it('matches case-insensitively on both sides', () => {
    expect(backlinksTo(notes, 'beta').map((n) => n.id).sort()).toEqual(['1', '3'])
    expect(backlinksTo(notes, 'BETA').map((n) => n.id).sort()).toEqual(['1', '3'])
  })

  it('returns an empty array when nothing links to the title', () => {
    expect(backlinksTo(notes, 'Nonexistent')).toEqual([])
  })
})

describe('buildGraph', () => {
  it('counts degree per node from links between existing notes', () => {
    const notes = [
      { id: '1', title: 'A', body: '[[B]]', edits: 1 },
      { id: '2', title: 'B', body: '', edits: 1 },
    ]
    const { nodes, edges } = buildGraph(notes)
    const byId = new Map(nodes.map((n) => [n.id, n]))
    expect(byId.get('1').degree).toBe(1)
    expect(byId.get('2').degree).toBe(1)
    expect(edges).toHaveLength(1)
    expect(edges[0].w).toBe(1)
  })

  it('increases edge weight when a link is repeated', () => {
    const notes = [
      { id: '1', title: 'A', body: '[[B]] and again [[B]] and again [[B]]', edits: 1 },
      { id: '2', title: 'B', body: '', edits: 1 },
    ]
    const { edges } = buildGraph(notes)
    expect(edges).toHaveLength(1)
    expect(edges[0].w).toBe(3)
  })

  it('ignores links to missing targets', () => {
    const notes = [{ id: '1', title: 'A', body: '[[Nowhere]]', edits: 1 }]
    const { nodes, edges } = buildGraph(notes)
    expect(edges).toHaveLength(0)
    expect(nodes[0].degree).toBe(0)
  })

  it('ignores self-links (a note linking to itself)', () => {
    const notes = [{ id: '1', title: 'A', body: '[[A]]', edits: 1 }]
    const { nodes, edges } = buildGraph(notes)
    expect(edges).toHaveLength(0)
    expect(nodes[0].degree).toBe(0)
  })

  it('marks nodes edited/created within the recent window as recent', () => {
    const notes = [{ id: '1', title: 'A', body: '', edits: 1 }]
    const activity = [{ t: Date.now(), noteId: '1' }]
    const { nodes } = buildGraph(notes, activity)
    expect(nodes[0].recent).toBe(true)
  })
})

describe('plainText', () => {
  it('strips markdown emphasis/heading/quote/code markers', () => {
    expect(plainText('# Heading\n**bold** *italic* `code` > quote')).toBe(
      'Heading\nbold italic code  quote'
    )
  })

  it('renders link labels in place of wiki-link syntax', () => {
    expect(plainText('See [[Target|the label]] for detail.')).toBe('See the label for detail.')
  })

  it('renders the bare target when a link has no label', () => {
    expect(plainText('See [[Target]] for detail.')).toBe('See Target for detail.')
  })

  it('returns an empty string for empty/undefined input', () => {
    expect(plainText('')).toBe('')
    expect(plainText(undefined)).toBe('')
  })
})
