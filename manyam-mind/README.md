# Manyam Mind

Build, grow, and transfer your **mind clone**. An original, Obsidian-inspired knowledge app with a living graph, an AI persona grounded in your vault, and a marketplace scaffold for transferring or selling minds.

> Legal note: this is an original codebase inspired by the *concept* of linked-note tools. It contains no Obsidian code, assets, or branding — and yours shouldn't either. Rebrand via `src/styles/theme.css` (brand tokens) and the wordmark in `src/App.jsx`.

## What works today

- **Vault** — markdown notes with `[[wiki-links]]`, autocomplete, click-to-create, read/write modes, full-text search
- **Living graph** — custom force-directed canvas network. Nodes are neurons, links are synapses. Frequently edited/linked notes grow larger and brighter; recent edits pulse; new links fire a traveling spark. Drag, pan, zoom, click to open.
- **Backlinks** — bidirectional connections panel per note
- **Persona** — chat with an AI mind clone grounded in your strongest notes. Retrieval blends keyword search (BM25) with synaptic strength by default, and upgrades to semantic (embedding) search when you opt in; a distilled "Persona Profile" note is auto-maintained from your strongest notes and injected alongside Identity Core; interview mode suggests related notes to link as you grow the vault. By default, chat routes through this mind's server proxy (platform-held keys, metered per account) once you're signed in — your own API key stays local unless you turn on Developer mode in Settings. The persona always identifies itself as a clone and enforces any topics you've told it to refuse.
- **Transfer** — export/import the entire mind as a portable `.mind.json` bundle (secrets stripped). Works fully offline, no account needed.
- **Marketplace** — sign in, list a mind for sale (client-side E2E-encrypted upload), browse and buy other minds, and complete escrowed sales end to end: payment is held by an internal escrow provider (no real money moves — Stripe is on hold by product decision; see PLAN.md §3.3), the content key is delivered sealed to the buyer's device, and the buyer verifies + imports before the sale finalizes. Every transfer's status timeline is visible; disputes/refunds are available within 72h of delivery.
- **Mind API** — publish an owner-approved, privacy-scoped subset of your vault (per-note "Persona access": private/mind/published) as a hosted, queryable endpoint anyone can `POST /minds/:handle/ask` or integrate against — see the [Mind API](#mind-api) section below.

## Run it

```bash
npm install
npm run dev
# open http://localhost:5173
```

Without a Supabase backend configured, the Marketplace tab still works fully offline (export/import a `.mind.json` bundle), and Persona chat works via Developer mode (Settings → your own API key). To enable accounts, listings, escrowed sales, the server LLM proxy, and semantic retrieval, copy `.env.example` to `.env.local` and fill in your Supabase project's URL + anon key, then apply `supabase/migrations/*.sql` and deploy `supabase/functions/*` to that project (see `.env.example` for the Edge Function secrets each of `llm-proxy`/`embed` needs — all platform-held, never a user's own key).

### Privacy note (persona engine v3, PLAN.md §4)

The vault stays end-to-end: nothing here changes that. Two narrow, always
owner-opted-in exceptions exist once a backend is configured:

- **Semantic retrieval** (Settings, default **off**): when on, note chunks
  you've edited are sent *transiently* to an embedding provider (Voyage or
  OpenAI, whichever this deployment configures) to compute a vector; the
  provider doesn't retain the text, the server doesn't log or store it, and
  only the resulting vector is cached — client-side, in this browser's
  IndexedDB. Off by default; falls back to fully offline keyword search
  whenever it's off, unconfigured, or unavailable.
- **Server LLM proxy** (on by default once signed in with a backend
  configured): your question, retrieved memories, and the system prompt
  are sent to this mind's own Supabase project, which relays them to the
  configured frontier model using **platform-held** keys — your own API
  key never leaves this browser unless you explicitly turn on **Developer
  mode**, which calls the provider directly instead and is the only path
  that ever uses your own key.

