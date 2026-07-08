// A tiny in-memory fake of the handful of supabase-js query shapes
// routes/ask.js actually issues (select/eq/maybeSingle/single, insert,
// update, upsert, delete). Good enough to exercise the FULL /ask pipeline
// end-to-end through supertest without a real database — the query
// surface here is deliberately narrow (matches only what this service's
// own routes use), not a general Postgres emulator.

const CONFLICT_KEYS = {
  ask_cache: ['mind_handle', 'version', 'question_hash'],
}

export function makeFakeDb(seed = {}) {
  const state = {}
  for (const table of ['minds', 'public_minds', 'mind_chunks', 'ask_cache', 'ask_usage', 'api_keys']) {
    state[table] = (seed[table] || []).map((r) => ({ ...r }))
  }

  function builder(table) {
    const filters = []
    let mode = 'list'
    let op = null

    const b = {
      select: () => b,
      eq: (col, val) => {
        filters.push([col, val])
        return b
      },
      maybeSingle: () => {
        mode = 'maybeSingle'
        return b
      },
      single: () => {
        mode = 'single'
        return b
      },
      insert: (row) => {
        op = { type: 'insert', payload: row }
        return b
      },
      update: (patch) => {
        op = { type: 'update', payload: patch }
        return b
      },
      upsert: (row) => {
        op = { type: 'upsert', payload: row }
        return b
      },
      delete: () => {
        op = { type: 'delete' }
        return b
      },
      then: (resolve, reject) => execute().then(resolve, reject),
    }

    function matched() {
      return state[table].filter((r) => filters.every(([c, v]) => r[c] === v))
    }

    function shapeResult(rows) {
      if (mode === 'single') return { data: rows[0] || null, error: rows[0] ? null : { message: 'not found' } }
      if (mode === 'maybeSingle') return { data: rows[0] || null, error: null }
      return { data: rows, error: null }
    }

    async function execute() {
      if (op?.type === 'insert') {
        const rows = (Array.isArray(op.payload) ? op.payload : [op.payload]).map((r, i) => ({
          id: r.id || `${table}-${state[table].length + i}-${Math.random().toString(36).slice(2, 8)}`,
          ...r,
        }))
        state[table].push(...rows)
        return shapeResult(rows)
      }
      if (op?.type === 'update') {
        const rows = matched()
        rows.forEach((r) => Object.assign(r, op.payload))
        return shapeResult(rows)
      }
      if (op?.type === 'upsert') {
        const keys = CONFLICT_KEYS[table] || Object.keys(op.payload)
        const existing = state[table].find((r) => keys.every((k) => r[k] === op.payload[k]))
        if (existing) Object.assign(existing, op.payload)
        else state[table].push({ ...op.payload })
        return { data: null, error: null }
      }
      if (op?.type === 'delete') {
        state[table] = state[table].filter((r) => !filters.every(([c, v]) => r[c] === v))
        return { data: null, error: null }
      }
      return shapeResult(matched())
    }

    return b
  }

  return {
    from: (table) => builder(table),
    auth: { getUser: async () => ({ data: { user: null }, error: new Error('not used by /ask') }) },
    _state: state,
  }
}
