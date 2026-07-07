import { vault } from '../lib/store.js'
import { backlinksTo, parseLinks, plainText } from '../lib/links.js'

export default function ContextPanel({ note, onNavigate }) {
  if (!note) return null
  const { notes } = vault.get()
  const back = backlinksTo(notes, note.title)
  const out = parseLinks(note.body)

  return (
    <div className="pane context">
      <div className="pane-h">Connections</div>
      <div className="pane-body">
        <div className="ctx-section">
          <h4>Backlinks · {back.length}</h4>
          {back.map((n) => (
            <a key={n.id} className="backlink" onClick={() => onNavigate(n.id)}>
              {n.title}
              <small>{plainText(n.body).slice(0, 80)}</small>
            </a>
          ))}
          {!back.length && (
            <div className="empty-hint">
              Nothing links here yet. Reference [[{note.title}]] from another note to form a synapse.
            </div>
          )}
        </div>
        <div className="ctx-section">
          <h4>Links out · {out.length}</h4>
          {out.map((l, i) => (
            <a
              key={i}
              className="backlink"
              onClick={() => onNavigate(vault.resolveOrCreate(l.target).id)}
            >
              {l.target}
            </a>
          ))}
          {!out.length && <div className="empty-hint">Type [[ in the editor to connect this note outward.</div>}
        </div>
      </div>
    </div>
  )
}
