// Persona engine v3 — your mind as a queryable model. PLAN.md §4.
//
// Pipeline per question:
//   1. Local safety pre-filter (personaSafety.checkRefusal) — obviously
//      excluded topics never reach an LLM call at all.
//   2. Retrieve relevant memories (semantic-or-BM25 + synaptic strength,
//      ./retrieval.js)
//   3. Assemble: Identity Core + Persona Profile + safety block + retrieved
//      memories + conversation
//   4. Route to any frontier model (./llm.js: server proxy, or the
//      developer-mode direct call, or a clear error) — the LLM reasons,
//      the vault makes it *you*
//   5. Parse [[citations]] back out so the UI can link to source notes
//
// Interview mode inverts the flow: the mind studies its own gaps and asks
// the owner questions; every answer becomes a new neuron in the vault, and
// absorbAnswer now also suggests up to two related existing notes to link.

import { chat } from './llm.js'
import { retrieve, knowledgeGaps } from './retrieval.js'
import { vault } from './store.js'
import { backendConfigured } from './supabase.js'
import { getSession } from './auth.js'
import { profileText } from './personaProfile.js'
import { buildSafetyBlock, checkRefusal } from './personaSafety.js'

export const IDENTITY_TITLE = 'Identity Core'

/** How confidently a related note must score (retrieve()'s blended score) before an interview answer suggests linking it. Tuned empirically — both retrieval modes normalize into roughly the same 0..1 range. */
const SEE_ALSO_MIN_SCORE = 0.15
const SEE_ALSO_MAX = 2

function identityCore(state) {
  const core = state.notes.find(
    (n) => n.title.trim().toLowerCase() === IDENTITY_TITLE.toLowerCase()
  )
  return core ? core.body : ''
}

/** Resolves the auth/backend context chat() needs to route correctly. Never throws — an unconfigured/offline backend just means signedIn stays false. */
async function callContext(state) {
  let signedIn = false
  try {
    signedIn = Boolean(await getSession())
  } catch {
    // network/auth hiccup — treat as signed out rather than throwing from here
  }
  return { persona: state.persona, backendConfigured, signedIn }
}

export function buildSystemPrompt(state, memories) {
  const p = state.persona
  const memBlock = memories
    .map((m) => `[[${m.title}]]\n${m.text}`)
    .join('\n\n---\n\n')
  const availableTitles = [...new Set(memories.map((m) => m.title))]
  const profile = profileText(state)
  const importedFraming =
    p.imported && p.exportedBy
      ? `This vault was imported: you are a mind clone of ${p.exportedBy}, now owned by whoever is chatting with you today — not ${p.exportedBy}. Answer from the imported vault as that mind, and say so plainly if asked about your origin.`
      : ''

  return [
    `You are "${p.name}", a mind clone: a personal model built from one person's knowledge vault.`,
    `Voice: ${p.voice}. Answer as the owner would — their views, their reasoning, their style.`,
    importedFraming,
    `Ground every claim in the MEMORIES below. When you draw on a memory, cite it inline`,
    `exactly as [[Note Title]], citing only titles from this list: ${availableTitles.join(', ') || '(none retrieved for this question)'}.`,
    `If the memories don't cover the question, say so honestly`,
    `and answer from general knowledge only if clearly labeled as such.`,
    `You are a clone, not the real person — never claim otherwise.`,
    '',
    buildSafetyBlock(p.refusalTopics || []),
    '',
    identityCore(state) ? `=== IDENTITY CORE ===\n${identityCore(state)}\n` : '',
    profile ? `=== PERSONA PROFILE ===\n${profile}\n` : '',
    `=== RETRIEVED MEMORIES ===\n${memBlock || '(vault is empty on this topic)'}`,
  ].join('\n')
}

/** Ask the mind a question. Returns { content, sources: [{noteId,title}] } */
export async function askPersona(state, history) {
  const lastUser = [...history].reverse().find((m) => m.role === 'user')
  const question = lastUser?.content || ''

  // Safety pre-filter (PLAN.md §4.5) — short-circuits obviously-refused
  // topics before spending a retrieval pass or an LLM call.
  const pre = checkRefusal(question, state.persona.refusalTopics || [])
  if (pre.refused) {
    return { role: 'assistant', content: pre.message, sources: [] }
  }

  const memories = await retrieve(state, question, 6)

  const content = await chat({
    ...(await callContext(state)),
    system: buildSystemPrompt(state, memories),
    messages: history.map(({ role, content }) => ({ role, content })),
  })

  // resolve [[citations]] against retrieved memories (fall back to any note)
  const cited = new Map()
  for (const m of content.matchAll(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g)) {
    const t = m[1].trim()
    const src =
      memories.find((x) => x.title.toLowerCase() === t.toLowerCase()) ||
      state.notes.find((n) => n.title.toLowerCase() === t.toLowerCase())
    if (src) cited.set(src.noteId || src.id, { noteId: src.noteId || src.id, title: t })
  }

  return {
    role: 'assistant',
    content: content.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, t, l) => l || t),
    sources: [...cited.values()],
  }
}

/** Interview mode: the mind asks the owner one question to grow the vault. */
export async function nextInterviewQuestion(state, asked = []) {
  const gaps = knowledgeGaps(state, 6)
  const content = await chat({
    ...(await callContext(state)),
    maxTokens: 200,
    system: [
      `You are the growth engine of a personal mind clone. Your job is to ask the owner`,
      `ONE short, specific question that will add the most valuable missing knowledge to`,
      `their vault. Thin areas of the vault: ${gaps.join('; ') || 'everything — vault is new'}.`,
      `Already asked this session: ${asked.join(' | ') || 'nothing'}.`,
      `Ask about concrete beliefs, experiences, decisions, or expertise — never small talk.`,
      `Reply with the question only.`,
    ].join('\n'),
    messages: [{ role: 'user', content: 'Ask me your next question.' }],
  })
  return content.trim()
}

/**
 * Save an interview answer as a new neuron, linked into the vault, and
 * suggest up to two related existing notes ("See also [[X]]") when
 * retrieve() is confident enough about the match (PLAN.md §4.4). Suggestion
 * lookup is best-effort — it must never stop an answer from being absorbed.
 */
export async function absorbAnswer(question, answer) {
  const title = question.replace(/[?.!]+$/, '').slice(0, 60)
  const priorState = vault.get()

  let seeAlso = ''
  try {
    const related = await retrieve(priorState, answer, 6)
    const seen = new Set()
    const picks = []
    for (const m of related) {
      if (m.score < SEE_ALSO_MIN_SCORE) continue
      if (seen.has(m.noteId)) continue
      seen.add(m.noteId)
      picks.push(m)
      if (picks.length >= SEE_ALSO_MAX) break
    }
    if (picks.length) seeAlso = '\n\n' + picks.map((m) => `See also [[${m.title}]]`).join('\n')
  } catch (err) {
    console.error('[persona] see-also suggestion failed', err)
  }

  const note = vault.createNote(title)
  vault.updateNote(note.id, {
    body: `> ${question}\n\n${answer}\n\n*(absorbed via interview — link this to related notes to strengthen it)*${seeAlso}`,
  })
  return note
}

export { SEE_ALSO_MIN_SCORE }
