// POST /get-bundle-url  { transfer_id: uuid }
//
// verify_jwt: true (default) — BUYER must be authenticated.
//
// Buyer-side counterpart to deliver-key: mints a fresh short-lived signed
// URL for the transfer's bundle ciphertext, plus the wrapped content key
// and the expected hash, so src/lib/marketplace.js importPurchasedBundle
// can download, verify, unseal, and decrypt (PLAN.md §3.5). Only callable
// once the transfer has reached 'delivered' or 'completed' — before that,
// no key has been wrapped for this buyer yet.

import { handlePreflight, json, errorResponse } from '../_shared/cors.ts'
import { serviceClient } from '../_shared/db.ts'
import { getCallerUser } from '../_shared/auth.ts'
import { parseJsonBody, requireUuid, ValidationError } from '../_shared/validate.ts'

const SIGNED_URL_TTL_SECONDS = 3600

Deno.serve(async (req) => {
  const preflight = handlePreflight(req)
  if (preflight) return preflight
  if (req.method !== 'POST') return errorResponse('POST only', 405)

  try {
    const user = await getCallerUser(req)
    if (!user) return errorResponse('Sign in required.', 401)

    const body = await parseJsonBody(req)
    const transferId = requireUuid(body, 'transfer_id')

    const db = serviceClient()

    const { data: transfer, error: transferErr } = await db.from('transfers').select('*').eq('id', transferId).single()
    if (transferErr || !transfer) return errorResponse('Transfer not found.', 404)
    if (transfer.buyer_id !== user.id) return errorResponse('Only the buyer can fetch the bundle for this transfer.', 403)
    if (!['delivered', 'completed'].includes(transfer.status)) {
      return errorResponse(`The content key has not been delivered yet (status: "${transfer.status}").`, 409)
    }
    if (!transfer.listing_id) return errorResponse('The original listing for this transfer no longer exists.', 410)

    const { data: listing, error: listingErr } = await db
      .from('listings')
      .select('bundle_path, bundle_hash')
      .eq('id', transfer.listing_id)
      .single()
    if (listingErr || !listing?.bundle_path) return errorResponse('Bundle not found.', 404)

    const { data: signed, error: signErr } = await db.storage
      .from('bundles')
      .createSignedUrl(listing.bundle_path, SIGNED_URL_TTL_SECONDS)
    if (signErr) throw signErr

    return json({ signedUrl: signed.signedUrl, wrappedKey: transfer.wrapped_key, bundleHash: listing.bundle_hash })
  } catch (err) {
    if (err instanceof ValidationError) return errorResponse(err.message, 400)
    console.error('[get-bundle-url]', err)
    return errorResponse('Internal error fetching bundle URL.', 500)
  }
})
