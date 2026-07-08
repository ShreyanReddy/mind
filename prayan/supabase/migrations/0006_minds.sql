-- Phase 5 — Mind-as-a-Service (PLAN.md §5, as amended 2026-07-08). Adds the
-- server-side schema for a published, hosted "ask this mind" endpoint,
-- served by the Node service in services/mind-api/ (NOT an Edge Function —
-- owner decision 2026-07-08; only marketplace/escrow stays in Edge
-- Functions). Idempotent: every statement is guarded so re-applying this
-- file against a database it's already been run against is a no-op.
--
-- PRIVACY (per CLAUDE.md): the server never holds plaintext PRIVATE vault
-- content. `mind_chunks.content` (already provisioned NULL-by-default in
-- migration 0005_pgvector.sql) is populated by the CLIENT publish pipeline
-- (src/lib/mindPublish.js) ONLY for notes the owner explicitly scoped
-- 'mind' or 'published' — never 'private' (the default scope for every
-- note). The mind-api service reads mind_chunks with the service-role key
-- (bypasses RLS by design, same pattern as every marketplace Edge
-- Function) and answers only from this owner-approved subset.

-- ---------------------------------------------------------------------
-- mind_chunks: add the columns Phase 5's publish pipeline needs beyond
-- what Phase 4 provisioned. `title` is the source note's title (for
-- [[citation]] display); `version` stamps which `minds.current_version`
-- this chunk belongs to — a republish deletes the old rows and inserts
-- fresh ones under the bumped version (src/lib/mindPublish.js), so the
-- unique constraint below never needs to hold multiple versions of the
-- same chunk_key at once.
-- ---------------------------------------------------------------------
alter table mind_chunks add column if not exists title text;
alter table mind_chunks add column if not exists version integer not null default 0;

create index if not exists mind_chunks_user_version_idx on mind_chunks (user_id, version);

-- ---------------------------------------------------------------------
-- minds: one row per owner who has ever published. `handle` is
-- denormalized from profiles.handle (kept in sync by mindPublish.js on
-- every publish) so the mind-api service can resolve a mind by handle
-- with a single indexed lookup, without joining profiles. `refusal_topics`
-- is deliberately NOT exposed by `public_minds` below — it's read
-- server-side (service role) by /ask, never shown to the public.
-- ---------------------------------------------------------------------
create table if not exists minds (
  user_id uuid primary key references profiles(id) on delete cascade,
  handle text unique not null,
  bio text default '',
  note_count integer not null default 0,
  link_count integer not null default 0,
  sample_questions jsonb not null default '[]',
  refusal_topics jsonb not null default '[]',
  preferred_provider text not null default 'anthropic' check (preferred_provider in ('anthropic', 'openai', 'gemini')),
  price_per_query_cents integer not null default 0 check (price_per_query_cents >= 0),
  free_queries_per_day integer not null default 25 check (free_queries_per_day >= 0),
  current_version integer not null default 0,
  published boolean not null default false,
  published_at timestamptz,
  voice_rating jsonb not null default '{}', -- PLAN.md §5.5 — owner's star ratings of sample answers, keyed by question
  digest_opt_in boolean not null default false, -- PLAN.md §5.6
  gap_titles jsonb not null default '[]', -- PLAN.md §5.6 — computed client-side at publish time
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table minds enable row level security;

-- Owner-only read/write of the full row (including refusal_topics,
-- voice_rating). Public read of the safe subset goes through the
-- `public_minds` view below, NOT a policy on this table.
drop policy if exists "owner_all_minds" on minds;
create policy "owner_all_minds" on minds
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------
-- public_minds: the ONLY way an anonymous/other-user caller ever reads
-- from `minds`. A plain (non-security-invoker) view runs its underlying
-- table access with the view owner's privileges, not the querying role's
-- — the same pattern Supabase docs recommend for "public window into an
-- RLS table" — so granting SELECT on the view to anon/authenticated is
-- sufficient without adding an RLS policy that would otherwise expose the
-- base table. Deliberately excludes refusal_topics and voice_rating.
-- ---------------------------------------------------------------------
drop view if exists public_minds;
create view public_minds as
  select
    handle,
    bio,
    note_count,
    link_count,
    sample_questions,
    price_per_query_cents,
    free_queries_per_day,
    current_version,
    published_at
  from minds
  where published = true;

grant select on public_minds to anon, authenticated;

-- ---------------------------------------------------------------------
-- api_keys: programmatic access to a published mind, metered per key.
-- Only the sha-256 hash is ever stored (mind-api's POST /keys shows the
-- plaintext key exactly once, at creation, then never again — same
-- "shown once" discipline as any API-key product).
-- ---------------------------------------------------------------------
create table if not exists api_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  mind_handle text not null,
  key_hash text not null unique,
  key_prefix text not null,
  label text default '',
  usage_count integer not null default 0,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create index if not exists api_keys_user_id_idx on api_keys (user_id);
create index if not exists api_keys_key_hash_idx on api_keys (key_hash);

alter table api_keys enable row level security;

drop policy if exists "owner_all_api_keys" on api_keys;
create policy "owner_all_api_keys" on api_keys
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------
-- ask_cache / ask_usage: written and read exclusively by mind-api via the
-- service-role key (same append/upsert-via-service-role-only pattern as
-- transfer_events / usage_events elsewhere in this schema) — RLS enabled,
-- deliberately NO policies, so ordinary client access is denied outright.
-- ---------------------------------------------------------------------
create table if not exists ask_cache (
  mind_handle text not null,
  version integer not null,
  question_hash text not null,
  answer jsonb not null,
  created_at timestamptz not null default now(),
  primary key (mind_handle, version, question_hash)
);

alter table ask_cache enable row level security;

create table if not exists ask_usage (
  id bigint generated always as identity primary key,
  mind_handle text not null,
  day date not null,
  count integer not null default 0,
  unique (mind_handle, day)
);

alter table ask_usage enable row level security;
