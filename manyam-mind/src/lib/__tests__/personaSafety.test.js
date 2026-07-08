// PLAN.md §4.5 — safety rails. checkRefusal is the local, no-LLM-call
// pre-filter; buildSafetyBlock is the always-on system-prompt block
// persona.js injects into every prompt regardless of settings.
import { describe, it, expect } from 'vitest'
import { checkRefusal, buildSafetyBlock, parseRefusalTopics, STANDARD_REFUSAL, IMPERSONATION_REFUSAL } from '../personaSafety.js'

describe('parseRefusalTopics', () => {
  it('splits, trims, and drops empties from a comma-separated field', () => {
    expect(parseRefusalTopics('salary,  my health ,, politics ')).toEqual(['salary', 'my health', 'politics'])
  })
  it('returns [] for an empty or whitespace-only input', () => {
    expect(parseRefusalTopics('')).toEqual([])
    expect(parseRefusalTopics('   ')).toEqual([])
  })
})

describe('checkRefusal — local pre-filter', () => {
  it('refuses a question that contains an owner-excluded topic, case-insensitively', () => {
    const result = checkRefusal('What is your SALARY these days?', ['salary'])
    expect(result.refused).toBe(true)
    expect(result.message).toBe(STANDARD_REFUSAL)
    expect(result.topic).toBe('salary')
  })

  it('matches a multi-word topic as a substring', () => {
    expect(checkRefusal('Tell me about my health history', ['my health']).refused).toBe(true)
  })

  it('does not refuse when no topic matches', () => {
    expect(checkRefusal('What do you value most?', ['salary', 'my health']).refused).toBe(false)
  })

  it('is safe with an empty topics list or empty question', () => {
    expect(checkRefusal('anything', []).refused).toBe(false)
    expect(checkRefusal('', ['salary']).refused).toBe(false)
    expect(checkRefusal(undefined, ['salary']).refused).toBe(false)
  })

  it('ignores blank entries in the topics list', () => {
    expect(checkRefusal('what is your salary', ['', '   ', 'salary']).refused).toBe(true)
  })
})

describe('buildSafetyBlock — always-on system-prompt block', () => {
  it('always self-identifies as a clone and refuses impersonation, even with no topics set', () => {
    const block = buildSafetyBlock([])
    expect(block).toMatch(/SAFETY/)
    expect(block).toMatch(/mind clone/i)
    expect(block).toContain(IMPERSONATION_REFUSAL)
  })

  it('lists every configured topic and the exact standard refusal line', () => {
    const block = buildSafetyBlock(['salary', 'my ex'])
    expect(block).toContain('salary')
    expect(block).toContain('my ex')
    expect(block).toContain(STANDARD_REFUSAL)
  })

  it('tolerates blank/whitespace topic entries without emitting them', () => {
    const block = buildSafetyBlock(['', '  ', 'politics'])
    expect(block).toContain('politics')
    expect(block).not.toMatch(/Topics: ,/)
  })
})
