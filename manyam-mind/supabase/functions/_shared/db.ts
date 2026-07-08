// Service-role Supabase client for Edge Functions. The service role key is
// auto-injected by the Supabase platform as SUPABASE_SERVICE_ROLE_KEY —
// never present in client code, never logged. It bypasses RLS entirely,
// which is exactly why every marketplace state change must go through a
// function that uses this client rather than the user's own session: the
// function is the only thing allowed to write `transfers`/`transfer_events`.

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'

let cached: SupabaseClient | null = null

export function serviceClient(): SupabaseClient {
  if (cached) return cached
  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured for this function')
  cached = createClient(url, key, { auth: { persistSession: false } })
  return cached
}
