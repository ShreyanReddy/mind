# CLAUDE.md — project instructions for Claude Code

## What this is
Prayan (formerly Manyam Mind): a knowledge app where a person builds a "mind clone" (linked-note
vault + AI persona grounded in it), watches it grow as a living graph, and can
transfer or sell the mind. The MVP works; PLAN.md is the production roadmap.

## Ground rules (never violate)
- Original code only. Never copy code, assets, icons, fonts, or trade dress
  from Obsidian or any other product. The look is "familiar dark workspace,"
  built from our own tokens in `src/styles/theme.css`.
- Never store or transmit user LLM API keys server-side. Never include secrets
  in exported mind bundles — `store.js exportBundle()` strips them; keep that
  invariant covered by a test at all times.
- Once E2E encryption lands (PLAN.md §1.3), the server must never hold
  plaintext vault content. Don't add features that break this.
- Every marketplace state change goes through a webhook-verified Edge Function
  and is appended to `transfer_events`.
- The persona always self-identifies as a clone and respects owner-defined
  refusal topics.

## How to work
- Follow PLAN.md phase by phase, in order. Do not skip ahead or blend phases.
- After each phase: `npm run build`, run tests, commit with a descriptive
  message, append a CHANGELOG.md entry, then STOP and summarize before starting
  the next phase.
- Preserve existing module interfaces (`store.js`, `links.js`, `retrieval.js`,
  `llm.js`, `persona.js`, `marketplace.js`) — upgrade internals in place.
- Prefer boring, proven dependencies. Ask before adding anything heavy.
- All brand values live in the token block at the top of
  `src/styles/theme.css`. Never hardcode colors in components.

## Commands
- `npm run dev` — local dev server (Vite, port 5173)
- `npm run build` — must pass before any commit
- Tests: Vitest once Phase 0 lands (`npm test`)

## Repo map
- `src/lib/store.js` — vault store, growth metrics, bundle export/import
- `src/lib/links.js` — wiki-link parser, backlinks, graph model
- `src/lib/retrieval.js` — BM25 retrieval + knowledge-gap detection
- `src/lib/llm.js` — multi-provider adapter (Anthropic/OpenAI/Gemini)
- `src/lib/persona.js` — mind pipeline: retrieve → identity core → cite
- `src/lib/marketplace.js` — transfer/sale logic (local live, remote stubbed)
- `src/components/` — Sidebar, Editor, GraphView, ContextPanel, PersonaChat,
  Marketplace, Settings
- `supabase/migrations/` — ordered SQL migrations (`0001_marketplace.sql`,
  `0002_sync.sql`); `supabase/schema.sql` is now a pointer to these
- `PLAN.md` — the production build plan (the source of truth for scope)
