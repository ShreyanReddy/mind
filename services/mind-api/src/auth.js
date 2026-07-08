// Two distinct credential types this service accepts on `Authorization:
// Bearer <token>`, distinguished by shape — PLAN.md §5.4:
//
//   - a Supabase user JWT (POST/DELETE /keys — "manage my mind's API
//     keys"), verified via the service-role client's auth.getUser(token)
//     (GoTrue accepts the service-role key as the apikey header, so no
//     separate anon key is needed just to validate a caller's JWT — see
//     services/mind-api/README.md's env var list).
//   - a mind-api API key (POST /minds/:handle/ask — "answer as this mind,
//     metered to my key"), our own format (`mk_<hex>`), verified by
//     sha-256 hash lookup against `api_keys.key_hash`.

import { createHash, randomBytes } from 'node:crypto'

export const API_KEY_PREFIX = 'mk_'

export function hashApiKey(key) {
  return createHash('sha256').update(key).digest('hex')
}

/** Generate a brand-new API key: { key (shown once), hash, prefix (for display, e.g. "mk_a1b2c3d4") }. */
export function generateApiKey() {
  const raw = randomBytes(24).toString('hex')
  const key = `${API_KEY_PREFIX}${raw}`
  return { key, hash: hashApiKey(key), prefix: key.slice(0, 12) }
}

function bearerToken(req) {
  const header = req.headers.authorization || ''
  return header.startsWith('Bearer ') ? header.slice(7).trim() : null
}

/** Express middleware: requires a valid Supabase user JWT, sets req.user. */
export function requireSupabaseUser(supabase) {
  return async function (req, res, next) {
    const token = bearerToken(req)
    if (!token) return res.status(401).json({ error: 'Sign in required.' })
    try {
      const { data, error } = await supabase.auth.getUser(token)
      if (error || !data?.user) return res.status(401).json({ error: 'Invalid or expired session.' })
      req.user = data.user
      next()
    } catch (err) {
      res.status(401).json({ error: `Could not verify session: ${err.message}` })
    }
  }
}

/**
 * Resolve an API key from the Authorization header, if present and valid
 * for this specific mind handle. Returns null (never throws) when there's
 * no bearer token, it isn't shaped like one of ours, it doesn't match any
 * row, it's revoked, or it belongs to a different mind — every one of
 * those cases degrades to "anonymous caller, apply free-tier limits"
 * rather than a hard error, since a malformed/missing key is not
 * abnormal on a public endpoint.
 */
export async function resolveApiKey(supabase, req, mindHandle) {
  const token = bearerToken(req)
  if (!token || !token.startsWith(API_KEY_PREFIX)) return null
  const hash = hashApiKey(token)
  const { data, error } = await supabase.from('api_keys').select('*').eq('key_hash', hash).maybeSingle()
  if (error || !data) return null
  if (data.revoked_at) return null
  if (data.mind_handle !== mindHandle) return null
  return data
}
