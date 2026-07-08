// POST /confirm-import  { transfer_id: uuid, hash_ok: true }
//
// verify_jwt: true (default) — BUYER must be authenticated.
//
// Buyer confirms the imported bundle's integrity check passed
// (src/lib/marketplace.js importPurchasedBundle verifies the SHA-256
// client-side BEFORE calling this — hash_ok must literally be `true`, we
// never trust a client claim we can't independently verify, but requiring
// the flag here still fails loudly/explicitly rather than silently if a
// caller skips the check). On success: capture the escrowed payment
// (internal provider — see _shared/payments.ts), complete the transfer,
// and — for exclusive-mode sales only — revoke the seller's synced copy by
// deleting their vault_docs rows (PLAN.md §3.5). Mode is read from
// listing_snapshot, not the live listing row, so this still works correctly
// even if the listing was later withdrawn or erased.

import { handlePreflight, json, errorResponse } from '../_shared/cors.ts'
import { serviceClient } from '../_shared/db.ts'
import { getCallerUser } from '../_shared/auth.ts'
import { appendEvent } from '../_shared/events.ts'
import { canTransition } from '../_shared/stateMachine.ts'
import { getPaymentProvider } from '../_shared/payments.ts'
import { parseJsonBody, requireUuid, ValidationError } from '../_shared/validate.ts'
import { allowRate } from '../_shared/rateLimit.ts'

Deno.serve(async (req) => {
  const preflight = handlePreflight(req)
  if (preflight) return preflight
  if (req.method !== 'POST') return errorResponse('POST only', 405)

  try {
    const user = await getCallerUser(req)
    if (!user) return errorResponse('Sign in required.', 401)
    // PLAN.md §6.4 — per-user burst limit (20/min); see _shared/rateLimit.ts
    if (!allowRate('confirm-import:' + user.id, 20, 60000))
      return errorResponse('Too many requests — try again shortly.', 429)

    const body = await parseJsonBody(req)
    const transferId = requireUuid(body, 'transfer_id')
    if (body.hash_ok !== true) {
      return errorResponse('Refusing to confirm import: hash_ok must be true (verify the bundle hash client-side first).', 400)
    }

    const db = serviceClient()

    const { data: transfer, error: transferErr } = await db.from('transfers').select('*').eq('id', transferId).single()
    if (transferErr || !transfer) return errorResponse('Transfer not found.', 404)
    if (transfer.buyer_id !== user.id) return errorResponse('Only the buyer can confirm this import.', 403)
    if (!canTransition(transfer.status, 'completed')) {
      return errorResponse(`Cannot confirm import for a transfer in status "${transfer.status}".`, 409)
    }

    const provider = getPaymentProvider()
    await provider.capture(transfer.payment_ref)

    const completedAt = new Date().toISOString()
    const { data: updated, error: updateErr } = await db
      .from('transfers')
      .update({ status: 'completed', completed_at: completedAt })
      .eq('id', transferId)
      .select()
      .single()
    if (updateErr) throw updateErr

    await appendEvent(db, transferId, 'payment.captured', { payment_ref: transfer.payment_ref })
    await appendEvent(db, transferId, 'transfer.completed', {})

    if (transfer.listing_snapshot?.mode === 'exclusive') {
      const { error: revokeErr } = await db.from('vault_docs').delete().eq('user_id', transfer.seller_id)
      if (revokeErr) throw revokeErr
      await appendEvent(db, transferId, 'seller_copy.revoked', { seller_id: transfer.seller_id })
    }

    return json({ transfer: updated })
  } catch (err) {
    if (err instanceof ValidationError) return errorResponse(err.message, 400)
    console.error('[confirm-import]', err)
    return errorResponse('Internal error confirming import.', 500)
  }
})
