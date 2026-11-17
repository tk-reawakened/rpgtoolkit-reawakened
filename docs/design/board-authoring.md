# Connected board authoring

Status: owner-approved experience direction, 2026-11-16; implementation pending.
Delivery: [Epic 30 — Build playable places through connected board authoring](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/2985).
This document defines the approved authoring experience, not a claim that the current editor already implements it.

## Purpose and authority

An author builds a playable place: paint a room, define walls and walk-behind areas, place people and items, add interactions and exits, set its atmosphere, then test it. The board connects to the other editors while keeping its own editing context intact.

Jensen approved documenting and ticketing this direction after reviewing the legacy board's Vectors, Programs, Sprites, Images, Lighting, Properties and contiguous tileset surfaces. The screenshots are visual/task evidence only. No legacy implementation source was consulted. Their slot numbers, raw vertex labels and permanent type tabs are not a required new layout.

This refines the accepted connected-workshop direction and the existing T-20–T-35 capability inventory. Preserve documented behavior and supported data; change how the author reaches it. G2, G7, ADR 0022 (document authority, lifecycle, host layout and launches), ADR 0025 (Preact/TSX), ADR 0031 (browser-led editor mechanisms), and ADR 0019's scene model remain binding. No new format, runtime mechanic, docking library or exception is selected here.

Shared placement, action vocabulary, components and theme roles are defined in [the editor design language](editor-design-language.md). Stories 11.22/11.23 own that shared contract and its styling implementation; 30.1 owns the board-specific active-view/inspector behavior and consumes those components.

## Workspace and tabs

- Keep the board canvas available during normal object and board-settings work. The inspector shelf presents context; it does not replace the document workspace.
- Single selection changes the inspector. An explicit **Open** action opens the referenced asset in its appropriate editor tab; an optional consistent double-click shortcut supplements that action.
- Scripts, character definitions, enemy definitions, items, artwork and destination boards are editors in their own tabs. Use the existing provider for the referenced resource. In VS Code RPGCode uses the native text editor, as ADR 0022 D2 requires.
- Ordinary Open focuses an existing suitable view of that document, or opens one if needed. Deliberate split views remain supported according to the host's capabilities. One document authority may back several views; do not make an editable copy for a visit.
- Returning to the board restores its viewport, selection, active tool and brush. Other editors retain their own view state. Browsing, selecting, opening and rearranging views do not dirty game documents.
- Standalone/web use the shared workbench chrome. VS Code uses native editor tabs/groups and contributed views. Do not embed a second workspace or docking system inside a VS Code board webview.

## Inspector focus contract

**The inspector follows the focused authoring editor. With two boards visible, only one is active; the inspector shows that board's remembered selection.** This is the owner's clarification, using the familiar focus-following preview interaction as an analogy, not a claim about a particular Markdown extension's internals.

1. Focus board A: inspect A's selection and identify A and the object in the shelf.
2. Focus board B: inspect B's remembered selection. A remains visible and keeps its own view state.
3. Move focus from a board into its inspector, outline, asset browser or contextual toolbar: retain that board as the authoring target. These auxiliary controls do not become a new document target or erase selection.
4. An inspector edit belongs to its explicit originating document, view and object. Capture that target when an interaction begins. A delayed picker or asynchronous result must never apply to a newly focused board by consulting a mutable global selection. If the original target is closed, invalidated or belongs to a departed project, cancel/refuse with a clear reason.
5. Focus another document editor: use its applicable inspector context, or an informative empty state. Do not leave apparently active board controls targeting an unrelated hidden board. Merely opening a background tab does not change the active authoring view.
6. Delete a selected object, close its view or switch project: reconcile the target and remove stale editable controls. Use the host's actual next active view; never guess another board from an array or tab order.
7. Two views of the same board share authored data and undo authority but can have different selection/zoom. Inspector context belongs to the active view, not just the file identity.

No separate board picker, inspector pin mode or simultaneous multi-board property editing is required. The shelf should work narrow, hidden or relocated. Its default is on the right; right-side placement is not required for correctness. The first implementation story proves an actual VS Code contributed inspector view and the web shelf before broader authoring work depends on them.

## Selection, outline and overlays

