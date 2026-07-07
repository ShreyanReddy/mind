import { describe, it, expect } from 'vitest'
import { findUnlinkedMentions, linkFirstMention } from '../mentions.js'

describe('findUnlinkedMentions', () => {
  const note = { id: '1', title: 'My Principles' }
  const other = (id, body) => ({ id, title: 'Other ' + id, body })

  it('finds a case-insensitive plain-text mention of the title in another note', () => {
    const others = [other('2', 'I keep coming back to my principles when deciding.')]
    const found = findUnlinkedMentions(note, others)
    expect(found).toHaveLength(1)
    expect(found[0].noteId).toBe('2')
    expect(found[0].matchedText.toLowerCase()).toBe('my principles')
  })

  it('ignores a mention that is already inside a [[wiki-link]]', () => {
    const others = [other('2', 'See [[My Principles]] for more.')]
    expect(findUnlinkedMentions(note, others)).toHaveLength(0)
  })

  it('matches aliases too', () => {
    const others = [other('2', 'My core values guide every call I make.')]
    const found = findUnlinkedMentions(note, others, ['core values'])
    expect(found).toHaveLength(1)
    expect(found[0].matchedText.toLowerCase()).toBe('core values')
  })

  it('excludes the note itself and notes with no mention', () => {
    const others = [
      { ...note, body: 'my principles mentioned here too' },
      other('3', 'Nothing related here.'),
    ]
    expect(findUnlinkedMentions(note, others)).toHaveLength(0)
  })

  it('respects word boundaries (does not match inside a longer word)', () => {
    const others = [other('2', 'Myprinciplesxyz is not a real match.')]
    expect(findUnlinkedMentions(note, others)).toHaveLength(0)
  })
})

describe('linkFirstMention', () => {
  it('wraps the matched range in [[...]]', () => {
    const body = 'I keep coming back to my principles when deciding.'
    const mention = { index: body.toLowerCase().indexOf('my principles'), length: 'my principles'.length }
    const next = linkFirstMention(body, mention)
    expect(next).toBe('I keep coming back to [[my principles]] when deciding.')
  })
})
