// POST /create-transfer  { listing_id: uuid }
//
// verify_jwt: true (default) — buyer must be authenticated.
//
// Buyer starts a purchase. Validates the listing is active and not the
// caller's own, authorizes payment via the active PaymentProvider (internal
// escrow today — see _shared/payments.ts), and inserts the transfer
// directly into 'escrowed' (no unpaid 'pending' row is ever persisted —
// see _shared/stateMachine.ts's note on 'pending'). Exclusive-mode listings
// flip to 'sold' immediately (buyers can no longer see or buy them);
// license-mode listings stay 'active' so other buyers can license a copy.
// Every step appends a transfer_events row.

import { handlePreflight, json, errorResponse } from '../_shared/cors.ts'
import { serviceClient } from '../_shared/db.ts'
import { getCallerUser } from '../_shared/auth.ts'
import { appendEvent } from '../_shared/events.ts'
import { getPaymentProvider } from '../_shared/payments.ts'
import { transferAgreement } from '../_shared/agreement.ts'
import { parseJsonBody, requireUuid, ValidationError } from '../_shared/validate.ts'

Deno.serve(async (req) => {
  const preflight = handlePreflight(req)
  if (preflight) return preflight
  if (req.method !== 'POST') return errorResponse('POST only', 405)

  try {
    const user = await getCallerUser(req)
    if (!user) return errorResponse('Sign in required.', 401)

    const body = await parseJsonBody(req)
    const listingId = requireUuid(body, 'listing_id')

    const db = serviceClient()

    const { data: listing, error: listingErr } = await db.from('listings').select('*').eq('id', listingId).single()
    if (listingErr || !listing) return errorResponse('Listing not found.', 404)
    if (listing.status !== 'active') return errorResponse('This listing is no longer active.', 409)
    if (listing.seller_id === user.id) return errorResponse('You cannot buy your own listing.', 400)

    const { data: sellerProfile } = await db.from('profiles').select('handle').eq('id', listing.seller_id).single()

    const transferId = crypto.randomUUID()
    const provider = getPaymentProvider()
    const { paymentRef } = await provider.authorize({ transferId, amountCents: listing.price_cents })

    const listingSnapshot = {
      title: listing.title,
      description: listing.description,
      price_cents: listing.price_cents,
      mode: listing.mode,
      note_count: listing.note_count,
      link_count: listing.link_count,
      agreement: transferAgreement({
        sellerHandle: sellerProfile?.handle || 'the seller',
        title: listing.title,
        mode: listing.mode,
        priceCents: listing.price_cents,
        date: new Date().toISOString(),
      }),
    }

    const { data: transfer, error: insertErr } = await db
      .from('transfers')
      .insert({
        id: transferId,
        listing_id: listing.id,
        seller_id: listing.seller_id,
        buyer_id: user.id,
        price_cents: listing.price_cents,
        payment_ref: paymentRef,
        status: 'escrowed',
        listing_snapshot: listingSnapshot,
      })
      .select()
      .single()
    if (insertErr) throw insertErr

    if (listing.mode === 'exclusive') {
      const { error: soldErr } = await db
        .from('listings')
        .update({ status: 'sold' })
        .eq('id', listing.id)
        .eq('status', 'active')
      if (soldErr) throw soldErr
    }

    await appendEvent(db, transferId, 'transfer.created', { listing_id: listing.id, mode: listing.mode })
    await appendEvent(db, transferId, 'payment.authorized', { payment_ref: paymentRef, amount_cents: listing.price_cents })
    await appendEvent(db, transferId, 'escrow.entered', {})

    return json({ transfer }, { status: 201 })
  } catch (err) {
    if (err instanceof ValidationError) return errorResponse(err.message, 400)
    console.error('[create-transfer]', err)
    return errorResponse('Internal error creating transfer.', 500)
  }
})
