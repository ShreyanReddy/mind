-- Manyam Mind marketplace schema (Supabase / Postgres)
-- Moved here from supabase/schema.sql in Phase 1 (PLAN.md §1.2) so all
-- schema changes are ordered migrations. PLAN.md §3 covers RLS policies,
-- Stripe webhooks, and the signed transfer flow that completes this backend.

create extension if not exists pgcrypto;

create table if not exists profiles (
  id uuid primary key references auth.users on delete cascade,
  handle text unique not null,
  display_name text,
  created_at timestamptz default now()
);

create table if not exists listings (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid references profiles(id),
  title text not null,
  description text,
  price_cents integer not null check (price_cents >= 0),
  -- production: store an E2E-encrypted bundle in Storage and keep only a
  -- pointer + content hash here. Plaintext jsonb is MVP-only.
  bundle jsonb,
  bundle_hash text,
  status text not null default 'active' check (status in ('active','sold','withdrawn')),
  created_at timestamptz default now()
);

create table if not exists transfers (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid references listings(id),
  seller_id uuid references profiles(id),
  buyer_id uuid references profiles(id),
  price_cents integer,
  stripe_payment_intent text,
  status text not null default 'pending'
    check (status in ('pending','escrowed','delivered','completed','refunded','disputed')),
  -- signed handoff: seller signs the bundle hash; buyer countersigns receipt
  seller_signature text,
  buyer_signature text,
  created_at timestamptz default now(),
  completed_at timestamptz
);

create table if not exists transfer_events (
  id bigint generated always as identity primary key,
  transfer_id uuid references transfers(id),
  event text not null,
  meta jsonb,
  at timestamptz default now()
);

-- Enable RLS everywhere; policies are specified in PLAN.md §3.4.
alter table profiles enable row level security;
alter table listings enable row level security;
alter table transfers enable row level security;
alter table transfer_events enable row level security;
