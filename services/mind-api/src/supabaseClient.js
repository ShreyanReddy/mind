// Service-role Supabase client — this service's ONLY way to reach the
// database. Unlike the main app's Edge Functions (which mostly run as the
// caller via their JWT, with RLS enforcing per-user access), mind-api is a
// standalone server that must read across every published mind's
// mind_chunks/minds/ask_cache/ask_usage rows regardless of who's asking —
// that's exactly what the service-role key is for, same justification as
// supabase/functions/_shared/db.ts serviceClient() in the main app.
// SUPABASE_SERVICE_ROLE_KEY must never be logged or sent to a client.

import { createClient } from '@supabase/supabase-js'

export function makeSupabaseClient(env = process.env) {
  const url = env.SUPABASE_URL
  const key = env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  return createClient(url, key, { auth: { persistSession: false } })
}
