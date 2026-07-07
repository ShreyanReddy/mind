import { useState } from 'react'
import { vault } from '../lib/store.js'
import { buildGraph } from '../lib/links.js'

export default function Sidebar({ activeId, onSelect }) {
  const [q, setQ] = useState('')
  const { notes } = vault.get()
  const g = buildGraph(notes)
  const degree = new Map(g.nodes.map((n) => [n.id, n.degree]))

  const shown = notes.filter(
    (n) =>
      !q ||
      n.title.toLowerCase().includes(q.toLowerCase()) ||
      n.body.toLowerCase().includes(q.toLowerCase())
  )

  const totalEdits = notes.reduce((s, n) => s + n.edits, 0)

  return (
    <div className="pane">
      <div className="pane-h">
        Vault
        <span className="spacer" />
        <button
          className="ghost"
          title="New note"
          onClick={() => onSelect(vault.createNote().id)}
        >
          + New
        </button>
      </div>
      <div className="search">
        <input
          placeholder="Search your mind…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Search notes"
        />
      </div>
      <div className="pane-body">
        <ul className="note-list">
          {shown.map((n) => (
            <li
              key={n.id}
              className={
                'note-item' +
                (n.id === activeId ? ' active' : '') +
                // "hot" is a display-only recency heuristic re-derived from
                // wall-clock time each render; it never feeds memoization.
                // eslint-disable-next-line react-hooks/purity
                (Date.now() - n.updatedAt < 60000 ? ' hot' : '')
              }
              onClick={() => onSelect(n.id)}
            >
              <span className="dot" />
              <span className="title">{n.title}</span>
              <span className="links">{degree.get(n.id) || 0}</span>
            </li>
          ))}
          {!shown.length && <li className="empty-hint">No notes match. Create one to grow the network.</li>}
        </ul>
      </div>
      <div className="sidebar-foot">
        <div className="stat-row"><span>Neurons</span><b>{notes.length}</b></div>
        <div className="stat-row"><span>Synapses</span><b>{g.edges.length}</b></div>
        <div className="stat-row"><span>Total strengthenings</span><b>{totalEdits}</b></div>
      </div>
    </div>
  )
}
