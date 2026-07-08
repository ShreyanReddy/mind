# Changelog

All notable changes to Manyam Mind are recorded here, grouped by PLAN.md
phase.

## Phase 0 — Foundation & hygiene — 2026-07-07

Foundational tooling and hygiene work per PLAN.md §0. No product behavior
changed except one bug fix (below); all existing module interfaces
(`store.js`, `links.js`, `retrieval.js`, `llm.js`, `persona.js`,
`marketplace.js`) are unchanged.

- **TypeScript, incremental.** Added `typescript` as a devDependency and
  `tsconfig.json` with `allowJs: true`, `checkJs: false`, `jsx: react-jsx`,
  `moduleResolution: bundler`, `noEmit: true`, and the strictest settings
  (`strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`,
  `noUnusedLocals`/`Parameters`, `exactOptionalPropertyTypes`, etc.) as the
  floor for any new `.ts`/`.tsx` files. No existing `.js`/`.jsx` file was
  renamed or type-checked. `npm run typecheck` runs `tsc --noEmit`.

- **Vitest + React Testing Library.** Added `vitest`,
  `@testing-library/react`, `@testing-library/jest-dom`, and `jsdom`.
  Configured via the `test` block in `vite.config.js` (`environment:
  'jsdom'`, `globals: true`, `setupFiles: ['./src/test/setup.js']`).
  `npm test` runs `vitest run`; `npm run test:watch` runs it in watch mode.
  First tests:
  - `src/lib/__tests__/links.test.js` — `parseLinks` (plain links, labeled
    links, multiple links, no links, malformed/unclosed syntax, whitespace
    trimming), `backlinksTo` (case-insensitive matching), `buildGraph`
    (degree counts, repeated-link edge weight, links to missing targets
    ignored, self-links ignored, recent-activity flag), and `plainText`
    (markdown stripped, link labels rendered).
  - `src/lib/__tests__/store.test.js` — `exportBundle` never includes
    `persona.keys` or the legacy `persona.apiKey`; `importBundle` round-trips
    an exported bundle, validates `notes` is an array, fills in missing note
    fields (`id`/`title`/`body`/`createdAt`/`updatedAt`/`edits`) with sane
    defaults, and never imports `keys`/`apiKey` into `persona` even from a
    bundle that supplies them.

- **Bug fix (found while writing the import/export test): format-string
  mismatch broke every import.** `store.js`'s `exportBundle()` tagged
  bundles with `format: 'manyam-mind/1'`, but `importBundle()` checked for
  `'synapse-mind/1'` (a pre-rebrand leftover) and rejected everything else
  — so a bundle exported by this app could never be re-imported by it.
  Fixed `importBundle()` to accept both `'manyam-mind/1'` (current) and
  `'synapse-mind/1'` (legacy, for bundles exported before this fix/rebrand),
  and added validation: `notes` must be an array, and each imported note is
  given `id`/`title`/`body`/`createdAt`/`updatedAt`/`edits` defaults for any
  missing field. The secret-stripping invariant is preserved on import too:
  `keys`/`apiKey` are destructured off and discarded, never merged into
  `persona`, regardless of what a bundle contains.

- **ESLint + Prettier.** Added a flat `eslint.config.js`
  (`@eslint/js` recommended + `eslint-plugin-react-hooks` +
  `eslint-plugin-react-refresh`, with `eslint-config-prettier` last to
  disable formatting-related rules). Added `.prettierrc` (no semicolons,
  single quotes, `printWidth: 100`) and `.prettierignore`. `npm run lint`
  runs `eslint .`; `npm run format` runs `prettier --write .`. Fixed the
  handful of real violations lint surfaced on the existing codebase: a
  duplicate `anthropic` key in `Settings.jsx`'s initial form state (a real
  bug — the later key was silently discarding a merge of `p.keys`), an
  unused event-handler parameter in `GraphView.jsx`, and a stale
  `useMemo` dependency in `Editor.jsx`. Added one targeted
  `eslint-disable-next-line` (with justification) in `Sidebar.jsx` for a
  display-only `Date.now()` recency read that the new
  `react-hooks/purity` rule flags but which has no memoization/compiler
  safety implication.

- **CI.** Added `.github/workflows/ci.yml`: runs on push and pull request,
  Node 20, `defaults.run.working-directory: manyam-mind`, steps `npm ci` →
  lint → typecheck → test → build. Added `.gitignore`
  (`node_modules`, `dist`, `coverage`, `.env*`) and confirmed
  `package-lock.json` is present and `npm ci` succeeds cleanly against it.

- **Error boundaries.** Added `src/components/ErrorBoundary.jsx` (an
  original class component) rendering a fallback built from the existing
  `.pane`/`.pane-h`/`.pane-body`/`.empty-hint`/`button.primary` classes and
  brand tokens, with a "Reload" button and a `console.error` crash log.
  Wrapped the Sidebar, the active main-view pane, and the ContextPanel in
  `App.jsx` each in their own boundary, so a crash in one pane no longer
  takes down the whole app.

