-- PLAN.md §4.1/§4.3 — semantic retrieval storage + per-user usage metering.
-- Idempotent: every statement is guarded so re-applying this file is a
-- no-op, not an error.

create extension if not exists vector;

-- ---------------------------------------------------------------------
-- mind_chunks: server-side pgvector storage, PROVISIONED for Phase 5, NOT
-- populated by Phase 4. The Phase 4 client (src/lib/embeddings.js) never
-- writes here — it caches vectors client-side in Dexie only. This table
-- exists now so a future server-side retrieval path (PLAN.md §5.1, an
-- owner's hosted "ask this mind" endpoint) has somewhere to read vectors
-- from.
--
-- PRIVACY (honest, per CLAUDE.md): `content` stays NULL in this phase.
-- Phase 5 will populate it ONLY for notes the owner has explicitly scoped
-- 'mind' or 'published' (server-side retrieval needs the literal text to
-- return grounded answers) — everything scoped 'private' (the default)
-- never has its content written here, ever. `embedding` dimension (1024)
-- is a placeholder sized for a mid-size embedding model; Phase 5 should
-- confirm/resize it against whichever provider becomes canonical for
-- server-side embedding before writing real rows (Voyage voyage-3-lite and
-- OpenAI text-embedding-3-small do not share a dimension, and the Phase 4
-- client-side cache — Dexie `vectors`, src/lib/db.js — stores whichever
-- dimension its configured provider returns without this constraint,
-- since it isn't a SQL column).
create table if not exists mind_chunks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  note_id text not null,
  chunk_key text not null,
  scope text not null default 'mind' check (scope in ('private', 'mind', 'published')),
  content text, -- NULL in Phase 4 by design; see privacy note above
  embedding vector(1024),
  updated_at timestamptz not null default now(),
  unique (user_id, chunk_key)
);

create index if not exists mind_chunks_user_id_idx on mind_chunks (user_id);
create index if not exists mind_chunks_embedding_ivfflat
  on mind_chunks using ivfflat (embedding vector_cosine_ops) with (lists = 100);

alter table mind_chunks enable row level security;

drop policy if exists "owner_all_mind_chunks" on mind_chunks;
create policy "owner_all_mind_chunks" on mind_chunks
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------
-- usage_events: per-user metering (PLAN.md §4.1/§4.3) — every llm-proxy and
-- embed call appends one row here via the service-role client
-- (supabase/functions/_shared/usage.ts). Owners can read their own usage;
-- deliberately no client write policy — the same append-only-via-Edge-
-- Function pattern as transfer_events (migration 0004_rls.sql).
-- ---------------------------------------------------------------------
create table if not exists usage_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('llm', 'embed')),
  provider text not null,
  model text not null,
  tokens_in integer not null default 0,
  tokens_out integer not null default 0,
  at timestamptz not null default now()
);

create index if not exists usage_events_user_at_idx on usage_events (user_id, at);

alter table usage_events enable row level security;

drop policy if exists "usage_events_select_own" on usage_events;
create policy "usage_events_select_own" on usage_events
  for select
  to authenticated
  using (user_id = auth.uid());

-- Deliberately no insert/update/delete policy: usage_events is written only
-- by Edge Functions via the service-role key.
