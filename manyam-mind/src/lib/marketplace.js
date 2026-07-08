// Marketplace — listing, buying, and selling mind clones. PLAN.md §3.
//
// PRODUCT NOTE (2026-07-08): Stripe is on hold by owner decision. Escrow
// runs on an internal, no-real-money provider (supabase/functions/_shared/
// payments.ts, InternalEscrowProvider) that the Edge Functions below drive;
// a Stripe adapter stub exists behind the same interface for later
// activation. `transfers.payment_ref` is a generic column any provider can
// populate — it used to be `stripe_payment_intent` (migration 0003 renamed
// it). No Stripe SDK, keys, or API calls exist anywhere in this codebase.
//
// The server never sees plaintext vault content: listed bundles are
// encrypted client-side (XChaCha20-Poly1305, crypto.js) with a random
// per-listing content key before upload. The content key is held by the
// SELLER (Dexie meta) until a sale — `deliverKey` seals it to the BUYER's
// published X25519 public key (crypto_box_seal) so only the buyer's local
// private key (never uploaded) can open it. Every state change on a
// transfer is a call to an Edge Function, which appends to
// `transfer_events` — see CLAUDE.md.
//
// Uploaded objects are framed as `nonce (24B) || ciphertext` so no extra
// "nonce" column is needed; bundle_hash is the SHA-256 of that whole framed
// blob (verified by the buyer after download, before decrypting).

import { vault } from './store.js'
import { db } from './db.js'
import { getSupabase } from './supabase.js'
import { getLocalKeyPair } from './auth.js'
import {
  encrypt,
  decrypt,
  generateContentKey,
  sealToPublicKey,
  unsealToString,
  sha256Hex,
  fromBase64,
  toBase64,
  XCHACHA_NONCE_BYTES,
} from './crypto.js'

export const remoteConfigured = Boolean(import.meta.env?.VITE_SUPABASE_URL && import.meta.env?.VITE_SUPABASE_ANON_KEY)

function requireSupabase() {
  const supabase = getSupabase()
  if (!supabase) throw new Error('Marketplace backend not configured (.env)')
  return supabase
}

async function requireUser(supabase) {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('Sign in to do that.')
  return user
}

async function invokeFn(name, body) {
  const supabase = requireSupabase()
  const { data, error } = await supabase.functions.invoke(name, { body })
  if (error) throw error
  return data
}

function listingKeyMetaKey(listingId) {
  return `listingKey:${listingId}`
}

/* ---------- local export/import — WORKS TODAY, offline, no backend ---------- */

/** Download the current mind as a portable .mind.json bundle. */
export function downloadBundle() {
  const bundle = vault.exportBundle()
  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `${bundle.persona.name.replace(/\s+/g, '-').toLowerCase()}.mind.json`
  a.click()
  URL.revokeObjectURL(a.href)
}

/** Import a bundle file — this is how a buyer receives a mind out-of-band. */
export function importBundleFile(file) {
  return file.text().then((txt) => vault.importBundle(JSON.parse(txt)))
}

/* ---------- listings (E2E-encrypted) — PLAN.md §3.2 ---------- */

/**
 * List the current mind for sale. Exports the bundle, encrypts it
 * client-side with a fresh random content key, uploads the ciphertext to
 * Storage, and inserts the listing row (preview fields only — title,
 * description, stats; never note content). Requires both consent
 * checkboxes per PLAN.md §3.6.
 *
 * @param {{ title: string, description?: string, priceCents: number, mode?: 'exclusive'|'license', consent: { noThirdPartyData: boolean, ownsContent: boolean } }} opts
 */