- **Brand tokens.** Extracted the brand custom-property block from the top
  of `src/styles/theme.css` into `src/styles/brand.css`; `theme.css` now
  starts with `@import './brand.css';` and keeps all non-brand layout and
  component CSS. Verified `main.jsx`/`index.html` still load styles
  correctly (build output includes the merged CSS as before). Documented
  the rebrand procedure in `docs/REBRANDING.md` (edit `brand.css` tokens +
  the wordmark markup in `App.jsx`; brand is **Manyam Mind**).

`npm run lint`, `npm run typecheck`, `npm test` (29 tests, 2 files), and
`npm run build` all pass.

## Phase 1 — Vault hardening — 2026-07-07

Per PLAN.md §1. `store.js`'s public API grew (undo/redo, `graph()`, daily
notes/templates, `ready()`/`flush()`, `importNotes()`, `applyRemotePatch()`)
but every pre-existing method (`get`, `subscribe`, `createNote`,
`updateNote`, `deleteNote`, `findByTitle`, `resolveOrCreate`, `setPersona`,
`exportBundle`, `importBundle`) kept its exact signature and behavior —
`vault.get()` is still fully synchronous once the vault has hydrated, which
is the one thing every component depends on.

- **Layered persistence (Dexie as source of truth), `src/lib/db.js` +
  rewritten `src/lib/store.js`.** Added `dexie` (dep) and `fake-indexeddb`
  (devDep, polyfills IndexedDB under jsdom/Vitest). `db.js` defines the
  `manyam-mind` Dexie database: `notes` (id), `meta` (key/value — persona,
  settings, the folder-vault directory handle, the encryption salt),
  `activity` (`++id, t, noteId`), `outbox` (queued encrypted sync updates).
  `store.js` keeps all state in memory for the synchronous `vault.get()`
  components rely on, and write-behind flushes only dirty notes/meta/
  activity to Dexie on a 300ms debounce (`vault.flush()` forces an
  immediate write; a `beforeunload` handler calls it as a last-chance save).
  `vault.ready()` resolves once hydration completes; `main.jsx` now renders
  a `.boot-splash` div and awaits `vault.ready()` before mounting `<App/>`.
  One-time migration: if `localStorage['manyam.vault.v1']` exists and Dexie
  is empty, its notes/persona/activity are migrated into Dexie and the
  localStorage key is removed; a fresh vault is seeded only when *both* are
  empty. The activity log is durable (capped at 5,000 rows in Dexie, oldest
  pruned) and replayable — entries are now `{ t, noteId, kind }` with
  `kind` in `create | edit | link | delete | absorb`; the in-memory copy
  kept in `state.activity` stays capped at the last 500 for the graph, as
  before. A failed background flush is logged, never thrown — a torn-down
  IndexedDB connection (as happens between test files) can't crash the app.
  **Intentional interface change, documented:** because hydration is now
  async, `store.test.js`'s `freshVault()` helper awaits `vault.ready()`
  after the dynamic re-import; no assertions in that file changed. IndexedDB
  is also reset between tests (`indexedDB.deleteDatabase('manyam-mind')`) in
  addition to the existing `localStorage.clear()`, since the fake-indexeddb
  database persists by name across `vi.resetModules()`.

- **Undo/redo per note, in `store.js`.** Bounded in-memory history (max 100
  snapshots per note) with 500ms coalescing: a burst of edits inside the
  same 500ms window collapses into one undo step, but *any* edit — even
  inside that same window — immediately clears the redo stack (a real bug
  caught by `store-vault.test.js`: the first cut only cleared redo when a
  new coalescing window started, so editing right after an undo silently
  left the old redo entry sitting there). `vault.undo(id)` /
  `vault.redo(id)` return `true`/`false`; `vault.canUndo`/`canRedo(id)`
  report availability. Wired into `Editor.jsx`: Ctrl/Cmd-Z and
  Ctrl/Cmd-Shift-Z on the title input or body textarea call
  `preventDefault()` and go through vault history instead of the browser's
  native textarea undo.

- **Folder-vault mode, new `src/lib/fsvault.js`.** Optional, off by
  default, toggled from Settings ("Local folder vault"). Feature-detects
  `window.showDirectoryPicker` (`isSupported()`), so the module is a no-op
  under jsdom/Node. When connected, every note round-trips as
  `<safe-title>-<id8>.md` with YAML frontmatter (`id`, `title`, `aliases`,
  `tags`, `folder`, `createdAt`, `updatedAt`, `edits`) + body; exports are
  debounced (800ms) on every vault change (wired in `main.jsx`). The
  directory handle is structured-cloned into Dexie meta and
  re-acquired (with a permission re-request if needed) on startup
  (`reconnect()`). "Load from folder" parses every `.md` file back into
  vault-shaped notes (frontmatter wins, filename slug is the fallback
  title) and merges them via the new `vault.importNotes()` (upserts by id,
  then by title — unlike `importBundle`, it does not wipe the vault).

