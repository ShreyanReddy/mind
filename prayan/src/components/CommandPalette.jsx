import { useEffect, useMemo, useRef, useState } from 'react'
import { fuzzyScore } from '../lib/fuzzy.js'

/**
 * Global command palette (Ctrl/Cmd-K). Fuzzy-matches notes (open) and
 * commands together. Mounted once in App.jsx.
 */
export default function CommandPalette({ open, onClose, notes, onOpenNote, commands }) {
  const [query, setQuery] = useState('')
  const [sel, setSel] = useState(0)
  const inputRef = useRef(null)

  // Reset the search + selection during render when `open` flips to true —
  // the React-recommended way to reset state on a prop change without the
  // cascading-render effect this used to trigger (see react.dev "Adjusting
  // state when a prop changes"). Focusing the input is a DOM side effect,
  // not state, so that part still belongs in a plain effect below.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setQuery('')
      setSel(0)
    }
  }

  useEffect(() => {
    if (open) requestAnimationFrame(() => inputRef.current?.focus())
  }, [open])

  const items = useMemo(() => {
    const noteItems = notes.map((n) => ({
      id: 'note:' + n.id,
      label: n.title,
      hint: 'Open note',
      run: () => onOpenNote(n.id),
    }))
    const all = [...commands, ...noteItems]
    if (!query) return all.slice(0, 20)
    return all
      .map((it) => ({ it, score: fuzzyScore(query, it.label) }))
      .filter((x) => x.score >= 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 20)
      .map((x) => x.it)
  }, [query, notes, commands, onOpenNote])

  if (!open) return null

  function run(item) {
    onClose()
    item.run()
  }

  function onKeyDown(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSel((s) => Math.min(items.length - 1, s + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSel((s) => Math.max(0, s - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (items[sel]) run(items[sel])
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }

  return (
    <div className="cmdk-overlay" onMouseDown={onClose}>
      <div className="cmdk" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Command palette">
        <input
          ref={inputRef}
          className="cmdk-input"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setSel(0)
          }}
          onKeyDown={onKeyDown}
          placeholder="Jump to a note or run a command…"
          aria-label="Command palette search"
        />
        <ul className="cmdk-list">
          {items.map((item, i) => (
            <li
              key={item.id}
              className={i === sel ? 'sel' : ''}
              onMouseEnter={() => setSel(i)}
              onMouseDown={(e) => {
                e.preventDefault()
                run(item)
              }}
            >
              <span className="cmdk-label">{item.label}</span>
              {item.hint && <span className="cmdk-hint">{item.hint}</span>}
            </li>
          ))}
          {!items.length && <li className="empty-hint">No matches.</li>}
        </ul>
      </div>
    </div>
  )
}
