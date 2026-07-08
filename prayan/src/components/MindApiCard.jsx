// Marketplace's "Mind API" card — PLAN.md §5. Publish/unpublish a hosted
// mind (services/mind-api/), with an explicit "what will be shared"
// consent step before anything leaves the device, price/free-tier/digest
// controls, API key issuance, and voice-match rating of sample answers.
// Demo mode (no backend / no mind-api URL configured) degrades to an
// explanatory note rather than broken controls.

import { useEffect, useState } from 'react'
import { vault } from '../lib/store.js'
import { getSupabase, backendConfigured } from '../lib/supabase.js'
import { publishPreview, publishMind, unpublishMind, getMyMind, rateSampleAnswer } from '../lib/mindPublish.js'

const MIND_API_URL = (import.meta.env?.VITE_MIND_API_URL || '').replace(/\/+$/, '')

function usdToCents(usd) {
  return Math.max(0, Math.round(Number(usd || 0) * 100))
}

function sampleQuestionsFromText(text) {
  return text
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 10)
}

async function createApiKey(label) {
  const supabase = getSupabase()
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session) throw new Error('Sign in to create an API key.')
  const res = await fetch(`${MIND_API_URL}/keys`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ label }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `Mind API returned ${res.status}.`)
  return data
}

function formFromMind(m) {
  return {
    bio: m?.bio || '',
    sampleQuestionsText: (m?.sample_questions || []).join('\n'),
    pricePerQueryUsd: ((m?.price_per_query_cents || 0) / 100).toFixed(2),
    freeQueriesPerDay: String(m?.free_queries_per_day ?? 25),
    digestOptIn: Boolean(m?.digest_opt_in),
  }
}