- **End-to-end encryption, new `src/lib/crypto.js`.** Dep:
  `libsodium-wrappers-sumo`. `sodiumReady()`, `deriveVaultKey(passphrase,
  salt?)` (Argon2id, `OPSLIMIT_MODERATE`/`MEMLIMIT_MODERATE`),
  `encrypt(key, bytes|string)` / `decrypt(key, nonce, cipher)`
  (XChaCha20-Poly1305), plus base64 helpers and an in-memory-only session
  key holder (`setSessionKey`/`getSessionKey`/`clearSessionKey`). Settings
  gained a "Vault encryption passphrase" section: setting/changing a
  passphrase derives a key and persists **only the salt** to Dexie meta
  (`vaultSalt`) — never the passphrase or key. Round-trip, wrong-key
  (throws), distinct-nonce, and salt-persistence behavior are covered by
  `crypto.test.js`. That file runs under `@vitest-environment node`: under
  jsdom, libsodium's wasm glue does a strict `instanceof Uint8Array` check
  that fails because jsdom's global `Uint8Array` is a different realm
  object than Node's — real browsers don't have two realms, so this is a
  test-environment-only issue, not a runtime one.

- **Sync engine, new `src/lib/sync.js`.** Deps: `yjs`,
  `@supabase/supabase-js`. `syncEnabled` is `false` (and everything else in
  the module a safe no-op) unless `VITE_SUPABASE_URL`/
  `VITE_SUPABASE_ANON_KEY` are set — fully additive per CLAUDE.md. One
  Y.Doc per note (`Y.Text 'body'` + `Y.Map 'meta'`); `watchForOutbox` tags
  remote-origin updates so applying a merged-in remote update never re-queues
  itself (the loop guard); `createNoteSync` encrypts local updates
  (`crypto.js`) into the Dexie `outbox` and refuses to queue anything
  without a derived session key; `flushOutbox` best-effort pushes queued
  rows to a `vault_docs` table and leaves them queued on any failure;
  `subscribeRealtime` wires a `vault:<user_id>` Supabase Realtime channel.
  `sync.test.js` unit-tests the pure CRDT primitives (doc creation, local
  patch application, remote merge, the loop guard, and CRDT convergence of
  two divergent docs) with **no network** — `createClient` is never called
  unless `syncEnabled` is true. New migration
  `supabase/migrations/0002_sync.sql` adds `vault_docs` (+ indexes, owner-
  only RLS policy); the previous `supabase/schema.sql` content moved
  unchanged to `supabase/migrations/0001_marketplace.sql` so schema changes
  are ordered from here on, and `schema.sql` is now a pointer comment.

- **Vault features beyond MVP.** Notes gained `folder` (string, default
  `''`), `tags` (parsed from `#tag` tokens in the body on every
  `updateNote`, via `links.extractTags`), and `aliases` (string[]).
  `links.buildGraph` and `links.backlinksTo` now resolve against titles
  *and* aliases, case-insensitively, while keeping their existing call
  signatures working (aliases is an added optional argument/field, not a
  required one). `Sidebar.jsx` groups notes into collapsible folders
  (right-click a note to move it), adds tag filter chips, and a "Today"
  button (`vault.todayNote()` — creates/opens `Daily/YYYY-MM-DD`).
  Templates: any note filed under `Templates` is offered by the new
  "New from template…" command (`vault.newFromTemplate()` substitutes
  `{{date}}`/`{{title}}`). Unlinked mentions: new `src/lib/mentions.js`
  (pure, tested) finds case-insensitive plain-text occurrences of a note's
  title/aliases in other notes' bodies, skipping anything already inside a
  `[[link]]`; `ContextPanel.jsx` surfaces them with a "Link" button that
  wraps the first occurrence in `[[...]]`. Command palette: new
  `src/components/CommandPalette.jsx` (Ctrl/Cmd-K, mounted once in
  `App.jsx`), fuzzy-matching (`src/lib/fuzzy.js`, original subsequence
  scoring) across every note (open) and a dozen commands (new note, today's
  daily note, new from template, open each tab, export bundle, undo/redo,
  move to folder, connect local folder).

