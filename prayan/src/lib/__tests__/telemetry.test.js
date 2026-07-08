import { describe, it, expect, beforeEach } from 'vitest'
import { track, snapshot, reset, flush, isEnabled } from '../telemetry.js'

const ENABLED = { VITE_TELEMETRY_URL: 'https://t.example/collect' }
const DISABLED = {}

describe('telemetry (PLAN.md §6.3 — event counts only, env-gated)', () => {
  beforeEach(() => reset())

  it('is disabled without VITE_TELEMETRY_URL', () => {
    expect(isEnabled(DISABLED)).toBe(false)
  })

  it('counts events by name', () => {
    track('note.create')
    track('note.create')
    track('view.Graph')
    expect(snapshot()).toEqual({ 'note.create': 2, 'view.Graph': 1 })
  })

  it('flush sends ONLY counts — no content-shaped fields anywhere', () => {
    track('note.create')
    track('persona.ask')
    let sent
    flush({ env: ENABLED, send: (url, body) => ((sent = { url, body }), true) })

    expect(sent.url).toBe('https://t.example/collect')
    const payload = JSON.parse(sent.body)
    expect(Object.keys(payload).sort()).toEqual(['events', 'startedAt'])
    expect(payload.events).toEqual({ 'note.create': 1, 'persona.ask': 1 })
    // every value is a number — nothing string-shaped (i.e. no content) leaks
    for (const v of Object.values(payload.events)) expect(typeof v).toBe('number')
  })

  it('flush clears the buffer and reports false when there is nothing to send', () => {
    track('x')
    expect(flush({ env: ENABLED, send: () => true })).toBe(true)
    expect(snapshot()).toEqual({})
    expect(flush({ env: ENABLED, send: () => true })).toBe(false)
  })

  it('flush is a silent no-op when disabled (events stay local and die)', () => {
    track('x')
    let called = false
    expect(flush({ env: DISABLED, send: () => (called = true) })).toBe(false)
    expect(called).toBe(false)
  })

  it('respects Do Not Track', () => {
    const orig = Object.getOwnPropertyDescriptor(Navigator.prototype, 'doNotTrack')
    Object.defineProperty(navigator, 'doNotTrack', { value: '1', configurable: true })
    expect(isEnabled(ENABLED)).toBe(false)
    if (orig) Object.defineProperty(Navigator.prototype, 'doNotTrack', orig)
    else delete navigator.doNotTrack
  })
})
