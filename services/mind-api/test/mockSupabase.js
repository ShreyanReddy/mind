// A minimal chainable Supabase query-builder stand-in, shared across this
// package's tests — same pattern as prayan's src/lib/__tests__/
// marketplace.test.js, adapted for mind-api's own table shapes.
import { vi } from 'vitest'

export function chain(result) {
  const calls = []
  const b = {
    select: (...a) => (calls.push(['select', a]), b),
    eq: (...a) => (calls.push(['eq', a]), b),
    order: (...a) => (calls.push(['order', a]), b),
    maybeSingle: (...a) => (calls.push(['maybeSingle', a]), b),
    single: (...a) => (calls.push(['single', a]), b),
    insert: (...a) => (calls.push(['insert', a]), b),
    update: (...a) => (calls.push(['update', a]), b),
    upsert: (...a) => (calls.push(['upsert', a]), b),
    delete: (...a) => (calls.push(['delete', a]), b),
    then: (resolve, reject) => Promise.resolve(typeof result === 'function' ? result() : result).then(resolve, reject),
    calls,
  }
  return b
}

/**
 * makeMockSupabase({ tables, getUserResult }) -> a fake supabase-js client.
 * `tables` maps table name -> either a fixed { data, error } response, or a
 * function(callArgsSoFar) -> response for tests that need per-call logic.
 * Override `.from` directly on the returned object for anything fancier
 * (see ask.test.js, which needs different responses per call to the same
 * table within one request).
 */
export function makeMockSupabase({ tables = {}, getUserResult } = {}) {
  const fromCalls = []
  return {
    auth: {
      getUser: vi.fn(async () => getUserResult ?? { data: { user: null }, error: new Error('no user configured') }),
    },
    from: (table) => {
      fromCalls.push(table)
      const spec = tables[table]
      return chain(typeof spec === 'function' ? spec : (spec ?? { data: null, error: null }))
    },
    _fromCalls: fromCalls,
  }
}
