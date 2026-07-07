// Persona engine v2 — your mind as a queryable model.
//
// Pipeline per question:
//   1. Retrieve relevant memories (BM25 + synaptic strength, ./retrieval.js)
//   2. Assemble: Identity Core + retrieved memories + conversation
//   3. Route to any frontier model (./llm.js) — the LLM reasons,
//      the vault makes it *you*
//   4. Parse [[citations]] back out so the UI can link to source notes
//
// Interview mode inverts the flow: the mind studies its own gaps and asks
// the owner questions; every answer becomes a new neuron in the vault.

import { chat } from './llm.js'
import { retrieve, knowledgeGaps } from './retrieval.js'
import { vault } from './store.js'

export const IDENTITY_TITLE = 'Identity Core'

function identityCore(state) {
  const core = state.notes.find(
    (n) => n.title.trim().toLowerCase() === IDENTITY_TITLE.toLowerCase()
  )
  return core ? core.body : ''
}

function llmConfig(state) {
  const p = state.persona
  return {
    provider: p.provider || 'anthropic',
    model: p.model || 'claude-sonnet-4-6',
    apiKey: (p.keys || {})[p.provider || 'anthropic'] || p.apiKey || '',
  }
}

export function buildSystemPrompt(state, memories) {
  const p = state.persona
  const memBlock = memories
    .map((m) => `[[${m.title}]]\n${m.text}`)
    .join('\n\n---\n\n')
  return [
    `You are "${p.name}", a mind clone: a personal model built from one person's knowledge vault.`,
    `Voice: ${p.voice}. Answer as the owner would — their views, their reasoning, their style.`,
    `Ground every claim in the MEMORIES below. When you draw on a memory, cite it inline`,
    `exactly as [[Note Title]]. If the memories don't cover the question, say so honestly`,
    `and answer from general knowledge only if clearly labeled as such.`,
    `You are a clone, not the real person — never claim otherwise.`,
    '',
    identityCore(state) ? `=== IDENTITY CORE ===\n${identityCore(state)}\n` : '',
    `=== RETRIEVED MEMORIES ===\n${memBlock || '(vault is empty on this topic)'}`,
  ].join('\n')
}

/** Ask the mind a question. Returns { content, sources: [{noteId,title}] } */
export async function askPersona(state, history) {
  const lastUser = [...history].reverse().find((m) => m.role === 'user')
  const memories = retrieve(state, lastUser?.content || '', 6)

  const content = await chat({
    ...llmConfig(state),
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
    ...llmConfig(state),
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

/** Save an interview answer as a new neuron, linked into the vault. */
export function absorbAnswer(question, answer) {
  const title = question.replace(/[?.!]+$/, '').slice(0, 60)
  const note = vault.createNote(title)
  vault.updateNote(note.id, {
    body: `> ${question}\n\n${answer}\n\n*(absorbed via interview — link this to related notes to strengthen it)*`,
  })
  return note
}