export async function listMindForSale({ title, description = '', priceCents, mode = 'license', consent }) {
  if (!consent?.noThirdPartyData || !consent?.ownsContent) {
    throw new Error('Both consent checkboxes are required to list a mind for sale.')
  }
  if (!title?.trim()) throw new Error('A title is required.')
  if (!Number.isFinite(priceCents) || priceCents < 0) throw new Error('Price must be a non-negative number of cents.')

  const supabase = requireSupabase()
  const user = await requireUser(supabase)

  const bundle = vault.exportBundle()
  const plaintext = new TextEncoder().encode(JSON.stringify(bundle))
  const contentKey = await generateContentKey()
  const { nonce, cipher } = await encrypt(fromBase64(contentKey), plaintext)

  const nonceBytes = fromBase64(nonce)
  const cipherBytes = fromBase64(cipher)
  const framed = new Uint8Array(nonceBytes.length + cipherBytes.length)
  framed.set(nonceBytes, 0)
  framed.set(cipherBytes, nonceBytes.length)

  const listingId = crypto.randomUUID()
  const bundlePath = `${user.id}/${listingId}.mind.enc`
  const bundleHash = await sha256Hex(framed)

  const { error: uploadError } = await supabase.storage
    .from('bundles')
    .upload(bundlePath, framed, { contentType: 'application/octet-stream', upsert: false })
  if (uploadError) throw uploadError

  const graph = vault.graph()
  const { data: listing, error } = await supabase
    .from('listings')
    .insert({
      id: listingId,
      seller_id: user.id,
      title: title.trim(),
      description,
      price_cents: Math.round(priceCents),
      bundle_path: bundlePath,
      bundle_hash: bundleHash,
      note_count: bundle.notes.length,
      link_count: graph.edges.length,
      mode,
      status: 'active',
    })
    .select()
    .single()
  if (error) throw error

  // The content key stays on THIS device (Dexie meta) until a sale closes —
  // it is never uploaded in the clear. deliverKey() seals it to a specific
  // buyer's public key at sale time.
  await db.meta.put({ key: listingKeyMetaKey(listingId), value: { contentKey } })

  return listing
}

/** Active listings for Browse (preview fields only — never bundle content). */
export async function browseListings() {
  const supabase = requireSupabase()
  const { data, error } = await supabase
    .from('listings')
    .select('id,title,description,price_cents,note_count,link_count,mode,seller_id,created_at')
    .eq('status', 'active')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data
}

/** This user's own listings (any status), for the "My listings" tab. */
export async function getMyListings() {
  const supabase = requireSupabase()
  const user = await requireUser(supabase)
  const { data, error } = await supabase
    .from('listings')
    .select('*')
    .eq('seller_id', user.id)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data
}

/** Pull a listing (and the seller's public handle) down for the buy/agreement modal. */
export async function getListing(listingId) {
  const supabase = requireSupabase()
  const { data, error } = await supabase
    .from('listings')
    .select('*, profiles!listings_seller_id_fkey(handle)')
    .eq('id', listingId)
    .single()
  if (error) throw error
  return data
}

/** The current user's own profile row (handle, display_name, public_key). */
export async function getMyProfile() {
  const supabase = requireSupabase()
  const user = await requireUser(supabase)
  const { data, error } = await supabase.from('profiles').select('*').eq('id', user.id).single()
  if (error) throw error
  return data
}

/** Withdraw an active listing. RLS (migration 0004) blocks this once a listing is sold. */
export async function withdrawListing(listingId) {
  const supabase = requireSupabase()
  const { error } = await supabase.from('listings').update({ status: 'withdrawn' }).eq('id', listingId)
  if (error) throw error
}

/* ---------- buy / sell state machine — PLAN.md §3.3 (internal escrow) ---------- */

/** Buyer: start a purchase. Server authorizes payment (internal provider) and enters escrow. */
export async function transferMind(listingId, _buyerId) {
  // _buyerId is accepted for backward compatibility with the pre-auth
  // signature but ignored — the Edge Function derives the buyer from the
  // caller's JWT, never from a client-supplied id.
  return invokeFn('create-transfer', { listing_id: listingId })
}

/** This user's purchases (as buyer), for the "My purchases" tab. */
export async function getMyPurchases() {
  const supabase = requireSupabase()
  const user = await requireUser(supabase)
  const { data, error } = await supabase
    .from('transfers')
    .select('*')
    .eq('buyer_id', user.id)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data
}

/** This user's sales (as seller), for the deliver-key action list. */
export async function getMySales() {
  const supabase = requireSupabase()
  const user = await requireUser(supabase)
  const { data, error } = await supabase
    .from('transfers')
    .select('*')
    .eq('seller_id', user.id)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data
}

