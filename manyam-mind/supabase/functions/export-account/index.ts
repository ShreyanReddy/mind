// GET (or POST) /export-account  (no body)
//
// verify_jwt: true (default) — caller exports only their own data.
//
// GDPR data export (PLAN.md §3.6): every row this user owns or is a party
// to, as JSON. vault_docs rows are exported as their stored ciphertext
// (base64 `update`/`nonce`) — this function never decrypts them, since it
// holds no vault key (only the user's passphrase-derived key does, and
// that never leaves the browser).

import { handlePreflight, json, errorResponse } from '../_shared/cors.ts'
import { serviceClient } from '../_shared/db.ts'
import { getCallerUser } from '../_shared/auth.ts'

Deno.serve(async (req) => {
  const preflight = handlePreflight(req)
  if (preflight) return preflight
  if (req.method !== 'GET' && req.method !== 'POST') return errorResponse('GET or POST only', 405)

  try {
    const user = await getCallerUser(req)
    if (!user) return errorResponse('Sign in required.', 401)

    const db = serviceClient()

    const [{ data: profile }, { data: listings }, { data: transfers }, { data: vaultDocs }] = await Promise.all([
      db.from('profiles').select('*').eq('id', user.id).maybeSingle(),
      db.from('listings').select('*').eq('seller_id', user.id),
      db.from('transfers').select('*').or(`buyer_id.eq.${user.id},seller_id.eq.${user.id}`),
      db.from('vault_docs').select('*').eq('user_id', user.id),
    ])

    const transferIds = (transfers || []).map((t) => t.id)
    let transferEvents: unknown[] = []
    if (transferIds.length) {
      const { data } = await db.from('transfer_events').select('*').in('transfer_id', transferIds)
      transferEvents = data || []
    }

    return json({
      exported_at: new Date().toISOString(),
      user: { id: user.id, email: user.email },
      profile: profile || null,
      listings: listings || [],
      transfers: transfers || [],
      transfer_events: transferEvents,
      vault_docs: vaultDocs || [],
    })
  } catch (err) {
    console.error('[export-account]', err)
    return errorResponse('Internal error exporting account data.', 500)
  }
})
