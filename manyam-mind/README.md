# Manyam Mind

Build, grow, and transfer your **mind clone**. An original, Obsidian-inspired knowledge app with a living graph, an AI persona grounded in your vault, and a marketplace scaffold for transferring or selling minds.

> Legal note: this is an original codebase inspired by the *concept* of linked-note tools. It contains no Obsidian code, assets, or branding — and yours shouldn't either. Rebrand via `src/styles/theme.css` (brand tokens) and the wordmark in `src/App.jsx`.

## What works today

- **Vault** — markdown notes with `[[wiki-links]]`, autocomplete, click-to-create, read/write modes, full-text search
- **Living graph** — custom force-directed canvas network. Nodes are neurons, links are synapses. Frequently edited/linked notes grow larger and brighter; recent edits pulse; new links fire a traveling spark. Drag, pan, zoom, click to open.
- **Backlinks** — bidirectional connections panel per note
- **Persona** — chat with an AI mind clone grounded in your strongest notes (bring your own Anthropic API key in Settings; stored in-browser only)
- **Transfer** — export/import the entire mind as a portable `.mind.json` bundle (secrets stripped). This is the real unit of transfer and sale.
- **Marketplace scaffold** — client logic (`src/lib/marketplace.js`) + Postgres schema (`supabase/migrations/`), ready for the production build

## Run it

```bash
npm install
npm run dev
# open http://localhost:5173
```

## Take it to production

Open **PLAN.md** — a phase-by-phase build plan written for Claude Opus 4.8 in Claude Code, covering sync + encryption, the embeddings-based persona engine, the paid marketplace with signed ownership transfer, desktop packaging, and security/legal requirements.

## Repo map

```
src/
  App.jsx                 layout, tabs, wordmark
  styles/theme.css        ALL brand tokens (rebrand here)
  lib/store.js            vault store + growth metrics + bundle export
  lib/links.js            wiki-link parser, backlinks, graph builder
  lib/persona.js          mind-context builder + Anthropic API call
  lib/marketplace.js      transfer/sale logic (local live, remote stubbed)
  components/             Sidebar, Editor, GraphView, ContextPanel,
                          PersonaChat, Marketplace, Settings
supabase/migrations/      ordered SQL migrations (marketplace, sync)
PLAN.md                   production build plan for Claude Code (Opus 4.8)
```
