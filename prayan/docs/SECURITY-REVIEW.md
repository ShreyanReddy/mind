# Security review — Phase 6.4 (executed 2026-07-08)

PLAN.md §6.4: RLS audit, key-handling audit, dependency scan, Edge Function
rate limits. This is the executed checklist with findings and dispositions,
not a template. Re-run it before any major release.

## 1. RLS audit

Method: Supabase security advisor (`get_advisors`) against the live project
+ manual read of every policy in `supabase/migrations/0004_rls.sql` /
`0006_minds.sql`, cross-checked against `supabase/tests/rls_checks.sql`.

Per-table posture:

| Table | Client read | Client write | Notes |
| --- | --- | --- | --- |
| `profiles` | any authed user | own row only | public keys are meant to be readable |
| `listings` | active OR own | owner, only while not sold | |
| `transfers` | buyer or seller | **none** (service role only) | all transitions via Edge Functions |
| `transfer_events` | participants | **none** (service role only) | append-only ledger |
| `vault_docs` | owner only | owner only | ciphertext only (E2E) |
| `mind_chunks` | owner only | owner only | content only for `mind`/`published` scopes |
| `usage_events` | owner (select) | **none** (service role only) | |
| `minds` | owner only (full row) | owner only | public reads go through `public_minds` |
| `api_keys` | owner only | owner only | stores sha-256 hashes, never plaintext |
| `ask_cache` / `ask_usage` | **none** | **none** | service role only (mind-api) |
| Storage `bundles` | **no read policy** | own prefix insert/update/delete | reads only via short-lived signed URLs issued by Edge Functions |

Advisor findings and dispositions:

- `extension_in_public` (WARN) — `vector` lived in `public`. **Fixed**:
  migration `0007_security_hardening.sql` moves it to `extensions` (applied
  live 2026-07-08; nothing in this codebase uses SQL vector operators — the
  mind-api scores cosine in JS — so no query changes).
- `rls_enabled_no_policy` on `ask_cache`, `ask_usage` (INFO) — **accepted,
  intentional**: RLS enabled with zero policies means ordinary clients are
  denied outright; only the mind-api service (service role) touches these.
  Same pattern as `transfers`/`transfer_events` writes.
- `security_definer_view` on `public_minds` (ERROR-level lint) — **accepted,
  intentional, documented**: the view is the deliberate "public window into
  an RLS table" pattern. It exposes ONLY the safe columns (never
  `refusal_topics`/`voice_rating`) of ONLY `published = true` rows. The
  linter-suggested `security_invoker` alternative would require either a
  base-table SELECT policy (leaks all columns of published rows to any
  client) or column-level grants (breaks the owner's own full-row reads in
  the Mind API card). The definer view is the least-exposure option; its
  body is 9 whitelisted columns and a `published` filter — re-audit it on
  any change to `minds`' columns.

## 2. Key-handling audit

Every key/secret in the system, where it lives, and where it can never go:

| Secret | At rest | In transit | Never |
| --- | --- | --- | --- |
| User LLM API keys (developer mode) | Dexie `persona.keys`, this browser only | direct browser→provider call, dev mode only | never server-side; stripped by `exportBundle()` AND discarded by `importBundle()` (tested: `store.test.js`) |
| Platform LLM/embed keys | Edge Function env (`llm-proxy`/`embed`) | server→provider | never in the repo, never in client bundles |
| Vault passphrase / derived key | passphrase never stored; key in-memory session only (`crypto.js`); only the Argon2id **salt** persists (Dexie meta) | never | the server never sees passphrase, key, or plaintext vault content |
| Listing content key | seller's Dexie meta until sale closes | delivered once, sealed to the buyer's X25519 public key (`deliver-key`) | never plaintext on the server; never in a listing row |
| Marketplace keypair | Dexie meta (`marketplaceKeyPair`) | public half → `profiles.public_key` | private half never uploaded, never exported in bundles |
| mind-api API keys | `api_keys.key_hash` (sha-256) + prefix | plaintext shown exactly once at creation | plaintext never stored anywhere |
| Supabase service-role key | Edge Function env / mind-api env (Railway) | server→db | never in client code or `VITE_*` vars |
| Supabase anon key | client bundle (`VITE_*`) | public by design | it's not a secret; RLS is the boundary |

Spot-checks performed: `git grep` for provider-key names in client source
(only `persona.keys` paths, dev-mode gated); `exportBundle` secret-stripping
test still present and passing; `.env.example` contains placeholders only;
`.gitignore` covers `.env*`.

## 3. Dependency scan

- `manyam-mind` (app): `npm audit` — **0 vulnerabilities** after upgrading
  Vite 5 → 7 (+ `@vitejs/plugin-react` 4 → 5) to clear
  GHSA-67mh-4wv8-2f99 (esbuild dev-server request forwarding; dev-only but
  free to fix). Full unit + e2e suite green on Vite 7.
- `services/mind-api`: `npm audit` — **0 vulnerabilities**.
- `src-tauri`: `cargo check` green; `cargo audit` is not yet wired into CI —
  listed under "future work" below.

## 4. Rate limits on Edge Functions

New `_shared/rateLimit.ts` (in-memory per-isolate fixed window, per user id)
wired into every authenticated function, in addition to the pre-existing
shared daily token cap (`usage.ts`) on `llm-proxy`/`embed`:

| Function | Limit |
| --- | --- |
| `create-transfer`, `dispute-transfer` | 10/min |
| `deliver-key`, `confirm-import` | 20/min |
| `get-bundle-url`, `embed`, `llm-proxy` | 30/min |
| `export-account` | 6/hour |
| `delete-account` | 3/hour |
| `interview-digest` | n/a — cron-secret gated, not user-callable |

Known limitation (documented in `rateLimit.ts`): per-isolate windows reset on
cold start; this blunts abuse but is not a hard global cap. The hard
guarantees remain the token caps + state-machine + RLS. The mind-api service
has its own token-bucket limiter (`services/mind-api/src/rateLimit.js`).

## 5. Other posture notes

- Desktop (Tauri): CSP pinned in `tauri.conf.json`; fs capability bounded to
  `$HOME`/`$DOCUMENT` and narrowed at runtime to the user-picked vault folder.
- Telemetry cannot carry content by construction (counts only —
  `telemetry.test.js` asserts payload shape); Sentry gated on DSN with PII
  off.
- All marketplace state transitions are function-verified + event-logged;
  client never writes `transfers`/`transfer_events`.

## Future work

- Wire `cargo audit` (RustSec) into the desktop-check CI job.
- Automate `rls_checks.sql` as a CI step against a branch database.
- Re-run the advisor + this checklist before enabling Stripe (on hold) and
  before first paid launch.
