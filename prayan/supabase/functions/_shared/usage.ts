// Per-user usage metering + a simple daily token cap — PLAN.md §4.1/§4.3.
// Every `llm-proxy` and `embed` call funnels through here: enforceDailyCap
// throws BEFORE the provider is called (so an over-cap request never spends
// real provider tokens), and recordUsage appends one row to `usage_events`
// (migration 0005_pgvector.sql — service role only, owner-only select RLS)
// after a successful call. The cap is shared across both `kind`s so a user
// can't dodge it by switching call types.

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'

const DEFAULT_DAILY_CAP = 200000

function dailyCap(): number {
  const raw = Deno.env.get('LLM_DAILY_TOKEN_CAP')
  const n = raw ? Number(raw) : NaN
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_DAILY_CAP
}

export class UsageCapExceededError extends Error {}

/** Sum of tokens_in+tokens_out recorded for this user since UTC midnight today. */
export async function tokensUsedToday(db: SupabaseClient, userId: string): Promise<number> {
  const since = new Date()
  since.setUTCHours(0, 0, 0, 0)
  const { data, error } = await db
    .from('usage_events')
    .select('tokens_in, tokens_out')
    .eq('user_id', userId)
    .gte('at', since.toISOString())
  if (error) throw new Error(`tokensUsedToday failed: ${error.message}`)
  return (data || []).reduce(
    (sum: number, r: { tokens_in: number | null; tokens_out: number | null }) =>
      sum + (r.tokens_in || 0) + (r.tokens_out || 0),
    0
  )
}

/** Throws UsageCapExceededError (callers map this to HTTP 429) if the user is already at/over today's cap. Does not record anything. */
export async function enforceDailyCap(db: SupabaseClient, userId: string): Promise<void> {
  const used = await tokensUsedToday(db, userId)
  const cap = dailyCap()
  if (used >= cap) throw new UsageCapExceededError(`Daily token cap (${cap}) exceeded for this account.`)
}

/** Append one usage_events row. Call after a successful provider call, with the real token counts when the provider reports them. */
export async function recordUsage(
  db: SupabaseClient,
  params: { userId: string; kind: 'llm' | 'embed'; provider: string; model: string; tokensIn: number; tokensOut?: number }
): Promise<void> {
  const { error } = await db.from('usage_events').insert({
    user_id: params.userId,
    kind: params.kind,
    provider: params.provider,
    model: params.model,
    tokens_in: params.tokensIn,
    tokens_out: params.tokensOut || 0,
  })
  if (error) throw new Error(`recordUsage failed: ${error.message}`)
}
