// POST /deliver-key  { transfer_id: uuid, wrapped_key: base64 }
//
// verify_jwt: true (default) — SELLER must be authenticated.
//
// The seller's client wraps the listing's content key to the buyer's
// published X25519 public key (crypto_box_seal, client-side — this
// function never sees an unwrapped key) and sends the sealed base64 blob
// here. We verify the caller is the transfer's seller and that the
// transfer is still 'escrowed' (state machine: escrowed -> delivered),
// store the wrapped key, flip status, log the event, and hand back a
// short-lived signed URL for the ciphertext object so the buyer's next
// get-bundle-url call (or this same response, for convenience) has
// something to download.

import { handlePreflight, json, errorResponse } from '../_shared/cors.ts'
import { serviceClient } from '../_shared/db.ts'
import { getCallerUser } from '../_shared/auth.ts'
import { appendEvent } from '../_shared/events.ts'
import { canTransition } from '../_shared/stateMachine.ts'
import { parseJsonBody, requireUuid, requireString, ValidationError } from '../_shared/validate.ts'

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
    const wrappedKey = requireString(body, 'wrapped_key')

    const db = serviceClient()

    const { data: transfer, error: transferErr } = await db.from('transfers').select('*').eq('id', transferId).single()
    if (transferErr || !transfer) return errorResponse('Transfer not found.', 404)
    if (transfer.seller_id !== user.id) return errorResponse('Only the seller can deliver the content key.', 403)
    if (!canTransition(transfer.status, 'delivered')) {
      return errorResponse(`Cannot deliver a key for a transfer in status "${transfer.status}".`, 409)
    }

    const deliveredAt = new Date().toISOString()
    const { data: updated, error: updateErr } = await db
      .from('transfers')
      .update({ wrapped_key: wrappedKey, status: 'delivered', delivered_at: deliveredAt })
      .eq('id', transferId)
      .select()
      .single()
    if (updateErr) throw updateErr

    await appendEvent(db, transferId, 'key.delivered', {})

    let signedUrl: string | null = null
    if (transfer.listing_id) {
      const { data: listing } = await db.from('listings').select('bundle_path').eq('id', transfer.listing_id).single()
      if (listing?.bundle_path) {
        const { data: signed, error: signErr } = await db.storage
          .from('bundles')
          .createSignedUrl(listing.bundle_path, SIGNED_URL_TTL_SECONDS)
        if (signErr) throw signErr
        signedUrl = signed.signedUrl
      }
    }

    return json({ transfer: updated, signedUrl })
  } catch (err) {
    if (err instanceof ValidationError) return errorResponse(err.message, 400)
    console.error('[deliver-key]', err)
    return errorResponse('Internal error delivering key.', 500)
  }
})
