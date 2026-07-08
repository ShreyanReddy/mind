import { useEffect, useState } from 'react'
import { vault } from '../lib/store.js'
import { PROVIDERS } from '../lib/llm.js'
import { db } from '../lib/db.js'
import * as fsvault from '../lib/fsvault.js'
import { sodiumReady, deriveVaultKey, getSessionKey, setSessionKey, clearSessionKey } from '../lib/crypto.js'
import { parseRefusalTopics } from '../lib/personaSafety.js'
import { backendConfigured } from '../lib/supabase.js'

function FolderVaultSection() {
  const [connected, setConnected] = useState(fsvault.isConnected())
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  if (!fsvault.isSupported()) {
    return (
      <div className="settings-section">
        <h4>Local folder vault</h4>
        <p className="empty-hint">
          Not supported in this browser — the File System Access API is available in
          Chromium-based browsers (Chrome, Edge).
        </p>
      </div>
    )
  }

  return (
    <div className="settings-section">
      <h4>Local folder vault</h4>
      <p className="empty-hint">
        Connect a folder on disk and every note round-trips as a real Markdown file with
        frontmatter — your files, always yours, readable in any editor.
      </p>
      <div style={{ display: 'flex', gap: 8 }}>
        {!connected ? (
          <button
            className="primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              try {
                await fsvault.connect()
                await fsvault.exportAll(vault.get().notes)
                setConnected(true)
                setMsg('Connected. Notes now export to the folder as you edit.')
              } catch (err) {
                setMsg('Could not connect: ' + err.message)
              } finally {
                setBusy(false)
              }
            }}
          >
            Connect a local folder
          </button>
        ) : (
          <>
            <button
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                try {
                  const notes = await fsvault.loadFromFolder()
                  if (confirm(`Import ${notes.length} note(s) found in the folder into this vault?`)) {
                    vault.importNotes(notes)
                    setMsg(`Loaded ${notes.length} note(s) from the folder.`)
                  }
                } catch (err) {
                  setMsg('Load failed: ' + err.message)
                } finally {
                  setBusy(false)
                }
              }}
            >
              Load from folder
            </button>
            <button
              className="ghost"
              disabled={busy}
              onClick={async () => {
                await fsvault.disconnect()
                setConnected(false)
                setMsg('Disconnected.')
              }}
            >
              Disconnect
            </button>
          </>
        )}
      </div>
      {msg && <p className="empty-hint">{msg}</p>}
    </div>
  )
}

function EncryptionSection() {
  const [passphrase, setPassphrase] = useState('')
  const [status, setStatus] = useState('checking') // checking | none | locked | unlocked
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    db.meta.get('vaultSalt').then((row) => {
      setStatus(row ? (getSessionKey() ? 'unlocked' : 'locked') : 'none')
    })
  }, [])

  async function setOrChangePassphrase() {
    if (!passphrase) return
    setBusy(true)
    try {
      await sodiumReady()
      const existing = await db.meta.get('vaultSalt')
      const { key, salt } = await deriveVaultKey(passphrase, existing?.value)
      await db.meta.put({ key: 'vaultSalt', value: salt })
      setSessionKey(key)
      setStatus('unlocked')
      setMsg('Vault key derived and unlocked for this session.')
      setPassphrase('')
    } catch (err) {
      setMsg('Could not derive key: ' + err.message)
    } finally {
      setBusy(false)
    }
  }

  function lock() {
    clearSessionKey()
    setStatus('locked')
    setMsg('Locked. Sync is paused until you unlock again.')
  }

  return (
    <div className="settings-section">
      <h4>Vault encryption passphrase</h4>
      <p className="empty-hint">
        Derives a per-vault key (Argon2id) used to encrypt anything before it leaves this device
        for sync. Only the salt is ever stored — never the passphrase or the key; the key lives in
        memory for this session only.{' '}
        {status === 'unlocked' && 'Unlocked for this session.'}
        {status === 'locked' && 'A passphrase is set but locked — enter it to unlock sync.'}
        {status === 'none' && 'No passphrase set yet — sync stays disabled until you set one.'}
      </p>
      <label>
        Passphrase
        <input
          type="password"
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          placeholder="never stored, never exported"
        />
      </label>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="primary" disabled={busy || !passphrase} onClick={setOrChangePassphrase}>
          {status === 'none' ? 'Set passphrase' : 'Unlock / change'}
        </button>
        {status === 'unlocked' && (
          <button className="ghost" onClick={lock}>
            Lock
          </button>
        )}
      </div>
      {msg && <p className="empty-hint">{msg}</p>}
    </div>
  )
}

