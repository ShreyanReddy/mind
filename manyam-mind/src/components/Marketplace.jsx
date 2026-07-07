import { useRef, useState } from 'react'
import { vault } from '../lib/store.js'
import { downloadBundle, importBundleFile, remoteConfigured } from '../lib/marketplace.js'

export default function Marketplace() {
  const fileRef = useRef(null)
  const [msg, setMsg] = useState('')
  const persona = vault.get().persona

  return (
    <div className="market pane-body">
      <div className="market-card">
        <h3>Transfer this mind</h3>
        <p>
          Export <b>{persona.name}</b> — every note, link, and persona setting — as a portable
          <code> .mind.json</code> bundle. Hand it to anyone; they import it below and your mind
          clone wakes up in their vault. This is the working unit of transfer and sale.
        </p>
        <span className="badge live">works today</span>
        <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
          <button className="primary" onClick={downloadBundle}>Export mind bundle</button>
          <button onClick={() => fileRef.current.click()}>Import a mind…</button>
          <input
            ref={fileRef}
            type="file"
            accept=".json"
            hidden
            onChange={async (e) => {
              const f = e.target.files[0]
              if (!f) return
              if (!confirm('Importing replaces your current vault. Export a backup first?\n\nOK = import anyway.')) return
              try {
                await importBundleFile(f)
                setMsg('Mind imported. The network on your Graph tab is now theirs.')
              } catch (err) {
                setMsg('Import failed: ' + err.message)
              }
            }}
          />
        </div>
        {msg && <p style={{ marginTop: 8 }}>{msg}</p>}
      </div>

      <div className="market-card">
        <h3>Sell on the marketplace</h3>
        <p>
          List your mind for sale, browse other minds, and complete escrowed ownership transfers.
          The client logic and database schema ship in this repo (<code>src/lib/marketplace.js</code>,
          <code> supabase/schema.sql</code>); PLAN.md §3 walks Claude Code through auth, Stripe
          Connect payments, and signed transfer with seller-copy revocation.
        </p>
        <span className="badge stub">{remoteConfigured ? 'backend connected' : 'scaffold — configure .env'}</span>
      </div>

      <div className="market-card">
        <h3>Mind API — your mind as its own LLM</h3>
        <p>
          The production headline: every mind gets a hosted endpoint
          (<code>POST /minds/:handle/ask</code>) and a public profile where anyone can chat with
          it or integrate it via API key — free tier, per-query pricing, owner-set rates.
          Per-note privacy scopes control what the public mind can draw on. Fully specced in
          PLAN.md §5 for Claude Code.
        </p>
        <span className="badge stub">production — PLAN.md §5</span>
      </div>

      <div className="market-card">
        <h3>Ownership, consent & privacy</h3>
        <p>
          A mind bundle is deeply personal data. Production requirements (specced in PLAN.md §3.6):
          end-to-end encryption of listed bundles, explicit consent language at listing time,
          GDPR-grade export/erasure, and never including API keys or credentials in a bundle
          (the exporter already strips them).
        </p>
      </div>
    </div>
  )
}
