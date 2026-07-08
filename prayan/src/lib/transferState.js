// Transfer state machine — client mirror of supabase/functions/_shared/stateMachine.ts.
//
// PLAN.md §3.3 (as amended: Stripe on hold, internal escrow provider is the
// active implementation). Every transfer moves through a strict, small
// state graph; both the Edge Functions (server, authoritative) and the
// client (for UI gating — "can I show the dispute button?") must agree on
// what's legal. Keep the two files in lockstep — see the TypeScript
// original for the canonical copy; this is a deliberate, tested duplicate
// because the client bundle can't import Deno-flavored TypeScript.
//
// Note 'pending' never actually appears as a persisted row: create-transfer
// authorizes payment and inserts straight into 'escrowed' (no client-side
// transfer is ever left sitting unpaid), so 'pending' only exists here as
// the theoretical start state / column default.

export const TRANSFER_STATUSES = ['pending', 'escrowed', 'delivered', 'completed', 'refunded', 'disputed']

const TRANSITIONS = {
  pending: ['escrowed'],
  escrowed: ['delivered', 'refunded', 'disputed'],
  delivered: ['completed', 'refunded', 'disputed'],
  completed: [],
  refunded: [],
  disputed: ['refunded'],
}

/** Is `from -> to` a legal transfer-status transition? */
export function canTransition(from, to) {
  return Boolean(TRANSITIONS[from]?.includes(to))
}

/** Terminal states — no further transitions are ever legal from these. */
export function isTerminal(status) {
  return (TRANSITIONS[status] || []).length === 0
}
