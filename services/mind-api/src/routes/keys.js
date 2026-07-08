// POST /keys    (Supabase JWT auth) -> { key, id, prefix, label } — the
//               plaintext key is returned exactly ONCE, at creation; only
//               its sha-256 hash is ever persisted (api_keys.key_hash).
// DELETE /keys/:id (Supabase JWT auth) -> revokes a key the caller owns.
//
// Callers then send `Authorization: Bearer <api-key>` on /ask to bypass
// the free-tier daily limit (still metered per key — see routes/ask.js).

import { Router } from 'express'
import { requireSupabaseUser, generateApiKey } from '../auth.js'

export function keysRouter({ supabase }) {
  const router = Router()
  const requireUser = requireSupabaseUser(supabase)

  router.post('/keys', requireUser, async (req, res) => {
    try {
      const { data: mind, error: mindErr } = await supabase
        .from('minds')
        .select('handle, published')
        .eq('user_id', req.user.id)
        .maybeSingle()
      if (mindErr) throw new Error(mindErr.message)
      if (!mind || !mind.published) {
        return res.status(400).json({ error: 'Publish your mind before creating an API key for it.' })
      }

      const label = typeof req.body?.label === 'string' ? req.body.label.slice(0, 120) : ''
      const { key, hash, prefix } = generateApiKey()

      const { data: row, error } = await supabase
        .from('api_keys')
        .insert({ user_id: req.user.id, mind_handle: mind.handle, key_hash: hash, key_prefix: prefix, label })
        .select('id, key_prefix, label, created_at')
        .single()
      if (error) throw new Error(error.message)

      // `key` is returned exactly once — the server never has the plaintext again after this response.
      res.status(201).json({ key, id: row.id, prefix: row.key_prefix, label: row.label, createdAt: row.created_at })
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })

  router.delete('/keys/:id', requireUser, async (req, res) => {
    try {
      const { data, error } = await supabase
        .from('api_keys')
        .update({ revoked_at: new Date().toISOString() })
        .eq('id', req.params.id)
        .eq('user_id', req.user.id)
        .select('id')
        .maybeSingle()
      if (error) throw new Error(error.message)
      if (!data) return res.status(404).json({ error: 'No key with that id owned by you.' })
      res.json({ revoked: true, id: data.id })
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })

  return router
}