Canvas and scene outline share selection. Use meaningful object names or honest derived labels when the format has no persisted name; do not invent fields or silently renumber legacy slots. Named layers are useful, but layer order is not proof of reachability or physical elevation.

Expose walls, walk-behind areas, interactions, people/items, images and lighting through understandable tools and outline groups. Keep exact geometry and numeric placement available. Tile painting and real vector editing are both supported routes for walls/walk-behind where their existing providers support them; do not replace precise polygons with rectangles.

Provide a discoverable way to select overlapping objects, with a keyboard/list alternative. Overlay visibility, edit locking and runtime-enabled behavior are distinct. Hiding a wall outline never disables collision. Vertex numbers and full source text are available for detailed editing without covering the whole board by default. Use labels/line styles/selection cues as well as color.

## Painting and artwork visits

Use one retained-context asset/tileset browser. A contiguous sheet preserves neighboring-tile context; repeated per-tile action cards are not the primary paint surface. Select a source separately from applying a brush or editing its artwork.

A focused board uses the browser to choose a brush; source editing opens the artwork editor in a tab. Remember source, sheet scroll and selection when switching editors. Region/stamp brushes, tile metadata and local variants reuse their existing providers and storage rules (T-24, T-62, Epic 13 and ADR 0019). Do not introduce a competing browser, artwork editor or undocumented local override.

## Placements and linked definitions

The inspector edits **this placement on this board**. Its references clearly name the shared definition or program and provide Open. The asset's own tab edits **the shared definition**. Placement overrides remain explicit and retain their documented meaning.

Choose existing and Create new are offered where a real provider can create that type. Creation opens the destination editor and retains the intended origin. Attach only the successfully created asset to the original placement through a normal board edit; cancellation, write failure, a deleted origin or a project change must not attach anything elsewhere. Multi-file creation follows ADR 0022 D4's per-document outcome reporting, not an invented atomic transaction. An asset created successfully before attachment fails remains recoverable and is named to the author.

Characters, enemies and items can be opened through their actual supported references. This does not authorize writing `.tem` or `.ene` paths into a legacy board's `.itm` sprite field. Starting-party membership, board placement, inventory and encounters stay distinct. Expose the legitimate owning reference surface; capability gaps require a documented provider task, not a fake editable preview.

## Interactions

Where applicable use the accepted inspector order **Name, When, Then, Only if, Placement**. Walls use shape and placement; a person uses the relevant appearance, activation and movement references.

Preserve step-on/key activation, repeat distance and units, stops-movement, run-once, conditions, completion assignments, layer, program filename/inline code and geometry. Keep sprite activation and multitask overrides distinct. Common supported interactions should be understandable in creator language while custom RPGCode remains directly accessible.

A door can expose a destination board and arrival selection when the existing action/template provider can represent that edit faithfully. Opening the destination uses another board tab; an explicit pick-arrival task retains its originating door and has Apply/Cancel and a return action. Picking an arrival does not change the destination board's player-start marker. Reverse links are separate, never implicitly created.

Do not claim arbitrary imported RPGCode round-trips through a sentence editor. Only documented, losslessly recognized forms may expose structured controls; otherwise keep the original source and Open action. Implementing a general visual event builder, route inference or new template language belongs outside this epic. Any missing narrow common-action contract is specified under `docs/` before its code and linked to its existing owning provider where applicable.

## Board settings, images and atmosphere

An explicit Board settings action uses the shelf while keeping the scene visible. Group size/coordinate information and layer titles, start and connections, background/music/ambient, encounters, entry program, board threads, constants and save behavior. Selecting an object returns to its inspector. Preserve the distinction between entry program and background threads.

Image placement uses its documented top-left anchor and transparency behavior; sprite placement uses its own anchor. Show units and affected layers. Lighting and tile shading stay distinct, consume Epic 13's provider, and preview through the shared compositor. Conversion to shading is an explicit operation with clear consequences and supported undo; no silent bake. Resize follows existing edit capabilities and shows what would be cropped before applying; unsupported format operations remain explained read-only.

## Shared host and lifecycle rules

