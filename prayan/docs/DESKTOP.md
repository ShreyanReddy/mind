# Desktop build (Tauri) — PLAN.md §6.1

The desktop app is a thin Tauri 2 shell (`src-tauri/`) around the exact same
web frontend. No product logic lives in Rust; the shell exists for three
things:

1. **A real window** with the app packaged as a native binary per OS.
2. **Folder-vault mode everywhere** — in browsers, folder vault needs the
   File System Access API (Chromium only). Inside the shell,
   `src/lib/fsvault.js` detects Tauri and uses the `dialog` + `fs` plugins
   instead, so notes round-trip as real `.md` files on any OS. The picked
   folder stays accessible across restarts via `tauri-plugin-persisted-scope`
   (no re-picking, no re-prompting).
3. **A tighter security posture** — the window CSP is pinned in
   `src-tauri/tauri.conf.json`; the fs scope is bounded to
   `$HOME`/`$DOCUMENT` in `src-tauri/capabilities/default.json` and further
   narrowed at runtime to the folder the user explicitly picked.

## Local development

Prereqs: Node 20, Rust (stable). On Linux also:

```sh
sudo apt-get install -y libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev libayatana-appindicator3-dev
```

Then:

```sh
npm install
npm run tauri dev      # dev window against the Vite dev server
npm run tauri build    # production bundles in src-tauri/target/release/bundle/
```

## CI

- `ci.yml` runs `cargo check` on the shell on every push (Linux) so the Rust
  side can't rot silently.
- `desktop.yml` builds installable bundles for Linux/macOS/Windows on demand
  (`workflow_dispatch`) or on a `v*` tag, and uploads them as workflow
  artifacts. Code signing is deliberately not configured yet — artifacts are
  unsigned; add signing secrets per the Tauri docs when distributing.

## Icons

`src-tauri/icons/*` are generated from the original artwork in
`src-tauri/app-icon.svg` (`npx tauri icon src-tauri/app-icon.svg`). Rebrand
procedure: edit the SVG (colors mirror `src/styles/brand.css`), re-run the
generator, commit the results. See also `docs/REBRANDING.md`.

## Mobile

There is no mobile shell yet. The interim mobile story (PLAN.md §6.1) is the
responsive web layout: under 720px the app collapses to a single pane with
the view ribbon as a bottom bar and the note list as an off-canvas drawer.
