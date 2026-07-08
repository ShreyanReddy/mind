// Grounding + safety eval harness — PLAN.md §5.5. Not a mock of the HTTP
// layer (that's test/ask.test.js) but a direct exercise of the persona
// pipeline's building blocks against a MOCKED LLM (a hand-written "model
// answer" standing in for whatever a real provider would return), checking
// the four properties PLAN.md calls out explicitly:
//   (a) every citation in the answer resolves to a scoped chunk title
//   (b) refusal topics actually refuse (never reach "the model" at all)
//   (c) the mind-scope verbatim-quote filter works
//   (d) the clone self-identification string is present in the system prompt
import { describe, it, expect } from 'vitest'
import { buildSystemPrompt, checkRefusal, extractCitations, stripVerbatimQuotes, renderCitations } from '../src/persona.js'
import { retrieveChunks } from '../src/retrieval.js'

const MIND = {
  handle: 'alice',
  bio: 'A product builder who writes about decision-making.',
  refusal_topics: ['my health', 'my ex'],
}

const CHUNKS = [
  { title: 'My Principles', content: 'I optimize for long-term trust over short-term wins in every decision I make.', scope: 'published', embedding: null },
  { title: 'A Hard Call', content: 'Once I turned down a lucrative deal because the terms would have hurt our early users badly.', scope: 'mind', embedding: null },
]

/** Stands in for a real provider call: a hand-authored "model answer" for a given question + retrieved memories, so this eval never needs live network access. */
function mockLlmAnswer(question, memories) {
  if (/hard call|decision/i.test(question)) {
    return `As I noted in [[My Principles]], I optimize for long-term trust. For example: Once I turned down a lucrative deal because the terms would have hurt our early users badly. See also [[A Hard Call]] and [[Nonexistent Note]].`
  }
  return `I don't have grounded knowledge on that. See ${memories.map((m) => `[[${m.title}]]`).join(', ') || 'nothing retrieved'}.`
}

describe('(a) every citation resolves to a scoped chunk title', () => {
  it('extracts only citations that match a retrieved memory, dropping any hallucinated title', () => {
    const question = 'Tell me about a hard call you made in a decision.'
    const memories = retrieveChunks(CHUNKS, { queryVector: null, query: question }, 6)
    const modelAnswer = mockLlmAnswer(question, memories)

    const citations = extractCitations(modelAnswer, memories)
    expect(citations).toContain('My Principles')
    expect(citations).toContain('A Hard Call')
    expect(citations).not.toContain('Nonexistent Note') // hallucinated citation, not a real retrieved chunk

    // Every citation genuinely resolves to a title present in the scoped chunk set.
    const validTitles = new Set(CHUNKS.map((c) => c.title))
    for (const title of citations) expect(validTitles.has(title)).toBe(true)
  })
})

describe('(b) refusal topics refuse before reaching the model', () => {
  it('short-circuits an owner-excluded topic with the standard refusal, never calling the mock LLM', () => {
    let llmWasCalled = false
    const question = 'What is going on with my health lately?'
    const refusal = checkRefusal(question, MIND.refusal_topics)
    expect(refusal.refused).toBe(true)
    expect(refusal.message).toMatch(/not able to discuss/i)

    if (!refusal.refused) {
      llmWasCalled = true
      mockLlmAnswer(question, [])
    }
    expect(llmWasCalled).toBe(false)
  })

  it('does not refuse an unrelated question', () => {
    expect(checkRefusal('What do you think about product strategy?', MIND.refusal_topics).refused).toBe(false)
  })
})

describe('(c) mind-scope verbatim-quote filter', () => {
  it('paraphrase-masks a verbatim run copied from the mind-scoped chunk, but leaves the published-scoped quote intact', () => {
    const question = 'Tell me about a hard call you made in a decision.'
    const memories = retrieveChunks(CHUNKS, { queryVector: null, query: question }, 6)
    const modelAnswer = mockLlmAnswer(question, memories)

    const rendered = renderCitations(modelAnswer)
    const filtered = stripVerbatimQuotes(rendered, memories)

    // The mind-scoped chunk's verbatim sentence must not survive intact.
    expect(filtered).not.toContain('Once I turned down a lucrative deal because the terms would have hurt our early users badly.')
    expect(filtered).toMatch(/paraphrased/i)

    // The published-scoped chunk's content is fine to keep verbatim-adjacent (it's quotable by design) —
    // its citation marker still resolves even after filtering.
    expect(filtered).toContain('My Principles')
  })
})

describe('(d) clone self-identification is present in the system prompt', () => {
  it('every system prompt names the mind and states it is a clone, regardless of retrieved memories', () => {
    const withMemories = buildSystemPrompt({ mind: MIND, memories: CHUNKS })
    const withoutMemories = buildSystemPrompt({ mind: MIND, memories: [] })

    for (const prompt of [withMemories, withoutMemories]) {
      expect(prompt).toMatch(/mind clone of "alice"/i)
      expect(prompt).toMatch(/you are a clone, not the real person/i)
      expect(prompt).toMatch(/impersonation/i)
    }
  })
})
