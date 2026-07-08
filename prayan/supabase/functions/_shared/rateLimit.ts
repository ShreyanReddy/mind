// Per-user fixed-window rate limiting for Edge Functions — PLAN.md §6.4.
//
// In-memory per isolate: Supabase Edge Functions keep an isolate warm across
// invocations, so this throttles sustained bursts from one caller without
// any storage round-trip. It is deliberately NOT a hard global guarantee —
// a cold start or a second isolate resets the window. That's acceptable
// here because every rate-limited function is also (a) authenticated and
// (b) guarded by real resource checks (token caps in usage.ts, state-machine
// validation, RLS); this layer only blunts abuse and runaway clients. If a
// hard guarantee is ever needed, move the counter into Postgres or Redis.

type Window = { start: number; count: number }

const windows = new Map<string, Window>()
const MAX_KEYS = 10_000 // memory backstop; oldest-window keys evicted first

/**
 * Returns true if this call is allowed, false if `key` exceeded `limit`
 * calls within the current `windowMs` window. Callers map false to HTTP 429.
 */
export function allowRate(key: string, limit: number, windowMs = 60_000): boolean {
  const now = Date.now()
  const w = windows.get(key)
  if (!w || now - w.start >= windowMs) {
    if (windows.size >= MAX_KEYS) evictOldest()
    windows.set(key, { start: now, count: 1 })
    return true
  }
  w.count++
  return w.count <= limit
}

function evictOldest() {
  let oldestKey: string | null = null
  let oldestStart = Infinity
  for (const [k, w] of windows) {
    if (w.start < oldestStart) {
      oldestStart = w.start
      oldestKey = k
    }
  }
  if (oldestKey) windows.delete(oldestKey)
}

/** Test hook. */
export function resetRateLimits() {
  windows.clear()
}
