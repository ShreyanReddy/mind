// Marketplace scaffold — listing, transferring, and selling mind clones.
//
// The MVP ships working local export/import (the actual unit of transfer)
// plus stubbed remote operations wired for Supabase. PLAN.md §3 specifies
// the production build: auth, Stripe Connect escrow, signed ownership
// transfer, and revocation of the seller's copy.

import { vault } from './store.js'

const SUPABASE_URL = import.meta.env?.VITE_SUPABASE_URL
const SUPABASE_KEY = import.meta.env?.VITE_SUPABASE_ANON_KEY
export const remoteConfigured = Boolean(SUPABASE_URL && SUPABASE_KEY)

/** Download the current mind as a portable .mind.json bundle. WORKS TODAY. */
export function downloadBundle() {
  const bundle = vault.exportBundle()
  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `${bundle.persona.name.replace(/\s+/g, '-').toLowerCase()}.mind.json`
  a.click()
  URL.revokeObjectURL(a.href)
}

/** Import a bundle file — this is how a buyer receives a mind. WORKS TODAY. */
export function importBundleFile(file) {
  return file.text().then((txt) => vault.importBundle(JSON.parse(txt)))
}

/* ---------- remote stubs (Supabase) — see supabase/schema.sql ---------- */

async function sb(path, opts = {}) {
  if (!remoteConfigured) throw new Error('Marketplace backend not configured (.env)')
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: SUPABASE_KEY,
      authorization: `Bearer ${SUPABASE_KEY}`,
      'content-type': 'application/json',
      prefer: 'return=representation',
      ...opts.headers,
    },
  })
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`)
  return res.json()
}

/** List a mind for sale. Production adds: auth, encryption, escrow. */
export function listMindForSale({ title, description, priceCents }) {
  return sb('listings', {
    method: 'POST',
    body: JSON.stringify({
      title,
      description,
      price_cents: priceCents,
      bundle: vault.exportBundle(),
      status: 'active',
    }),
  })
}

export function browseListings() {
  return sb('listings?status=eq.active&select=id,title,description,price_cents,created_at')
}

/** Transfer ownership. Production: signed handoff + seller-copy revocation. */
export function transferMind(listingId, buyerId) {
  return sb(`transfers`, {
    method: 'POST',
    body: JSON.stringify({ listing_id: listingId, buyer_id: buyerId, status: 'pending' }),
  })
}
