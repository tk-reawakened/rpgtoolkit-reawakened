# Project shell and sharing: flows for beginners

**Research provenance:** legacy-guide material is UX motivation only, not normative implementation authority. Promote missing behavioral requirements through `docs/spec` or `docs/editor-features.md` before implementation.

This document proposes the shell around every editor: opening a project, finding things, configuring a game, testing it, recovering work, and sending the result to somebody else. Recommendations remain research, not approved implementation decisions.

## Jobs

| Author says | Success signal |
|---|---|
| “I want to start a game without learning the file format.” | A pictured project choice creates a playable project, not an empty directory. |
| “I want to find the thing I was just editing.” | Search, quick open, thumbnails, recent documents, and a tree all reach the same asset. |
| “I want to know what this setting does.” | Settings are searchable, described in plain English, and show a useful default. |
| “I want to try this room now.” | Play saves first and starts from the selected board and location. |
| “I need to know what will break before I rename or delete something.” | The reference graph says “used in 3 places” and offers a preview, replacement, or safe cancellation. |
| “My laptop/browser crashed; I do not want to lose my game.” | Recovery offers a draft and a local-history snapshot with a visible diff. |
| “I want to send this to a friend.” | A preflight check leads to a Web build and a playable link without requiring the friend to install TKR. |

## Legacy flow and where it hurts

The observations below are from the legacy guide, `01-environment-and-main-file.md` sections “Starting the editor,” “MDI shell anatomy,” “Project tree,” “Test Game,” and “Main File / Project Properties editor”; the labels distinguish discoverability (D) from safety (S).

| Step | What happens | Problem: D / S |
|---|---|---|
| 1 | Launch shows a splash, then a tip dialog; a remembered project may open automatically, and a first-run tutorial prompt appears. | D: a new author cannot tell whether to follow the tip, tutorial, or remembered project. |
| 2 | New Project asks for a title, a folder, and whether to copy default files. | D: “copy default files” does not explain what those files make possible. |
| 3 | Setup creates folders and a Main File; defaults include a start program, start board, start character, plugins, and a menu key. | D: the author is not shown a bill of contents or a first playable goal. S: an existing folder can be reused without a clear collision decision (legacy guide, `01-environment-and-main-file.md` section “Starting the editor”). |
| 4 | Open Project chooses a `.gam`; Open chooses a supported file. | D: the distinction between opening a project and opening a loose asset is not taught. |
| 5 | The shell opens one child window per document; opening the same file again can create another tab. | S: two copies of one document can diverge; the active panel can act on the wrong copy. |
| 6 | Tools, project list, new-editor launcher, tileset browser, and board toolbox occupy mutually exclusive side-panel slots. | D: a useful panel disappears when another is selected; the active-editor rule is hidden. |
| 7 | The project tree recursively shows folders and extension icons. Double-click opens; refresh and collapse are manual. | D: every file looks alike; type, preview, and purpose are absent. |
| 8 | Rename warns that references are not updated; delete removes a file immediately. An open deleted file can later be saved back. | S: rename breaks links, and delete can either destroy a dependency or recreate a supposedly deleted file. |
| 9 | Project Properties uses several tabs for title, startup, controls, runtime keys, fighting, graphics, day/night, and plugins. | D: settings are split by historical tab placement rather than by a beginner’s question. |
| 10 | Empty file choices are displayed as “None”; direct entry and browse fields accept values with little validation. | S: an empty-looking field can become a real stored value; missing files are found late. |
| 11 | Key capture covers movement and a small action-key group separately; extended runtime keys are another dialog. | D/S: conflicts across the complete set are not visible together. |
| 12 | Fighting settings open a child dialog with OK but no Cancel; opening it can dirty the project. | S: accidental edits cannot be cancelled cleanly. |
| 13 | Plugins are selected by browsing for a library; descriptions are shown only after a library is added. | D: capability and compatibility are unclear before selection. |
| 14 | Test Game launches the engine using files already on disk and does not save dirty editors first. | S: “I changed it, why did it not change?” and unsaved work is omitted. |
| 15 | Tips are one-at-a-time text; the tutorial is a separate read-only sequence with Back and Next. | D: help is detached from the real task and does not prove that the author can use the editor. |
| 16 | Build actions create a self-running executable, a `.tpk`, or a setup ZIP; the guide does not describe a web share flow. | D: packaging is expressed in engine terms rather than “send this link to a friend.” |

