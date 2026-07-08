import { describe, it, expect, vi } from 'vitest'
import * as Y from 'yjs'
import {
  syncEnabled,
  createNoteDoc,
  applyLocalPatch,
  applyRemoteUpdate,
  docSnapshot,
  encodeStateAsUpdate,
  mergeUpdates,
  watchForOutbox,
} from '../sync.js'

describe('sync (pure CRDT primitives — no network)', () => {
  it('is disabled with no Supabase env config, and stays fully inert', () => {
    expect(syncEnabled).toBe(false)
  })

  it('creates a per-note Y.Doc seeded with body + meta', () => {
    const doc = createNoteDoc({ title: 'A', body: 'hello', folder: 'F', tags: ['x'], aliases: ['Alpha'] })
    expect(docSnapshot(doc)).toEqual({ body: 'hello', title: 'A', folder: 'F', tags: ['x'], aliases: ['Alpha'] })
  })

  it('queues local edits via the outbox watcher but never re-queues a remote update (loop guard)', () => {
    const docA = createNoteDoc({ title: 'A', body: 'v1' })
    const onLocal = vi.fn()
    const unwatch = watchForOutbox(docA, onLocal)

    applyLocalPatch(docA, { body: 'v2' })
    expect(onLocal).toHaveBeenCalledTimes(1)

    // Simulate a peer editing an independent copy of the same doc, then
    // merging that peer's update into docA as a *remote* update.
    const docB = createNoteDoc({ title: 'A', body: 'v1' })
    Y.applyUpdate(docB, encodeStateAsUpdate(docA)) // sync docB up first isn't required for this test
    applyLocalPatch(docB, { body: 'v1 + peer edit' })
    const remoteUpdate = encodeStateAsUpdate(docB)

    applyRemoteUpdate(docA, remoteUpdate)
    // Applying the remote update must not have re-entered the local outbox.
    expect(onLocal).toHaveBeenCalledTimes(1)

    unwatch()
  })

  it('merges divergent updates conflict-free (CRDT) so two peers converge', () => {
    const docA = createNoteDoc({ title: 'Shared', body: 'base' })
    const docB = new Y.Doc()
    Y.applyUpdate(docB, encodeStateAsUpdate(docA))

    applyLocalPatch(docA, { tags: ['from-a'] })
    applyLocalPatch(docB, { folder: 'from-b' })

    const merged = mergeUpdates([encodeStateAsUpdate(docA), encodeStateAsUpdate(docB)])
    const target = new Y.Doc()
    Y.applyUpdate(target, merged)

    const snap = docSnapshot(target)
    expect(snap.tags).toEqual(['from-a'])
    expect(snap.folder).toBe('from-b')
  })
})