- **Scale & incremental indexing, new `src/lib/linkIndex.js`.** An
  incremental index — `Map noteId -> parsed links` and
  `Map lowercased title/alias -> noteId` — updated for only the edited
  note on each `updateNote`/`createNote`/`deleteNote` (title/alias edits
  automatically refresh the resolution map since it's rebuilt from that
  note's current title/aliases on every touch). `links.buildGraph` remains
  as the pure, reparse-everything fallback used by tests and
  `retrieval.js`. `store.js` exposes `vault.graph()`, backed by the index;
  `Sidebar.jsx` and `GraphView.jsx` switched to it instead of reparsing the
  whole vault per render. `linkIndex.test.js` generates 5,000 notes /
  20,000 links and asserts a full `rebuild()` stays under 5s, a
  single-note `updateNote()` stays under 50ms, and node/edge counts match
  `links.buildGraph` exactly.

- **Deps.** Added `dexie`, `yjs`, `@supabase/supabase-js`,
  `libsodium-wrappers-sumo` (dependencies) and `fake-indexeddb`
  (devDependency).

`npm run lint`, `npm run typecheck`, `npm test` (65 tests, 9 files), and
`npm run build` all pass.

## Phase 2 — The living graph, production grade — 2026-07-07

Per PLAN.md §2. `<GraphView onOpenNote={...} />` keeps its exact component
API and its soul — glow, pulses on recent edits, traveling sparks on new
synapses — while the internals were rebuilt for 5k nodes.

- **Barnes-Hut physics at scale (§2.1), new `src/lib/quadtree.js` +
  `src/lib/graphPhysics.js`.** `quadtree.js` is a pure Barnes-Hut quadtree
  (insert points with mass; approximate inverse-square repulsion per node
  with theta 0.85; coincident points aggregate at a max-depth leaf instead
  of recursing forever). `graphPhysics.js` is the shared fixed-timestep
  step — BH repulsion + springs + centering + damping — with the original
  feel preserved: spring rest length still shrinks with edge weight
  (`90 − min(30, w·6)`), damping still 0.85, and the pair force
  `k·mᵃ·mᵇ/d²` divided by the node's own mass so unit-mass behavior matches
  the old sim exactly while heavier neurons claim more space. Tested:
  BH vs naive O(n²) summary stats on a 400-point random layout (mean
  magnitude error < 10%, mean direction cosine > 0.97), a CI perf budget
  (one full force pass over 5,000 nodes < 100ms), energy decay from the
  early peak to a settled layout, linked-nodes-end-closer clustering,
  pinned-node immobility, and syncSim position preservation.

- **Simulation in a Web Worker, new `src/workers/graphSim.js`.** Created
  via the Vite idiom `new Worker(new URL('../workers/graphSim.js',
  import.meta.url), { type: 'module' })`. The worker owns the sim state:
  `{type:'sync'}` topology snapshots in, transferable Float32Array position
  buffers out at ~60Hz while the layout is hot, throttling to 250ms once
  the layout energy settles (waking on any sync/pin). Dragging pins the
  node in the worker so it follows the pointer. Where `typeof Worker ===
  'undefined'` (jsdom, old browsers) GraphView steps the *same*
  `graphPhysics.js` module on the main thread — the physics is tested even
  though the worker itself can't run under jsdom.
  **OffscreenCanvas decision:** rendering stays on the main-thread canvas.
  Drawing needs live theme tokens, labels, hover/focus/search state — and
  the expensive part (the simulation) is already off the main thread, so
  OffscreenCanvas would have added a second message protocol and
  worker-side theming for no measurable gain. PLAN.md says "where
  supported"; here it is deliberately unused.

- **Growth semantics (§2.2), new `src/lib/growth.js` + `vault.graphEnriched()`.**
  - `nodeMass(note, {degree, activity, now})` = `1 + 0.6·log1p(edits) +
    0.25·degree + 0.5·recency`, where recency = Σ `exp(-(now−t)/τ)` over the
    note's activity events, τ = 14 days. Returns raw mass plus normalized
    visual `radius`/`brightness` in [0,1] (brightness leans on recency, so
    a freshly-worked neuron glows even while small).
  - `edgeWeight(linkCount, coEditCount)` = `linkCount × (1 +
    log1p(coEditCount))`. `coEditCounts(activity)` counts, per pair of
    notes, how often they were edited within the same 1-hour window using a
    sliding window pointer — O(activity·window), never O(n²) over pairs —
    returning a Map keyed by `pairKey(a, b)`.
  - `consolidate(edges, lastUsed, now)` flags edges whose endpoints have
    BOTH been inactive for 90 days as `faded: true`. Faded synapses thin to
    a floor opacity (`FADE_FLOOR_ALPHA`) but are never removed — old
    memories fade, they don't die. In the store this runs on idle
    (`requestIdleCallback`, `setTimeout` fallback) and only refreshes a
    flag set; no data mutation.
  - `vault.graphEnriched()` serves GraphView nodes with
    mass/radius01/brightness/folder/tags and edges with weight/faded, so
    the component computes no growth math ad hoc. `vault.graph()` is
    unchanged for existing callers.

- **Interactions (§2.3), in `GraphView.jsx`.**
  - *Local graph mode:* a "Whole mind" / "Around this note" toggle in the
    HUD. Local mode shows the 2-hop neighborhood (`growth.neighborhood`,
    tested) of the most recently active note; clicking a node re-centers on
    it (clicking the already-centered node — or pressing Enter — opens it).
  - *Time-lapse replay:* "Watch your mind grow" — a play/pause + scrubber
    bar reading the FULL durable activity log from Dexie (`db.activity`,
    up to 5,000 events; the in-memory copy only keeps 500). At scrub
    position T only notes born ≤ T appear, node sizes are recomputed from
    activity ≤ T, and play sweeps the full range in ~8s.
    **Documented approximation:** the log records per-note events, and a
    `link` event names the note that gained a link but not which edge it
    created — so an edge's birth is approximated as the earliest `link`
    event on either endpoint once both endpoints exist, falling back to
    "the moment both endpoints exist" when no link event survives in the
    capped log (`growth.timelapseFrame`, tested). Exiting returns to live
    mode; sim re-syncs are throttled to ~90ms while scrubbing with a
    trailing sync for the final position.
  - *Search-to-highlight:* a HUD search input; nodes matching by
    title/alias/tag substring glow brighter while non-matches dim to 20%
    (edges dim unless both endpoints match); Enter cycles matches and pans
    each one to center, announced via the live region.
  - *Cluster coloring:* nodes are colored by folder — the folder name
    hashes to a stable hue rotation applied to the brand token color in HSL
    space (new pure `src/lib/palette.js`, tested; no hardcoded hex in JS —
    the base color is always read from `--glow-syn`/`--glow-mind` at
    runtime, so cluster colors follow a rebrand automatically). Legend
    chips show folder → color for the largest six folders.

- **Accessibility (§2.4).** The canvas is focusable (`tabIndex=0`): arrow
  keys move a visible dashed focus ring to the nearest node in the pressed
  direction (cone-limited nearest-neighbor), Enter opens the focused note,
  Escape clears, and the focused title + connection count is announced
  through a visually-hidden `aria-live` region. Under
  `prefers-reduced-motion: reduce` there is no animation loop at all: the
  simulation runs to convergence once per data change on the main thread
  (`runToRest`, ≤300 steps), the layout is drawn statically and redrawn
  only on data/viewport change, and pulses/sparks/time-lapse autoplay are
  disabled (the scrubber still works by hand).

- **Tests.** 39 new (13 files total): `quadtree.test.js` (accuracy vs
  naive, perf budget, degenerate inputs), `graphPhysics.test.js` (energy
  decay, stable/clustered layout, convergence, pinning, sync semantics),
  `growth.test.js` (mass monotonicity, τ decay, edge-weight formula,
  co-edit windows/dedup/perf, consolidation boundary + never-removes +
  no-mutation, 2-hop neighborhood, time-lapse frames incl. the edge-birth
  approximation), `palette.test.js` (hash stability, token parsing, hue
  rotation), and a `graphEnriched` shape test in `store-vault.test.js`.
  All 65 pre-existing tests untouched and passing.

`npm run lint`, `npm run typecheck`, `npm test` (104 tests, 13 files), and
`npm run build` all pass.

## Phase 3 — Marketplace: transfer & sale (Stripe on hold) — 2026-07-08

PLAN.md §3, built against a live (already-provisioned) Supabase project,
with one product-scope change made by the owner on this date:

> **Stripe is on hold.** The full escrow/transfer state machine is built
> against a `PaymentProvider` interface (`supabase/functions/_shared/
> payments.ts`) with an **internal, no-real-money escrow provider** as the
> live implementation and an interface-conforming `StripeStub` (every
> method throws `'Stripe integration on hold'`) for later activation. No
> Stripe SDK dependency, no Stripe API calls, no Stripe keys anywhere in
> this codebase. `transfers.stripe_payment_intent` was renamed to the
> provider-agnostic `transfers.payment_ref` (migration 0003).

- **Auth + profiles (§3.1).** `src/lib/supabase.js` — a lazy supabase-js
  client singleton, `backendConfigured` gated on
  `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` (mirrors the existing
  pattern in `sync.js`). `src/lib/auth.js` — `signUp`/`signIn`/`signOut`/
  `getSession`/`onAuthChange`, plus `ensureProfile` (client-side insert,
  covered by the new `profiles_insert_own` RLS policy) and
  `ensureKeyPairPublished`: generates an X25519 keypair
  (`crypto.js generateKeyPair`, libsodium `crypto_box_keypair`) on first
  sign-in, stores it in Dexie meta (`marketplaceKeyPair` — **never**
  uploaded, never in an exported bundle), and publishes only the public
  half to the new `profiles.public_key` column. `src/components/
  AuthPanel.jsx` is a compact email+password sign up/sign in form
  (handle field on signup) rendered inside `Marketplace` when signed out.

- **Listings, E2E-encrypted (§3.2), in `src/lib/marketplace.js`.**
  `listMindForSale` now: exports the bundle, generates a fresh random
  32-byte content key (`crypto.js generateContentKey`), encrypts it with
  the existing XChaCha20-Poly1305 helpers, frames the upload as
  `nonce (24B) || ciphertext` (no extra DB column needed for the nonce),
  uploads to the private `bundles` Storage bucket at
  `<seller_id>/<listing_id>.mind.enc`, hashes the **ciphertext** frame
  (SHA-256, WebCrypto — `crypto.js sha256Hex`), and inserts a listing row
  with preview-only fields (title, description, `note_count`,
  `link_count`, `mode`) — never note content. The content key stays on
  the seller's device (Dexie meta, `listingKey:<id>`) until a sale closes;
  `deliverKey` is the only thing that ever moves it, and only sealed to a
  specific buyer. Two consent checkboxes (no third-party personal data;
  seller owns the content) are required before a listing can be created.
  `src/lib/agreement.js` — a pure `transferAgreement(...)` function
  generating the plain-language sale agreement, snapshotted verbatim into
  `transfers.listing_snapshot.agreement` at purchase time so buyer/seller
  always see what was actually stored, not a live re-render.

- **Escrow state machine, internal provider (§3.3, amended).** Seven Edge
  Functions under `supabase/functions/` (all `verify_jwt: true` — every one
  requires an authenticated caller, buyer or seller as noted):
  - `create-transfer` (buyer) — validates the listing, calls
    `provider.authorize()` (internal: immediate, no real money), inserts
    the transfer straight into `escrowed` (no unpaid `pending` row is ever
    persisted), flips exclusive-mode listings to `sold`, snapshots the
    listing + agreement, logs `transfer.created`/`payment.authorized`/
    `escrow.entered`.
  - `deliver-key` (seller) — stores the seller-sealed wrapped content key,
    `escrowed -> delivered`, logs `key.delivered`, returns a short-lived
    signed URL for the ciphertext.
  - `get-bundle-url` (buyer) — the buyer-side signed-URL + wrapped-key
    fetch, once `delivered`/`completed`.
  - `confirm-import` (buyer) — requires `hash_ok: true` (the client already
    verified SHA-256 before calling this), captures payment,
    `delivered -> completed`, and for **exclusive** mode deletes the
    seller's `vault_docs` rows (synced-copy revocation, §3.5) and logs
    `seller_copy.revoked`.
  - `dispute-transfer` (buyer) — `refund` or `dispute`, server-enforced 72h
    window from `delivered_at`.
  - `delete-account` / `export-account` — GDPR erasure and data export
    (§3.6); erasure deletes Storage objects and the auth user, and relies
    on migration 0003's FK policy (cascade profile → listings; set-null on
    transfers' buyer/seller/listing ids) to anonymize the ledger rather
    than delete it.
  Every transition is both function-verified (the state machine
  transitions are hand-validated against `canTransition`, duplicated
  identically in `supabase/functions/_shared/stateMachine.ts` and
  `src/lib/transferState.js`, both unit-tested) and event-logged
  (`_shared/events.ts appendEvent`) — the CLAUDE.md "webhook-verified"
  clause applies to the (on-hold) Stripe path; internal-provider
  transitions are function-verified + event-logged instead, and
  `_shared/payments.ts` is exactly the seam a `stripe-webhook` function
  would plug into later.

- **RLS (§3.4), migration 0004** — one policy per bullet in PLAN.md,
  each with an inline comment explaining the "why": `profiles` readable by
  any authed user, writable only to your own row; `listings` readable when
  active or your own, writable/deletable by the owner only while not sold;
  `transfers` readable by buyer-or-seller with **no** client write policy
  at all (service role only); `transfer_events` readable by participants,
  again no client write policy. `supabase/tests/rls_checks.sql` has
  commented psql-style fixtures + assertions (set role/JWT claims, expect
  row counts) for the orchestrator to run via `execute_sql`.

- **Buyer import flow (§3.5), in `Marketplace.jsx`'s "My purchases" tab.**
  `importPurchasedBundle` downloads the signed-URL ciphertext, verifies its
  SHA-256 against the listing's `bundle_hash` (**fails loudly, never
  decrypts, never confirms** on mismatch), unseals the content key with
  the local private key (`crypto_box_seal_open`), decrypts, calls
  `vault.importBundle`, then `confirm-import`. Each purchase shows a
  timeline built from `transfer_events`. The seller side (`My listings`)
  shows an honest banner when an exclusive sale completes: server-side
  revocation happened, but earlier local exports can't be technically
  revoked — the sale contract governs those.

