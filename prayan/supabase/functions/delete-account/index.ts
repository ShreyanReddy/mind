// POST /delete-account  (no body)
//
// verify_jwt: true (default) — caller deletes only their own account.
//
// GDPR erasure (PLAN.md §3.6). Deletes this user's bundle ciphertext from
// Storage, then deletes the auth user via the admin API. Everything else
// falls out of the foreign-key policy set in migration 0003:
//   - profiles row: cascades from the auth.users delete
//   - this user's listings: cascade from the profiles delete
//   - vault_docs rows: cascade from the auth.users delete (migration 0002)
//   - transfers where this user was buyer/seller: NOT deleted — buyer_id/
//     seller_id are set to NULL (anonymized), keeping the ledger intact
//     via listing_snapshot, which already captured the historical
//     title/price/agreement at purchase time
//   - transfers.listing_id for any of this user's erased listings: set
//     NULL for the same reason
// We log an 'account.anonymized' event on every transfer this user was a
// party to BEFORE the cascade runs, so the ledger records that erasure
// happened (the event log itself is not scrubbed — it holds no more PII
// than a role tag and a transfer id).

import { handlePreflight, json, errorResponse } from '../_shared/cors.ts'
import { serviceClient } from '../_shared/db.ts'
import { getCallerUser } from '../_shared/auth.ts'
import { appendEvent } from '../_shared/events.ts'
import { allowRate } from '../_shared/rateLimit.ts'

Deno.serve(async (req) => {
  const preflight = handlePreflight(req)
  if (preflight) return preflight
  if (req.method !== 'POST') return errorResponse('POST only', 405)

  try {
    const user = await getCallerUser(req)
    if (!user) return errorResponse('Sign in required.', 401)
    // PLAN.md §6.4 — per-user burst limit (3/hour); see _shared/rateLimit.ts
    if (!allowRate('delete-account:' + user.id, 3, 3600000))
      return errorResponse('Too many requests — try again shortly.', 429)

    const db = serviceClient()

    const { data: files, error: listErr } = await db.storage.from('bundles').list(user.id)
    if (listErr) throw listErr
    if (files && files.length) {
      const paths = files.map((f) => `${user.id}/${f.name}`)
      const { error: removeErr } = await db.storage.from('bundles').remove(paths)
      if (removeErr) throw removeErr
    }

    const { data: transfers, error: transfersErr } = await db
      .from('transfers')
      .select('id, buyer_id, seller_id')
      .or(`buyer_id.eq.${user.id},seller_id.eq.${user.id}`)
    if (transfersErr) throw transfersErr
    for (const t of transfers || []) {
      const role = t.buyer_id === user.id ? 'buyer' : 'seller'
      await appendEvent(db, t.id, 'account.anonymized', { role })
    }

    const { error: deleteUserErr } = await db.auth.admin.deleteUser(user.id)
    if (deleteUserErr) throw deleteUserErr

    return json({ ok: true })
  } catch (err) {
    console.error('[delete-account]', err)
    return errorResponse('Internal error deleting account.', 500)
  }
})
