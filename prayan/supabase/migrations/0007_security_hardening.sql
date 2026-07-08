-- 0007_security_hardening.sql — Phase 6.4 security review follow-ups.
--
-- Supabase security advisor (2026-07-08) flagged exactly one finding on this
-- project: `extension_in_public` — the `vector` extension (installed by
-- 0005_pgvector.sql) lives in the public schema, where its functions/types
-- are exposed through the default search_path. Move it to the conventional
-- `extensions` schema. Type references (mind_chunks.embedding) follow the
-- extension automatically; nothing in this codebase uses schema-qualified
-- vector operators in SQL (the mind-api service scores cosine similarity in
-- JS), so no query changes are needed.
--
-- Idempotent: safe to re-apply.

create schema if not exists extensions;

grant usage on schema extensions to postgres, anon, authenticated, service_role;

do $$
begin
  if exists (
    select 1
    from pg_extension e
    join pg_namespace n on e.extnamespace = n.oid
    where e.extname = 'vector' and n.nspname = 'public'
  ) then
    alter extension vector set schema extensions;
  end if;
end
$$;
