import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import { vault } from './lib/store.js'
import * as fsvault from './lib/fsvault.js'
import { onAuthChange, getSession } from './lib/auth.js'
import { chunkVault } from './lib/retrieval.js'
import { scheduleEmbeddingRefresh } from './lib/embeddings.js'
import { track, startTelemetry } from './lib/telemetry.js'
import './styles/theme.css'

// Error reporting (PLAN.md §6.3) — Sentry, but only when a DSN is configured,
// and dynamically imported so unconfigured deployments never even download
// the SDK. No PII: we attach nothing, and note content never appears in
// errors (the vault never throws its own data).
if (import.meta.env.VITE_SENTRY_DSN) {
  import('@sentry/react')
    .then((Sentry) =>
      Sentry.init({
        dsn: import.meta.env.VITE_SENTRY_DSN,
        sendDefaultPii: false,
        tracesSampleRate: 0,
      })
    )
    .catch(() => {})
}

const root = createRoot(document.getElementById('root'))

// Show nothing (a minimal splash) while the vault hydrates from Dexie —
// components rely on vault.get() being safe & fully populated synchronously
// once mounted. See PLAN.md §1.1.
root.render(<div className="boot-splash" aria-hidden="true" />)

vault.ready().then(async () => {
  // Best-effort: re-acquire a previously connected folder-vault handle and
  // start exporting on every change. Never blocks first render.
  await fsvault.reconnect().catch(() => {})

  // Track sign-in state (auth is async; this keeps the vault.subscribe
  // callback below synchronous) so the embedding refresh — PLAN.md §4.1 —
  // only ever runs signed in, backend-configured, and opted into in
  // Settings ("Semantic retrieval"); scheduleEmbeddingRefresh itself is a
  // safe no-op without a configured backend.
  let signedIn = false
  getSession()
    .then((s) => { signedIn = Boolean(s) })
    .catch(() => {})
  onAuthChange((session) => { signedIn = Boolean(session) })

  // Privacy-safe usage counts (PLAN.md §6.3): the activity log's `kind`
  // (create/edit/link/delete/absorb) is the only thing counted — never
  // titles, bodies, or ids. startTelemetry() is a no-op unless
  // VITE_TELEMETRY_URL is set and the browser doesn't send DNT.
  startTelemetry()

  vault.subscribe(() => {
    if (fsvault.isConnected()) fsvault.scheduleExport(vault.get().notes)
    const state = vault.get()
    const last = state.activity[state.activity.length - 1]
    if (last?.kind) track(`note.${last.kind}`)
    if (signedIn && state.persona.semanticRetrieval) {
      scheduleEmbeddingRefresh(chunkVault(state.notes))
    }
  })

  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  )
})
