import { useEffect, useState } from 'react'
import { vault } from './lib/store.js'
import Sidebar from './components/Sidebar.jsx'
import Editor from './components/Editor.jsx'
import ContextPanel from './components/ContextPanel.jsx'
import GraphView from './components/GraphView.jsx'
import PersonaChat from './components/PersonaChat.jsx'
import Marketplace from './components/Marketplace.jsx'
import Settings from './components/Settings.jsx'

// simple original glyphs for the ribbon (no external icon set needed)
const VIEWS = [
  { id: 'Notes', glyph: '✎', label: 'Notes' },
  { id: 'Graph', glyph: '◉', label: 'Graph' },
  { id: 'Persona', glyph: '☰', label: 'Persona' },
  { id: 'Marketplace', glyph: '⇄', label: 'Marketplace' },
]

export default function App() {
  const [, force] = useState(0)
  const [view, setView] = useState('Notes')
  const [activeId, setActiveId] = useState(vault.get().notes[0]?.id || null)

  useEffect(() => vault.subscribe(() => force((n) => n + 1)), [])

  const note = vault.get().notes.find((n) => n.id === activeId) || null
  const openNote = (id) => { setActiveId(id); setView('Notes') }

  const showContext = view === 'Notes'

  return (
    <div className={'app' + (showContext ? '' : ' no-context')}>
      <header className="topbar">
        <span className="wordmark">
          Manyam <span className="spark">Mind</span>
        </span>
        <span className="tagline">your mind, alive</span>
        <span className="spacer" />
      </header>

      <nav className="ribbon" aria-label="Views">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            className={view === v.id ? 'on' : ''}
            title={v.label}
            aria-label={v.label}
            onClick={() => setView(v.id)}
          >
            {v.glyph}
          </button>
        ))}
        <span className="gap" />
        <button
          className={view === 'Settings' ? 'on' : ''}
          title="Settings"
          aria-label="Settings"
          onClick={() => setView('Settings')}
        >
          ⚙
        </button>
      </nav>

      <Sidebar activeId={activeId} onSelect={openNote} />

      {view === 'Notes' && <Editor note={note} onNavigate={openNote} />}
      {view === 'Graph' && (
        <div className="pane"><GraphView onOpenNote={openNote} /></div>
      )}
      {view === 'Persona' && (
        <div className="pane"><PersonaChat onOpenNote={openNote} /></div>
      )}
      {view === 'Marketplace' && (
        <div className="pane"><Marketplace /></div>
      )}
      {view === 'Settings' && (
        <div className="pane"><Settings /></div>
      )}

      {showContext && <ContextPanel note={note} onNavigate={openNote} />}
    </div>
  )
}
