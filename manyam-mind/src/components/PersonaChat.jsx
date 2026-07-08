import { useEffect, useRef, useState } from 'react'
import { vault } from '../lib/store.js'
import { askPersona, nextInterviewQuestion, absorbAnswer } from '../lib/persona.js'
import { retrievalMode } from '../lib/retrieval.js'
import { profileStale, regenerateProfile } from '../lib/personaProfile.js'
import { chat } from '../lib/llm.js'
import { backendConfigured } from '../lib/supabase.js'
import { getSession } from '../lib/auth.js'

export default function PersonaChat({ onOpenNote }) {
  const [history, setHistory] = useState([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [interview, setInterview] = useState(false)
  const [pendingQ, setPendingQ] = useState(null)
  const [mode, setMode] = useState('lexical')
  const [profileState, setProfileState] = useState('fresh')
  const [regenBusy, setRegenBusy] = useState(false)
  const askedRef = useRef([])
  const logRef = useRef(null)
  const persona = vault.get().persona

  const scroll = () => requestAnimationFrame(() => logRef.current?.scrollTo(0, 1e9))

  async function refreshStatus() {
    const state = vault.get()
    setMode(await retrievalMode(state))
    setProfileState(profileStale(state) ? 'stale' : 'fresh')
  }

  useEffect(() => {
    refreshStatus()
  }, [history.length])

  async function regenerate() {
    setRegenBusy(true)
    try {
      const state = vault.get()
      const signedIn = Boolean(await getSession())
      await regenerateProfile(state, (args) => chat({ persona: state.persona, backendConfigured, signedIn, ...args }))
      await refreshStatus()
    } catch (err) {
      setHistory((h) => [...h, { role: 'assistant', content: `Profile regeneration error — ${err.message}` }])
    } finally {
      setRegenBusy(false)
    }
  }

  async function startInterview() {
    setInterview(true)
    setBusy(true)
    try {
      const q = await nextInterviewQuestion(vault.get(), askedRef.current)
      askedRef.current.push(q)
      setPendingQ(q)
      setHistory((h) => [...h, { role: 'assistant', content: q, interview: true }])
    } catch (err) {
      setHistory((h) => [...h, { role: 'assistant', content: `Interview error — ${err.message}` }])
      setInterview(false)
    } finally {
      setBusy(false)
      scroll()
    }
  }

  async function send() {
    const text = input.trim()
    if (!text || busy) return
    setInput('')

    // interview mode: the answer becomes a neuron, then the mind asks again
    if (interview && pendingQ) {
      setBusy(true)
      try {
        const note = await absorbAnswer(pendingQ, text)
        setHistory((h) => [
          ...h,
          { role: 'user', content: text },
          { role: 'assistant', content: `Absorbed — new neuron “${note.title}” added to your vault. Watch it appear on the Graph.`, grown: true },
        ])
      } finally {
        setBusy(false)
      }
      setPendingQ(null)
      scroll()
      return startInterview()
    }

    const next = [...history.filter((m) => !m.interview && !m.grown), { role: 'user', content: text }]
    setHistory((h) => [...h, { role: 'user', content: text }])
    setBusy(true)
    try {
      const reply = await askPersona(vault.get(), next)
      setHistory((h) => [...h, reply])
    } catch (err) {
      setHistory((h) => [...h, { role: 'assistant', content: `Persona error — ${err.message}` }])
    } finally {
      setBusy(false)
      scroll()
    }
  }

  return (
    <div className="chat">
      <div className="pane-h">
        {persona.name} · powered by {persona.provider || 'anthropic'}
        {persona.imported && (
          <span
            className="badge stub"
            title={persona.exportedBy ? `Originally built by ${persona.exportedBy}` : 'Imported from another owner'}
          >
            imported mind
          </span>
        )}
        <span className="spacer" />
        {interview ? (
          <button className="ghost" onClick={() => { setInterview(false); setPendingQ(null) }}>
            End interview
          </button>
        ) : (
          <button className="ghost" onClick={startInterview} disabled={busy} title="The mind asks YOU questions; every answer becomes a new neuron">
            ⚡ Interview me
          </button>
        )}
      </div>
      <div className="persona-status">
        <span className={`badge ${mode === 'semantic' ? 'live' : 'stub'}`}>
          {mode === 'semantic' ? 'semantic retrieval' : 'lexical retrieval'}
        </span>
        <span className={`badge ${profileState === 'fresh' ? 'live' : 'stub'}`}>profile: {profileState}</span>
        {profileState === 'stale' && (
          <button className="ghost" onClick={regenerate} disabled={regenBusy}>
            {regenBusy ? 'Regenerating…' : 'Regenerate profile'}
          </button>
        )}
      </div>
      <div className="chat-log" ref={logRef}>
        {!history.length && (
          <div className="empty-hint" style={{ padding: 20 }}>
            This is <b>{persona.name}</b> — your personal model. A frontier LLM does the
            reasoning; your vault supplies the knowledge, voice, and judgment. Ask it anything,
            or hit <b>⚡ Interview me</b> and grow the mind by answering its questions.
            {' '}Tip: create a note titled <b>Identity Core</b> — it's injected into every prompt.
          </div>
        )}
        {history.map((m, i) => (
          <div key={i} className={`msg ${m.role === 'user' ? 'user' : 'persona'}${m.grown ? ' grown' : ''}`}>
            {m.content}
            {m.sources?.length > 0 && (
              <div className="sources">
                {m.sources.map((s) => (
                  <button key={s.noteId} className="source-chip" onClick={() => onOpenNote?.(s.noteId)}>
                    {s.title}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
        {busy && <div className="msg persona">thinking…</div>}
      </div>
      <div className="chat-input">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
          }}
          placeholder={interview && pendingQ ? 'Answer to grow your mind…' : 'Ask your mind anything…'}
          aria-label="Message your mind clone"
        />
        <button className="primary" onClick={send} disabled={busy}>
          {interview && pendingQ ? 'Absorb' : 'Send'}
        </button>
      </div>
    </div>
  )
}
