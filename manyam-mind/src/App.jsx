import { useEffect, useMemo, useState } from 'react'
import { vault } from './lib/store.js'
import { downloadBundle } from './lib/marketplace.js'
import Sidebar from './components/Sidebar.jsx'
import Editor from './components/Editor.jsx'
import ContextPanel from './components/ContextPanel.jsx'
import GraphView from './components/GraphView.jsx'
import PersonaChat from './components/PersonaChat.jsx'
import Marketplace from './components/Marketplace.jsx'
import Settings from './components/Settings.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import CommandPalette from './components/CommandPalette.jsx'

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
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [interviewSignal, setInterviewSignal] = useState(0)

  useEffect(() => vault.subscribe(() => force((n) => n + 1)), [])

  // PLAN.md §5.6 — the hosted interview-digest email links to "#interview";
  // opening the app on that hash jumps straight to Persona and starts an
  // interview turn (PersonaChat.jsx watches `interviewSignal`). The hash is
  // cleared immediately so refreshing/navigating away doesn't re-trigger it.
  useEffect(() => {
    function onHash() {
      if (window.location.hash !== '#interview') return
      setView('Persona')
      setInterviewSignal((n) => n + 1)
      history.replaceState(null, '', window.location.pathname + window.location.search)
    }
    onHash()
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  useEffect(() => {
    function onKeyDown(e) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen((o) => !o)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const note = vault.get().notes.find((n) => n.id === activeId) || null
  const openNote = (id) => { setActiveId(id); setView('Notes') }

  const showContext = view === 'Notes'

  const commands = useMemo(
    () => [
      { id: 'cmd:new', label: 'New note', hint: 'Command', run: () => openNote(vault.createNote().id) },
      { id: 'cmd:today', label: "Today's daily note", hint: 'Command', run: () => openNote(vault.todayNote().id) },
      {
        id: 'cmd:template',
        label: 'New from template…',
        hint: 'Command',
        run: () => {
          const templates = vault.templates()
          if (!templates.length) return alert('No notes in the Templates folder yet.')
          const pick = prompt('Template:\n' + templates.map((t, i) => `${i + 1}. ${t.title}`).join('\n'))
          const idx = Number(pick) - 1
          if (templates[idx]) openNote(vault.newFromTemplate(templates[idx].id).id)
        },
      },
      { id: 'cmd:toggle-mode', label: 'Toggle Read/Write', hint: 'Command', run: () => setView('Notes') },
      { id: 'cmd:graph', label: 'Open Graph', hint: 'Command', run: () => setView('Graph') },
      { id: 'cmd:persona', label: 'Open Persona', hint: 'Command', run: () => setView('Persona') },
      { id: 'cmd:marketplace', label: 'Open Marketplace', hint: 'Command', run: () => setView('Marketplace') },
      { id: 'cmd:settings', label: 'Open Settings', hint: 'Command', run: () => setView('Settings') },
      { id: 'cmd:export', label: 'Export mind bundle', hint: 'Command', run: downloadBundle },
      { id: 'cmd:undo', label: 'Undo', hint: 'Command', run: () => activeId && vault.undo(activeId) },
      { id: 'cmd:redo', label: 'Redo', hint: 'Command', run: () => activeId && vault.redo(activeId) },
      {
        id: 'cmd:move',
        label: 'Move note to folder…',
        hint: 'Command',
        run: () => {
          if (!activeId) return
          const folder = prompt('Move to folder:')
          if (folder !== null) vault.updateNote(activeId, { folder: folder.trim() })
        },
      },
      { id: 'cmd:connect-folder', label: 'Connect local folder', hint: 'Command', run: () => setView('Settings') },
    ],
    [activeId]
  )

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

      <ErrorBoundary label="Sidebar">
        <Sidebar activeId={activeId} onSelect={openNote} />
      </ErrorBoundary>

      <ErrorBoundary label={view}>
        {view === 'Notes' && <Editor note={note} onNavigate={openNote} />}
        {view === 'Graph' && (
          <div className="pane"><GraphView onOpenNote={openNote} /></div>
        )}
        {view === 'Persona' && (
          <div className="pane"><PersonaChat onOpenNote={openNote} autoInterviewSignal={interviewSignal} /></div>
        )}
        {view === 'Marketplace' && (
          <div className="pane"><Marketplace /></div>
        )}
        {view === 'Settings' && (
          <div className="pane"><Settings /></div>
        )}
      </ErrorBoundary>

      {showContext && (
        <ErrorBoundary label="Connections">
          <ContextPanel note={note} onNavigate={openNote} />
        </ErrorBoundary>
      )}

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        notes={vault.get().notes}
        onOpenNote={openNote}
        commands={commands}
      />
    </div>
  )
}
