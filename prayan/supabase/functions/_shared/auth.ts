// Extract the authenticated caller from a request's JWT. Supabase's
// platform gateway already verified the JWT's signature before invoking
// this function (all marketplace functions deploy with verify_jwt = true —
// see each function's header comment); this just resolves *which* user it
// belongs to, using the anon client with the caller's own Authorization
// header so `auth.getUser()` validates against the same token.

import { createClient, type User } from 'https://esm.sh/@supabase/supabase-js@2.45.4'

export async function getCallerUser(req: Request): Promise<User | null> {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return null

  const url = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  if (!url || !anonKey) return null

  const client = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  })
  const { data, error } = await client.auth.getUser()
  if (error || !data.user) return null
  return data.user
}
