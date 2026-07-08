import { useEffect, useRef, useState } from 'react'
import { db } from '../lib/db.js'
import {
  downloadBundle,
  importBundleFile,
  remoteConfigured,
  listMindForSale,
  browseListings,
  getListing,
  getMyListings,
  getMyProfile,
  getMyPurchases,
  getMySales,
  withdrawListing,
  transferMind,
  deliverKey,
  importPurchasedBundle,
  disputeTransfer,
  listTransferEvents,
  exportAccountData,
  deleteAccountData,
} from '../lib/marketplace.js'
import { getSession, onAuthChange, signOut } from '../lib/auth.js'
import { transferAgreement } from '../lib/agreement.js'
import AuthPanel from './AuthPanel.jsx'
import MindApiCard from './MindApiCard.jsx'

const TABS = ['Browse', 'My listings', 'My purchases']
const DISPUTE_WINDOW_MS = 72 * 60 * 60 * 1000

function usdFromCents(cents) {
  return `$${(Number(cents || 0) / 100).toFixed(2)}`
}

// A plain module-scope helper (not a component-body const) so the
// wall-clock read stays out of the render function's own top-level body —
// see src/components/Sidebar.jsx's "hot" recency heuristic for the same
// pattern. Display-only: the 72h window is enforced authoritatively by
// dispute-transfer server-side regardless of what this renders.
function withinDisputeWindow(transfer) {
  return Boolean(
    transfer.status === 'delivered' &&
      transfer.delivered_at &&
      Date.now() - new Date(transfer.delivered_at).getTime() <= DISPUTE_WINDOW_MS
  )
}

/* ---------- always-available local export/import — works fully offline ---------- */

function LocalTransferCard() {
  const fileRef = useRef(null)
  const [msg, setMsg] = useState('')

  return (
    <div className="market-card">
      <h3>Transfer this mind (local)</h3>
      <p>
        Export every note, link, and persona setting as a portable <code>.mind.json</code> bundle. Hand it to
        anyone; they import it below and your mind clone wakes up in their vault. Works fully offline — no
        account needed.
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
  )
}

function LocalDemoMode() {
  return (
    <div className="market pane-body">
      <LocalTransferCard />
      <div className="market-card">
        <h3>Configure the marketplace backend</h3>
        <p>
          Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> (see{' '}
          <code>.env.example</code>) and restart the dev server to unlock accounts, browsing, and escrowed
          sales. Listed bundles are end-to-end encrypted client-side before upload — the server only ever
          stores ciphertext.
        </p>
        <span className="badge stub">local demo mode — no backend configured</span>
      </div>
    </div>
  )
}

/* ---------- agreement + buy modal ---------- */

