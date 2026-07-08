// Dexie (IndexedDB) database — the vault's durable source of truth.
// store.js keeps state in memory for synchronous vault.get() reads and
// write-behind flushes dirty records here. See PLAN.md §1.1.
//
// Tables:
//   notes    — id (primary key) -> full note object
//   meta     — key (primary key) -> value (persona, settings, salts, the
//              File System Access directory handle, …)
//   activity — auto-increment id, indexed by t/noteId -> { t, noteId, kind }
//              (durable, replayable activity log; Phase 2 builds a
//              time-lapse from it)
//   outbox   — auto-increment id -> queued, already-encrypted Yjs updates
//              waiting to be pushed to Supabase when sync is configured and
//              the device is online (PLAN.md §1.2)
//   vectors  — chunkKey (primary key) -> cached embedding for one chunk of
//              one note, keyed by a hash of noteId+chunk text so an edit
//              produces a new key (re-embedded) while unchanged text keeps
//              hitting the cache. PLAN.md §4.1 (src/lib/embeddings.js).

import Dexie from 'dexie'

export const db = new Dexie('manyam-mind')

db.version(1).stores({
  notes: 'id',
  meta: 'key',
  activity: '++id, t, noteId',
  outbox: '++id, noteId',
})

// Dexie only requires the tables that changed since the previous version;
// notes/meta/activity/outbox keep their v1 definitions unchanged.
db.version(2).stores({
  vectors: 'chunkKey, noteId',
})

export default db
