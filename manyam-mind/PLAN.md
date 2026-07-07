# PLAN.md — Production Build Plan for Claude Opus 4.8 (Claude Code)

You are taking the Manyam Mind MVP in this repo to production. Read the whole repo first (`README.md`, `src/`, `supabase/schema.sql`). Preserve the existing component APIs where possible; the MVP was designed so each subsystem can be upgraded in place.

Product definition: a knowledge app where a person builds a "mind clone" (a linked-note vault plus an AI persona grounded in it), watches it grow as a living graph, and can transfer or sell the whole mind to another user. Original codebase; must not copy code, assets, or branding from any existing product.

Work in the phase order below. After each phase: run the app, run tests, commit with a descriptive message, and write a short CHANGELOG entry.

---

## Phase 0 — Foundation & hygiene (½ day)

0.1 Convert to TypeScript incrementally (`allowJs: true`), strictest settings on new files.
0.2 Add Vitest + React Testing Library. First tests: `links.js` parser (wiki-links with/without labels, self-links, missing targets) and `store.js` (export strips `apiKey`; import round-trips).
0.3 Add ESLint + Prettier, a CI workflow (lint, test, build), and error boundaries around each pane.
0.4 Extract the brand tokens into `src/styles/brand.css` and document the rebrand procedure; brand is **Manyam Mind** — keep tokens centralized.

## Phase 1 — Vault hardening (2–3 days)

1.1 Replace the localStorage store with a layered persistence engine:
    - IndexedDB local store (Dexie) as source of truth
    - Optional File System Access API "folder vault" mode: notes as real `.md` files on disk (the local-first, user-owns-their-files promise)
    - Debounced autosave, undo/redo history per note
1.2 Sync: Supabase Realtime + Yjs CRDT per note for multi-device editing. Conflict-free merges; offline queue.
1.3 End-to-end encryption for synced vaults: per-vault key derived from a passphrase (Argon2id), XChaCha20-Poly1305 via libsodium. The server must never be able to read a vault.
1.4 Vault features that go beyond the MVP: folders/tags, daily notes, templates, note aliases, unlinked-mention detection (surface plain-text occurrences of note titles as suggested links), and a command palette (Ctrl/Cmd-K) covering every action.
1.5 Scale test: 5,000 notes / 20,000 links. Index links incrementally instead of reparsing the whole vault (maintain the link index in `store` on each edit).

## Phase 2 — The living graph, production grade (2 days)

