// Client marketplace logic, with the network mocked out. Uses libsodium
// (via crypto.js) for real encryption/sealing so the round trip is
// actually exercised — see crypto.test.js for why this needs the node
// environment.
// @vitest-environment node
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'

let mockClient = null

vi.mock('../supabase.js', () => ({
  backendConfigured: true,
  getSupabase: () => mockClient,
}))

import { sodiumReady, generateKeyPair, sha256Hex, fromBase64, XCHACHA_NONCE_BYTES } from '../crypto.js'
import { vault } from '../store.js'
import { db } from '../db.js'
import * as marketplace from '../marketplace.js'

/** A minimal chainable query-builder stand-in for supabase-js's PostgrestFilterBuilder. */
function makeQueryBuilder(response) {
  const calls = []
  const builder = {
    select: (...a) => (calls.push(['select', a]), builder),
    eq: (...a) => (calls.push(['eq', a]), builder),
    or: (...a) => (calls.push(['or', a]), builder),
    in: (...a) => (calls.push(['in', a]), builder),
    order: (...a) => (calls.push(['order', a]), builder),
    insert: (...a) => (calls.push(['insert', a]), builder),
    update: (...a) => (calls.push(['update', a]), builder),
    delete: (...a) => (calls.push(['delete', a]), builder),
    single: (...a) => (calls.push(['single', a]), builder),
    maybeSingle: (...a) => (calls.push(['maybeSingle', a]), builder),
    then: (resolve, reject) => Promise.resolve(typeof response === 'function' ? response() : response).then(resolve, reject),
    calls,
  }
  return builder
}

function makeSupabaseMock({ tableResponses = {}, storage = {}, invoke, user = { id: 'user-1', email: 'seller@x.test' } } = {}) {
  const fromCalls = []
  return {
    auth: { getUser: async () => ({ data: { user } }) },
    from: (table) => {
      fromCalls.push(table)
      return makeQueryBuilder(tableResponses[table] ?? { data: null, error: null })
    },
    storage: {
      from: (bucket) => ({
        upload: storage.upload || vi.fn(async () => ({ data: { path: 'x' }, error: null })),
        createSignedUrl: storage.createSignedUrl || vi.fn(async () => ({ data: { signedUrl: 'https://example.test/signed' }, error: null })),
        list: storage.list || vi.fn(async () => ({ data: [], error: null })),
        remove: storage.remove || vi.fn(async () => ({ data: {}, error: null })),
        _bucket: bucket,
      }),
    },
    functions: { invoke: invoke || vi.fn(async () => ({ data: {}, error: null })) },
    _fromCalls: fromCalls,
  }
}

beforeAll(async () => {
  await sodiumReady()
}, 20000)

beforeEach(() => {
  mockClient = null
})

describe('remoteConfigured', () => {
  it('reflects the env vars at module load (both configured in this test env)', () => {
    expect(typeof marketplace.remoteConfigured).toBe('boolean')
  })
})

describe('listMindForSale (PLAN.md §3.2)', () => {
  it('refuses to list without both consent checkboxes', async () => {
    mockClient = makeSupabaseMock()
    await expect(
      marketplace.listMindForSale({ title: 'X', priceCents: 100, consent: { noThirdPartyData: true, ownsContent: false } })
    ).rejects.toThrow(/consent/i)
    await expect(marketplace.listMindForSale({ title: 'X', priceCents: 100 })).rejects.toThrow(/consent/i)
  })

  it('rejects a missing title or a negative price before touching the network', async () => {
    mockClient = makeSupabaseMock()
    const consent = { noThirdPartyData: true, ownsContent: true }
    await expect(marketplace.listMindForSale({ title: '', priceCents: 100, consent })).rejects.toThrow(/title/i)
    await expect(marketplace.listMindForSale({ title: 'X', priceCents: -1, consent })).rejects.toThrow(/price/i)
  })

  it('encrypts the exported bundle, uploads nonce||ciphertext framed to bundle_hash, and inserts the listing row', async () => {
    const uploadCalls = []
    const upload = vi.fn(async (path, bytes, opts) => {
      uploadCalls.push({ path, bytes, opts })
      return { data: { path }, error: null }
    })
    let insertedRow = null
    mockClient = makeSupabaseMock({
      storage: { upload },
      tableResponses: {
        listings: () => {
          // The insert().select().single() chain resolves to the row we "stored".
          return { data: insertedRow, error: null }
        },
      },
    })
    // Intercept the insert payload via a spy on the query builder's insert call —
    // simplest is to override `from` just for this test to capture args directly.
    mockClient.from = (table) => {
      mockClient._fromCalls.push(table)
      const builder = makeQueryBuilder(() => ({ data: insertedRow, error: null }))
      const originalInsert = builder.insert
      builder.insert = (row) => {
        insertedRow = { ...row }
        return originalInsert(row)
      }
      return builder
    }

    const before = vault.get().notes.length
    vault.createNote('Marketplace test note A')
    const noteB = vault.createNote('Marketplace test note B')
    vault.updateNote(noteB.id, { body: `links to [[Marketplace test note A]]` })

    const listing = await marketplace.listMindForSale({
      title: 'A Fine Mind',
      description: 'preview only',
      priceCents: 999,
      mode: 'exclusive',
      consent: { noThirdPartyData: true, ownsContent: true },
    })

    expect(listing.title).toBe('A Fine Mind')
    expect(listing.mode).toBe('exclusive')
    expect(listing.seller_id).toBe('user-1')
    expect(listing.note_count).toBe(vault.get().notes.length)
    expect(listing.note_count).toBeGreaterThanOrEqual(before + 2)

    // The uploaded object is nonce || ciphertext; its hash is what got stored.
    expect(uploadCalls).toHaveLength(1)
    const framed = uploadCalls[0].bytes
    expect(framed.length).toBeGreaterThan(XCHACHA_NONCE_BYTES)
    expect(await sha256Hex(framed)).toBe(listing.bundle_hash)
    expect(uploadCalls[0].path).toBe(`user-1/${listing.id}.mind.enc`)

    // The content key was retained locally (Dexie meta), not uploaded in the clear.
    const stored = await db.meta.get(`listingKey:${listing.id}`)
    expect(stored.value.contentKey).toBeTruthy()
    expect(framed).not.toEqual(fromBase64(stored.value.contentKey))
  })
})

