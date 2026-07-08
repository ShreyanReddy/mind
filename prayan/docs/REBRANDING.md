# Rebranding Prayan

The app is built so a full rebrand touches exactly two places: the token
block and the wordmark markup. Everything else — every component, every
pane, every button — reads colors, fonts, and radii from CSS custom
properties, never from a hardcoded value. That invariant is a ground rule
(see `CLAUDE.md`): **never hardcode colors in components.**

## 1. Edit the brand tokens — `src/styles/brand.css`

This file is the single source of truth for the visual brand. It is
`@import`-ed from the top of `src/styles/theme.css`, which contains all the
non-brand layout/structure CSS (grid, spacing, component rules) that should
NOT change on a rebrand.

```css
:root {
  --ink-0: #1e1e1e;        /* editor background */
  --ink-1: #262626;        /* raised surfaces / sidebars */
  --ink-2: #363636;        /* borders, wells */
  --glow-syn: #a882ff;     /* accent purple — links, live signals */
  --glow-mind: #7f6df2;    /* deep purple — persona, selection, hubs */
  --paper: #dcddde;        /* primary text */

  --paper-dim: #999999;
  --danger: #ff6b81;
  --ok: #55d68a;

  --font-display: 'Inter', system-ui, sans-serif;
  --font-body: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Inter', system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', ui-monospace, monospace;

  --radius: 6px;
  --pane-gap: 1px;
}
```

Replace these values with the new brand's palette and type. Every surface,
button, badge, graph node, and chat bubble in the app is themed off this
block, so a new dark-workspace skin (or a light one — the values are just
custom properties, nothing here assumes dark) drops in without touching any
component file.

Do not add brand-specific values anywhere else — no inline `style` colors,
no hex codes in component files, no fonts introduced outside
`--font-display` / `--font-body` / `--font-mono`. If a component needs a new
visual role (e.g. a new status color), add a token for it here first, then
reference the token.

## 2. Update the wordmark — `src/App.jsx`

The name "Prayan" and its tagline are literal text in the topbar
markup, not a token (brand *names* are copy, not CSS):

```jsx
<span className="wordmark">
  Pra<span className="spark">yan</span>
</span>
<span className="tagline">your mind, alive</span>
```

Update the text nodes. The `.spark` class keeps the accent-colored word
using `--glow-syn` — keep that class on whichever word should carry the
accent color, or drop it if the new wordmark is a single color.

## 3. Assets

There are no bitmap logos or icon fonts to swap — the ribbon glyphs in
`App.jsx` (`✎ ◉ ☰ ⇄ ⚙`) are plain Unicode characters, not images, so there
is nothing else to replace. If a rebrand wants custom iconography, add
original SVGs (never assets copied from another product — see
`CLAUDE.md`) and reference them the same way the glyphs are used today.

## 4. Verify

After editing tokens and the wordmark:

```
npm run lint
npm run typecheck
npm test
npm run build
```

Then eyeball the four views (Notes, Graph, Persona, Marketplace) plus
Settings — the graph canvas in particular reads colors via
`getComputedStyle` at runtime (`src/components/GraphView.jsx`), so confirm
node/synapse colors picked up the new tokens.

## 5. What deliberately does NOT change on a rebrand

Renaming the product must never break existing users' data or bundles.
These identifiers are wire/storage formats, not brand copy — leave them:

- `src/lib/db.js` — the Dexie database name `manyam-mind` (an existing
  user's whole vault lives under it)
- `src/lib/store.js` — `importBundle()` accepts the legacy
  `'manyam-mind/1'` and `'synapse-mind/1'` format tags forever; exports are
  stamped `'prayan-mind/1'` (renamed 2026-07-08 along with the directory,
  since no production bundles existed yet)
- `src/lib/store.js` — the one-time-migration localStorage key
  `manyam.vault.v1`
- `src/lib/sync.js` — the CRDT origin tag `manyam-remote`

History: the product shipped Phases 0–5 as "Manyam Mind" and was renamed
to **Prayan** by owner decision on 2026-07-08 (this procedure was executed
then; desktop identifiers `com.prayan.app` / crate `prayan` were still
unreleased, so they were renamed outright). Later the same day the
`manyam-mind/` directory itself was renamed to `prayan/` (with all CI and
docs paths updated) and the export format tag moved to `prayan-mind/1` —
both were safe because nothing had shipped; the Dexie database name,
localStorage migration key, and CRDT origin tag remain the only
'manyam'-flavored identifiers, kept because renaming them would destroy
existing local vault data for zero user-visible gain.