2.1 Swap the O(n²) repulsion for Barnes-Hut (quadtree) so 5k nodes stays 60fps; move the simulation into a Web Worker, render via OffscreenCanvas where supported.
2.2 Growth semantics (this is the product's soul — get it right):
    - Node mass = f(edit count, degree, recency-decayed activity)
    - Edge weight = repeated-link count × co-edit frequency
    - "Consolidation" pass (nightly or on idle): edges unused for 90 days thin visually but never break — old memories fade, they don't die
2.3 Interactions: local graph view (2-hop neighborhood of the active note), time-lapse replay ("watch your mind grow" scrubber built from the activity log), search-to-highlight, cluster coloring by tag/folder.
2.4 Accessibility: keyboard navigation of nodes, reduced-motion mode renders a static layout.

## Phase 3 — Marketplace: transfer & sale (3–4 days)

3.1 Auth: Supabase Auth (email + OAuth). Profiles per `supabase/schema.sql`.
3.2 Listings: seller encrypts the bundle client-side with a random content key; uploads ciphertext to Supabase Storage; stores pointer + SHA-256 hash in `listings`. Listing preview = seller-approved excerpt only (title, description, stats: note count, link count — never note content).
3.3 Payments: Stripe Connect (destination charges) with manual capture as escrow:
    - buyer pays → PaymentIntent authorized → status `escrowed`
    - content key is wrapped to the buyer's public key (X25519) and delivered → `delivered`
    - buyer confirms import (hash check passes) → capture payment → `completed`
    - dispute window with refund path → `refunded`/`disputed`
    All transitions via Supabase Edge Functions verified by Stripe webhooks; append every step to `transfer_events`.
3.4 Row Level Security: sellers see own listings; buyers see active listings and their own transfers; `transfer_events` insert-only via Edge Functions. Write and test the policies.
3.5 Exclusive-transfer mode: on `completed`, the seller's synced copy is revoked (server key material deleted; client prompts local deletion). Be honest in the UI: local exports made earlier can't be technically revoked — the sale contract governs that. Also support non-exclusive "license a copy" mode.
3.6 Legal/consent: listing flow requires explicit confirmation that the vault contains no third parties' personal data and that the seller owns the content; generate a plain-language transfer agreement per sale; GDPR export + erasure endpoints.

## Phase 4 — Persona engine v3 (3 days)

The repo already ships v2: multi-provider adapter (`src/lib/llm.js`), in-browser
BM25 retrieval blended with synaptic strength (`src/lib/retrieval.js`), inline
[[citations]] resolved to clickable sources, Identity Core injection, and
interview mode where answers become neurons (`src/lib/persona.js`). Build on it:

4.1 Retrieval: embed notes (chunked ~500 tokens) with Voyage or an open model; store vectors in pgvector; retrieve top-k by query similarity blended with synaptic strength (`score = 0.6·cosine + 0.4·normalized_strength`).
4.2 Persona profile: a distilled "who I am" document auto-maintained from the vault (values, voice, decision heuristics), regenerated on idle when the vault changes materially; owner can review/edit it. Inject profile + retrieved chunks into the system prompt.
4.3 Move all Anthropic API calls behind a server proxy (Edge Function) with per-user metering; remove the in-browser key path (keep it only behind a "developer mode" flag).
4.4 Persona features: cite which notes an answer came from (click to open), "interview me" mode where the persona asks the owner questions to fill gaps in the vault (each answer becomes a note — the mind grows through conversation), and a buyer-facing chat for imported minds.
4.5 Safety rails: persona must state it is a clone, refuse to impersonate the owner for fraud (e.g., messages to third parties claiming to be the real person), and respect a seller-defined excluded-topics list baked into the bundle.

## Phase 5 — Mind-as-a-Service: each mind is its own LLM endpoint (3 days)

This is the product's headline: a person's mind becomes a hosted, queryable model
that *other people* can use — like a personal LLM with the owner's knowledge and
voice, powered underneath by generic frontier APIs.

5.1 Hosted endpoint per mind: `POST /minds/:handle/ask` (Supabase Edge Function).
    Runs the same pipeline as the client persona (retrieve → identity core →
    provider router → cited answer) against the owner's E2E-decrypted-server-side-
    never vault: retrieval runs on an owner-approved, selectively-published subset
    (see 5.3). Response includes cited note titles (never raw note bodies unless
    the note is published).
5.2 Provider router with fallback + caching: route by owner preference
    (Anthropic/OpenAI/Gemini), fall back on provider errors, cache identical
    (mind_version, question) pairs. Meter tokens per query.
5.3 Privacy scopes per note: `private` (owner only — default), `mind` (used for
    retrieval, never quoted verbatim), `published` (quotable). Scope picker in the
    editor; the publish pipeline builds a scoped index per mind version.
5.4 Monetization: free tier (n queries/day), per-query or subscription pricing via
    Stripe metered billing; owner sets the price; platform takes a fee. Public
    profile page per mind: bio, stats (neurons/synapses), sample questions,
    "Ask this mind" chat, and API keys for programmatic access — a person's mind
    literally becomes an API others integrate.
5.5 Quality & safety: eval harness that scores answers for grounding (are claims
    traceable to cited notes?) and voice-match (owner rates sample answers);
    abuse limits; the mind always self-identifies as a clone; owner-defined
    refusal topics enforced server-side.
5.6 Interview-driven growth loop, hosted: weekly email/push with 3 questions the
    mind wants answered (gap detection from `retrieval.knowledgeGaps`), one-tap
    answer → new neuron → mind version bump.

## Phase 6 — Ship (2 days)

6.1 Desktop: package with Tauri (uses the folder-vault mode from 1.1). Mobile-responsive web as interim mobile story.
6.2 Onboarding: first-run tour that has the user create three notes and one link, then reveals the graph animating — the aha moment.
6.3 Observability (privacy-safe: event counts only, never content), Sentry for errors, Playwright e2e for the critical paths (create/link/graph, export/import, list/buy/transfer).
6.4 Security review checklist: RLS audit, key-handling audit, dependency scan, rate limits on Edge Functions.
6.5 Deploy: Vercel/Netlify for the app, Supabase project per environment, Stripe test→live checklist.

---

## Constraints (do not violate)

- No code, assets, fonts, icons, or trade dress copied from Obsidian or any other product. Original everything.
- Never store or transmit a user's Anthropic key server-side; never include secrets in mind bundles (the exporter already strips them — keep that invariant tested).
- The server must never hold plaintext vault content once Phase 1.3 lands.
- Every marketplace state change must be webhook-verified and event-logged.

## Definition of done

A new user can: sign up → build a vault → watch the graph grow → talk to their persona → list the mind → a second user buys it via Stripe test mode → escrow completes → the buyer imports and chats with the purchased mind → all e2e tests green.
