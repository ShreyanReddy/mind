// Sync engine — PLAN.md §1.2. Env-gated, additive, and inert without config:
// with no VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY, `syncEnabled` is false
// and nothing here touches the network. One Y.Doc per note (Y.Text 'body' +
// Y.Map 'meta'); local edits queue in Dexie's `outbox` table when offline;
// remote updates merge in via Y.applyUpdate (CRDT = conflict-free) and are
// tagged with a distinct origin so they never loop back into the outbox.
// Every update is encrypted (crypto.js) before it leaves the device — the
// server never sees plaintext, per CLAUDE.md.

import * as Y from 'yjs'
import { createClient } from '@supabase/supabase-js'
import { db } from './db.js'
import { encrypt, decrypt } from './crypto.js'

const REMOTE_ORIGIN = 'manyam-remote'

const SUPABASE_URL = import.meta.env?.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = import.meta.env?.VITE_SUPABASE_ANON_KEY

/** True only when Supabase env config is present. Everything else in this
 * module is safe to import and call regardless — it just no-ops. */
export const syncEnabled = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY)

let supabaseClient = null
export function getSupabaseClient() {
  if (!syncEnabled) return null
  if (!supabaseClient) supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  return supabaseClient
}

/* ---------------- pure CRDT primitives (no network, unit-tested) ---------------- */

/** Create a Y.Doc for one note: Y.Text 'body' + Y.Map 'meta'. */
export function createNoteDoc(note = {}) {
  const doc = new Y.Doc()
  doc.transact(() => {
    const text = doc.getText('body')
    if (note.body) text.insert(0, note.body)
    const meta = doc.getMap('meta')
    meta.set('title', note.title || '')
    meta.set('folder', note.folder || '')
    meta.set('tags', note.tags || [])
    meta.set('aliases', note.aliases || [])
  })
  return doc
}

/** Apply a local edit to the doc. The resulting update carries the default (local) origin. */
export function applyLocalPatch(doc, patch = {}) {
  doc.transact(() => {
    if (patch.body !== undefined) {
      const text = doc.getText('body')
      text.delete(0, text.length)
      if (patch.body) text.insert(0, patch.body)
    }
    const meta = doc.getMap('meta')
    for (const k of ['title', 'folder', 'tags', 'aliases']) {
      if (patch[k] !== undefined) meta.set(k, patch[k])
    }
  })
}

/** Snapshot a doc's current merged state as a plain note patch. */
export function docSnapshot(doc) {
  const meta = doc.getMap('meta')
  return {
    body: doc.getText('body').toString(),
    title: meta.get('title') || '',
    folder: meta.get('folder') || '',
    tags: meta.get('tags') || [],
    aliases: meta.get('aliases') || [],
  }
}

/**
 * Apply an update received from a peer, tagged REMOTE_ORIGIN so it never
 * re-enters the local outbox (the loop guard) — see watchForOutbox below.
 * Returns the merged snapshot.
 */
export function applyRemoteUpdate(doc, updateBytes) {
  Y.applyUpdate(doc, updateBytes, REMOTE_ORIGIN)
  return docSnapshot(doc)
}

export function encodeStateAsUpdate(doc) {
  return Y.encodeStateAsUpdate(doc)
}

/** CRDT merge of any number of updates — conflict-free by construction. */
export function mergeUpdates(updates) {
  return Y.mergeUpdates(updates)
}

/**
 * Wire a Y.Doc so local edits are reported via `onLocalUpdate` (e.g. to
 * queue into the outbox) while remote-origin updates are ignored — this is
 * the loop guard that stops a merged-in remote update from being pushed
 * straight back out. Returns an unsubscribe function.
 */
export function watchForOutbox(doc, onLocalUpdate) {
  const handler = (update, origin) => {
    if (origin === REMOTE_ORIGIN) return
    onLocalUpdate(update)
  }
  doc.on('update', handler)
  return () => doc.off('update', handler)
}

/* ---------------- orchestration (network; inert unless syncEnabled) ---------------- */

/**
 * Track a note's Y.Doc, queueing encrypted updates from local edits into the
 * Dexie outbox. No-ops entirely when sync isn't configured. Refuses to
 * queue anything without a derived key (getSessionKey returning null).
 */
export function createNoteSync(note, { getSessionKey } = {}) {
  const doc = createNoteDoc(note)
  const unwatch = syncEnabled
    ? watchForOutbox(doc, async (update) => {
        const key = getSessionKey?.()
        if (!key) return // sync refuses to run without a derived key
        const { nonce, cipher } = await encrypt(key, update)
        await db.outbox.add({ noteId: note.id, update: cipher, nonce, clock: Date.now() })
      })
    : () => {}
  return { doc, stop: unwatch }
}

/** Push queued outbox entries to Supabase (best-effort; stays queued offline). */
export async function flushOutbox({ getSessionKey, getUserId } = {}) {
  if (!syncEnabled) return
  const key = getSessionKey?.()
  const userId = getUserId?.()
  if (!key || !userId) return
  const client = getSupabaseClient()
  const rows = await db.outbox.toArray()
  for (const row of rows) {
    try {
      const { error } = await client.from('vault_docs').insert({
        note_id: row.noteId,
        user_id: userId,
        update: row.update,
        nonce: row.nonce,
        clock: row.clock,
      })
      if (error) throw error
      await db.outbox.delete(row.id)
    } catch {
      break // network/RLS error — leave the rest queued, retry later
    }
  }
}

/** Decrypt + merge a remote row into `doc`, returning the merged snapshot. */
export async function mergeRemoteRow(doc, row, { getSessionKey } = {}) {
  const key = getSessionKey?.()
  if (!key) throw new Error('cannot merge a remote update without a derived key')
  const bytes = await decrypt(key, row.nonce, row.update)
  return applyRemoteUpdate(doc, bytes)
}

/** Subscribe to a user's realtime broadcast channel. No-ops without config. */
export function subscribeRealtime(userId, onMessage) {
  if (!syncEnabled || !userId) return () => {}
  const client = getSupabaseClient()
  const channel = client.channel(`vault:${userId}`)
  channel.on('broadcast', { event: 'update' }, (payload) => onMessage(payload))
  channel.subscribe()
  return () => client.removeChannel(channel)
}