export default function Settings() {
  const p = vault.get().persona
  const [form, setForm] = useState({
    provider: p.provider || 'anthropic',
    model: p.model || 'claude-sonnet-4-6',
    name: p.name,
    voice: p.voice,
    // legacy bundles stored a single top-level apiKey for the anthropic
    // provider; fold it in as the anthropic key's default, then let the
    // real per-provider keys object win.
    keys: {
      anthropic: p.apiKey || '',
      openai: '',
      gemini: '',
      ...(p.keys || {}),
    },
    developerMode: Boolean(p.developerMode),
    semanticRetrieval: Boolean(p.semanticRetrieval),
    refusalTopicsText: (p.refusalTopics || []).join(', '),
    defaultNoteScope: p.defaultNoteScope || 'private',
  })
  const [saved, setSaved] = useState(false)

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })
  const setKey = (prov) => (e) => setForm({ ...form, keys: { ...form.keys, [prov]: e.target.value } })
  const setFlag = (k) => (e) => setForm({ ...form, [k]: e.target.checked })
  const models = PROVIDERS[form.provider].models

  return (
    <div className="settings pane-body">
      <label>
        Mind clone name
        <input value={form.name} onChange={set('name')} />
      </label>
      <label>
        Voice & style (how the clone should sound)
        <input value={form.voice} onChange={set('voice')} />
      </label>
      <label>
        Reasoning engine (the generic LLM your mind runs on)
        <select
          value={form.provider}
          onChange={(e) => {
            const provider = e.target.value
            setForm({ ...form, provider, model: PROVIDERS[provider].models[0] })
          }}
        >
          {Object.entries(PROVIDERS).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>
      </label>
      <label>
        Model
        <select value={form.model} onChange={set('model')}>
          {models.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      </label>
      <label className="consent-row">
        <input type="checkbox" checked={form.developerMode} onChange={setFlag('developerMode')} />
        Developer mode — chat directly from this browser using your own API key
      </label>
      <p className="empty-hint">
        Off by default (PLAN.md §4.3): normally chat routes through this mind's server proxy, which
        uses platform-held keys and meters usage per account — your own key never leaves this
        device. Turning developer mode on switches to calling the provider directly from your
        browser with the key(s) you paste below instead; this is the ONLY way that path runs.
        {!backendConfigured && ' No backend is configured for this deployment, so developer mode is currently the only way to chat.'}
      </p>
      {form.developerMode &&
        Object.keys(PROVIDERS).map((prov) => (
          <label key={prov}>
            {PROVIDERS[prov].label} API key {form.provider === prov ? '(active)' : '(optional)'}
            <input
              type="password"
              value={form.keys[prov]}
              onChange={setKey(prov)}
              placeholder="stored only in this browser; never exported"
            />
          </label>
        ))}

      <label className="consent-row">
        <input type="checkbox" checked={form.semanticRetrieval} onChange={setFlag('semanticRetrieval')} />
        Semantic retrieval (sends note text to the embedding provider transiently)
      </label>
      <p className="empty-hint">
        Off by default (PLAN.md §4.1). When on, your notes are split into chunks and embedded via
        this mind's backend (Voyage or OpenAI, whichever is configured) so the persona can retrieve
        by meaning, not just keyword — each chunk's text is sent to that provider transiently to
        compute a vector, which is then cached on this device; the provider does not retain it and
        this app never uploads your note content anywhere else. Falls back to fully offline
        keyword+strength retrieval whenever this is off, unconfigured, or unavailable.
      </p>

      <label>
        Default persona access for new notes
        <select value={form.defaultNoteScope} onChange={set('defaultNoteScope')}>
          <option value="private">Private — never shared</option>
          <option value="mind">Mind — informs hosted answers, never quoted</option>
          <option value="published">Published — quotable by a hosted mind</option>
        </select>
      </label>
      <p className="empty-hint">
        New notes start at this access level (PLAN.md §5.3); change any single note's level
        anytime via the picker next to its title. Only notes scoped "Mind" or "Published" are
        ever sent to the Mind API publish pipeline — "Private" notes never leave this device.
      </p>

      <label>
        Topics my clone must refuse to discuss (comma-separated)
        <input
          value={form.refusalTopicsText}
          onChange={set('refusalTopicsText')}
          placeholder="e.g. my health, my ex, salary details"
        />
      </label>
      <p className="empty-hint">
        Enforced on every reply (PLAN.md §4.5) and cannot be turned off — only this list is
        editable. It's exported with the mind bundle (unlike API keys) so an imported/purchased
        mind keeps the same boundaries you set.
      </p>

      <div>
        <button
          className="primary"
          onClick={() => {
            const { refusalTopicsText, ...rest } = form
            vault.setPersona({ ...rest, refusalTopics: parseRefusalTopics(refusalTopicsText), apiKey: undefined })
            setSaved(true)
            setTimeout(() => setSaved(false), 1500)
          }}
        >
          {saved ? 'Saved' : 'Save settings'}
        </button>
      </div>

      <FolderVaultSection />
      <EncryptionSection />

      <p className="empty-hint">
        Pro tip: create a note titled <b>Identity Core</b> describing who you are — values,
        expertise, voice. The persona injects it into every prompt. Brand tokens live in
        <code> src/styles/theme.css</code> (brand tokens) and the wordmark in <code>src/App.jsx</code>.
      </p>
    </div>
  )
}
