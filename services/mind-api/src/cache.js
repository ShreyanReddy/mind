// Identical-(mind_version, question) answer cache — PLAN.md §5.2. Keyed by
// a normalized, hashed question so trivial whitespace/casing differences
// still hit the cache; scoped per mind_handle + version so a republish
// (which bumps the version) never serves a stale cached answer.

import { createHash } from 'node:crypto'

export function normalizeQuestion(question = '') {
  return question.trim().toLowerCase().replace(/\s+/g, ' ')
}

export function questionHash(question) {
  return createHash('sha256').update(normalizeQuestion(question)).digest('hex')
}

export async function getCached(supabase, { mindHandle, version, question }) {
  const hash = questionHash(question)
  const { data, error } = await supabase
    .from('ask_cache')
    .select('answer')
    .eq('mind_handle', mindHandle)
    .eq('version', version)
    .eq('question_hash', hash)
    .maybeSingle()
  if (error) throw new Error(`ask_cache lookup failed: ${error.message}`)
  return data?.answer ?? null
}

export async function setCached(supabase, { mindHandle, version, question, answer }) {
  const hash = questionHash(question)
  const { error } = await supabase
    .from('ask_cache')
    .upsert({ mind_handle: mindHandle, version, question_hash: hash, answer })
  if (error) throw new Error(`ask_cache write failed: ${error.message}`)
}