## Redesigned flow

### 1. First run and New project

Opening the standalone PWA shows a small welcome screen, not a blank workspace:

```text
┌──────────────────────────────────────────────────────────────────┐
│ TKR                                      [Open project] [Help ?] │
│                                                                  │
│ Make something playable                                         │
│ [ New project ]     [ Open folder ]     [ Import legacy project ]│
│                                                                  │
│ Recent projects:  Tiny Village     Space demo     (none yet)     │
│                                                                  │
│ [Start the 8-minute tour]       [I already know what I’m doing]  │
└──────────────────────────────────────────────────────────────────┘
```

`New project` is a real decision dialog, with pictures and a sentence for each choice:

1. **World style:** cards for **Top-down** (“walk on square ground”) and **Isometric** (“walk in a diamond-shaped world”). The choice is project-wide. A small animated preview shows movement and a wall overlay; keyboard navigation selects cards.
2. **Name:** title plus a generated folder name preview. If the destination exists, show “This folder already contains a project” and require Open, Replace after an explicit confirmation, or Choose another folder. Never merge silently.
3. **Template:** **Blank**, **Starter village**, or **Battle demo**, each with a screenshot, one-sentence goal, and “contains” disclosure. Blank still has the minimum playable shell; it is not an empty folder.
4. **Create and play:** a summary lists style, title, destination, and template. `Create project` opens the start board and offers the tutorial in the real editor.

#### New-project bill of contents

Template contents are limited to the shared starter catalog in `flows/03-tiles-and-art-sources.md`; this flow does not define or promise a second asset manifest. Catalog availability and G6 licensing determine which assets can be bundled.

| Content | Blank | Starter village | Battle demo | Why it exists |
|---|---:|---:|---:|---|
| Start board and start marker | yes | yes | yes | Play has somewhere to begin. |
| Hero and available walk/look assets | catalog-dependent | catalog-dependent | catalog-dependent | The first run has a controllable character when licensed assets are available. |
| Start program | yes | yes | yes | Runtime entry point. |
| Example door, Person, village boards | no | catalog-dependent | no | Teaches placement and navigation. |
| Battle arena, enemy, stances/background | no | no | catalog-dependent | Demonstrates battle only where catalog supplies assets. |
| Tutorial/test scenario | optional | optional | optional | Guide authors through real project assets. |

Do not promise unlisted UI art, fonts, or sound cues; derive exact inventory and counts from the catalog. Bundled content must meet the G6 license gate and appear in `THIRD_PARTY_NOTICES`; otherwise use authored placeholders or omit the affected template.

Bundled art, sound, fonts, and samples MUST be CC0 or Bronze-or-better on the Blue Oak list, and each item MUST be listed in `THIRD_PARTY_NOTICES`. A template that cannot meet that gate ships with authored placeholders or is removed, not silently bundled.

After creation, a non-blocking checklist says: “Your game is ready. Press Play to try it.” The first-run tutorial highlights the start marker, asks the author to paint one tile, change one sentence, and press Play. Every lesson edits the real project and can be dismissed without a second tutorial application.

### 2. Workspace, tree, quick open, and command palette