- **Migrations.** `0003_marketplace_e2e.sql` — `profiles.public_key`;
  drops the MVP plaintext `listings.bundle` column for good; adds
  `listings.bundle_path`/`note_count`/`link_count`/`mode`; renames
  `transfers.stripe_payment_intent` → `payment_ref`; adds
  `transfers.wrapped_key`/`listing_snapshot`/`delivered_at`; re-points FKs
  for the GDPR cascade/anonymize policy above; creates the private
  `bundles` Storage bucket with own-prefix insert/update/delete policies
  and deliberately no read policy. `0004_rls.sql` — the table RLS policies
  described above. Both are idempotent (guarded `if not exists`/`drop
  policy if exists`/information_schema checks) so re-applying is safe.

- **Config.** `supabase/functions/**` are Deno Edge Functions (URL imports,
  `Deno.*` globals) — excluded from `tsconfig.json` and `eslint.config.js`
  (documented inline in both files) since they're a different runtime the
  Node/browser toolchain doesn't model. `.env.example` documents every env
  var (client `VITE_*` and Edge Function secrets, all placeholders). A new
  `.env.test` zeroes the two `VITE_SUPABASE_*` vars for the unit-test mode
  Vite loads automatically, so the suite runs deterministically offline
  regardless of a developer's real `.env.local` — tests that need a
  configured backend mock `src/lib/supabase.js` directly instead.

