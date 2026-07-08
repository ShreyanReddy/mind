// Privacy-safe observability (PLAN.md §6.3): EVENT COUNTS ONLY, never
// content. No note text, no titles, no queries, no user identifiers — the
// payload is literally { startedAt, events: { 'note.create': 3, ... } }.
// Disabled unless VITE_TELEMETRY_URL is configured, and always disabled when
// the browser sends Do Not Track. Errors are Sentry's job (see main.jsx),
// not this module's.

const counts = new Map()
let startedAt = null

function dnt() {
  if (typeof navigator === 'undefined') return false
  return navigator.doNotTrack === '1' || globalThis.doNotTrack === '1'
}

export function telemetryUrl(env = import.meta.env) {
  return env?.VITE_TELEMETRY_URL || ''
}

export function isEnabled(env = import.meta.env) {
  return Boolean(telemetryUrl(env)) && !dnt()
}

/** Count one occurrence of a named event. Safe to call unconditionally. */
export function track(name) {
  if (!startedAt) startedAt = new Date().toISOString()
  counts.set(name, (counts.get(name) || 0) + 1)
}

/** The counts accumulated since the last flush — for tests and flush(). */
export function snapshot() {
  return Object.fromEntries(counts)
}

export function reset() {
  counts.clear()
  startedAt = null
}

/**
 * Send accumulated counts and clear the buffer. Injectable transport for
 * tests; defaults to sendBeacon (fires reliably on unload) with a
 * keepalive-fetch fallback. Never throws — losing a telemetry batch must
 * never affect the app.
 */
export function flush({ env = import.meta.env, send } = {}) {
  if (!isEnabled(env) || counts.size === 0) return false
  const body = JSON.stringify({ startedAt, events: snapshot() })
  reset()
  try {
    if (send) return Boolean(send(telemetryUrl(env), body))
    if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
      return navigator.sendBeacon(telemetryUrl(env), body)
    }
    fetch(telemetryUrl(env), {
      method: 'POST',
      body,
      headers: { 'content-type': 'application/json' },
      keepalive: true,
    }).catch(() => {})
    return true
  } catch {
    return false
  }
}

const FLUSH_INTERVAL = 60_000

/** Start the periodic + unload flush. No-op when disabled. */
export function startTelemetry(env = import.meta.env) {
  if (!isEnabled(env)) return () => {}
  const timer = setInterval(() => flush({ env }), FLUSH_INTERVAL)
  const onHide = () => flush({ env })
  window.addEventListener('pagehide', onHide)
  return () => {
    clearInterval(timer)
    window.removeEventListener('pagehide', onHide)
  }
}