The common layout is deliberately stable across editors:

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│ TKR / Tiny Village [Save] [Undo] [Redo] [Play current board] [Play from start] [Test here] │
│ [Quick Open  Ctrl/Cmd+P] [Search project] [Command palette  Ctrl/Cmd+Shift+P]│
├───────────────┬─────────────────────────────────────────────┬───────────────┤
│ PROJECT       │ tabs: Start board | Old Man | Settings     │ INSPECTOR     │
│ [By type ▾]   │                                             │ selection or  │
│ ▾ Boards      │              active editor                  │ settings      │
│   ▣ Village   │                                             │               │
│ ▾ People      │                                             │               │
│   ☺ Old Man   │                                             │               │
│ ▾ Tiles       │                                             │               │
│ ▾ Programs    │                                             │               │
│ [Folders]     │                                             │               │
├───────────────┴─────────────────────────────────────────────┴───────────────┤
│ Problems  2   Output   Play   Host History (where available)      Ready / Saved │
└─────────────────────────────────────────────────────────────────────────────┘
```

Rules:

- The tree has **By type** and **Folders** views. Both are projections of one project index, so an asset has one identity and one context menu.
- Asset rows show a thumbnail where meaningful, a purpose label, dirty/recovered badges, and a warning badge. Hover previews animation and audio without opening another document.
- Double-click or Enter opens the asset. If already open, focus the existing document instead of opening a second instance. Quick Open uses fuzzy name, type, folder, and recent history; it shows a thumbnail and breadcrumb.
- Search covers names, object labels, settings descriptions, script text, and reference edges. Search results can open the exact board object or settings row.
- The command palette exposes every action, its shortcut, and its capability requirement. A missing host capability is shown as “Unavailable here because this host cannot write folders,” not a dead command.
- Tabs are one document instance per URI per host. Closing a dirty tab presents host-supported Save, Keep draft, or Cancel; history/reopen behavior depends on host support.
- Docking layout is saved per project but has a one-click **Reset beginner layout**. Panels are resizable and keyboard-focusable; no panel is mutually exclusive with another.

### 3. Host differences without three editor designs

`editor-ui` owns the flows. Hosts provide platform services through AD-20, and documents follow AD-19: one model and serialisable command stack per URI; the host controls save, backup, and external-change timing.

| Capability | PWA (beginner path) | VS Code webview | Desktop shell |
|---|---|---|---|
| Open project | Folder picker where available, or imported ZIP/single file; recent projects in browser storage. | Workspace/folder URI through extension host. | Native folder picker and recent-project list. |
| Documents | Browser storage; explicit project backup download. | Host document controller and VS Code backup/revert. | Atomic filesystem writes and OS watcher. |
| Play | New tab or external browser; external navigation asks permission. | External browser or host runner where supported. | Separate runner window. No host loads legacy native DLLs. |
| Export | Web build and downloadable package; folder export may become ZIP. | Host export service writes folder/archive. | Host export service writes distributable output; executable wrapper only where supported. |
| Recovery | Browser storage recovery is a proposal pending host contract. | VS Code host backup/revert. | Host backup/revert; project-local journal/history is not assumed. |
| Missing capability | Explain and offer a supported download/import route. | Use command palette to open in a capable host. | Explain unavailable capabilities; never imply legacy DLL support. |

A host MUST NOT move data mutation into its own bespoke UI. When the PWA cannot create a directory, the shared export action produces a single archive instead of quietly dropping assets.

Project files are hidden by convention: new authors work through the board's **Start here** marker, Party setup, and the feature being changed. Project settings is an exceptions/inspection page that shows resolved values and their source and links to the owning editor. Experts can explicitly **Open as text**. This follows the proposed convention in `flows/08-project-file-by-convention.md`; it remains research, not approved implementation.

```text
Project settings · exceptions and inspection
Start board: Village · from board marker [Open board]
Starting party: Hero, Healer · from Party setup [Open setup]
Start program: Prg/start.prg · convention [Open]
```

Party setup owns starting members, inventory, and equipment; each board owns its Start here marker. Settings shows effective values read-only with owner-jump links. The first starting-party member is the player by convention. Legacy `.gam` stores one `initChar`; a multi-member party needs native data or generated startup code such as `addplayer`.

| Capability | Owner / reachable flow |
|---|---|
| T-08 preferences (syntax colours, UI language, splash/tip toggles, board-editor colours) | Per-user Preferences page, discoverable from application menu, not project data. |
| T-10/11/13 joystick, cursor image/hot spot/sounds, game speed, tile/pixel/pixel-push movement, pathfinding, colour depth, title-bar FPS, debug drawing | Complete Controls, Movement, Look and feel, Developer overlays settings; reachable, not silently dropped. |
| T-23/T-26 board-layer images | Board outline Images entry: add image, position, layer, transparency colour, parallax/stretch. |
| T-26 trigger options | Trigger inspector exposes repeat while inside, every N pixels, and stop-player-movement, with activation/action settings. |
| T-30/T-31 coordinate/vector formats | Import previews coordinate upgrade; pixel-coordinate and pre-vector boards remain editable without forced lossy conversion. |
| T-35 placeholder drawing | Object inspector offers placeholder drawing for objects without graphics. |
| T-36/T-38 tile and `.gph` operations | Tile editor exposes replace colour, cut corner, skew, layer-tile overlay, greyscale, wrap-scroll, save to chosen slot, and `.gph` single-tile add/convert/export. |
| T-40/T-46 program helpers | Program creation offers header templates and capitalisation helper; auto-command cleanup wraps loose dialogue lines with preview. |
| T-64 skins | Skin editor is deferred, not dropped; no legacy skin DLL support. |
| T-70/T-72 distribution | Distinct Web package and Setup ZIP profiles, each with preflight/output disclosure. A self-running executable is **not** a profile: the owner dropped producing one on 2026-10-31 (it is read for import only). |
| T-73 flat layout | Import recognizes 2.x flat projects, previews mapping/upgrades and retains originals for recovery. |
| T-81 browser | Legacy embedded browser intentionally remains external: open URLs in host/browser with permission; no browser recreation. |
| T-82 file association | Host setup offers supported project/file associations and explains permission limits. |

Plugins follow the proposed extension contract in `flows/09-plugin-editors.md`: plugin-defined fields are edited by plugin-provided editor extensions within the shared editor, not forced into a generic editor. Adding a pack is a two-step action: add it, then explicitly review and enable/order it. File presence/drop never auto-enables it. No first-party trust tier or special host privilege is assumed; trust/isolation remains one unresolved contract. Legacy native DLL plugins are unsupported on all new hosts.

### 5. Problems panel and reference graph

The project index maintains stable IDs for assets and placed objects, with names and relative paths as presentation. The Problems panel is grouped by severity and location:

```text
Problems (4)
  Errors (1)
  ! Start character is missing                Settings › Start   [Choose]
  Warnings (2)
  ! Board “Cave” is unreachable from the start [Show graph]
  ! “Town tiles” is unused                    Tiles › Town       [Open] [Keep]
  Info (1)
  i Door destination repaired during import                       [Review]
