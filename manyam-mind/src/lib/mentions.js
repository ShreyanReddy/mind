// Unlinked-mention detection — PLAN.md §1.4.
// Finds case-insensitive plain-text occurrences of a note's title/aliases in
// OTHER notes' bodies, skipping anything already inside a [[wiki-link]], so
// ContextPanel can offer to turn a mention into a real synapse.

const WIKILINK_RE = /\[\[([^\]]+)\]\]/g

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Byte ranges [start, end) already covered by a [[...]] link in `body`. */
function linkRanges(body) {
  const ranges = []
  let m
  WIKILINK_RE.lastIndex = 0
  while ((m = WIKILINK_RE.exec(body))) ranges.push([m.index, m.index + m[0].length])
  return ranges
}

/**
 * Find unlinked mentions of `note` (by title + `aliases`) across `otherNotes`.
 * Returns [{ noteId, title, index, length, matchedText }] — one entry per
 * other note that contains at least one unlinked mention (the first one).
 */
export function findUnlinkedMentions(note, otherNotes = [], aliases = []) {
  if (!note) return []
  const names = [note.title, ...aliases].filter(Boolean)
  if (!names.length) return []

  // Longest-first so a longer alias isn't shadowed by a shorter substring alias.
  const sorted = [...names].sort((a, b) => b.length - a.length)
  const pattern = sorted.map(escapeRegExp).join('|')
  const re = new RegExp(`\\b(?:${pattern})\\b`, 'gi')

  const results = []
  for (const other of otherNotes) {
    if (!other || other.id === note.id) continue
    const body = other.body || ''
    const ranges = linkRanges(body)

    re.lastIndex = 0
    let m
    let found = null
    while ((m = re.exec(body))) {
      const start = m.index
      const end = start + m[0].length
      const insideLink = ranges.some(([s, e]) => start >= s && end <= e)
      if (!insideLink) {
        found = { index: start, length: m[0].length, matchedText: m[0] }
        break
      }
    }
    if (found) results.push({ noteId: other.id, title: other.title, ...found })
  }
  return results
}

/** Wrap the mention's matched text (found by findUnlinkedMentions) in [[...]]. */
export function linkFirstMention(body, mention) {
  const { index, length } = mention
  return body.slice(0, index) + '[[' + body.slice(index, index + length) + ']]' + body.slice(index + length)
}
