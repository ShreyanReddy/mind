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
