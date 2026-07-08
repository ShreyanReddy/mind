// Supabase client singleton — PLAN.md §3.1.
//
// One client for the whole app (auth.js, marketplace.js). Created lazily and
// only when env config is present, so importing this module is always safe
// (local-only / offline demo mode never touches the network). `sync.js` has
// its own client today for historical reasons (Phase 1); both read the same
// two env vars and would happily share an instance, but keeping them
// separate avoids reordering Phase 1/2 code we're not touching in Phase 3.

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = import.meta.env?.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = import.meta.env?.VITE_SUPABASE_ANON_KEY

/** True only when both env vars are present. Everything below no-ops without it. */
export const backendConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY)

let client = null

/** The shared supabase-js client, or null when the backend isn't configured. */
export function getSupabase() {
  if (!backendConfigured) return null
  if (!client) client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  return client
}

// Convenience export for call sites that already guard on backendConfigured.
export const supabase = backendConfigured ? getSupabase() : null