export default function MindApiCard() {
  const [mind, setMind] = useState(null)
  const [loaded, setLoaded] = useState(false)
  const [form, setForm] = useState(formFromMind(null))
  const [preview, setPreview] = useState(null)
  const [agreed, setAgreed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [keyResult, setKeyResult] = useState(null)

  async function reload() {
    try {
      const m = await getMyMind()
      setMind(m)
      setForm(formFromMind(m))
    } catch (err) {
      setMsg(err.message)
    } finally {
      setLoaded(true)
    }
  }

  useEffect(() => {
    // Deferred via .then() rather than calling the async reload directly in
    // the effect body — same pattern as Marketplace.jsx's other tabs.
    Promise.resolve().then(reload)
  }, [])

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })

  function openPreview() {
    setPreview(publishPreview(vault.get()))
    setAgreed(false)
    setKeyResult(null)
  }

  async function confirmPublish() {
    setBusy(true)
    setMsg('')
    try {
      const result = await publishMind({
        bio: form.bio,
        sampleQuestions: sampleQuestionsFromText(form.sampleQuestionsText),
        pricePerQueryCents: usdToCents(form.pricePerQueryUsd),
        freeQueriesPerDay: Math.max(0, Math.round(Number(form.freeQueriesPerDay || 0))),
        digestOptIn: form.digestOptIn,
      })
      setMind(result)
      setPreview(null)
      setMsg(`Published — v${result.current_version} is live.`)
    } catch (err) {
      setMsg(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function doUnpublish() {
    if (!confirm('Take this mind offline? The hosted endpoint stops answering immediately — your local vault is untouched.')) return
    setBusy(true)
    setMsg('')
    try {
      await unpublishMind()
      await reload()
      setMsg('Unpublished.')
    } catch (err) {
      setMsg(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function doCreateKey() {
    setBusy(true)
    setMsg('')
    setKeyResult(null)
    try {
      setKeyResult(await createApiKey('Created from the app'))
    } catch (err) {
      setMsg(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function rate(question, stars) {
    try {
      const voiceRating = await rateSampleAnswer(question, stars)
      setMind((m) => (m ? { ...m, voice_rating: voiceRating } : m))
    } catch (err) {
      setMsg(err.message)
    }
  }

  if (!backendConfigured) {
    return (
      <div className="market-card">
        <h3>Mind API — your mind as an endpoint</h3>
        <p>
          Publish your "Mind"- and "Published"-scoped notes as a hosted, queryable model other people can
          talk to and integrate with (PLAN.md §5). Configure the marketplace backend above to unlock this.
        </p>
        <span className="badge stub">requires backend</span>
      </div>
    )
  }

  if (!loaded) {
    return (
      <div className="market-card">
        <h3>Mind API — your mind as an endpoint</h3>
        <p className="empty-hint">Loading…</p>
      </div>
    )
  }

  const sampleQuestions = sampleQuestionsFromText(form.sampleQuestionsText)

  return (
    <div className="market-card">
      <h3>Mind API — your mind as an endpoint</h3>
      <p>
        Only notes scoped <b>Mind</b> or <b>Published</b> in the Editor are ever sent here — set a note's
        access level next to its title. "Private" notes (the default) never leave this device.
      </p>
      {!MIND_API_URL && (
        <p className="empty-hint error-text">
          <code>VITE_MIND_API_URL</code> is not configured for this deployment — publishing is disabled until
          it is.
        </p>
      )}

      {mind?.published && (
        <p className="empty-hint">
          <span className="badge live">published · v{mind.current_version}</span>{' '}
          Endpoint: <code>{MIND_API_URL}/minds/{mind.handle}/ask</code>{' '}
          {MIND_API_URL && (
            <a href={`${MIND_API_URL}/minds/${mind.handle}/page`} target="_blank" rel="noreferrer">
              public page ↗
            </a>
          )}
        </p>
      )}

      <label>
        Bio
        <textarea rows={2} value={form.bio} onChange={set('bio')} placeholder="A short public bio for your mind's page" />
      </label>
      <label>
        Sample questions (one per line — shown as clickable prompts on your public page)
        <textarea rows={3} value={form.sampleQuestionsText} onChange={set('sampleQuestionsText')} />
      </label>
      <label>
        Price per query (USD, charged after the free tier — billing is on hold; this is stored & displayed only for now)
        <input type="number" min="0" step="0.01" value={form.pricePerQueryUsd} onChange={set('pricePerQueryUsd')} />
      </label>
      <label>
        Free queries per day
        <input type="number" min="0" step="1" value={form.freeQueriesPerDay} onChange={set('freeQueriesPerDay')} />
      </label>
      <label className="consent-row">
        <input type="checkbox" checked={form.digestOptIn} onChange={set('digestOptIn')} />
        Email me a weekly digest of 3 questions my mind wants answered
      </label>

      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <button className="primary" disabled={!MIND_API_URL || busy} onClick={openPreview}>
          {mind?.published ? 'Republish' : 'Publish my mind'}
        </button>
        {mind?.published && (
          <button className="ghost" disabled={busy} onClick={doUnpublish}>
            Unpublish
          </button>
        )}
      </div>

      {preview && (
        <div className="market-card">
          <h4>What will be shared</h4>
          <ul>
            <li>{preview.privateNotes} private note(s) — never shared</li>
            <li>{preview.mindChunks} chunk(s) from "Mind"-scoped notes — inform answers, never quoted verbatim</li>
            <li>{preview.publishedChunks} chunk(s) from "Published"-scoped notes — directly quotable</li>
          </ul>
          <label className="consent-row">
            <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
            I understand exactly this content will be sent to and hosted by the Mind API.
          </label>
          {msg && <p className="empty-hint error-text">{msg}</p>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="ghost" onClick={() => setPreview(null)} disabled={busy}>
              Cancel
            </button>
            <button className="primary" disabled={!agreed || busy} onClick={confirmPublish}>
              {busy ? 'Publishing…' : 'Confirm & publish'}
            </button>
          </div>
        </div>
      )}

      {mind?.published && (
        <div className="settings-section">
          <h4>API keys</h4>
          <p className="empty-hint">
            Callers send <code>Authorization: Bearer &lt;key&gt;</code> on <code>/ask</code> to bypass the
            free-tier limit — still metered per key.
          </p>
          <button disabled={!MIND_API_URL || busy} onClick={doCreateKey}>
            {busy ? 'Creating…' : 'Create API key'}
          </button>
          {keyResult && (
            <p className="empty-hint">
              Your key (shown once — copy it now): <code>{keyResult.key}</code>
            </p>
          )}
        </div>
      )}

      {mind?.published && sampleQuestions.length > 0 && (
        <div className="settings-section">
          <h4>Voice-match rating</h4>
          <p className="empty-hint">Try a sample question on your public page, then rate how much it sounds like you.</p>
          {sampleQuestions.map((q) => (
            <div key={q} style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
              <span style={{ flex: 1 }}>{q}</span>
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  className="ghost"
                  aria-label={`Rate "${q}" ${n} star${n > 1 ? 's' : ''}`}
                  onClick={() => rate(q, n)}
                >
                  {(mind.voice_rating || {})[q] >= n ? '★' : '☆'}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}

      {msg && !preview && <p className="empty-hint">{msg}</p>}
    </div>
  )
}
