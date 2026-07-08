import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import { vault } from './lib/store.js'
import * as fsvault from './lib/fsvault.js'
import { onAuthChange, getSession } from './lib/auth.js'
import { chunkVault } from './lib/retrieval.js'
import { scheduleEmbeddingRefresh } from './lib/embeddings.js'
import './styles/theme.css'

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

  vault.subscribe(() => {
    if (fsvault.isConnected()) fsvault.scheduleExport(vault.get().notes)
    const state = vault.get()
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
