-- Phase 3 §3.4 — Row Level Security policies. RLS was enabled (with no
-- policies) on profiles/listings/transfers/transfer_events back in
-- migration 0001; this migration adds the actual policies. Every `create
-- policy` is preceded by `drop policy if exists` of the same name so this
-- file can be re-applied safely.
--
-- vault_docs already has its owner-only policy from migration 0002 — not
-- touched here.

-- =======================================================================
-- profiles
-- =======================================================================

-- Any authenticated user can see any profile's public handle/display name —
-- these are meant to be public-ish (shown as "seller: <handle>" on
-- listings) the same way a marketplace username is.
drop policy if exists "profiles_select_all_authed" on profiles;
create policy "profiles_select_all_authed" on profiles
  for select
  to authenticated
  using (true);

-- A user may create only their own profile row (id = auth.uid()), and only
-- once — this is the policy that makes client-side profile creation on
-- sign-up (src/lib/auth.js ensureProfile) safe without a service role.
drop policy if exists "profiles_insert_own" on profiles;
create policy "profiles_insert_own" on profiles
  for insert
  to authenticated
  with check (id = auth.uid());

-- A user may update only their own row (handle, display_name, public_key).
drop policy if exists "profiles_update_own" on profiles;
create policy "profiles_update_own" on profiles
  for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- =======================================================================
-- listings
-- =======================================================================

-- Anyone authenticated can browse active listings; a seller can always see
-- their own listings regardless of status (sold/withdrawn included), for
-- the "My listings" tab.
drop policy if exists "listings_select_active_or_own" on listings;
create policy "listings_select_active_or_own" on listings
  for select
  to authenticated
  using (status = 'active' or seller_id = auth.uid());

-- A seller may only create listings under their own seller_id.
drop policy if exists "listings_insert_own" on listings;
create policy "listings_insert_own" on listings
  for insert
  to authenticated
  with check (seller_id = auth.uid());

-- A seller may update their own listing (price, description, status —
-- e.g. withdrawing it) ONLY while it is not already sold. Once a listing
-- flips to 'sold' (done server-side, by create-transfer, for exclusive-mode
-- sales) the `using` clause makes it read-only to the client from then on —
-- price/status can no longer change out from under a completed sale.
drop policy if exists "listings_update_own_unsold" on listings;
create policy "listings_update_own_unsold" on listings
  for update
  to authenticated
  using (seller_id = auth.uid() and status <> 'sold')
  with check (seller_id = auth.uid());

-- A seller may delete their own listing while it hasn't sold (a sold
-- listing is part of the historical record via transfers.listing_snapshot;
-- FK on delete set null (migration 0003) keeps that ledger intact even if
-- it is later removed by GDPR erasure).
drop policy if exists "listings_delete_own_unsold" on listings;
create policy "listings_delete_own_unsold" on listings
  for delete
  to authenticated
  using (seller_id = auth.uid() and status <> 'sold');

-- =======================================================================
-- transfers
-- =======================================================================

-- A user sees only transfers where they are the buyer or the seller.
drop policy if exists "transfers_select_participant" on transfers;
create policy "transfers_select_participant" on transfers
  for select
  to authenticated
  using (buyer_id = auth.uid() or seller_id = auth.uid());

-- Deliberately NO insert/update/delete policy for `authenticated`: every
-- transfer state change (create-transfer, deliver-key, confirm-import,
-- dispute-transfer) happens exclusively inside an Edge Function using the
-- service-role key, which bypasses RLS entirely. With RLS enabled and no
-- write policy, ordinary client writes to this table are denied outright —
-- that absence of a policy IS the security control here.

-- =======================================================================
-- transfer_events
-- =======================================================================

-- A user may read the event timeline only for transfers they're a party
-- to (buyer or seller) — resolved via the parent transfer row.
drop policy if exists "transfer_events_select_participant" on transfer_events;
create policy "transfer_events_select_participant" on transfer_events
  for select
  to authenticated
  using (
    exists (
      select 1 from transfers t
      where t.id = transfer_events.transfer_id
        and (t.buyer_id = auth.uid() or t.seller_id = auth.uid())
    )
  );

-- Deliberately NO insert/update/delete policy: transfer_events is an
-- append-only ledger written exclusively by Edge Functions via the
-- service-role key (supabase/functions/_shared/events.ts appendEvent).
