// Publish pipeline — PLAN.md §5.3. Turns the owner's mind/published-scoped
// notes into a hosted, queryable mind: chunks them (retrieval.chunkVault),
// embeds each chunk via the shared `embed` Edge Function, and upserts the
// result into `mind_chunks` under a fresh `mind_version`, then upserts the
// public `minds` row the mind-api service (services/mind-api/) reads from
// with its service-role key.
//
// PRIVACY (per CLAUDE.md): notes scoped 'private' (the default — see
// store.js NOTE_SCOPES) are never chunked, never embedded, and never leave
// this device via this module. Only 'mind' (informs answers, never quoted
// verbatim — enforced server-side by the mind-api persona pipeline) and
// 'published' (quotable) notes are ever sent anywhere from here.
//
// Every publish is a full re-index: existing mind_chunks rows for this
// owner are deleted and replaced (rather than diffed) — simpler, and cheap
// enough at vault scale, and it's what makes "Unpublish" a clean delete.

import { vault } from './store.js'
import { chunkVault, knowledgeGaps } from './retrieval.js'
import { chunkKey, embedTexts } from './embeddings.js'
import { getSupabase } from './supabase.js'
import { getMyProfile } from './marketplace.js'

const SHAREABLE_SCOPES = new Set(['mind', 'published'])
const EMBED_BATCH_SIZE = 32

function requireSupabase() {
  const supabase = getSupabase()
  if (!supabase) throw new Error('Backend not configured (.env) — cannot publish a mind.')
  return supabase
}

async function requireUser(supabase) {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('Sign in to publish your mind.')
  return user
}

/** Notes eligible for hosting: scope 'mind' or 'published' (never 'private', the default). */
function shareableNotes(state) {
  return state.notes.filter((n) => SHAREABLE_SCOPES.has(n.scope || 'private'))
}

/**
 * What "Publish my mind" would share right now, for the explicit-consent
 * preview PLAN.md §5.3 requires before a publish/republish actually runs.
 * Counts are per SCOPE, not per note, since a note can produce zero chunks
 * (empty body) — chunk counts are what's actually retrievable/quotable.
 */
export function publishPreview(state = vault.get()) {
  const notes = shareableNotes(state)
  const scopeByNote = new Map(notes.map((n) => [n.id, n.scope]))
  const chunks = chunkVault(notes)
  const counts = { mind: 0, published: 0 }
  for (const c of chunks) counts[scopeByNote.get(c.noteId)]++
  return {
    totalNotes: state.notes.length,
    privateNotes: state.notes.length - notes.length,
    shareableNotes: notes.length,
    mindChunks: counts.mind,
    publishedChunks: counts.published,
    totalChunks: chunks.length,
  }
}

/** Best-effort batch embed; a batch (or the whole call) failing just means those chunks publish with a null embedding — mind-api's BM25 fallback still serves them. */
async function embedChunks(chunks) {
  const vectors = new Map()
  for (let i = 0; i < chunks.length; i += EMBED_BATCH_SIZE) {
    const batch = chunks.slice(i, i + EMBED_BATCH_SIZE)
    try {
      const data = await embedTexts(batch.map((c) => c.text))
      if (!data?.vectors) continue
      batch.forEach((c, j) => {
        if (data.vectors[j]) vectors.set(chunkKey(c.noteId, c.text), data.vectors[j])
      })
    } catch (err) {
      console.error('[mindPublish] embedding batch failed — publishing without vectors for it', err)
    }
  }
  return vectors
}

/**
 * Publish (or republish) the current vault as a hosted mind.
 * @param {{ bio?: string, sampleQuestions?: string[], pricePerQueryCents?: number,
 *   freeQueriesPerDay?: number, preferredProvider?: string, digestOptIn?: boolean }} opts
 */
export async function publishMind(opts = {}) {
  const supabase = requireSupabase()
  const user = await requireUser(supabase)
  const state = vault.get()

  const profile = await getMyProfile()
  if (!profile?.handle) throw new Error('Set up your profile handle before publishing a mind.')

  const notes = shareableNotes(state)
  const scopeByNote = new Map(notes.map((n) => [n.id, n.scope]))
  const chunks = chunkVault(notes)

  const { data: existingMind } = await supabase.from('minds').select('current_version').eq('user_id', user.id).maybeSingle()
  const nextVersion = (existingMind?.current_version || 0) + 1

  const vectors = chunks.length ? await embedChunks(chunks) : new Map()

  // Full re-index: clear this owner's prior chunks before inserting the new set.
  const { error: delErr } = await supabase.from('mind_chunks').delete().eq('user_id', user.id)
  if (delErr) throw delErr

  if (chunks.length) {
    const rows = chunks.map((c) => ({
      user_id: user.id,
      note_id: c.noteId,
      chunk_key: chunkKey(c.noteId, c.text),
      title: c.title,
      scope: scopeByNote.get(c.noteId),
      content: c.text,
      embedding: vectors.get(chunkKey(c.noteId, c.text)) || null,
      version: nextVersion,
    }))
    const { error: insErr } = await supabase.from('mind_chunks').insert(rows)
    if (insErr) throw insErr
  }

  const graph = vault.graph()
  const { data: mind, error } = await supabase
    .from('minds')
    .upsert({
      user_id: user.id,
      handle: profile.handle,
      bio: opts.bio ?? '',
      note_count: state.notes.length,
      link_count: graph.edges.length,
      sample_questions: opts.sampleQuestions ?? [],
      refusal_topics: state.persona.refusalTopics || [],
      preferred_provider: opts.preferredProvider || state.persona.provider || 'anthropic',
      price_per_query_cents: Math.max(0, Math.round(opts.pricePerQueryCents ?? 0)),
      free_queries_per_day: Math.max(0, Math.round(opts.freeQueriesPerDay ?? 25)),
      current_version: nextVersion,
      published: true,
      published_at: new Date().toISOString(),
      digest_opt_in: Boolean(opts.digestOptIn),
      gap_titles: knowledgeGaps(state, 3),
    })
    .select()
    .single()
  if (error) throw error

  return mind
}

/** Take the mind offline: delete all hosted chunks and flip `published` off. Owner keeps their local vault untouched — this only affects the hosted copy. */
export async function unpublishMind() {
  const supabase = requireSupabase()
  const user = await requireUser(supabase)

  const { error: delErr } = await supabase.from('mind_chunks').delete().eq('user_id', user.id)
  if (delErr) throw delErr

  const { error } = await supabase
    .from('minds')
    .update({ published: false, published_at: null })
    .eq('user_id', user.id)
  if (error) throw error
}

/** The caller's own minds row (publish state, price, stats), or null if they've never published. */
export async function getMyMind() {
  const supabase = requireSupabase()
  const user = await requireUser(supabase)
  const { data, error } = await supabase.from('minds').select('*').eq('user_id', user.id).maybeSingle()
  if (error) throw error
  return data
}

/** Store an owner's rating (1-5) of a sample question's answer — PLAN.md §5.5 voice-match. */
export async function rateSampleAnswer(question, rating) {
  const supabase = requireSupabase()
  const user = await requireUser(supabase)
  const mind = await getMyMind()
  if (!mind) throw new Error('Publish your mind before rating sample answers.')
  const voiceRating = { ...(mind.voice_rating || {}), [question]: rating }
  const { error } = await supabase.from('minds').update({ voice_rating: voiceRating }).eq('user_id', user.id)
  if (error) throw error
  return voiceRating
}