- **Tests.** 36 new: `agreement.test.js` (pure-function coverage, incl. the
  exclusive-mode honesty language and price/date formatting),
  `transferState.test.js` (the full `canTransition` matrix, terminal
  states, backwards/skip transitions rejected), `marketplaceCrypto.test.js`
  (X25519 seal/unseal round trip and cross-key rejection, content-key
  generation, SHA-256 determinism/tamper-detection, the nonce-framing
  round trip), and `marketplace.test.js` (client marketplace logic against
  a mocked supabase-js client: consent/validation gating, the encrypt→
  upload→insert listing flow with a real hash check, buy/withdraw,
  `deliverKey`'s real seal round trip, `importPurchasedBundle`'s full
  download→verify→unseal→decrypt→import→confirm path including the
  hash-mismatch abort path, and dispute). All 104 pre-existing tests
  untouched and passing.

`npm run lint`, `npm run typecheck`, `npm test` (140 tests, 17 files), and
`npm run build` all pass.

## Phase 4 — Persona engine v3 — 2026-07-08

Per PLAN.md §4, built against the same live Supabase project as Phase 3. All
five preserved interfaces (`persona.js`: `askPersona`/`nextInterviewQuestion`/
`absorbAnswer`/`buildSystemPrompt`/`IDENTITY_TITLE`; `retrieval.js`:
`retrieve`/`chunkVault`/`knowledgeGaps`; `llm.js`: `chat`/`PROVIDERS`) keep
their names and purpose; `retrieve()` and `absorbAnswer()` are now `async`
(both already only had async callers) — documented at each definition.
Deleted `src/lib/providers.js`, a dead duplicate of `llm.js` with a
divergent API and zero imports anywhere in the codebase (verified by grep
before removal).

