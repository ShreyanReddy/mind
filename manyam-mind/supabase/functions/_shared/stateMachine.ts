// Transfer state machine — canonical copy. src/lib/transferState.js is a
// deliberate, tested duplicate for the client bundle (which can't import
// Deno-flavored TypeScript with URL imports). Keep the two in lockstep.
//
// 'pending' never actually appears as a persisted row: create-transfer
// authorizes payment and inserts straight into 'escrowed' in one step, so
// 'pending' only exists here as the theoretical start state / column
// default (see migration 0001's `status text not null default 'pending'`).

export type TransferStatus = 'pending' | 'escrowed' | 'delivered' | 'completed' | 'refunded' | 'disputed'

const TRANSITIONS: Record<TransferStatus, TransferStatus[]> = {
  pending: ['escrowed'],
  escrowed: ['delivered', 'refunded', 'disputed'],
  delivered: ['completed', 'refunded', 'disputed'],
  completed: [],
  refunded: [],
  disputed: ['refunded'],
}

export function canTransition(from: TransferStatus, to: TransferStatus): boolean {
  return (TRANSITIONS[from] || []).includes(to)
}

export function isTerminal(status: TransferStatus): boolean {
  return (TRANSITIONS[status] || []).length === 0
}
