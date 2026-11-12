# Docking-library spike evidence

Research for [#2182](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/2182); recommendation in [proposed ADR 0028](../../adr/0028-docking-library-selection.md). Not an adoption-gate pass. Base: `0872e406`, 2026-11-12, macOS arm64, Node 26.13.0, esbuild 0.28.2, Playwright 1.64.0 / Chromium 156. Candidate installs are **outside the workspace**, with scripts disabled; no production dependency was added.

Reproduce from the repository root after `pnpm install --frozen-lockfile`:

```sh
node tools/spikes/e11-editor/install.mjs
node tools/spikes/e11-editor/build.mjs
pnpm exec playwright test -c tools/spikes/e11-editor/playwright.config.mjs
```

`TKR_SPIKE_DEPS` and `TKR_SPIKE_OUT` may set external directories. The latter receives `build.json` and `results/`; snapshots from this run are in [raw/](raw/). Bundle sizes below are minified bytes / gzip -9 bytes: JS includes the same Preact panels and prototype adapter, CSS separate. Sizes are not a production build budget. `raw/build.json` includes the esbuild input attribution and static scan; static pattern counts are not proof of absence of dynamically generated code.

| Candidate | JS / gzip | CSS / gzip | Web host / simulated webview CSP violations after operations | Keyboard and ARIA observed | Layout features and licence |
|---|---:|---:|---|---|---|
| dockview 8.9.0 + core 8.9.0 | 388,172 / 95,939 | 142,792 / 10,863 | 0 / 0 | Four tabs had `tab`, `aria-selected`, `aria-controls`; arrow and Delete worked; two sashes neither focusable nor `separator` | tabs, split, in-page float, serialisation; MIT; no enterprise package installed |
| dock-spawn-ts 4.5.4 | 148,362 / 36,123 | 56,598 / 11,692 | 0 / 0 | Six tab/title elements, none role=tab or focusable; two sashes not focusable | tabs, split, in-page float, serialisation; MIT |
| @lumino/widgets 2.10.0 | 209,863 / 56,323 | 5,786 / 1,363 | 0 / 0 | Four role=tab with selected state; arrow worked, Delete did not close; two sashes not focusable | tabs, split, serialisation with application id mapping; no in-page float tested; BSD-3-Clause tree |
| golden-layout 2.6.0 | 145,775 / 37,262 | 8,738 / 2,323 | 0 / 4 `img-src` | Four tab elements, none role=tab or focusable; two sashes not focusable | tabs, split, serialisation, popout API not exercised; MIT |

Web policy is read from `tools/browser/editor-web/index.html`; webview policy is the template from `packages/host-vscode/src/extension.ts`, with its origin simulated over HTTP. Exact strings, lifecycle results and console messages are in the respective raw JSON. Golden Layout's embedded data images violate the simulated webview's `img-src`; the web policy allows `data:`. None of the bundles matched the repository dynamic-code scanner. Dockview's ESM with external CSS was used, not its self-styling UMD. No popout path, offline service-worker installation or screen reader was tested.

The adapters mounted Preact through a dispose handle and a stand-in shared document. Two views reflected a paint, closing/recreating one preserved the dirty model and undo, and serialising then recreating the layout retained the model. Dockview also moved and floated a panel. Missing component handling was application-supplied: dockview, dock-spawn and Lumino adapters produced a placeholder; Golden Layout threw on an unregistered type. This is **not** proof of the real editor-model, host lifecycle or restart persistence.

The dockview keyboard prototype adds 100 nonblank, non-comment lines: F6 group traversal, scoped keyboard movement/splitting and resizing, content focus and focus restoration after last-tab closure. Eleven scripted keyboard steps passed in Chromium and an Electron 45.2.1 scratch window over privileged `app://` with zero violations. The `app://` run is not a packaged desktop editor. Resizing via commands does not make splitters accessible separators. The 380 Monaco keybindings captured on macOS contained no F6/Shift+F6; several arrow chords are Monaco bindings, so they are scoped to focused dock tabs. Other platforms and system-level collisions are untested.

Registry/GitHub metadata captured 2026-11-12: dockview repository 3,523 stars, pushed 2026-11-12, 1,891 default-branch commits since 2025-11-12, 1,685 attributed to one account (includes automation; commit count is not review capacity). Dock-spawn-ts: 148 stars, pushed 2026-10-23; Lumino: 765, pushed 2026-11-01; Golden Layout: 6,722, pushed 2026-09-12 but last npm release 2023-02-21. Sources: [dockview](https://github.com/dockview/dockview), [dock-spawn-ts](https://github.com/node-projects/dock-spawn-ts), [Lumino](https://github.com/jupyterlab/lumino), [Golden Layout](https://github.com/golden-layout/golden-layout). Dockview's [repository licence](https://github.com/dockview/dockview/blob/master/LICENCE.md) distinguishes MIT packages from proprietary enterprise. Keyboard docking/navigation are enterprise modules; no enterprise package was installed. `flexlayout-react` and `rc-dock` need React or an unapproved `preact/compat` decision; [Trellis](https://github.com/DanFessler/trellis/blob/main/LICENSE.md) has a non-commercial tier and is not admitted under G6; [atelier83/layouts](https://github.com/atelier83/layouts) is new (created June 2026, three stars) and was not prototyped. These are screens, not equivalent feature proofs.

The web host's `frame-ancestors` directive is ignored in a meta policy; tracked separately as [#2184](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/2184).