- **Embedding retrieval, env-gated with graceful BM25 fallback (§4.1).**
  New `src/lib/embeddings.js` — a client for the new `embed` Edge Function.
  `chunkKey(noteId, text)` (a fast djb2 hash) is the cache key in a new
  Dexie `vectors` table (`src/lib/db.js`, `db.version(2)`:
  `{chunkKey, noteId, vector, model, updatedAt}`), so an edited chunk gets a
  new key (re-embedded) while an untouched chunk stays a cache hit forever
  — covered by `embeddings.test.js`'s cache-invalidation tests. Cosine
  similarity runs in plain JS (`cosineSimilarity`). `retrieval.js`'s
  `retrieve()` keeps its call shape but is now `async`: when the owner has
  opted in (`persona.semanticRetrieval`), the backend is configured, and
  at least half of the vault's chunks already have a cached vector
  (`SEMANTIC_MIN_COVERAGE`), it embeds the live query and scores
  `0.6·cosine + 0.4·normalized_synaptic_strength` (PLAN.md §4.1 exactly);
  otherwise (or if the live query-embed call fails — offline, rate
  limited, no provider configured) it falls back to the original v2
  BM25×0.7 + strength×0.3 blend, unchanged. New `retrievalMode(state)`
  reports `'semantic'|'lexical'` for the UI without spending a query embed.
  Background refresh (`scheduleEmbeddingRefresh`, idle + 4s debounce) is
  wired from `main.jsx`'s existing `vault.subscribe` callback, gated on
  signed-in (tracked via `auth.onAuthChange`) + `persona.semanticRetrieval`.
  New Edge Function `supabase/functions/embed/index.ts` (authed): Voyage AI
  (`VOYAGE_API_KEY`, voyage-3-lite) if set, else OpenAI (`OPENAI_API_KEY`,
  text-embedding-3-small), else 501 `no embedding provider configured`;
  meters usage via the new `_shared/usage.ts`. New migration
  `0005_pgvector.sql`: `create extension vector`, `mind_chunks` (id,
  user_id, note_id, chunk_key, scope, `content` — **left NULL in this
  phase**, embedding vector(1024), updated_at) with an ivfflat index and
  owner-only RLS — provisioned for Phase 5's server-side retrieval, not
  written to by the Phase 4 client at all (the client only ever caches
  vectors in Dexie). **Honest privacy note**: the E2E vault stays E2E;
  turning on Settings → "Semantic retrieval (sends note text to the
  embedding provider transiently)" (default **off**) sends each opted-in
  chunk's text to the configured provider transiently, purely to compute a
  vector — the function never logs or stores that text.

- **Persona profile (§4.2).** New `src/lib/personaProfile.js`. The
  profile is itself a note titled `Persona Profile` (like Identity Core),
  auto-maintained: `regenerateProfile(state, llmCall)` distills the
  vault's strongest notes (`topNotes`, by synaptic strength, top 8) into a
  ~300-word "who I am" doc via one injected LLM call (never imports
  `llm.js` directly, so it's trivially testable with a fake and carries no
  routing/auth opinion), and stores it with an HTML-comment banner +
  embedded fingerprint (`vaultFingerprint` — sorted `id@updatedAt` pairs
  of the top-note set). `profileStale(state)` is true when there's no
  profile yet, or more than 20% of the fingerprint's entries changed
  (`DRIFT_THRESHOLD`) — membership churn and content edits both count.
  `profileText(state)` strips the banner for injection.
  `persona.js buildSystemPrompt` injects `=== PERSONA PROFILE ===` right
  after Identity Core. PersonaChat gained a status row: retrieval mode
  badge + "profile: fresh/stale" badge with a "Regenerate profile" button
  when stale, wired to `regenerateProfile` bound through `llm.chat`'s
  normal routing (so regeneration itself goes through the same
  proxy/dev-mode/error path as any other prompt). The note remains fully
  owner-editable like any other; regeneration only overwrites it, it never
  locks it.

