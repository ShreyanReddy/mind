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
