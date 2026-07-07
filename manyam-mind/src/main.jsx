import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import { vault } from './lib/store.js'
import * as fsvault from './lib/fsvault.js'
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
  vault.subscribe(() => {
    if (fsvault.isConnected()) fsvault.scheduleExport(vault.get().notes)
  })

  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  )
})