/** The event timeline for one transfer (RLS restricts this to its buyer/seller). */
export async function listTransferEvents(transferId) {
  const supabase = requireSupabase()
  const { data, error } = await supabase
    .from('transfer_events')
    .select('*')
    .eq('transfer_id', transferId)
    .order('at', { ascending: true })
  if (error) throw error
  return data
}

/**
 * Seller: wrap the listing's content key to the buyer's published public
 * key and hand it off via the deliver-key function. Requires the content
 * key to still be on this device (the one that created the listing).
 */
export async function deliverKey(transferId) {
  const supabase = requireSupabase()
  const { data: transfer, error } = await supabase.from('transfers').select('*').eq('id', transferId).single()
  if (error) throw error

  const { data: buyerProfile, error: profErr } = await supabase
    .from('profiles')
    .select('public_key')
    .eq('id', transfer.buyer_id)
    .single()
  if (profErr) throw profErr
  if (!buyerProfile.public_key) {
    throw new Error("The buyer hasn't published an encryption key yet — ask them to sign in once more.")
  }

  const stored = await db.meta.get(listingKeyMetaKey(transfer.listing_id))
  if (!stored?.value?.contentKey) {
    throw new Error('Content key not found on this device — it only exists on the device that created the listing.')
  }

  const wrappedKey = await sealToPublicKey(buyerProfile.public_key, stored.value.contentKey)
  return invokeFn('deliver-key', { transfer_id: transferId, wrapped_key: wrappedKey })
}

/** Signed download URL (+ wrapped key + expected hash) for a delivered/completed transfer. Buyer-only. */
export async function getBundleUrl(transferId) {
  return invokeFn('get-bundle-url', { transfer_id: transferId })
}

/**
 * Buyer: full import flow (PLAN.md §3.5) — download the ciphertext,
 * verify its SHA-256 against what was listed (fail loudly on mismatch,
 * never decrypt an unverified blob), unseal the content key with this
 * device's private key, decrypt, import into the vault, then confirm the
 * import so escrow releases to the seller.
 */
export async function importPurchasedBundle(transferId) {
  const { signedUrl, wrappedKey, bundleHash } = await getBundleUrl(transferId)

  const res = await fetch(signedUrl)
  if (!res.ok) throw new Error(`Could not download the bundle (HTTP ${res.status}).`)
  const framed = new Uint8Array(await res.arrayBuffer())

  const actualHash = await sha256Hex(framed)
  if (actualHash !== bundleHash) {
    throw new Error(
      'Bundle hash mismatch — the downloaded file does not match what was listed. Refusing to import; this transfer has not been confirmed.'
    )
  }

  const keyPair = await getLocalKeyPair()
  if (!keyPair) throw new Error('No local encryption key found on this device — cannot decrypt this purchase.')
  const contentKeyB64 = await unsealToString(keyPair, wrappedKey)

  const nonce = framed.slice(0, XCHACHA_NONCE_BYTES)
  const cipher = framed.slice(XCHACHA_NONCE_BYTES)
  const plainBytes = await decrypt(fromBase64(contentKeyB64), nonce, cipher)
  const bundle = JSON.parse(new TextDecoder().decode(plainBytes))

  vault.importBundle(bundle)
  await invokeFn('confirm-import', { transfer_id: transferId, hash_ok: true })
  return bundle
}

/** Buyer: dispute or request a refund within the 72h window after delivery (server-enforced). */
export async function disputeTransfer(transferId, action, reason) {
  return invokeFn('dispute-transfer', { transfer_id: transferId, action, reason })
}

/* ---------- GDPR export/erasure — PLAN.md §3.6 ---------- */

/** All of the current user's rows, as JSON, for a GDPR data export. */
export async function exportAccountData() {
  return invokeFn('export-account', {})
}

/** Erase the current user's account: storage objects, profile, vault_docs, auth user; ledger rows anonymized, not deleted. */
export async function deleteAccountData() {
  return invokeFn('delete-account', {})
}

// Re-exported so callers can convert a base64 content key back to raw bytes
// (e.g. tests exercising the seal/unseal + decrypt round trip end-to-end).
export { toBase64 }