```

Diagnostics are emitted while editing and before Play/export. Each item has a sentence, the cause, and the nearest next action: **Choose**, **Create**, **Open**, **Replace**, **Show graph**, or **Ignore this warning**. Ignore is stored with a reason and can be restored from Problems settings.

The proposed graph view presents boards as frames and references as arrows. It distinguishes proven from uncertain edges. Rename/move previews enumerate proven updates; dynamic or unresolved script strings require manual review. Cross-document apply/undo is Conditional pending an AD-19 transaction contract. Delete offers a preview, replacement/removal where references are proven, or Cancel; uncertain edges are never declared safe. Unused assets are warnings, never automatic deletion candidates.
### 6. Play, Play-from-here, and test scenarios

**Play** saves relevant edits and tests the **current board**, not the configured start. The host must save successfully before launch; on failure it reports the error and does not launch stale data. Play from the current board chooses the test position in this order: explicit **Test here** context-menu spot, that board's test marker, then a prompted safe traversable spot. Never use the incidental last click; it may be inside a wall or trigger. A step-on trigger starts only when entered, so testing from inside it does not activate it; test from an adjacent tile or explicitly test its action.

**Play from start** is a distinct action. It saves relevant edits and starts at the configured Start here board marker with the first starting-party member as player. It does not inherit the current-board test spot.

**Play from here** uses the safe test-position resolution above and passes a temporary `run` override; it never mutates the game's configured starting board, party, or marker. It displays a debug-start banner and offers restart at game start. Runtime gameplay changes are not saved back into project documents.

A saved **test scenario** is the only flow that guarantees a chosen seed. It contains board/position, party, variables, inventory, and test inputs; ordinary Play has no selected-seed guarantee.

### 7. Autosave, recovery, and local history

- Every edit is a serialisable command in `editor-model`; selection and camera changes are not edits.
- Host backup/revert is available only where the host contract provides it. Draft journals, cross-host equivalent recovery, and project-local History are proposals requiring an AD-19 amendment; do not promise them as shared behavior.
- The editor reports save confirmation from the host and never claims “saved” before confirmation. A failed save preserves the host's prior canonical file where its atomic-save contract guarantees that behavior.

### 8. Help, onboarding, and accessibility

The tutorial runs inside the actual editor: highlight a control, provide one sentence, wait for the author’s real action, then verify it. A “Show me” button demonstrates without committing; a “Try it” step commits through the same command stack. Tooltips use plain words, include units, and link to the matching help section. Errors state the next action: “The start board is missing. Choose a board or create one.”

Keyboard navigation reaches every tree row, tab, field, canvas action, and bottom panel. Every icon has a label and tooltip. Focus rings remain visible at all zoom levels. Text and controls meet the project’s contrast target in light and dark themes. Overlays use colour plus pattern, icon, or hatch so walls, triggers, and warnings remain distinguishable without colour vision. Canvas actions have keyboard equivalents; hover-only information is repeated in the inspector and Problems panel. Screen-reader labels expose asset type, name, dirty state, and diagnostic severity.

### 9. Export, sharing, and preflight

The top-level **Share / Export** action is a profile picker, not a collection of unexplained build commands:

| Profile | Output | Use |
|---|---|---|
| **Web build** | Static playable package with manifest and indexed project files | Download or host independently; deployment service is not bundled. |
| **Share playable link** | Upload through a host/service selected and configured by the owner | Pending: no hosting backend, privacy, expiry, limits or anonymous-publishing contract is established; never imply solved. |
| **Project export** | Editable project archive | Native extension/container remains undecided. |
| **Distributable package** | Playable distribution package using the documented package manifest | Not a promise to write legacy authoring formats. |
| **Setup ZIP** | Installer package that registers the game with the player's library | Distinct T-70/T-72 profiles with explicit host support and preflight; not legacy `.tpk` export, and no self-running executable (read for import only). |

Before any profile, preflight checks:

1. Resolve the configured main game settings and all reachable assets.
2. Report missing files, invalid paths, unsupported plugins, unresolved board destinations, unreachable start content, unused files, and licence notices.
3. Show estimated output size and a complete file list with an option to open each cause.
4. Require explicit acknowledgement for warnings that can produce a playable-but-different result; errors block export.
5. Generate a reproducible report beside the output, including profile and schema versions.

The distribution writer normalises package entry separators to `/`, includes a manifest with schema, main, and index for packages TKR writes, and rejects unsafe or duplicate paths according to `packaging-and-paths.md`. Legacy `.tpk` input remains import/playback compatibility; TKR does not promise writing legacy authoring formats. Share-link upload remains pending a host/service contract; a URL is shown only after an actual configured host confirms upload.

#### Time to first shared game budget

The budget is a design target for scenario (a), not a measured result.

| Minutes | Action | Design support | Exit evidence |
|---:|---|---|---|
| 0–2 | Open PWA and choose New project | Welcome screen, no install, keyboard-accessible cards | Template chooser visible |
| 2–5 | Pick Top-down, name project, choose Starter village | Pictures, bill of contents, collision-safe folder choice | Project created without a blank state |
| 5–8 | Follow the first three in-editor tutorial steps | Real editor, defaults, starter library | Author has painted/edited one real thing |
| 8–15 | Add or change a village tile and inspect the player start | Start marker, contextual inspector, undo | Change is visible on the start board |
| 15–19 | Edit the example person and door | Sentence trigger, linked destination, reference graph | Door and person have visible behaviour |
| 19–22 | Press Play, then Play from here | Save-first runner and debug-start banner | Author has walked and tested the village |
| 22–26 | Open Share / Export and fix preflight findings | Problems links, licence/file report, Web build profile | Build completed with a report |
| 26–30 | Open Share / Export and run preflight; build distributable package | Host export capability, licence/file report | Package completed with report |

## Scenarios walked

### (a) A total beginner makes and shares a village in under 30 minutes

| Step | Walkthrough | Covered / Conditional |
|---|---|---|
| 1 | Opens PWA and sees New project without installing a toolchain. | Conditional: host availability and template implementation. |
| 2 | Chooses Top-down, names game, chooses a starter template. | Conditional: templates use the catalog in `flows/03-tiles-and-art-sources.md` and require licensed assets. |
| 3 | Understands the generated contents. | Conditional on template catalog and generator implementation; do not label omitted generator functionality “coming soon.” |
| 4 | Changes a tile and a line of dialogue. | Conditional on board/program editor implementation. |
| 5 | Presses Play on the current board and sees saved edits. | Conditional on save-first current-board Play contract and host save success. |
| 6 | Builds and sends a playable link. | HOLE: sharing backend, privacy, expiry, limits and permission remain unresolved; Web package export is distinct and does not solve hosting. |

### (b) A returning creator opens an old project

| Step | Walkthrough | Covered / Conditional |
|---|---|---|
| 1 | Imports from Toolkit root (containing `Main/`), or supplies Toolkit root/main plus legacy project folder, or imports a Setup ZIP / `.tpk` package. | Conditional: a legacy project folder alone may omit its `.gam`; prompt for the missing Toolkit root/main or package manifest rather than claiming detection is complete. |
| 2 | Reviews import report and original-file preservation. | Conditional: exact report schema/rollback package is unspecified. |
| 3 | Opens a board and finds referenced tiles/People. | Conditional on importer/indexing. |
| 4 | Adjusts a setting and finds its owner. | Conditional on proposed settings/convention flow. |
| 5 | Plays imported project. | Conditional on save-first behavior; legacy native DLL plugins are unsupported on all new hosts, with no compatibility shim. |

### (c) A crash mid-edit and recovery

| Step | Walkthrough | Covered / Conditional |
|---|---|---|
| 1 | Author edits, host crashes before Save. | Conditional: recovery behavior depends on host backup/draft contract. |
| 2 | Reopens and reviews recoverable drafts. | Conditional: draft storage and chooser are proposals, not established AD-19 services. |
| 3 | Recovers only one document from a multi-document change. | Conditional: no cross-document recovery transaction is defined. |
| 4 | Saves recovered board; failed write leaves prior canonical file intact. | Conditional on host atomic-save contract. |
| 5 | Restores a prior snapshot. | Conditional: project local history is not established in AD-19; use host backup/revert where available. |

### (d) Rename a board used by three doors, then delete one that is used

| Step | Walkthrough | Covered / Conditional |
|---|---|---|
| 1 | Select board and request Rename. | Conditional on reference graph implementation. |
| 2 | Preview provable static destinations and uncertain dynamic references. | Conditional on analyzer coverage. |
| 3 | Apply rename across documents and undo once. | Conditional: AD-19 specifies per-document command stacks, not multi-document transactions. |
| 4 | Select a used board and request Delete. | Conditional on reference graph implementation. |
| 5 | Replace references where proven; review dynamic/string references manually. | Conditional; unresolved strings need review, no redirect/tombstone shim is invented. |
| 6 | Cancel and confirm the board remains. | Conditional on delete-dialog implementation. |

## Holes found and fixes

| Hole | Why it matters | Proposed fix |
|---|---|---|
| Share upload backend, privacy, and expiry are unspecified. | The brief’s success measure cannot be proven by a local Web build alone. | Owner chooses a first-party or user-configured HTTPS publisher; show public/unlisted choice, expiry, delete-link, size limit, and upload result. |
| Plugins unavailable on a target host. | Packaging can succeed while runtime behavior differs. | Report host capability incompatibility and identify affected features; no legacy native DLL support, no implied desktop-only rescue path. |
| Dynamic script references evade graph certainty. | Rename/delete could miss a computed string. | Show uncertain references and require manual review; no invented redirect/tombstone metadata shim. |
| Partial recovery across documents has no transaction rule. | Recovering a subset can produce inconsistent state. | Keep multi-document recovery Conditional until an AD-19 contract exists; offer document-level host recovery only where available. |
| Browser storage quota and permission loss can surprise beginners. | “Saved” would be misleading and drafts could disappear. | Display quota/last durable write, prompt for Download backup, and block risky actions when the only copy is an unconfirmed draft. |
| Legacy import report and conversion rollback are not specified. | Returning creators need confidence before opening an old folder. | Define an import manifest, preserve originals untouched, and produce a one-file rollback/export bundle. |
| A one-file editable project extension is not decided. | The export button cannot promise a stable interchange format. | Keep profile label “Project export” and owner-select the native container/schema before implementation; do not invent an extension in UI copy. |
| New-project starter content has licensing and maintenance cost. | A missing or impermissible asset blocks the first minute. | Maintain a small licensed starter pack with notices and a fixture test that opens, plays, and exports each template. |

## Data and native-format implications

- **Project model:** The shell needs a project manifest/index, stable asset and placed-object IDs, human names, relative paths, schema/version metadata, host-independent settings, and graph edges. A path is a display and packaging concern; references resolve by identity where the native model permits it.
- **Legacy main file:** `.gam` stores legacy project settings and may be outside the project folder. Import must accept Toolkit root/main plus project folder or a packaged source; a project folder alone may omit it. Preserve unmodelled residue on read (AD-18); no legacy write-back is promised.
- **Native format:** ADR 0005 does not choose its name, extension, container, or migration policy. Stable IDs and graph metadata are proposals pending the native-format decision. Dynamic/unresolved reference strings require review; no redirect/tombstone shim is assumed.
- **Paths and packages:** `packaging-and-paths.md` requires relative paths, normalised archive separators for packages TKR writes, a manifest with `schema`, `main`, and `index`, and rejection of unsafe/duplicate entries. Preflight uses the same resolver as packaging; it must not report a clean build using a different path rule.
- **Undo and save:** AD-19 specifies serialisable document commands and host save/backup/revert, not multi-document transactions. Cross-document rename/recovery undo remains Conditional until that contract exists.
- **Host services:** AD-20 supplies filesystem, project, run, export, dialogs, clipboard, external URL, and capability services. `editor-ui` remains host-agnostic. PWA storage, VS Code backup, and desktop files are adapters, not three semantics.
- **Graph quality:** Reference graph and rename preview are proposals; static references can be updated only when proven. Dynamic or unresolved references require manual review. A share URL is a host/service capability, not core game state; no hosting contract is established.

## Challenges to earlier decisions

1. **“Play saves first” prevents stale launches but can fail when the host cannot save.** Save failure must stop launch and report the error; any recovery/download choice depends on host capability.
2. **A reference graph cannot prove dynamically computed script references.** Distinguish proven from uncertain references and require review; do not invent redirects or tombstones.
3. **Legacy formats are import/playback compatibility, not a write-back promise.** The editable project container and native component semantics remain undecided.
4. **The proposed starter library is essential to beginner success, not merely polish.** It therefore needs the G6 licence gate and template fixture coverage before being treated as a default.

## Open questions for the owner

1. **Where should Share playable link upload, with what privacy/expiry/limits?** Unresolved; current flow does not assume a backend or publication model.
2. **What is the native editable project container and extension?** Unresolved; do not overload `.tpk` with editable-project meaning.
3. **Which plugins support each host?** Unresolved capability mapping; report unsupported behavior without promising legacy DLL loading or a desktop-only fallback.
4. **How much starter content ships in each template, and who supplies it?** Recommended default: small authored/CC0 pack, one complete playable loop per non-Blank template, with `THIRD_PARTY_NOTICES` generated as part of packaging.
5. **What should PWA storage guarantee?** Recommended default: IndexedDB drafts plus a visible quota/last-write indicator, and a first-run prompt to download a backup before large imports.
6. **How should imported legacy projects be preserved?** Recommended default: originals remain untouched; import writes a sibling project and a machine-readable report, with one-click rollback by deleting only the generated sibling.
7. **Should “unused asset” warnings be shown by default?** Recommended default: yes, as low-severity Problems with “Keep,” “Archive,” and “Open references” actions; never delete automatically.
8. **Which advanced main-file fields are truly supported?** Recommended default: expose every field that affects the runner, preserve other fields as residue, and label stored-but-unsupported fields with a clear compatibility warning.

## Sources

- `docs/editor-features.md`: T-01–T-14 (workspace, settings), T-70–T-74 (packaging and distribution).
- `docs/spec/formats/packaging-and-paths.md`: project paths, package roots, `.tpk`, distribution manifest, path and archive limits.
- `docs/spec/formats/main-file.md`: `.gam` fields, defaults, paths, key arrays, plugin records, and validation notes.
- `docs/guardrails.md`: G2 host boundary, G6 licence gate, G7 clean-room provenance.
- `docs/adr/0004-script-ast-step-ir-and-plugins.md`: plugin composition and host-boundary implications.
- `docs/adr/0005-independent-product-v1-and-native-format.md`: TKR identity, import/playback compatibility, and native-format policy.
- Architecture spine, AD-18: format-model residue and round-trip discipline; AD-19: document model, undo, save, backup, and one-document-per-URI; AD-20: platform-services and host capabilities.
- Legacy guide, `01-environment-and-main-file.md` sections “Starting the editor,” “MDI shell anatomy,” “Project tree,” “Test Game,” “Main File / Project Properties editor,” “Tips, tutorial, and configuration,” and “Workflows.”
- Legacy guide, `editor-ux-proposals.md` sections “Cross-cutting fixes,” “Workspace and project,” “Game settings (the main file),” “Play in editor,” and “Platform basics people now expect.”
- `decisions.md`: owner-selected audience/full capability, hidden project-file direction and grouped snippets; save-first Play, templates and starter-library details are proposals, with storage/licensing questions still open.
