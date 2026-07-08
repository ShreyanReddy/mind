import { useState } from 'react'
import { signUp, signIn } from '../lib/auth.js'

/** Compact email+password auth — rendered inside Marketplace when signed out and the backend is configured. */
export default function AuthPanel() {
  const [mode, setMode] = useState('signin') // 'signin' | 'signup'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [handle, setHandle] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setMsg('')
    try {
      if (mode === 'signup') {
        const { session } = await signUp(email, password, handle)
        setMsg(session ? 'Account created — you are signed in.' : 'Check your email to confirm your account, then sign in.')
      } else {
        await signIn(email, password)
        setMsg('Signed in.')
      }
    } catch (err) {
      setMsg(err.message || 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="market-card auth-panel">
      <h3>{mode === 'signup' ? 'Create an account' : 'Sign in'}</h3>
      <p>Sign in to list, buy, and sell minds. A local X25519 keypair is generated on your device on first sign-in.</p>
      <form onSubmit={submit} className="auth-form">
        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
          />
        </label>
        {mode === 'signup' && (
          <label>
            Handle (public, shown on your listings)
            <input value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="e.g. ada" />
          </label>
        )}
        <div className="auth-actions">
          <button className="primary" type="submit" disabled={busy}>
            {busy ? 'Working…' : mode === 'signup' ? 'Sign up' : 'Sign in'}
          </button>
          <button
            type="button"
            className="ghost"
            onClick={() => {
              setMode(mode === 'signup' ? 'signin' : 'signup')
              setMsg('')
            }}
          >
            {mode === 'signup' ? 'Have an account? Sign in' : 'New here? Create an account'}
          </button>
        </div>
      </form>
      {msg && <p className="empty-hint">{msg}</p>}
    </div>
  )
}
