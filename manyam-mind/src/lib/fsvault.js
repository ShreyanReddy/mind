// Folder-vault mode — PLAN.md §1.1 (web) + §6.1 (desktop). Optional, off by
// default. When connected, every note round-trips as a real `.md` file on
// disk: `<safe-title>-<id8>.md` with YAML frontmatter (id, title, aliases,
// tags, folder, createdAt, updatedAt, edits) + body.
//
// Two backends behind one public API:
//   web   — File System Access API directory handles (Chromium browsers)
//   tauri — the desktop shell's dialog + fs plugins (a plain folder path);
//           modules are dynamically imported so the web bundle never loads
//           them, and tauri-plugin-persisted-scope keeps the picked folder
//           readable across restarts.
// Feature-detected and guarded everywhere so this module is a safe no-op
// under jsdom/Node (tests, SSR).

import { db } from './db.js'

const EXPORT_DEBOUNCE = 800
const HANDLE_META_KEY = 'fsVaultHandle'

export function isTauri() {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

export function isSupported() {
  if (isTauri()) return true
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function'
}

// { kind: 'web', handle } | { kind: 'tauri', path }
let connection = null
let exportTimer = null

// Test seam: lets unit tests inject fakes for the Tauri modules, which only
// exist at runtime inside the desktop shell.
let tauriModulesOverride = null
export function __setTauriModules(mods) {
  tauriModulesOverride = mods
}

async function tauriModules() {
  if (tauriModulesOverride) return tauriModulesOverride
  const [dialog, fs, path] = await Promise.all([
    import('@tauri-apps/plugin-dialog'),
    import('@tauri-apps/plugin-fs'),
    import('@tauri-apps/api/path'),
  ])
  return { dialog, fs, path }
}

export function isConnected() {
  return Boolean(connection)
}

/** Prompt the user to pick a folder; persist the connection to Dexie. */
export async function connect() {
  if (!isSupported()) throw new Error('File System Access API is not supported in this browser')
  if (isTauri()) {
    const { dialog } = await tauriModules()
    const path = await dialog.open({ directory: true, title: 'Choose your vault folder' })
    if (!path) throw new Error('No folder was chosen')
    connection = { kind: 'tauri', path }
    await db.meta.put({ key: HANDLE_META_KEY, value: { kind: 'tauri', path } })
    return path
  }
  const handle = await window.showDirectoryPicker()
  connection = { kind: 'web', handle }
  // The raw handle (not wrapped) keeps the pre-desktop Dexie rows readable —
  // reconnect() accepts both shapes.
  await db.meta.put({ key: HANDLE_META_KEY, value: handle })
  return handle
}

export async function disconnect() {
  connection = null
  await db.meta.delete(HANDLE_META_KEY)
}

/** Re-acquire a previously connected folder on startup, re-requesting permission if needed. */
export async function reconnect() {
  if (!isSupported()) return null
  try {
    const row = await db.meta.get(HANDLE_META_KEY)
    const stored = row?.value
    if (!stored) return null

    if (stored.kind === 'tauri') {
      if (!isTauri()) return null // vault DB copied into a plain browser — can't reach the path
      const { fs } = await tauriModules()
      if (!(await fs.exists(stored.path))) return null
      connection = { kind: 'tauri', path: stored.path }
      return stored.path
    }

    const handle = stored.kind === 'web' ? stored.handle : stored // raw-handle legacy shape
    if (!handle) return null
    if (handle.queryPermission) {
      let perm = await handle.queryPermission({ mode: 'readwrite' })
      if (perm !== 'granted') perm = await handle.requestPermission({ mode: 'readwrite' })
      if (perm !== 'granted') return null
    }
    connection = { kind: 'web', handle }
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

async function writeNoteFile(note) {
  if (connection.kind === 'tauri') {
    const { fs, path } = await tauriModules()
    await fs.writeTextFile(await path.join(connection.path, fileNameFor(note)), toMarkdown(note))
    return
  }
  const fh = await connection.handle.getFileHandle(fileNameFor(note), { create: true })
  const writable = await fh.createWritable()
  await writable.write(toMarkdown(note))
  await writable.close()
}

/** Export every note now. */
export async function exportAll(notes) {
  if (!connection) return
  for (const note of notes) await writeNoteFile(note)
}

/** Debounced export — call on every vault change while connected. */
export function scheduleExport(notes) {
  if (!connection) return
  clearTimeout(exportTimer)
  exportTimer = setTimeout(() => {
    exportAll(notes).catch((err) => console.error('[fsvault] export failed', err))
  }, EXPORT_DEBOUNCE)
}

/** List every .md file in the connected folder as [name, text] pairs. */
async function readMarkdownFiles() {
  const files = []
  if (connection.kind === 'tauri') {
    const { fs, path } = await tauriModules()
    for (const entry of await fs.readDir(connection.path)) {
      if (entry.isDirectory || !entry.name.toLowerCase().endsWith('.md')) continue
      files.push([entry.name, await fs.readTextFile(await path.join(connection.path, entry.name))])
    }
    return files
  }
  for await (const [name, handle] of connection.handle.entries()) {
    if (handle.kind !== 'file' || !name.toLowerCase().endsWith('.md')) continue
    const file = await handle.getFile()
    files.push([name, await file.text()])
  }
  return files
}

/** Parse every .md file in the connected folder into vault-shaped note objects. */
export async function loadFromFolder() {
  if (!connection) throw new Error('No folder connected')
  const notes = []
  for (const [name, text] of await readMarkdownFiles()) {
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
