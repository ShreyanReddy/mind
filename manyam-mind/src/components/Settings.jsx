import { useState } from 'react'
import { vault } from '../lib/store.js'
import { PROVIDERS } from '../lib/llm.js'

export default function Settings() {
  const p = vault.get().persona
  const [form, setForm] = useState({
    provider: p.provider || 'anthropic',
    model: p.model || 'claude-sonnet-4-6',
    name: p.name,
    voice: p.voice,
    keys: { anthropic: '', openai: '', gemini: '', ...(p.keys || {}), anthropic: (p.keys?.anthropic ?? p.apiKey ?? '') },
  })
  const [saved, setSaved] = useState(false)

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })
  const setKey = (prov) => (e) => setForm({ ...form, keys: { ...form.keys, [prov]: e.target.value } })
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
      {Object.keys(PROVIDERS).map((prov) => (
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
      <div>
        <button
          className="primary"
          onClick={() => {
            vault.setPersona({ ...form, apiKey: undefined })
            setSaved(true)
            setTimeout(() => setSaved(false), 1500)
          }}
        >
          {saved ? 'Saved' : 'Save settings'}
        </button>
      </div>
      <p className="empty-hint">
        Pro tip: create a note titled <b>Identity Core</b> describing who you are — values,
        expertise, voice. The persona injects it into every prompt. Brand tokens live in
        <code> src/styles/theme.css</code> (brand tokens) and the wordmark in <code>src/App.jsx</code>.
      </p>
    </div>
  )
}
