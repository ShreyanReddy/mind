import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  isSupported,
  isConnected,
  isTauri,
  fileNameFor,
  toMarkdown,
  fromMarkdown,
  connect,
  disconnect,
  reconnect,
  exportAll,
  loadFromFolder,
  __setTauriModules,
} from '../fsvault.js'
import { db } from '../db.js'

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

describe('fsvault tauri backend (PLAN.md §6.1 — desktop folder vault)', () => {
  // A fake desktop shell: an in-memory "disk" plus the three module seams.
  let disk
  const fakeModules = () => ({
    dialog: { open: async () => '/home/me/vault' },
    fs: {
      writeTextFile: async (p, text) => {
        disk.set(p, text)
      },
      readTextFile: async (p) => {
        if (!disk.has(p)) throw new Error('ENOENT ' + p)
        return disk.get(p)
      },
      readDir: async (dir) =>
        [...disk.keys()]
          .filter((p) => p.startsWith(dir + '/'))
          .map((p) => ({ name: p.slice(dir.length + 1), isDirectory: false })),
      exists: async (p) => [...disk.keys()].some((k) => k.startsWith(p)),
    },
    path: { join: async (...parts) => parts.join('/') },
  })

  beforeEach(() => {
    disk = new Map()
    window.__TAURI_INTERNALS__ = {}
    __setTauriModules(fakeModules())
  })

  afterEach(async () => {
    await disconnect()
    __setTauriModules(null)
    delete window.__TAURI_INTERNALS__
  })

  it('reports supported when running inside the Tauri shell', () => {
    expect(isTauri()).toBe(true)
    expect(isSupported()).toBe(true)
  })

  it('connects via the native folder picker and persists { kind: tauri, path } to Dexie', async () => {
    const path = await connect()
    expect(path).toBe('/home/me/vault')
    expect(isConnected()).toBe(true)
    const row = await db.meta.get('fsVaultHandle')
    expect(row.value).toEqual({ kind: 'tauri', path: '/home/me/vault' })
  })

  it('round-trips notes to real .md files: exportAll then loadFromFolder', async () => {
    await connect()
    const notes = [
      {
        id: 'aaaa1111-x',
        title: 'Desktop Note',
        body: 'Body with [[A Link]].',
        aliases: ['DN'],
        tags: ['desk'],
        folder: 'Projects',
        createdAt: 1000,
        updatedAt: 2000,
        edits: 4,
      },
    ]
    await exportAll(notes)
    expect(disk.has('/home/me/vault/desktop-note-aaaa1111.md')).toBe(true)

    const loaded = await loadFromFolder()
    expect(loaded).toHaveLength(1)
    expect(loaded[0]).toMatchObject({
      id: 'aaaa1111-x',
      title: 'Desktop Note',
      body: 'Body with [[A Link]].',
      folder: 'Projects',
      tags: ['desk'],
      aliases: ['DN'],
      edits: 4,
    })
  })

  it('loadFromFolder skips non-markdown entries and subdirectories', async () => {
    await connect()
    disk.set('/home/me/vault/note-12345678.md', toMarkdown({ id: 'n1', title: 'Note', body: 'hi' }))
    disk.set('/home/me/vault/image.png', 'binary')
    const loaded = await loadFromFolder()
    expect(loaded).toHaveLength(1)
    expect(loaded[0].title).toBe('Note')
  })

  it('reconnect() re-acquires a stored tauri path when the folder still exists', async () => {
    await connect()
    await exportAll([{ id: 'n1', title: 'Keep', body: '' }])
    // simulate an app restart: module state cleared, Dexie row remains
    __setTauriModules(fakeModules())
    await db.meta.put({ key: 'fsVaultHandle', value: { kind: 'tauri', path: '/home/me/vault' } })
    const path = await reconnect()
    expect(path).toBe('/home/me/vault')
    expect(isConnected()).toBe(true)
  })

  it('reconnect() returns null when the stored folder no longer exists', async () => {
    await db.meta.put({ key: 'fsVaultHandle', value: { kind: 'tauri', path: '/gone/away' } })
    expect(await reconnect()).toBe(null)
    expect(isConnected()).toBe(false)
  })

  it('reconnect() refuses a tauri-shaped row in a plain browser (vault DB copied out of the shell)', async () => {
    await db.meta.put({ key: 'fsVaultHandle', value: { kind: 'tauri', path: '/home/me/vault' } })
    delete window.__TAURI_INTERNALS__ // plain browser: not tauri, and jsdom has no FS Access API
    expect(await reconnect()).toBe(null)
  })
})