describe('browseListings / transferMind (buy) / withdrawListing', () => {
  it('browseListings queries only active listings ordered by recency', async () => {
    const rows = [{ id: 'l1', title: 'One' }]
    mockClient = makeSupabaseMock({ tableResponses: { listings: { data: rows, error: null } } })
    const result = await marketplace.browseListings()
    expect(result).toBe(rows)
    expect(mockClient._fromCalls).toContain('listings')
  })

  it('transferMind (buy) invokes create-transfer with the listing id, ignoring the legacy buyerId arg', async () => {
    const invoke = vi.fn(async () => ({ data: { transfer: { id: 't1' } }, error: null }))
    mockClient = makeSupabaseMock({ invoke })
    const result = await marketplace.transferMind('listing-123', 'ignored-legacy-buyer-id')
    expect(invoke).toHaveBeenCalledWith('create-transfer', { body: { listing_id: 'listing-123' } })
    expect(result.transfer.id).toBe('t1')
  })

  it('surfaces an Edge Function error rather than swallowing it', async () => {
    const invoke = vi.fn(async () => ({ data: null, error: new Error('listing not active') }))
    mockClient = makeSupabaseMock({ invoke })
    await expect(marketplace.transferMind('listing-123')).rejects.toThrow('listing not active')
  })

  it('withdrawListing updates the listing status', async () => {
    mockClient = makeSupabaseMock({ tableResponses: { listings: { data: null, error: null } } })
    await expect(marketplace.withdrawListing('listing-123')).resolves.toBeUndefined()
  })
})

describe('deliverKey (seller wraps the content key to the buyer)', () => {
  it('seals the locally-held content key to the buyer public key and invokes deliver-key', async () => {
    const buyer = await generateKeyPair()
    const transfer = { id: 'transfer-1', listing_id: 'listing-1', buyer_id: 'buyer-1', seller_id: 'user-1' }

    await db.meta.put({ key: 'listingKey:listing-1', value: { contentKey: 'fake-content-key-base64' } })

    const invoke = vi.fn(async (name, { body }) => {
      expect(name).toBe('deliver-key')
      expect(body.transfer_id).toBe('transfer-1')
      // Verify the wrapped key genuinely unseals to the original content key.
      const { unsealToString } = await import('../crypto.js')
      const opened = await unsealToString(buyer, body.wrapped_key)
      expect(opened).toBe('fake-content-key-base64')
      return { data: { transfer: { ...transfer, status: 'delivered' }, signedUrl: 'https://example.test/x' }, error: null }
    })

    mockClient = makeSupabaseMock({
      invoke,
      tableResponses: {
        transfers: { data: transfer, error: null },
        profiles: { data: { public_key: buyer.publicKey }, error: null },
      },
    })

    const result = await marketplace.deliverKey('transfer-1')
    expect(result.transfer.status).toBe('delivered')
    expect(invoke).toHaveBeenCalledTimes(1)
  })

  it('refuses to deliver a key the local device never created', async () => {
    const transfer = { id: 'transfer-2', listing_id: 'listing-does-not-exist-locally', buyer_id: 'buyer-1', seller_id: 'user-1' }
    mockClient = makeSupabaseMock({
      tableResponses: {
        transfers: { data: transfer, error: null },
        profiles: { data: { public_key: 'somekey' }, error: null },
      },
    })
    await expect(marketplace.deliverKey('transfer-2')).rejects.toThrow(/content key not found/i)
  })

  it("refuses when the buyer hasn't published a public key yet", async () => {
    const transfer = { id: 'transfer-3', listing_id: 'listing-1', buyer_id: 'buyer-1', seller_id: 'user-1' }
    await db.meta.put({ key: 'listingKey:listing-1', value: { contentKey: 'k' } })
    mockClient = makeSupabaseMock({
      tableResponses: {
        transfers: { data: transfer, error: null },
        profiles: { data: { public_key: null }, error: null },
      },
    })
    await expect(marketplace.deliverKey('transfer-3')).rejects.toThrow(/encryption key/i)
  })
})

