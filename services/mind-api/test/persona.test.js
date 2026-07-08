import { describe, it, expect } from 'vitest'
import { checkRefusal, buildSafetyBlock, buildSystemPrompt, stripVerbatimQuotes, extractCitations, renderCitations } from '../src/persona.js'

describe('checkRefusal', () => {
  it('matches a topic case-insensitively as a substring', () => {
    const result = checkRefusal('Tell me about your Health issues', ['health'])
    expect(result.refused).toBe(true)
    expect(result.message).toMatch(/not able to discuss/i)
  })

  it('does not refuse when no topic matches, or the topic list is empty', () => {
    expect(checkRefusal('what do you think about coffee?', ['health']).refused).toBe(false)
    expect(checkRefusal('anything', []).refused).toBe(false)
  })

  it('ignores blank/whitespace-only topics', () => {
    expect(checkRefusal('salary details are private', ['', '   ']).refused).toBe(false)
  })
})

describe('buildSafetyBlock', () => {
  it('always includes clone self-identification and the impersonation refusal', () => {
    const block = buildSafetyBlock([])
    expect(block).toMatch(/mind clone/i)
    expect(block).toMatch(/impersonation/i)
  })

  it('lists owner-excluded topics when present', () => {
    const block = buildSafetyBlock(['my ex', 'salary'])
    expect(block).toContain('my ex')
    expect(block).toContain('salary')
  })
})

describe('buildSystemPrompt', () => {
  const mind = { handle: 'alice', bio: 'A builder.', refusal_topics: ['exes'] }

  it('self-identifies as a clone of the handle and includes the safety block', () => {
    const prompt = buildSystemPrompt({ mind, memories: [] })
    expect(prompt).toMatch(/clone of "alice"/i)
    expect(prompt).toMatch(/impersonation/i)
    expect(prompt).toContain('exes')
  })

  it('lists only retrieved memory titles as citable, and marks mind vs published scope', () => {
    const memories = [
      { title: 'A', content: 'mind stuff', scope: 'mind' },
      { title: 'B', content: 'published stuff', scope: 'published' },
    ]
    const prompt = buildSystemPrompt({ mind, memories })
    expect(prompt).toContain('A, B')
    expect(prompt).toMatch(/never claim otherwise/i)
    expect(prompt).toMatch(/\(scope: mind\)/)
    expect(prompt).toMatch(/\(scope: published\)/)
    expect(prompt).toMatch(/must never be quoted verbatim/i)
  })

  it('handles an empty memory set honestly rather than inventing citable titles', () => {
    const prompt = buildSystemPrompt({ mind, memories: [] })
    expect(prompt).toMatch(/none retrieved for this question/)
  })
})

describe('stripVerbatimQuotes', () => {
  it('masks a long verbatim run copied from a mind-scoped memory', () => {
    const longText = 'This is a fairly long sentence that should not be quoted verbatim at all costs.'
    const memories = [{ title: 'A', content: longText, scope: 'mind' }]
    const answer = `Here's what I think: ${longText} That's my view.`
    const out = stripVerbatimQuotes(answer, memories)
    expect(out).not.toContain(longText)
    expect(out).toMatch(/paraphrased/i)
  })

  it('never touches a verbatim run copied from a published-scoped memory (quotable by design)', () => {
    const longText = 'This is a fairly long sentence that is perfectly fine to quote directly.'
    const memories = [{ title: 'A', content: longText, scope: 'published' }]
    const answer = `Quote: ${longText}`
    expect(stripVerbatimQuotes(answer, memories)).toBe(answer)
  })

  it('leaves short overlaps alone (below the verbatim window) even for mind-scoped content', () => {
    const memories = [{ title: 'A', content: 'a short mind memory', scope: 'mind' }]
    const answer = 'I generally agree with that idea.'
    expect(stripVerbatimQuotes(answer, memories)).toBe(answer)
  })
})

describe('extractCitations / renderCitations', () => {
  it('extracts only titles that resolve to a retrieved memory, de-duplicated', () => {
    const memories = [{ title: 'My Principles', content: '...', scope: 'mind' }]
    const content = 'As I wrote in [[My Principles]], also see [[My Principles]] and [[Nonexistent]].'
    expect(extractCitations(content, memories)).toEqual(['My Principles'])
  })

  it('renderCitations strips the [[...]] markup down to plain text, honoring an optional label', () => {
    expect(renderCitations('See [[Title]] and [[Title|a label]].')).toBe('See Title and a label.')
  })
})
