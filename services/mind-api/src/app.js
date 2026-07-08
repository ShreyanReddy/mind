// Express app factory — kept separate from index.js so tests can build an
// app with mocked supabase/fetch/limiters and drive it with supertest
// without ever binding a real port or touching the network.

import express from 'express'
import { healthzRouter } from './routes/healthz.js'
import { mindsRouter } from './routes/minds.js'
import { askRouter } from './routes/ask.js'
import { keysRouter } from './routes/keys.js'
import { makeSupabaseClient } from './supabaseClient.js'
import { makeLimiter } from './rateLimit.js'
import { getBillingProvider } from './billing.js'

export function createApp({
  env = process.env,
  supabase = makeSupabaseClient(env),
  fetchImpl = fetch,
  apiBaseUrl = env.MIND_API_PUBLIC_URL || '',
  ipLimiter = makeLimiter({ capacity: 30, refillPerSec: 0.5 }),
  keyLimiter = makeLimiter({ capacity: 120, refillPerSec: 2 }),
  billing = getBillingProvider(env),
} = {}) {
  const app = express()
  app.disable('x-powered-by')
  app.use(express.json({ limit: '100kb' }))

  // Permissive CORS: /ask and /minds/:handle(/page) are meant to be called
  // from any origin (that's the "your mind becomes an API others integrate"
  // pitch, PLAN.md §5.4) — there's no cookie-based session to protect here,
  // only bearer tokens the caller chooses to send.
  app.use((req, res, next) => {
    res.set('Access-Control-Allow-Origin', '*')
    res.set('Access-Control-Allow-Headers', 'authorization, content-type')
    res.set('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
    if (req.method === 'OPTIONS') return res.status(204).end()
    next()
  })

  if (!supabase) {
    app.use((req, res, next) => {
      if (req.path === '/healthz') return next()
      res.status(503).json({ error: 'This deployment is missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.' })
    })
  }

  app.use(healthzRouter())

  if (supabase) {
    app.use(mindsRouter({ supabase, apiBaseUrl }))
    app.use(askRouter({ supabase, env, fetchImpl, ipLimiter, keyLimiter, billing }))
    app.use(keysRouter({ supabase }))
  }

  app.use((req, res) => {
    res.status(404).json({ error: 'Not found.' })
  })

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error('[mind-api] unhandled error', err)
    res.status(500).json({ error: 'Internal error.' })
  })

  return app
}