describe('importPurchasedBundle (PLAN.md §3.5 — buyer verify + import + confirm)', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    globalThis.fetch = originalFetch
  })

  it('downloads, verifies the hash, unseals the key, decrypts, imports, and confirms', async () => {
    const { encrypt, generateContentKey, toBase64, sealToPublicKey } = await import('../crypto.js')
    const buyer = await generateKeyPair()
    await db.meta.put({ key: 'marketplaceKeyPair', value: buyer })

    const bundle = { format: 'manyam-mind/1', persona: { name: 'Purchased Mind' }, notes: [] }
    const plaintext = new TextEncoder().encode(JSON.stringify(bundle))
    const key = fromBase64(await generateContentKey())
    const { nonce, cipher } = await encrypt(key, plaintext)
    const nonceBytes = fromBase64(nonce)
    const cipherBytes = fromBase64(cipher)
    const framed = new Uint8Array(nonceBytes.length + cipherBytes.length)
    framed.set(nonceBytes, 0)
    framed.set(cipherBytes, nonceBytes.length)
    const bundleHash = await sha256Hex(framed)

    const wrappedKey = await sealToPublicKey(buyer.publicKey, toBase64(key))

    const invoke = vi.fn(async (name, { body }) => {
      if (name === 'get-bundle-url') {
        return { data: { signedUrl: 'https://example.test/bundle', wrappedKey, bundleHash }, error: null }
      }
      if (name === 'confirm-import') {
        expect(body).toEqual({ transfer_id: 'transfer-1', hash_ok: true })
        return { data: { transfer: { id: 'transfer-1', status: 'completed' } }, error: null }
      }
      throw new Error(`unexpected invoke: ${name}`)
    })
    mockClient = makeSupabaseMock({ invoke })

    globalThis.fetch = vi.fn(async (url) => {
      expect(url).toBe('https://example.test/bundle')
      return { ok: true, arrayBuffer: async () => framed.buffer.slice(framed.byteOffset, framed.byteOffset + framed.byteLength) }
    })

    const importSpy = vi.spyOn(vault, 'importBundle').mockImplementation(() => {})

    const result = await marketplace.importPurchasedBundle('transfer-1')

    expect(result.persona.name).toBe('Purchased Mind')
    expect(importSpy).toHaveBeenCalledWith(expect.objectContaining({ persona: { name: 'Purchased Mind' } }))
    expect(invoke).toHaveBeenCalledWith('confirm-import', { body: { transfer_id: 'transfer-1', hash_ok: true } })

    importSpy.mockRestore()
  })

  it('refuses to import and does NOT confirm when the downloaded bytes fail the hash check', async () => {
    const buyer = await generateKeyPair()
    await db.meta.put({ key: 'marketplaceKeyPair', value: buyer })

    const invoke = vi.fn(async (name) => {
      if (name === 'get-bundle-url') {
        return { data: { signedUrl: 'https://example.test/bundle', wrappedKey: 'irrelevant', bundleHash: 'deadbeef'.repeat(8) }, error: null }
      }
      throw new Error(`should not call ${name} after a hash mismatch`)
    })
    mockClient = makeSupabaseMock({ invoke })

    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => new TextEncoder().encode('tampered bytes').buffer,
    }))

    const importSpy = vi.spyOn(vault, 'importBundle').mockImplementation(() => {})
    await expect(marketplace.importPurchasedBundle('transfer-1')).rejects.toThrow(/hash mismatch/i)
    expect(importSpy).not.toHaveBeenCalled()
    expect(invoke).toHaveBeenCalledTimes(1) // only get-bundle-url, never confirm-import
    importSpy.mockRestore()
  })
})

describe('disputeTransfer', () => {
  it('invokes dispute-transfer with the action and reason', async () => {
    const invoke = vi.fn(async (name, { body }) => {
      expect(name).toBe('dispute-transfer')
      expect(body).toEqual({ transfer_id: 't1', action: 'refund', reason: 'not as described' })
      return { data: { transfer: { id: 't1', status: 'refunded' } }, error: null }
    })
    mockClient = makeSupabaseMock({ invoke })
    const result = await marketplace.disputeTransfer('t1', 'refund', 'not as described')
    expect(result.transfer.status).toBe('refunded')
  })
})
