// Folder-vault mode — PLAN.md §1.1. Optional, off by default. When
// connected, every note round-trips as a real `.md` file on disk via the
// File System Access API: `<safe-title>-<id8>.md` with YAML frontmatter
// (id, title, aliases, tags, folder, createdAt, updatedAt, edits) + body.
//
// Feature-detected (`window.showDirectoryPicker`) and guarded everywhere so
// this module is a safe no-op under jsdom/Node (tests, SSR).

import { db } from './db.js'

const EXPORT_DEBOUNCE = 800
const HANDLE_META_KEY = 'fsVaultHandle'

export function isSupported() {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function'
}

let directoryHandle = null
let exportTimer = null

export function isConnected() {
  return Boolean(directoryHandle)
}

/** Prompt the user to pick a folder; persist the handle (structured-clonable) to Dexie. */
export async function connect() {
  if (!isSupported()) throw new Error('File System Access API is not supported in this browser')
  directoryHandle = await window.showDirectoryPicker()
  await db.meta.put({ key: HANDLE_META_KEY, value: directoryHandle })
  return directoryHandle
}

export async function disconnect() {
  directoryHandle = null
  await db.meta.delete(HANDLE_META_KEY)
}

/** Re-acquire a previously connected folder on startup, re-requesting permission if needed. */
export async function reconnect() {
  if (!isSupported()) return null
  try {
    const row = await db.meta.get(HANDLE_META_KEY)
    const handle = row?.value
    if (!handle) return null
    if (handle.queryPermission) {
      let perm = await handle.queryPermission({ mode: 'readwrite' })
      if (perm !== 'granted') perm = await handle.requestPermission({ mode: 'readwrite' })
      if (perm !== 'granted') return null
    }
    directoryHandle = handle
    return handle
  } catch {
    return null
  }
}

function safeSlug(title = 'untitled') {
  const slug = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return slug || 'untitled'
}

export function fileNameFor(note) {
  return `${safeSlug(note.title)}-${(note.id || '').slice(0, 8)}.md`
}

function yamlList(arr = []) {
  return '[' + arr.map((v) => JSON.stringify(v)).join(', ') + ']'
}

export function toMarkdown(note) {
  const front = [
    '---',
    `id: ${JSON.stringify(note.id)}`,
    `title: ${JSON.stringify(note.title || '')}`,
    `aliases: ${yamlList(note.aliases || [])}`,
    `tags: ${yamlList(note.tags || [])}`,
    `folder: ${JSON.stringify(note.folder || '')}`,
    `createdAt: ${note.createdAt}`,
    `updatedAt: ${note.updatedAt}`,
    `edits: ${note.edits || 0}`,
    '---',
    '',
  ].join('\n')
  return front + (note.body || '')
}

/** Parse a .md file's frontmatter + body back into a partial note (frontmatter wins). */
export function fromMarkdown(text, fallbackTitle) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (!m) return { title: fallbackTitle, body: text, aliases: [], tags: [], folder: '' }

  const [, front, body] = m
  const meta = {}
  for (const line of front.split('\n')) {
    const kv = line.match(/^(\w+):\s*(.*)$/)
    if (!kv) continue
    const [, k, raw] = kv
    try {
      meta[k] = JSON.parse(raw)
    } catch {
      meta[k] = raw
    }
  }
  return {
    id: meta.id,
    title: meta.title ?? fallbackTitle,
    aliases: Array.isArray(meta.aliases) ? meta.aliases : [],
    tags: Array.isArray(meta.tags) ? meta.tags : [],
    folder: meta.folder ?? '',
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt,
    edits: meta.edits ?? 0,
    body: body.replace(/^\n/, ''),
  }
}

async function writeNoteFile(dirHandle, note) {
  const fh = await dirHandle.getFileHandle(fileNameFor(note), { create: true })
  const writable = await fh.createWritable()
  await writable.write(toMarkdown(note))
  await writable.close()
}

/** Export every note now. */
export async function exportAll(notes) {
  if (!directoryHandle) return
  for (const note of notes) await writeNoteFile(directoryHandle, note)
}

/** Debounced export — call on every vault change while connected. */
export function scheduleExport(notes) {
  if (!directoryHandle) return
  clearTimeout(exportTimer)
  exportTimer = setTimeout(() => {
    exportAll(notes).catch((err) => console.error('[fsvault] export failed', err))
  }, EXPORT_DEBOUNCE)
}

/** Parse every .md file in the connected folder into vault-shaped note objects. */
export async function loadFromFolder() {
  if (!directoryHandle) throw new Error('No folder connected')
  const notes = []
  for await (const [name, handle] of directoryHandle.entries()) {
    if (handle.kind !== 'file' || !name.toLowerCase().endsWith('.md')) continue
    const file = await handle.getFile()
    const text = await file.text()
    const fallbackTitle = name.replace(/-[a-f0-9]{8}\.md$/i, '').replace(/\.md$/i, '')
    const parsed = fromMarkdown(text, fallbackTitle)
    notes.push({
      id: parsed.id || crypto.randomUUID(),
      title: parsed.title || fallbackTitle,
      body: parsed.body || '',
      folder: parsed.folder || '',
      tags: parsed.tags || [],
      aliases: parsed.aliases || [],
      createdAt: parsed.createdAt || Date.now(),
      updatedAt: parsed.updatedAt || Date.now(),
      edits: parsed.edits || 0,
    })
  }
  return notes
}
