-- Sync engine schema (PLAN.md §1.2) — one row per queued Yjs CRDT update,
-- per note, per device. `update` and `nonce` are base64 ciphertext produced
-- client-side by src/lib/crypto.js (XChaCha20-Poly1305, key derived from the
-- owner's passphrase via Argon2id, src/lib/crypto.js deriveVaultKey). The
-- server stores and relays opaque bytes only — per CLAUDE.md, it must never
-- be able to read vault content once E2E encryption (PLAN.md §1.3) is in
-- place, and this table holds nothing else.

create table if not exists vault_docs (
  id bigint generated always as identity primary key,
  note_id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  update text not null, -- base64 ciphertext of a Yjs update (Y.encodeStateAsUpdate)
  nonce text not null,  -- base64 XChaCha20-Poly1305 nonce for this update
  clock bigint not null, -- client-side logical/wall clock, for ordering & dedup
  created_at timestamptz default now()
);

create index if not exists vault_docs_note_id_idx on vault_docs (note_id);
create index if not exists vault_docs_user_id_idx on vault_docs (user_id);
create index if not exists vault_docs_user_note_clock_idx on vault_docs (user_id, note_id, clock);

alter table vault_docs enable row level security;

-- Owner-only: a user can read/write only their own queued updates. Realtime
-- broadcast for live multi-device merge happens on channel `vault:<user_id>`
-- (src/lib/sync.js subscribeRealtime), which Supabase Realtime authorizes
-- against this same RLS policy.
create policy "owner_all_vault_docs" on vault_docs
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
