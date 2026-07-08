# mind-api

Manyam Mind's **Mind-as-a-Service** endpoint (PLAN.md Phase 5) — a small
Node/Express service, deployed on **Railway** (owner decision, 2026-07-08;
not a Supabase Edge Function — those stay reserved for marketplace/escrow).
Each published mind becomes a hosted, queryable model at
`POST /minds/:handle/ask`, backed by the same privacy-scoped, server-side
retrieval pipeline described in `manyam-mind/PLAN.md` §5.

The server never holds plaintext PRIVATE vault content — it only ever reads
`mind_chunks` rows the owner explicitly published as scope `mind` or
`published` from the main app's Editor (see
`manyam-mind/src/lib/mindPublish.js`).

## Endpoints

| Method & path                | Auth                        | Purpose |
|-------------------------------|------------------------------|---------|
| `GET /healthz`                 | none                         | `{ ok: true }` — Railway healthcheck |
| `GET /minds/:handle`           | none                         | Public profile JSON (from the `public_minds` view). 404 if unpublished. |
| `GET /minds/:handle/page`      | none                         | Self-contained HTML public profile page (bio, stats, sample questions, an "Ask this mind" box, a curl example). |
| `POST /minds/:handle/ask`      | none, or `Bearer <api-key>`  | Ask the mind a question. Free tier without a key (`minds.free_queries_per_day`); metered and unlimited by tier with a valid key. |
| `POST /keys`                   | `Bearer <supabase-jwt>`      | Create an API key for the caller's own published mind. Returns the key **once**. |
| `DELETE /keys/:id`             | `Bearer <supabase-jwt>`      | Revoke a key the caller owns. |

## Environment variables

| Var | Required | Purpose |
|---|---|---|
| `SUPABASE_URL` | yes | The main app's Supabase project URL. |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | Service-role key — bypasses RLS by design (see `src/supabaseClient.js`). Never log or expose this. |
| `ANTHROPIC_API_KEY` | one of the three | Platform-held key for the Anthropic provider. |
| `OPENAI_API_KEY` | one of the three | Platform-held key for the OpenAI provider; also usable as the query-embedding fallback (see `src/providers.js`). |
| `GEMINI_API_KEY` | one of the three | Platform-held key for the Gemini provider. |
| `VOYAGE_API_KEY` | optional | Preferred query-embedding provider (mirrors `supabase/functions/embed`). Without this or `OPENAI_API_KEY`, retrieval falls back to lexical (BM25) scoring only. |
| `RESEND_API_KEY` | optional | Enables the weekly interview-digest email (sent by the Edge Function `supabase/functions/interview-digest`, not this service) — inert without it. |
| `MAIL_FROM` | optional | From-address for the digest email. |
| `MIND_API_PUBLIC_URL` | optional | This service's own public URL, used to render the curl example on `/minds/:handle/page`. |
| `BILLING_PROVIDER` | optional | Defaults to internal (no real billing). `stripe` selects a stub that throws — see `src/billing.js`; do not set this to `stripe` yet. |
| `PORT` | optional | Defaults to `8787`. |

At least one of the three LLM provider keys must be set for `/ask` to
produce answers; the mind's `preferred_provider` (set at publish time) is
tried first, then the rest of the configured providers in order
(`src/providers.js` — PLAN.md §5.2's fallback router).

## Local development

```bash
npm install
npm run dev     # node --watch src/index.js
npm test        # vitest + supertest, mocked supabase/fetch throughout
```

## Deploying (Railway)

1. Create a new Railway service pointed at this directory
   (`services/mind-api/`) — Railway will use `railway.json` + `Dockerfile`.
2. Set the environment variables above in the Railway project settings.
3. Railway builds the Docker image, runs `npm start`, and polls
   `GET /healthz` per `railway.json`'s `healthcheckPath`.
4. Point the main app's `VITE_MIND_API_URL` env var at the deployed
   service's URL so the Marketplace tab's "Mind API" card can link to it.

## Design notes

- **Abuse limits** (`src/rateLimit.js`): an in-memory token bucket per IP
  and per API key. This is a **single-instance** limiter — it resets on
  restart and doesn't coordinate across horizontally-scaled Railway
  replicas. The documented upgrade path, once this service runs more than
  one instance, is a Redis-backed bucket (e.g. `ioredis` + an atomic
  `INCR`/`EXPIRE` Lua script) keyed the same way.
- **Caching** (`src/cache.js`): identical `(mind_handle, mind_version,
  normalized question)` triples hit `ask_cache` — a republish bumps
  `minds.current_version`, which naturally invalidates the cache for that
  mind without an explicit purge step.
- **Billing** (`src/billing.js`): Stripe metered billing is on hold, same
  as the main app's marketplace escrow. `InternalBillingStub` records what
  *would* have been billed (for honest usage displays) without moving
  money; `PLATFORM_FEE_BPS` documents the eventual platform take rate.
- **Safety** (`src/persona.js`): every answer runs through
  `checkRefusal` (server-side, from `minds.refusal_topics`) before any
  retrieval or provider call, and every system prompt includes the
  always-on safety block (clone self-identification, no
  impersonation-for-fraud). `stripVerbatimQuotes` is a mechanical second
  line of defense against a 'mind'-scoped chunk being quoted verbatim,
  independent of the model actually following the prompt's instruction.
