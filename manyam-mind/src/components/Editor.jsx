import { useMemo, useRef, useState } from 'react'
import { marked } from 'marked'
import { vault } from '../lib/store.js'

// Render [[links]] as clickable spans inside the markdown preview.
function renderPreview(body) {
  const withLinks = body.replace(
    /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,
    (_, t, label) =>
      `<span class="wikilink" data-target="${t.trim().replace(/"/g, '&quot;')}">${label || t}</span>`
  )
  return marked.parse(withLinks, { breaks: true })
}

export default function Editor({ note, onNavigate }) {
  const [mode, setMode] = useState('write') // write | read
  const [ac, setAc] = useState(null) // { query, x, y, sel }
  const taRef = useRef(null)

  const titles = useMemo(
    () => vault.get().notes.map((n) => n.title).filter((t) => t !== note?.title),
    [note?.id, note?.updatedAt]
  )

  if (!note)
    return (
      <div className="pane">
        <div className="pane-body empty-hint" style={{ padding: 40 }}>
          Select a note, or press <b>+ New</b> to grow a neuron.
        </div>
      </div>
    )

  const matches = ac
    ? titles.filter((t) => t.toLowerCase().includes(ac.query.toLowerCase())).slice(0, 6)
    : []

  function onBodyChange(e) {
    const val = e.target.value
    vault.updateNote(note.id, { body: val })

    // wiki-link autocomplete: detect an unclosed [[query at the caret
    const caret = e.target.selectionStart
    const before = val.slice(0, caret)
    const m = before.match(/\[\[([^\]\n]*)$/)
    if (m) {
      setAc({ query: m[1], sel: 0, start: caret - m[1].length })
    } else setAc(null)
  }

  function acceptCompletion(title) {
    const ta = taRef.current
    const val = ta.value
    const caret = ta.selectionStart
    const next = val.slice(0, ac.start) + title + ']]' + val.slice(caret)
    vault.updateNote(note.id, { body: next })
    setAc(null)
    requestAnimationFrame(() => {
      ta.focus()
      const pos = ac.start + title.length + 2
      ta.setSelectionRange(pos, pos)
    })
  }

  function onKeyDown(e) {
    if (!ac || !matches.length) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setAc({ ...ac, sel: (ac.sel + 1) % matches.length }) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setAc({ ...ac, sel: (ac.sel - 1 + matches.length) % matches.length }) }
    else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); acceptCompletion(matches[ac.sel]) }
    else if (e.key === 'Escape') setAc(null)
  }

  function onPreviewClick(e) {
    const t = e.target.closest('.wikilink')?.dataset?.target
    if (t) onNavigate(vault.resolveOrCreate(t).id)
  }

  return (
    <div className="pane">
      <div className="pane-h">
        <div className="tabs">
          <button className={mode === 'write' ? 'on' : ''} onClick={() => setMode('write')}>Write</button>
          <button className={mode === 'read' ? 'on' : ''} onClick={() => setMode('read')}>Read</button>
        </div>
        <span className="spacer" />
        <button
          className="ghost"
          onClick={() => {
            if (confirm(`Delete "${note.title}"? This removes the neuron and its synapses.`)) {
              vault.deleteNote(note.id)
              onNavigate(vault.get().notes[0]?.id || null)
            }
          }}
        >
          Delete
        </button>
      </div>

      <div className="editor-wrap">
        <input
          className="editor-title"
          value={note.title}
          onChange={(e) => vault.updateNote(note.id, { title: e.target.value })}
          aria-label="Note title"
        />
        <div className="editor-meta">
          <span>strengthened ×{note.edits}</span>
          <span>updated {new Date(note.updatedAt).toLocaleString()}</span>
        </div>

        {mode === 'write' ? (
          <div style={{ position: 'relative', flex: 1, display: 'flex' }}>
            <textarea
              ref={taRef}
              className="editor-body"
              value={note.body}
              onChange={onBodyChange}
              onKeyDown={onKeyDown}
              placeholder="Write what you know. Type [[ to connect a synapse…"
              aria-label="Note body"
            />
            {ac && matches.length > 0 && (
              <div className="autocomplete" style={{ left: 26, bottom: 20 }}>
                {matches.map((t, i) => (
                  <div
                    key={t}
                    className={i === ac.sel ? 'sel' : ''}
                    onMouseDown={(e) => { e.preventDefault(); acceptCompletion(t) }}
                  >
                    [[{t}]]
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div
            className="preview"
            onClick={onPreviewClick}
            dangerouslySetInnerHTML={{ __html: renderPreview(note.body) }}
          />
        )}
      </div>
    </div>
  )
}
