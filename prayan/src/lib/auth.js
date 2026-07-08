// Auth + profile bootstrap — PLAN.md §3.1.
//
// Thin wrapper over supabase-js auth plus the two pieces of first-sign-in
// bookkeeping the marketplace needs: a `profiles` row (created client-side,
// gated by the `insert own row only` RLS policy in migration 0004) and an
// X25519 keypair (crypto.js) whose PUBLIC half is published to
// `profiles.public_key` so other users can seal content keys to this user.
// The PRIVATE half never leaves the device — it lives only in Dexie meta
// (db.js), keyed by `marketplaceKeyPair`, and is never included in
// store.js's exportBundle() (a different table entirely).

import { getSupabase, backendConfigured } from './supabase.js'
import { db } from './db.js'
import { generateKeyPair, sodiumReady } from './crypto.js'

export { backendConfigured }

const KEYPAIR_META_KEY = 'marketplaceKeyPair'

function requireSupabase() {
  const supabase = getSupabase()
  if (!supabase) throw new Error('Marketplace backend not configured (.env)')
  return supabase
}

/** Create an auth user, then (if email confirmation is off / session is immediate) the profile + keypair. */
export async function signUp(email, password, handle) {
  const supabase = requireSupabase()
  const { data, error } = await supabase.auth.signUp({ email, password })
  if (error) throw error
  if (data.session && data.user) {
    await ensureProfile(data.user.id, handle)
    await ensureKeyPairPublished(data.user.id)
  }
  return data
}

/** Sign in; ensures the profile row and published public key exist (idempotent — safe on every sign-in). */
export async function signIn(email, password) {
  const supabase = requireSupabase()
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw error
  if (data.user) {
    await ensureProfile(data.user.id)
    await ensureKeyPairPublished(data.user.id)
  }
  return data
}

export async function signOut() {
  const supabase = requireSupabase()
  const { error } = await supabase.auth.signOut()
  if (error) throw error
}

/** Current session, or null when signed out / backend not configured. */
export async function getSession() {
  const supabase = getSupabase()
  if (!supabase) return null
  const { data } = await supabase.auth.getSession()
  return data.session
}

/** Subscribe to auth state changes. Returns an unsubscribe function; no-ops without a backend. */
export function onAuthChange(callback) {
  const supabase = getSupabase()
  if (!supabase) return () => {}
  const { data } = supabase.auth.onAuthStateChange((_event, session) => callback(session))
  return () => data.subscription.unsubscribe()
}

/** Insert the profile row for a freshly-authed user, if it doesn't exist yet. Idempotent. */
export async function ensureProfile(userId, handle) {
  const supabase = requireSupabase()
  const { data: existing } = await supabase.from('profiles').select('id').eq('id', userId).maybeSingle()
  if (existing) return existing
  const finalHandle = (handle || '').trim() || `mind-${userId.slice(0, 8)}`
  const { data, error } = await supabase
    .from('profiles')
    .insert({ id: userId, handle: finalHandle, display_name: finalHandle })
    .select()
    .single()
  if (error) throw error
  return data
}

/**
 * Ensure a local X25519 keypair exists (generating one on first call) and
 * that its public half is published to profiles.public_key. Idempotent.
 * Returns { publicKey, privateKey } (base64) — the private key never leaves
 * this function's caller's device.
 */
export async function ensureKeyPairPublished(userId) {
  let pair = await getLocalKeyPair()
  if (!pair) {
    await sodiumReady()
    pair = await generateKeyPair()
    await db.meta.put({ key: KEYPAIR_META_KEY, value: pair })
  }
  const supabase = requireSupabase()
  const { data: profile } = await supabase.from('profiles').select('public_key').eq('id', userId).maybeSingle()
  if (profile && profile.public_key !== pair.publicKey) {
    const { error } = await supabase.from('profiles').update({ public_key: pair.publicKey }).eq('id', userId)
    if (error) throw error
  }
  return pair
}

/** The locally-held keypair (Dexie meta), or null if none has been generated yet. Never touches the network. */
export async function getLocalKeyPair() {
  const stored = await db.meta.get(KEYPAIR_META_KEY)
  return stored?.value || null
}
