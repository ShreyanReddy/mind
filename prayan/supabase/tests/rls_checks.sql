-- RLS smoke checks for migrations 0003/0004 — PLAN.md §3.4.
--
-- Not a full pgTAP suite (no new test-runner dependency); this is a set of
-- commented psql-style assertions the orchestrator can run one block at a
-- time via execute_sql against a scratch project/branch, reading each
-- SELECT's result against the "expect:" comment above it. Each block sets
-- the Postgres session to simulate a specific authenticated user via
-- `set local role authenticated; set local request.jwt.claims = ...` (the
-- same mechanism Supabase's PostgREST/Realtime layer uses), so these run
-- against the real RLS policies, not a mock.
--
-- Fixtures: two users, A (seller) and B (buyer), one active listing owned
-- by A, one transfer between them. Wrap each scenario in its own
-- transaction and roll back so this file is safe to run repeatedly and
-- leaves no fixture data behind.
--
-- Caveat (no live DB access while authoring this file): `auth.users`' full
-- column set varies slightly by Supabase/GoTrue version. If the minimal
-- insert below fails on a NOT NULL column with no default, run
-- `select column_name, is_nullable, column_default from
-- information_schema.columns where table_schema='auth' and
-- table_name='users'` first and extend the insert with whatever else that
-- project's schema requires (e.g. `instance_id`, `aud`, `role`).

begin;

-- ---- fixtures --------------------------------------------------------
-- Two auth.users rows (minimal columns) + matching profiles.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'seller@example.test'),
  ('00000000-0000-0000-0000-00000000000b', 'buyer@example.test')
on conflict (id) do nothing;

insert into profiles (id, handle, display_name, public_key) values
  ('00000000-0000-0000-0000-00000000000a', 'seller_a', 'Seller A', 'pubkey-a'),
  ('00000000-0000-0000-0000-00000000000b', 'buyer_b', 'Buyer B', 'pubkey-b')
on conflict (id) do nothing;

insert into listings (id, seller_id, title, description, price_cents, bundle_path, bundle_hash, note_count, link_count, mode, status)
values ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a',
        'Test Mind', 'a listing for RLS checks', 500,
        '00000000-0000-0000-0000-00000000000a/10000000-0000-0000-0000-000000000001.mind.enc',
        'deadbeef', 3, 2, 'license', 'active')
on conflict (id) do nothing;

insert into transfers (id, listing_id, seller_id, buyer_id, price_cents, payment_ref, status)
values ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b',
        500, 'int_test', 'escrowed')
on conflict (id) do nothing;

-- ---- profiles ----------------------------------------------------------

-- expect: 2 rows (any authenticated user can see all profiles' public handles)
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000b"}';
select count(*) as expect_2_visible_profiles from profiles
where id in ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b');

-- expect: 0 rows affected / error (B cannot insert a profile row for A)
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000b"}';
select (
  exists(select 1) -- placeholder guard; real assertion is the statement below raising/returning 0 rows
) as note_run_the_insert_below_and_expect_a_permission_error;
-- Run and expect a policy violation:
--   insert into profiles (id, handle) values ('00000000-0000-0000-0000-00000000000a', 'hijack');

-- ---- listings ------------------------------------------------------------

-- expect: 1 row (B, a non-owner, sees the active listing)
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000b"}';
select count(*) as expect_1_active_listing_visible_to_buyer from listings
where id = '10000000-0000-0000-0000-000000000001';

-- expect: 0 rows updated (B cannot update A's listing)
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000b"}';
with attempt as (
  update listings set price_cents = 1 where id = '10000000-0000-0000-0000-000000000001' returning id
)
select count(*) as expect_0_rows_updated_by_non_owner from attempt;

-- expect: 1 row updated (A, the owner, can update their own unsold listing)
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000a"}';
with attempt as (
  update listings set description = 'updated by owner' where id = '10000000-0000-0000-0000-000000000001' returning id
)
select count(*) as expect_1_row_updated_by_owner from attempt;

-- ---- transfers -------------------------------------------------------

-- expect: 1 row (buyer B sees their own transfer)
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000b"}';
select count(*) as expect_1_transfer_visible_to_buyer from transfers
where id = '20000000-0000-0000-0000-000000000001';

-- expect: 1 row (seller A sees the same transfer)
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000a"}';
select count(*) as expect_1_transfer_visible_to_seller from transfers
where id = '20000000-0000-0000-0000-000000000001';

-- expect: 0 rows (a third party sees nothing)
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-000000000c"}';
select count(*) as expect_0_transfers_visible_to_stranger from transfers
where id = '20000000-0000-0000-0000-000000000001';

-- expect: 0 rows updated (no client-side write policy exists — service role only)
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000b"}';
with attempt as (
  update transfers set status = 'completed' where id = '20000000-0000-0000-0000-000000000001' returning id
)
select count(*) as expect_0_rows_updated_by_client from attempt;

-- ---- transfer_events ---------------------------------------------------

-- expect: 0 rows initially (none inserted by this fixture); insert one as
-- service role (bypasses RLS, as the real Edge Functions do), then confirm
-- participants can read it and strangers cannot.
reset role;
insert into transfer_events (transfer_id, event, meta)
values ('20000000-0000-0000-0000-000000000001', 'transfer.created', '{}');

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000b"}';
select count(*) as expect_1_event_visible_to_participant from transfer_events
where transfer_id = '20000000-0000-0000-0000-000000000001';

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-000000000c"}';
select count(*) as expect_0_events_visible_to_stranger from transfer_events
where transfer_id = '20000000-0000-0000-0000-000000000001';

-- expect: 0 rows inserted (clients cannot write events directly)
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000b"}';
-- Run and expect a policy violation (no insert policy exists for this role):
--   insert into transfer_events (transfer_id, event) values ('20000000-0000-0000-0000-000000000001', 'forged');

rollback;
