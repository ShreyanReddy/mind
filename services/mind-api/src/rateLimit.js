// Abuse limits — PLAN.md §5.5. A simple in-memory token bucket per key
// (caller IP, or API key id when one is presented). Deliberately minimal:
// this is a SINGLE-INSTANCE limiter — state lives in this process's
// memory, so it resets on deploy/restart and does not coordinate across
// horizontally-scaled instances. That's an accepted tradeoff for a v1
// deploy; the documented upgrade path when this service runs more than
// one instance on Railway is to swap `Map` here for a Redis-backed bucket
// (e.g. `ioredis` + a Lua INCR/EXPIRE script) keyed the same way.

/**
 * makeLimiter({ capacity, refillPerSec }) -> allow(key) => boolean
 * `capacity` tokens available immediately; refills at `refillPerSec` tokens/sec.
 * Each call to makeLimiter gets its OWN bucket map (a fresh Map in the
 * closure, not shared module state) — ipLimiter and keyLimiter (routes/
 * ask.js) key on different kinds of string (IP vs. api_keys.id), and
 * per-instance state is also what keeps this trivially testable: a fresh
 * limiter per test never leaks bucket state from another test.
 */
export function makeLimiter({ capacity = 20, refillPerSec = 0.5 } = {}) {
  const buckets = new Map()
  return function allow(key) {
    const now = Date.now() / 1000
    let bucket = buckets.get(key)
    if (!bucket) {
      bucket = { tokens: capacity, last: now }
      buckets.set(key, bucket)
    }
    bucket.tokens = Math.min(capacity, bucket.tokens + (now - bucket.last) * refillPerSec)
    bucket.last = now
    if (bucket.tokens < 1) return false
    bucket.tokens -= 1
    return true
  }
}
