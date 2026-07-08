-- Phase 3 — E2E-encrypted listings, escrow-ready transfers (PLAN.md §3,
-- as amended 2026-07-08: Stripe is on hold; escrow runs on an internal,
-- no-real-money provider behind a provider interface — see
-- supabase/functions/_shared/payments.ts. `payment_ref` is a generic column
-- any provider (internal today, Stripe later) can populate; it replaces
-- the Stripe-specific `stripe_payment_intent` column from migration 0001.
--
-- Idempotent: every statement is guarded so re-running this file against a
-- database it has already been applied to is a no-op, not an error.

-- ---------------------------------------------------------------------
-- profiles: publish an X25519 public key (crypto.js generateKeyPair) so
-- buyers/sellers can seal content keys to each other without the server
-- ever touching key material in a form it could misuse.
-- ---------------------------------------------------------------------
alter table profiles add column if not exists public_key text;

-- ---------------------------------------------------------------------
-- listings: drop the MVP plaintext `bundle` column for good (production
-- listings store only a Storage pointer + hash of the ciphertext — see
-- bundle_path/bundle_hash below); add preview stats and sale mode.
-- ---------------------------------------------------------------------
alter table listings drop column if exists bundle;

alter table listings add column if not exists bundle_path text;
alter table listings add column if not exists note_count integer;
alter table listings add column if not exists link_count integer;

alter table listings add column if not exists mode text not null default 'license' check (mode in ('exclusive', 'license'));

-- ---------------------------------------------------------------------
-- transfers: generic payment_ref (was stripe_payment_intent), the sealed
-- content key handed to the buyer at delivery, a snapshot of the listing
-- + agreement text at purchase time (so the ledger survives listing
-- edits/erasure), and a delivered_at timestamp for the 72h dispute window.
-- ---------------------------------------------------------------------
do $$
begin
  if exists (
       select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'transfers' and column_name = 'stripe_payment_intent'
     )
     and not exists (
       select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'transfers' and column_name = 'payment_ref'
     ) then
    alter table transfers rename column stripe_payment_intent to payment_ref;
  end if;
end $$;

-- Fresh databases that somehow skip the rename branch above (e.g. 0001
-- re-authored later) still end up with the column via this guard.
alter table transfers add column if not exists payment_ref text;
alter table transfers add column if not exists wrapped_key text;
alter table transfers add column if not exists listing_snapshot jsonb;
alter table transfers add column if not exists delivered_at timestamptz;

-- ---------------------------------------------------------------------
-- Foreign key policy for GDPR erasure (delete-account Edge Function):
--   - deleting a profile cascades to that seller's listings (their
--     listings are part of what erasure removes);
--   - deleting a profile referenced by a transfer nulls buyer_id/seller_id
--     instead of deleting the row — the ledger survives, anonymized,
--     because listing_snapshot already carries the historical title/price;
--   - deleting a listing (via the cascade above, or directly) nulls
--     transfers.listing_id for the same reason.
-- Re-creating a constraint under the same name keeps PostgREST's embedded-
-- resource syntax (`profiles!listings_seller_id_fkey(...)`) working.
-- ---------------------------------------------------------------------
alter table listings drop constraint if exists listings_seller_id_fkey;
alter table listings add constraint listings_seller_id_fkey
  foreign key (seller_id) references profiles(id) on delete cascade;

alter table transfers drop constraint if exists transfers_seller_id_fkey;
alter table transfers add constraint transfers_seller_id_fkey
  foreign key (seller_id) references profiles(id) on delete set null;

alter table transfers drop constraint if exists transfers_buyer_id_fkey;
alter table transfers add constraint transfers_buyer_id_fkey
  foreign key (buyer_id) references profiles(id) on delete set null;

alter table transfers drop constraint if exists transfers_listing_id_fkey;
alter table transfers add constraint transfers_listing_id_fkey
  foreign key (listing_id) references listings(id) on delete set null;

-- ---------------------------------------------------------------------
-- Storage: a private bucket for E2E-encrypted bundle ciphertext. Objects
-- are framed client-side as `nonce (24B) || ciphertext` (src/lib/
-- marketplace.js listMindForSale) so no plaintext, and no key material,
-- ever reaches Storage.
--
-- Deliberately NO select/read policy exists on these objects: the only way
-- to read one is a short-lived signed URL minted server-side (service
-- role, which bypasses RLS entirely) by the deliver-key / get-bundle-url
-- Edge Functions, after they've verified the caller is a party to the
-- relevant transfer. Sellers may insert/update/delete only under their own
-- `bundles/<seller_id>/` prefix.
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('bundles', 'bundles', false)
on conflict (id) do nothing;

drop policy if exists "sellers_insert_own_prefix" on storage.objects;
create policy "sellers_insert_own_prefix" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'bundles' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "sellers_update_own_prefix" on storage.objects;
create policy "sellers_update_own_prefix" on storage.objects
  for update to authenticated
  using (bucket_id = 'bundles' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "sellers_delete_own_prefix" on storage.objects;
create policy "sellers_delete_own_prefix" on storage.objects
  for delete to authenticated
  using (bucket_id = 'bundles' and (storage.foldername(name))[1] = auth.uid()::text);
