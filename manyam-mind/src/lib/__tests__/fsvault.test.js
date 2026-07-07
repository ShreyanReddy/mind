import { describe, it, expect } from 'vitest'
import { isSupported, isConnected, fileNameFor, toMarkdown, fromMarkdown } from '../fsvault.js'

describe('fsvault (jsdom-safe: feature detection + pure markdown round-trip)', () => {
  it('reports unsupported and disconnected under jsdom (no File System Access API)', () => {
    expect(isSupported()).toBe(false)
    expect(isConnected()).toBe(false)
  })

  it('names files as <safe-title>-<id8>.md', () => {
    expect(fileNameFor({ id: '12345678-abcd-efgh', title: 'My Great Note!' })).toBe(
      'my-great-note-12345678.md'
    )
  })

  it('round-trips a note through toMarkdown/fromMarkdown, frontmatter wins over filename', () => {
    const note = {
      id: 'abc123',
      title: 'Round Trip',
      body: 'Some **body** with [[A Link]].',
      aliases: ['RT', 'Trippy'],
      tags: ['demo', 'fs'],
      folder: 'Projects',
      createdAt: 1000,
      updatedAt: 2000,
      edits: 3,
    }
    const md = toMarkdown(note)
    const parsed = fromMarkdown(md, 'fallback-title')

    expect(parsed.id).toBe(note.id)
    expect(parsed.title).toBe(note.title)
    expect(parsed.aliases).toEqual(note.aliases)
    expect(parsed.tags).toEqual(note.tags)
    expect(parsed.folder).toBe(note.folder)
    expect(parsed.createdAt).toBe(note.createdAt)
    expect(parsed.updatedAt).toBe(note.updatedAt)
    expect(parsed.edits).toBe(note.edits)
    expect(parsed.body).toBe(note.body)
  })

  it('falls back to the filename-derived title when a file has no frontmatter', () => {
    const parsed = fromMarkdown('Just plain text, no frontmatter.', 'fallback-title')
    expect(parsed.title).toBe('fallback-title')
    expect(parsed.body).toBe('Just plain text, no frontmatter.')
  })
})
