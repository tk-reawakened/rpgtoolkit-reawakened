# Where the editors are today

Part of the [editor ecosystem proposal](README.md). This page describes; it proposes nothing. It was written from the repository as it stood on 2026-11-11 (commit `20e0f54`).

## In plain terms

The editors this project starts from are the ones RPG Toolkit 3.1 shipped. They are taken one at a time on [toolkit-3-editors.md](toolkit-3-editors.md). This page is about our own code and plans.

Very little editor exists as running code: one document (the main game file) with one edit (change the game's title), shown by one view, over a test double of the host. What exists is carefully built and is the right first slice. What is planned is large and well specified: about seventy stories in five epics. The plan's shape, though, is the Toolkit 3 tool list, and nothing yet says how a second, tenth or plugin-supplied editor is attached.

## What is built

| Package | What it holds today | Evidence |
|---|---|---|
| `platform-services` | The host door: `capabilities` (five flags), `fs`, `project`, `settings`, `document.edited`, and an in-memory double for tests. `run`, `export`, `dialogs`, `clipboard`, `language` and `shell` are named by AD-20 and not declared yet; each waits for its first caller. | `packages/platform-services/src/services.ts` |
| `editor-model` | Document identity (ADR 0022 D1) and **one** document type, `MainDocument`, for the main game file. Its command set is one command, `SetGameTitleCommand`. It keeps bytes plus an edit stack and saves through the same-version writer. | `packages/editor-model/src/main-document.ts` |
| `editor-ui` | `mount(el, ctx) -> { dispose }`, a settings view in Preact and TSX, and a hook that binds a view to a document. | `packages/editor-ui/src/` |
| `native-data` and its tools | The native-document checker, the extension registry (one row, `.tkranm`), the animation clip reader and writer, rename, and an importer from the legacy clip. | `packages/native-data*/src/` |
| `lsp`, `script-tools`, `script-spec`, `script-cli` | RPGCode language services and the creator-test framework. | `packages/` |
| Hosts | **None.** There is no `host-web`, `host-vscode` or `host-desktop` package yet. Story 11.18 ([#1833](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1833)) carries the settings tracer into the first two. | `packages/` listing |

At the 2026-11-11 snapshot date, the count of working editors, in the sense of "open a file, change it, save it, in a real host", was zero. The follow-on implementation below records the first host slice.

## Follow-on implementation: the settings tracer (story 11.18)

Since the snapshot above, story 11.18 adds the first real host slice: the shared game-settings view edits a `.gam` through the same `editor-model` in the browser and VS Code. The current form edits only the game title; it is not the complete Toolkit 3 settings editor.

- **Browser:** run `pnpm browser:build` and `pnpm browser:serve`, then open `http://localhost:4173/tools/browser/editor-web/index.html`. Choose a project directory where File System Access is available, or use the `.gam` file picker. The standalone-file path is an explicitly labelled session copy: edits live only in memory and are lost when the page closes. It does not claim a persistent project folder.
- **VS Code:** run `pnpm --dir extensions/editor build`, then launch the development extension with `code --extensionDevelopmentPath="$PWD/extensions/editor" "$PWD/docs/spec/examples/game"`. Open a `.gam` and choose the RPG Toolkit Game Settings custom editor if it is not the default. The extension-host model remains authoritative and a failed workspace write remains a named, dirty save error.

The real vscode.dev proof exercises the mounted VS Code editor under CSP, edits and saves the `.gam`, then reopens it and verifies persisted bytes. A separate shared-adapter integration test compares bytes saved through the web and VS Code adapters. These checks complement, rather than replace, the host-adapter failure and fetched-corpus tests.

## What is decided

| Decision | Record |
|---|---|
| Document identity, content ownership, lifecycle promises, settings layers, run snapshots, history, Git | [ADR 0022](../adr/0022-shared-editor-authoring-contracts.md) (Accepted) |
| Preact with TSX for `editor-ui`; Monaco for code outside VS Code; Electron for the desktop | [ADR 0025](../adr/0025-editor-ui-framework-preact-tsx.md), [ADR 0021](../adr/0021-monaco-code-editor.md), [ADR 0013](../adr/0013-desktop-shell-electron.md) |
| Toolkit 3 formats stay first-class editable; native YAML is not needed for the first release | [ADR 0005](../adr/0005-independent-product-v1-and-native-format.md), amendment of 2026-11-09 |
| Scenes, tile recipes and asset packs are `.tkr*` YAML editor documents that build legacy files | [ADR 0019](../adr/0019-tkr-authoring-formats.md) (Accepted) |
| Native contracts: stamp, per-contract versions, path identity, plugin blocks | [ADR 0023](../adr/0023-native-data-contracts-versioning-identity-and-sidecars.md) (Proposed) |
| A plugin declares the data it adds to each native contract | [ADR 0024](../adr/0024-plugin-data-contributions.md) (Proposed) |
| Direction of the experience: RPG Maker's clarity of purpose, VS Code's workspace flexibility, direct visual editing | Owner, 2026-11-07 ([research decisions, section 8](../../_bmad-output/initiative-rpgtoolkit-reawakened/research-editor-ux-for-beginners/decisions.md)) |

## What is planned

The five editor epics, from the [editor delivery plan](../../_bmad-output/initiative-rpgtoolkit-reawakened/ux-connected-editors/editor-delivery-plan.md):

| Epic | Covers |
|---|---|
| [11 Foundation](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1357) | Documents, hosts, navigation, preferences, game settings, code editing, launches, creator tests, history, Git |
| [12 P0 assets](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1358) | Board, tileset browser, sprite graphics, character, item, animation, tile bitmap, packaging |
| [13 P1 tools](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1359) | Pixel art, tile grabber, tilesets, animated tiles, enemies, moves, status effects, backgrounds, lighting, auto-tiles |
| [14 Beginner tools](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1360) | Visual events, skins, audio audition, media conversion, setup, tutorials, visual test fixtures |
| [15 Desktop editor](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1361) | The Electron application and its services |

[Epic 27](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1802) (native data contracts) sits beside them and is deferred for the first release.

## Where the structure stops short

These are observations about the plan's shape. None is a defect in a story.

1. **The unit of the plan is the Toolkit 3 tool.** Every story in epics 12 and 13 is named for a legacy tool and its file type. That is correct for parity ([editor-features.md](../editor-features.md), section 11). It gives no home to an editor for something Toolkit 3 never stored.
2. **Nothing binds a kind of document to its model and its views.** `MainDocument` and `MainCommand` are concrete types for one file type. The second document (the board tracer, 12.1) will need the same lifecycle. With no shared shape, each new editor adds another concrete document type, and each host adds another hand-written registration. In VS Code that is one `customEditors` entry per file type, kept in step by hand.
3. **The lifecycle promises are stated once and would be proved per editor.** ADR 0022 D3 lists what every host must pass. There is no matching list of what every *kind* must pass (a save with no edit writes the same bytes, a rejected command changes nothing, unknown data survives).
4. **The plugin contract has no editor surface.** `PluginDefinition` lists `id`, `version`, `commands`, `decoders` and `subsystems`, and ADR 0024 adds `contributes` for data. Nothing declares a kind, a field's label, a view, a preview or an importer. The [plugin-editor study](../../_bmad-output/initiative-rpgtoolkit-reawakened/research-editor-ux-for-beginners/flows/09-plugin-editors.md) names this gap and proposes three levels; they are unapproved.
5. **There is no general form.** Character, item, enemy, move, status effect and background editors are six stories that each build a form. A schema-driven form is planned only for editor *preferences* (11.5).
6. **Project-wide knowledge is spread across stories.** Reference review on rename (ADR 0022 D1.3), folder-aware pickers (11.4), the native checker's reference class and the RPGCode symbol index each know part of "what refers to what". No one index is named as the owner for game data.
7. **Import means legacy import.** AD-31 lets the *engine* decode new formats. In the editor, 14.11 to 14.14 cover audio and video conversion. Nothing covers bringing in a Tiled map, an LDtk level, an Aseprite sheet or a sprite sheet laid out for another tool, with settings that can be changed and applied again.
8. **Two naming conventions for native files are both on record.** ADR 0019 (Accepted) names `.tkrscn`, `.tkrtile` and `.tkrpack` and stamps them `schema: tkr-scn/1.0`. ADR 0023 (Proposed) requires `.tkr` plus exactly three letters and a `contract` and `version` stamp. ADR 0019 also says the board editor's document is a `.tkrscn`, while the ADR 0005 amendment of the same day keeps `.brd` first-class editable and defers native YAML. Filed as [#1839](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1839). The amendment of 2026-11-11 ([ADR 0019](../adr/0019-tkr-authoring-formats.md#amendment-2026-11-11-one-editor-two-files-the-common-stamp)) answers it from the owner's direction of that day: the common stamp, no fixed length for the kind code, and one scene editor that saves to either file.

## What is already strong

The comparison on the next page should be read with these in mind. They are things the rival tools mostly lack, and the proposal builds on them.

* **One editor, three hosts.** The same views in a browser, in VS Code and on the desktop, behind one host door.
* **A deterministic engine.** A run is a function of its inputs and a seed. That makes a test run repeatable, a recorded play session replayable, and a preview trustworthy.
* **Creator tests** in plain `*.spec.prg` files, run on the real engine (TOOL-5).
* **Text-first native documents** designed for Git: one property change is a one-line diff (story 27.6), and a checker reports duplicate identities.
* **Unknown data is preserved**, in legacy residue (AD-18) and in plugin blocks (ADR 0023 decision 12).
* **Honest failure.** Every lifecycle rule says what happens when the host cannot do something.
