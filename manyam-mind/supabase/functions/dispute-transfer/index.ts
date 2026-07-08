// POST /dispute-transfer  { transfer_id: uuid, action: 'refund'|'dispute', reason?: string }
//
// verify_jwt: true (default) — BUYER must be authenticated.
//
// PLAN.md §3.3/§3.5: the buyer may dispute or request a refund within 72
// hours of the content key being delivered. The window is guarded here,
// server-side — the client UI hides the button once the deadline passes,
// but this function is the actual enforcement point. 'refund' immediately
// releases the escrowed payment back to the buyer (internal provider);
// 'dispute' flags the transfer for manual review (status 'disputed', which
// can still resolve to 'refunded' later per the state machine) without
// moving money yet.

import { handlePreflight, json, errorResponse } from '../_shared/cors.ts'
import { serviceClient } from '../_shared/db.ts'
import { getCallerUser } from '../_shared/auth.ts'
import { appendEvent } from '../_shared/events.ts'
import { canTransition } from '../_shared/stateMachine.ts'
import { getPaymentProvider } from '../_shared/payments.ts'
import { parseJsonBody, requireUuid, requireOneOf, ValidationError } from '../_shared/validate.ts'

const DISPUTE_WINDOW_MS = 72 * 60 * 60 * 1000

Deno.serve(async (req) => {
  const preflight = handlePreflight(req)
  if (preflight) return preflight
  if (req.method !== 'POST') return errorResponse('POST only', 405)

  try {
    const user = await getCallerUser(req)
    if (!user) return errorResponse('Sign in required.', 401)

    const body = await parseJsonBody(req)
    const transferId = requireUuid(body, 'transfer_id')
    const action = requireOneOf(body, 'action', ['refund', 'dispute'] as const)
    const reason = typeof body.reason === 'string' ? body.reason.slice(0, 2000) : null

    const db = serviceClient()

    const { data: transfer, error: transferErr } = await db.from('transfers').select('*').eq('id', transferId).single()
    if (transferErr || !transfer) return errorResponse('Transfer not found.', 404)
    if (transfer.buyer_id !== user.id) return errorResponse('Only the buyer can dispute this transfer.', 403)

    const nextStatus = action === 'refund' ? 'refunded' : 'disputed'
    if (!canTransition(transfer.status, nextStatus)) {
      return errorResponse(`Cannot ${action} a transfer in status "${transfer.status}".`, 409)
    }

    if (!transfer.delivered_at) {
      return errorResponse('This transfer has no delivery timestamp — dispute window cannot be evaluated.', 409)
    }
    const deliveredAtMs = new Date(transfer.delivered_at).getTime()
    if (Date.now() - deliveredAtMs > DISPUTE_WINDOW_MS) {
      return errorResponse('The 72-hour dispute window has closed for this transfer.', 403)
    }

    if (action === 'refund') {
      const provider = getPaymentProvider()
      await provider.refund(transfer.payment_ref)
    }

    const { data: updated, error: updateErr } = await db
      .from('transfers')
      .update({ status: nextStatus })
      .eq('id', transferId)
      .select()
      .single()
    if (updateErr) throw updateErr

    await appendEvent(db, transferId, action === 'refund' ? 'payment.refunded' : 'transfer.disputed', { reason })

    return json({ transfer: updated })
  } catch (err) {
    if (err instanceof ValidationError) return errorResponse(err.message, 400)
    console.error('[dispute-transfer]', err)
    return errorResponse('Internal error disputing transfer.', 500)
  }
})
