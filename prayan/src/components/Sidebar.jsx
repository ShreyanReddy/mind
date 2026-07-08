import { useMemo, useState } from 'react'
import { vault } from '../lib/store.js'

export default function Sidebar({ activeId, onSelect }) {
  const [q, setQ] = useState('')
  const [collapsed, setCollapsed] = useState(() => new Set())
  const [activeTags, setActiveTags] = useState(() => new Set())
  const { notes } = vault.get()
  const g = vault.graph() // incremental index (PLAN.md §1.5) — no whole-vault reparse
  const degree = new Map(g.nodes.map((n) => [n.id, n.degree]))

  const allTags = useMemo(() => {
    const s = new Set()
    for (const n of notes) for (const t of n.tags || []) s.add(t)
    return [...s].sort()
  }, [notes])

  const filtered = notes.filter((n) => {
    if (activeTags.size && !(n.tags || []).some((t) => activeTags.has(t))) return false
    if (!q) return true
    return n.title.toLowerCase().includes(q.toLowerCase()) || n.body.toLowerCase().includes(q.toLowerCase())
  })

  const groups = useMemo(() => {
    const m = new Map()
    for (const n of filtered) {
      const folder = n.folder || ''
      if (!m.has(folder)) m.set(folder, [])
      m.get(folder).push(n)
    }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [filtered])

  const totalEdits = notes.reduce((s, n) => s + n.edits, 0)

  function toggleFolder(folder) {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(folder)) next.delete(folder)
      else next.add(folder)
      return next
    })
  }

  function toggleTag(tag) {
    setActiveTags((prev) => {
      const next = new Set(prev)
      if (next.has(tag)) next.delete(tag)
      else next.add(tag)
      return next
    })
  }

  return (
    <div className="pane sidebar">
      <div className="pane-h">
        Vault
        <span className="spacer" />
        <button className="ghost" title="Today's daily note" onClick={() => onSelect(vault.todayNote().id)}>
          Today
        </button>
        <button className="ghost" title="New note" onClick={() => onSelect(vault.createNote().id)}>
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
      {allTags.length > 0 && (
        <div className="tag-chips">
          {allTags.map((t) => (
            <button
              key={t}
              className={'tag-chip' + (activeTags.has(t) ? ' on' : '')}
              onClick={() => toggleTag(t)}
            >
              #{t}
            </button>
          ))}
        </div>
      )}
      <div className="pane-body">
        {groups.map(([folder, items]) => (
          <div key={folder} className="folder-group">
            <div className="folder-h" onClick={() => toggleFolder(folder)}>
              <span className={'chevron' + (collapsed.has(folder) ? ' closed' : '')}>▾</span>
              <span className="folder-name">{folder || 'Unfiled'}</span>
              <span className="folder-count">{items.length}</span>
            </div>
            {!collapsed.has(folder) && (
              <ul className="note-list">
                {items.map((n) => (
                  <li
                    key={n.id}
                    className={
                      'note-item' +
                      (n.id === activeId ? ' active' : '') +
                      // "hot" is a display-only recency heuristic re-derived from
                      // wall-clock time each render; it never feeds memoization.
                      (Date.now() - n.updatedAt < 60000 ? ' hot' : '')
                    }
                    onClick={() => onSelect(n.id)}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      const target = prompt('Move to folder:', n.folder || '')
                      if (target !== null) vault.updateNote(n.id, { folder: target.trim() })
                    }}
                    title="Right-click to move to a folder"
                  >
                    <span className="dot" />
                    <span className="title">{n.title}</span>
                    <span className="links">{degree.get(n.id) || 0}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
        {!filtered.length && (
          <div className="empty-hint" style={{ padding: 12 }}>
            No notes match. Create one to grow the network.
          </div>
        )}
      </div>
      <div className="sidebar-foot">
        <div className="stat-row"><span>Neurons</span><b>{notes.length}</b></div>
        <div className="stat-row"><span>Synapses</span><b>{g.edges.length}</b></div>
        <div className="stat-row"><span>Total strengthenings</span><b>{totalEdits}</b></div>
      </div>
    </div>
  )
}
