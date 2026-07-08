// Append-only transfer_events writer. Every marketplace state change is
// required (CLAUDE.md) to append here — this is the one function all the
// Edge Functions call to do it, so the shape is consistent everywhere.

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'

export async function appendEvent(
  db: SupabaseClient,
  transferId: string,
  event: string,
  meta: Record<string, unknown> = {}
): Promise<void> {
  const { error } = await db.from('transfer_events').insert({ transfer_id: transferId, event, meta })
  if (error) throw new Error(`appendEvent(${event}) failed: ${error.message}`)
}