function BuyModal({ listing, onClose, onBought }) {
  const [agreed, setAgreed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const sellerHandle = listing.profiles?.handle || 'the seller'
  const agreement = transferAgreement({
    sellerHandle,
    title: listing.title,
    mode: listing.mode,
    priceCents: listing.price_cents,
    date: new Date().toISOString(),
  })

  async function confirmBuy() {
    setBusy(true)
    setError('')
    try {
      await transferMind(listing.id)
      onBought()
    } catch (err) {
      setError(err.message || 'Purchase failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="modal">
        <h3>Buy "{listing.title}"</h3>
        <pre className="agreement-text">{agreement}</pre>
        <label className="consent-row">
          <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
          I have read and agree to this transfer agreement.
        </label>
        {error && <p className="empty-hint error-text">{error}</p>}
        <div className="modal-actions">
          <button className="ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="primary" disabled={!agreed || busy} onClick={confirmBuy}>
            {busy ? 'Placing order…' : `Buy for ${usdFromCents(listing.price_cents)}`}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ---------- Browse tab ---------- */

function BrowseTab() {
  const [listings, setListings] = useState(null)
  const [error, setError] = useState('')
  const [buying, setBuying] = useState(null)
  const [msg, setMsg] = useState('')

  function reload() {
    browseListings().then(setListings).catch((err) => setError(err.message))
  }
  useEffect(reload, [])

  return (
    <div className="market-tab">
      {error && <p className="empty-hint error-text">{error}</p>}
      {listings === null && !error && <p className="empty-hint">Loading listings…</p>}
      {listings?.length === 0 && <p className="empty-hint">No active listings yet.</p>}
      {msg && <p className="empty-hint">{msg}</p>}
      <div className="listing-grid">
        {listings?.map((l) => (
          <div key={l.id} className="market-card listing-card">
            <h3>{l.title}</h3>
            <p>{l.description}</p>
            <div className="listing-stats">
              <span>{l.note_count ?? '?'} notes</span>
              <span>{l.link_count ?? '?'} links</span>
              <span className="badge stub">{l.mode}</span>
            </div>
            <div className="listing-footer">
              <b>{usdFromCents(l.price_cents)}</b>
              <button
                className="primary"
                onClick={async () => {
                  try {
                    const full = await getListing(l.id)
                    setBuying(full)
                  } catch (err) {
                    setError(err.message)
                  }
                }}
              >
                Buy
              </button>
            </div>
          </div>
        ))}
      </div>
      {buying && (
        <BuyModal
          listing={buying}
          onClose={() => setBuying(null)}
          onBought={() => {
            setBuying(null)
            setMsg('Purchase created — payment is held in escrow. Find it under "My purchases" once the seller delivers the key.')
            reload()
          }}
        />
      )}
    </div>
  )
}

/* ---------- My listings tab ---------- */

function NewListingForm({ onCreated }) {
  const [form, setForm] = useState({ title: '', description: '', priceUsd: '5.00', mode: 'license' })
  const [noThirdPartyData, setNoThirdPartyData] = useState(false)
  const [ownsContent, setOwnsContent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })
  const priceCents = Math.round(Number(form.priceUsd || 0) * 100)

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setMsg('')
    try {
      await listMindForSale({
        title: form.title,
        description: form.description,
        priceCents,
        mode: form.mode,
        consent: { noThirdPartyData, ownsContent },
      })
      setForm({ title: '', description: '', priceUsd: '5.00', mode: 'license' })
      setNoThirdPartyData(false)
      setOwnsContent(false)
      onCreated()
    } catch (err) {
      setMsg(err.message || 'Could not create listing.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="market-card" onSubmit={submit}>
      <h3>List this mind for sale</h3>
      <p>Your vault is exported, encrypted on this device, and uploaded as ciphertext. Only the title, description, and stats below are ever visible to buyers.</p>
      <label>
        Title
        <input value={form.title} onChange={set('title')} required />
      </label>
      <label>
        Description (preview only — never note content)
        <textarea value={form.description} onChange={set('description')} rows={2} />
      </label>
      <label>
        Price (USD)
        <input type="number" min="0" step="0.01" value={form.priceUsd} onChange={set('priceUsd')} required />
      </label>
      <label>
        Mode
        <select value={form.mode} onChange={set('mode')}>
          <option value="license">License a copy (you keep your copy, can sell to others)</option>
          <option value="exclusive">Exclusive transfer (your synced copy is revoked on sale)</option>
        </select>
      </label>
      <label className="consent-row">
        <input type="checkbox" checked={noThirdPartyData} onChange={(e) => setNoThirdPartyData(e.target.checked)} />
        This mind contains no personal data about third parties without their consent.
      </label>
      <label className="consent-row">
        <input type="checkbox" checked={ownsContent} onChange={(e) => setOwnsContent(e.target.checked)} />
        I own the content I am listing for sale.
      </label>
      {msg && <p className="empty-hint error-text">{msg}</p>}
      <div>
        <button className="primary" type="submit" disabled={busy || !noThirdPartyData || !ownsContent}>
          {busy ? 'Encrypting & uploading…' : 'Create listing'}
        </button>
      </div>
    </form>
  )
}

function revokedBannerKey(transferId) {
  return `revokedSeen:${transferId}`
}

function RevokedBanner({ transfer, onDismiss }) {
  return (
    <div className="market-card banner-warn">
      <p>
        <b>"{transfer.listing_snapshot?.title}"</b> sold exclusively and is now complete — your synced copy has
        been revoked server-side. We cannot technically revoke any copies you already exported to this or other
        devices before the sale; the transfer agreement you accepted governs those. Please honor it.
      </p>
      <button
        className="ghost"
        onClick={async () => {
          await db.meta.put({ key: revokedBannerKey(transfer.id), value: true })
          onDismiss()
        }}
      >
        Got it
      </button>
    </div>
  )
}

function MyListingsTab() {
  const [listings, setListings] = useState(null)
  const [sales, setSales] = useState([])
  const [error, setError] = useState('')
  const [banners, setBanners] = useState([])

  async function reload() {
    try {
      const [myListings, mySales] = await Promise.all([getMyListings(), getMySales()])
      setListings(myListings)
      setSales(mySales)
      const toShow = []
      for (const s of mySales) {
        if (s.status === 'completed' && s.listing_snapshot?.mode === 'exclusive') {
          const seen = await db.meta.get(revokedBannerKey(s.id))
          if (!seen) toShow.push(s)
        }
      }
      setBanners(toShow)
    } catch (err) {
      setError(err.message)
    }
  }
  useEffect(() => {
    // Deferred via .then() (rather than calling the async `reload` directly)
    // so state updates happen inside a promise callback, not synchronously
    // in the effect body — same pattern as Settings.jsx's EncryptionSection.
    Promise.resolve().then(reload)
  }, [])

  const saleForListing = (listingId) => sales.find((s) => s.listing_id === listingId && s.status === 'escrowed')

  return (
    <div className="market-tab">
      {banners.map((b) => (
        <RevokedBanner key={b.id} transfer={b} onDismiss={reload} />
      ))}
      <NewListingForm onCreated={reload} />
      {error && <p className="empty-hint error-text">{error}</p>}
      {listings?.length === 0 && <p className="empty-hint">You have no listings yet.</p>}
      <div className="listing-grid">
        {listings?.map((l) => {
          const pendingSale = saleForListing(l.id)
          return (
            <div key={l.id} className="market-card listing-card">
              <h3>{l.title}</h3>
              <p>{l.description}</p>
              <div className="listing-stats">
                <span>{usdFromCents(l.price_cents)}</span>
                <span className="badge stub">{l.mode}</span>
                <span className="badge live">{l.status}</span>
              </div>
              {pendingSale && (
                <DeliverKeyAction transfer={pendingSale} onDelivered={reload} />
              )}
              {l.status === 'active' && (
                <button
                  className="ghost"
                  onClick={async () => {
                    if (!confirm('Withdraw this listing?')) return
                    await withdrawListing(l.id)
                    reload()
                  }}
                >
                  Withdraw
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function DeliverKeyAction({ transfer, onDelivered }) {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  return (
    <div className="deliver-key-action">
      <p className="empty-hint">Sold — payment is escrowed. Deliver the content key to release it.</p>
      <button
        className="primary"
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          setMsg('')
          try {
            await deliverKey(transfer.id)
            onDelivered()
          } catch (err) {
            setMsg(err.message)
          } finally {
            setBusy(false)
          }
        }}
      >
        {busy ? 'Sealing key…' : 'Deliver key to buyer'}
      </button>
      {msg && <p className="empty-hint error-text">{msg}</p>}
    </div>
  )
}

/* ---------- My purchases tab ---------- */

function Timeline({ transferId }) {
  const [events, setEvents] = useState(null)
  useEffect(() => {
    listTransferEvents(transferId).then(setEvents).catch(() => setEvents([]))
  }, [transferId])
  if (!events) return null
  return (
    <ul className="timeline">
      {events.map((e) => (
        <li key={e.id}>
          <span className="timeline-event">{e.event}</span>
          <span className="timeline-at">{new Date(e.at).toLocaleString()}</span>
        </li>
      ))}
    </ul>
  )
}

function PurchaseCard({ transfer, onChanged }) {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  async function doImport() {
    setBusy(true)
    setMsg('')
    try {
      await importPurchasedBundle(transfer.id)
      setMsg('Imported and confirmed — the mind is now in your vault.')
      onChanged()
    } catch (err) {
      setMsg(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function doDispute(action) {
    const reason = prompt(action === 'refund' ? 'Reason for refund request:' : 'Reason for dispute:') || ''
    setBusy(true)
    setMsg('')
    try {
      await disputeTransfer(transfer.id, action, reason)
      onChanged()
    } catch (err) {
      setMsg(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="market-card purchase-card">
      <h3>{transfer.listing_snapshot?.title || 'Mind'}</h3>
      <div className="listing-stats">
        <span>{usdFromCents(transfer.price_cents)}</span>
        <span className="badge live">{transfer.status}</span>
      </div>
      {transfer.status === 'delivered' && (
        <button className="primary" disabled={busy} onClick={doImport}>
          {busy ? 'Verifying & importing…' : 'Verify, import & confirm'}
        </button>
      )}
      {withinDisputeWindow(transfer) && (
        <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
          <button className="ghost" disabled={busy} onClick={() => doDispute('refund')}>Request refund</button>
          <button className="ghost" disabled={busy} onClick={() => doDispute('dispute')}>Dispute</button>
        </div>
      )}
      {transfer.status === 'completed' && <p className="empty-hint">Completed — enjoy your mind.</p>}
      {msg && <p className="empty-hint error-text">{msg}</p>}
      <Timeline transferId={transfer.id} />
    </div>
  )
}

function MyPurchasesTab() {
  const [purchases, setPurchases] = useState(null)
  const [error, setError] = useState('')

  function reload() {
    getMyPurchases().then(setPurchases).catch((err) => setError(err.message))
  }
  useEffect(reload, [])

  return (
    <div className="market-tab">
      {error && <p className="empty-hint error-text">{error}</p>}
      {purchases?.length === 0 && <p className="empty-hint">You haven't bought anything yet.</p>}
      <div className="listing-grid">
        {purchases?.map((t) => (
          <PurchaseCard key={t.id} transfer={t} onChanged={reload} />
        ))}
      </div>
    </div>
  )
}

/* ---------- account (GDPR) ---------- */

function AccountSection() {
  const [msg, setMsg] = useState('')
  return (
    <div className="market-card">
      <h3>Your account & data</h3>
      <p>Export everything the marketplace holds about you, or permanently erase your account.</p>
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={async () => {
            try {
              const data = await exportAccountData()
              const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
              const a = document.createElement('a')
              a.href = URL.createObjectURL(blob)
              a.download = 'manyam-mind-account-export.json'
              a.click()
              URL.revokeObjectURL(a.href)
            } catch (err) {
              setMsg(err.message)
            }
          }}
        >
          Export my data
        </button>
        <button
          className="ghost"
          onClick={async () => {
            if (!confirm('Permanently delete your account, listings, and synced data? This cannot be undone.')) return
            try {
              await deleteAccountData()
              setMsg('Account deleted.')
            } catch (err) {
              setMsg(err.message)
            }
          }}
        >
          Delete my account
        </button>
      </div>
      {msg && <p className="empty-hint">{msg}</p>}
    </div>
  )
}

/* ---------- root ---------- */

export default function Marketplace() {
  const [session, setSession] = useState(null)
  const [checked, setChecked] = useState(false)
  const [tab, setTab] = useState('Browse')
  const [handle, setHandle] = useState('')

  useEffect(() => {
    if (!remoteConfigured) {
      // Deferred via .then() rather than a direct synchronous setState call.
      Promise.resolve().then(() => setChecked(true))
      return
    }
    getSession().then((s) => {
      setSession(s)
      setChecked(true)
    })
    return onAuthChange((s) => setSession(s))
  }, [])

  useEffect(() => {
    if (session) {
      getMyProfile().then((p) => setHandle(p.handle)).catch(() => {})
    } else {
      Promise.resolve().then(() => setHandle(''))
    }
  }, [session])

  if (!remoteConfigured) return <LocalDemoMode />
  if (!checked) {
    return (
      <div className="market pane-body">
        <p className="empty-hint">Loading…</p>
      </div>
    )
  }

  if (!session) {
    return (
      <div className="market pane-body">
        <AuthPanel />
        <LocalTransferCard />
      </div>
    )
  }

  return (
    <div className="market pane-body">
      <div className="market-header">
        <span>
          Signed in as <b>{handle || session.user.email}</b>
        </span>
        <button className="ghost" onClick={() => signOut()}>Sign out</button>
      </div>
      <div className="tabs">
        {TABS.map((t) => (
          <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </div>
      {tab === 'Browse' && <BrowseTab />}
      {tab === 'My listings' && <MyListingsTab />}
      {tab === 'My purchases' && <MyPurchasesTab />}
      <LocalTransferCard />
      <MindApiCard />
      <AccountSection />
    </div>
  )
}