Owner-defined refusal topics (Settings → "Topics my clone must refuse to
discuss") and the standing self-identification-as-a-clone /
no-impersonation rule are enforced on every reply and cannot be turned off.
Refusal topics are intentionally **not** treated as a secret — they're
exported with the mind bundle so a purchased/imported mind keeps the same
boundaries its seller set.

## Mind API (PLAN.md §5)

Each note has a **Persona access** level, set next to its title in the
Editor: **Private** (default — never leaves this device), **Mind**
(informs a hosted mind's answers, never quoted verbatim), or **Published**
(directly quotable). "Publish my mind" (Marketplace tab → "Mind API" card)
chunks and embeds only the Mind/Published notes, shows an explicit
**"what will be shared" preview by scope** before anything is sent
anywhere, then hosts the result at a queryable endpoint served by
**`services/mind-api/`** — a standalone Node/Express service on
**Railway**, not a Supabase Edge Function (owner decision, 2026-07-08;
marketplace/escrow stay in Edge Functions). See
`services/mind-api/README.md` for its endpoints, environment variables,
and Railway deploy instructions.

From this app's side:

- Set `VITE_MIND_API_URL` (`.env.example`) to the deployed mind-api URL to
  enable the Marketplace tab's publish/unpublish controls, price + free-tier
  + weekly-digest-opt-in fields, and API key creation.
- A hosted mind's public page (`<mind-api-url>/minds/:handle/page`) is a
  small, self-contained HTML page with an "Ask this mind" box and a curl
  example — no app deployment needed to try it.
- Owners who opt into the weekly digest get an email (via Resend, inert
  without `RESEND_API_KEY` — see `supabase/functions/interview-digest/`)
  with 3 questions their mind wants answered; the links land on `#interview`,
  which this app opens straight into an interview turn (`src/App.jsx`).
- Billing is metering + a displayed, owner-set price only for now — Stripe
  metered billing is on hold behind the same provider-stub seam as the
  marketplace's escrow (`services/mind-api/src/billing.js`).

## Take it to production

Open **PLAN.md** — a phase-by-phase build plan written for Claude Opus 4.8 in Claude Code, covering sync + encryption, the embeddings-based persona engine, the paid marketplace with signed ownership transfer, desktop packaging, and security/legal requirements.

## Repo map

```
src/
  App.jsx                 layout, tabs, wordmark
  styles/theme.css        ALL brand tokens (rebrand here)
  lib/store.js            vault store + growth metrics + bundle export
  lib/links.js            wiki-link parser, backlinks, graph builder
  lib/retrieval.js        BM25/semantic hybrid retrieval + knowledge gaps
  lib/embeddings.js       embedding cache (Dexie) + cosine similarity
  lib/persona.js          mind pipeline: safety -> retrieve -> prompt -> cite
  lib/personaProfile.js   auto-maintained "who I am" profile note
  lib/personaSafety.js    refusal pre-filter + always-on safety block
  lib/llm.js              multi-provider adapter: proxy / dev-mode / error
  lib/marketplace.js      listing/buy/sell client logic (E2E-encrypted)
  lib/mindPublish.js      Mind API publish/unpublish pipeline (PLAN.md §5.3)
  lib/auth.js             sign up/in, profile bootstrap, keypair publish
  lib/agreement.js        plain-language transfer agreement (pure fn)
  lib/transferState.js    transfer status state machine (client mirror)
  components/             Sidebar, Editor, GraphView, ContextPanel,
                          PersonaChat, Marketplace, MindApiCard, AuthPanel,
                          Settings
supabase/migrations/      ordered SQL migrations (marketplace, sync, RLS,
                          pgvector + usage metering, minds/api_keys/ask_*)
supabase/functions/       Edge Functions: create-transfer, deliver-key,
                          get-bundle-url, confirm-import, dispute-transfer,
                          delete-account, export-account, llm-proxy, embed,
                          interview-digest (+ _shared/, incl. usage.ts metering)
services/mind-api/        Mind-as-a-Service Node/Express service (Railway) —
                          POST /minds/:handle/ask and friends; see its own
                          README.md
PLAN.md                   production build plan for Claude Code (Opus 4.8)
```