- **Server LLM proxy + metering (§4.3).** New Edge Function
  `supabase/functions/llm-proxy/index.ts` (authed): forwards
  `{provider, model, system, messages, maxTokens}` to
  Anthropic/OpenAI/Gemini using **platform** keys
  (`ANTHROPIC_API_KEY`/`OPENAI_API_KEY`/`GEMINI_API_KEY`, this function's
  own env — never a user's), returns `{content}`. New
  `supabase/functions/_shared/usage.ts`: `enforceDailyCap` (throws
  `UsageCapExceededError` → 429, checked *before* calling the provider)
  and `recordUsage` (appends to the new `usage_events` table — migration
  0005, service-role-only insert, owner-only select RLS), sharing one cap
  (env `LLM_DAILY_TOKEN_CAP`, default 200000) across `llm`/`embed` kinds so
  switching call types can't dodge it. `llm.js`'s `chat()` keeps its name
  and options-object shape but is now a router
  (`resolveRoute({persona, backendConfigured, signedIn})`, exported and
  unit-tested as the routing matrix): backend configured + signed in + NOT
  developer mode → `llm-proxy`; developer mode on with a key set → the
  original v1/v2 direct browser call (moved into internal `chatDirect`,
  byte-for-byte the same three provider branches as before); otherwise a
  clear error explaining both paths, thrown before any network call. The
  browser-key path is thus reachable **only** behind the new persona
  setting `developerMode` (default **false**). Settings gained a
  "Developer mode" toggle with an honest explanation; the per-provider API
  key fields now render only when it's on.

- **Persona features (§4.4).** Citations: unchanged parsing, but
  `buildSystemPrompt` now also lists the retrieved chunks' note titles
  explicitly ("citing only titles from this list: …") for citation
  fidelity. Interview mode: `absorbAnswer` (now `async`) runs `retrieve()`
  against the new answer's text and appends up to two `See also [[Title]]`
  lines for notes scoring above a confidence threshold
  (`SEE_ALSO_MIN_SCORE`, deduplicated by note, best-effort — a lookup
  failure never blocks absorbing the answer); `persona.test.js` covers the
  threshold, the two-suggestion cap, dedup, and the failure path. Buyer-
  facing imported minds: `store.js exportBundle()` now stamps
  `persona.exportedBy` with the origin owner's clone name the *first* time
  a mind is exported (preserved through re-export if a buyer later
  re-lists it); `importBundle()` sets `persona.imported = true`
  unconditionally. `buildSystemPrompt` adds an explicit imported-mind
  framing sentence when both are set ("You are a mind clone of `<origin>`,
  now owned by whoever is chatting with you today…"), and
  `PersonaChat.jsx`'s header shows an "imported mind" badge.

- **Safety rails (§4.5).** New `src/lib/personaSafety.js`:
  `checkRefusal(question, topics)` is a cheap, local, no-LLM-call
  substring pre-filter that short-circuits an obviously-excluded topic
  with a standard refusal line before `askPersona` even calls `retrieve()`
  or `chat()` (unit-tested, and covered end-to-end in `persona.test.js`);
  `buildSafetyBlock(topics)` is the always-on system-prompt block —
  clone self-identification, a standing refusal of impersonation-for-fraud,
  and the owner's excluded-topics list — injected into **every**
  `buildSystemPrompt` call unconditionally, with no persona setting able
  to suppress it. `persona.refusalTopics` (Settings: a comma-separated
  field, `parseRefusalTopics`) is deliberately **not** stripped by
  `exportBundle`/`importBundle` the way API keys are — PLAN.md §4.5 wants
  a seller's refusal boundaries to survive into a buyer's copy of the mind.

- **Tests.** 69 new (23 files total): `personaSafety.test.js` (refusal
  pre-filter matching/case-insensitivity/blank-topic handling, safety
  block content), `personaProfile.test.js` (fingerprint drift math,
  staleness thresholds, regeneration overwrite-in-place), `embeddings.test.js`
  (chunkKey stability/uniqueness, cosine similarity, cache
  hit/miss/re-embed-on-change, coverage, prune), `retrieval.test.js`
  (semantic path with injected fake vectors, every fallback trigger —
  low coverage, failed query embed, opt-out, unconfigured backend — and
  the unchanged lexical/chunking/gap-detection behavior), `llm.test.js`
  (the full `resolveRoute` matrix plus `chat()` dispatch to proxy/direct/
  error), and `persona.test.js` (safety block presence in every prompt,
  citation title list, imported-mind framing in both directions, the
  refusal pre-filter short-circuit, and the see-also suggestion threshold/
  cap/dedup/failure-path). All 140 pre-existing tests untouched and
  passing.

`npm run lint`, `npm run typecheck`, `npm test` (209 tests, 23 files), and
`npm run build` all pass.