- Reuse editor-model commands and platform-services; hosts supply integration and chrome, not separate board features.
- Save, undo, redo, backup, external conflicts and read-only formats follow ADR 0022. Selection or focus changes never manufacture a save or an edit.
- Preserve supported legacy fields, slot identities, same-version residue and native scene semantics. No conversion on open.
- Webview recreation restores compact view state without losing document state. Keeping every hidden canvas alive is not the default persistence strategy.
- Theme through shared semantic tokens and the host theme, including light/dark/high contrast. Native controls, visible keyboard focus, accessible names, sensible toolbar navigation and numeric alternatives accompany visual tools.
- Commands such as Open referenced asset, Show Inspector and Test Board are discoverable with context-correct targets. Respect existing shortcuts and shared Save/Run behavior.
- ADR 0022 D8 already decides unsaved-run policy: save the documents the run reads, stop and name a failed save, then launch a fixed snapshot. Asset preview, Test Board and Run Game are different actions. Authoring synchronization does not hot-reload a running game.

## Acceptance walkthrough

Use a small authored room and second destination board, representative nondefault interaction settings and linked assets. Paint, edit a wall and walk-behind polygon, select overlapping objects, place an item-backed person, open the legitimate character/enemy/item/script references, return, add or edit an exit, pick arrival, change atmosphere, save/reopen and test through the real runner.

Also prove A/B board focus, auxiliary-control focus, separate selections in split views of one board, delayed reference creation after switching boards, cancellation, deleted/closed origin, hidden/recreated webview, undo/redo and failed save before run. Assert actual document identities/contents, not only highlighted controls. No wrong board may be mutated.

Run the journey in the web/PWA and actual VS Code host, with host versions and revision recorded. Exercise the same shared components in any shipped standalone editor; do not use a player-only shell as editor-host evidence. Capture normal and narrow panes, light/dark/high contrast and keyboard-only access. Keep ordinary unit tests under one second; pace real-browser/host protocols with bounded retries per AGENTS.md. Missing providers remain unmet acceptance, not silently skipped steps.

## Engineering reference pack

Official sources read 2026-11-16. These are external platform guidance; our concrete focus rules above are the project decision.

| Source | Constraint carried into the design |
| --- | --- |
| [VS Code custom editors](https://code.visualstudio.com/api/extension-guides/custom-editors) | One authoritative document can have multiple synchronized views; integrate edits with host lifecycle. |
| [Views UX](https://code.visualstudio.com/api/ux-guidelines/views) | Views can move; keep their number small and use native trees when suitable. |
| [Webviews UX](https://code.visualstudio.com/api/ux-guidelines/webviews) | Custom visual authoring can use webviews; respect theme, accessibility and existing workspace functions. |
| [Webview persistence](https://code.visualstudio.com/api/extension-guides/webview#persistence) | Persist/reconstruct view state; avoid blanket retention of hidden webviews. |
| [Command Palette UX](https://code.visualstudio.com/api/ux-guidelines/command-palette) | Clear categorized commands and non-conflicting shortcuts. |
| [Theme colors](https://code.visualstudio.com/api/references/theme-color) | Adapt shared semantic tokens to host colors. |
| [W3C toolbar pattern](https://www.w3.org/WAI/ARIA/apg/patterns/toolbar/) | Meaningful toolbar grouping, keyboard entry and arrow navigation. |

Internal references: [editor capabilities](../editor-features.md) T-20–T-35; [ADR 0022](../adr/0022-shared-editor-authoring-contracts.md); [guardrails](../guardrails.md); [board format](../spec/formats/board.md); [native authoring](../spec/formats/tkr-authoring.md); [board-test startup](../spec/engine/main-loop-and-startup.md#reawakened-board-test-startup).

## Scope and delivery ownership

This is an experience epic over Epics 11–13, not a replacement of their capability contracts. Reuse PR #2950's final focused-command/Save/compact-tools behavior; it was open when planned. Reuse #1713/#2322 for the browser/region-brush provider, #1721 for board objects, #1850–#1852 for native scene/collision, #1737 for lighting and #1723 for broad connected-authoring services. Epic 29 (#2968) owns the character editor's internal experience; this epic opens it and proves the board-origin visit.

Exact outline grouping, labels, shelf dimensions and shortcuts are implementation design choices validated with real content. A universal database, new engine mechanics, automatic interpretation of arbitrary scripts, a new docking library, new persistence formats, mandatory inspector pinning and a whole-shell redesign are outside this scope.
