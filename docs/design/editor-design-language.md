# Shared editor design language

Status: owner-requested shared direction, with 11.22 candidate validation recorded on 2026-11-17 in [the evidence record](editor-design-validation.md). This consolidates the approved character/board conversations and the real-editor engineering gallery. Delivery: [11.22 — design language](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/2987) and [11.23 — styling implementation](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/2988). Story 11.23 implements the shared styling and actual cross-host proof. Existing UI is not claimed to conform already.

## Purpose and source of truth

An author should be able to predict where to find something, what an action changes, and how to return to their work. The design language covers information placement, interaction, component states and appearance together. A palette alone cannot provide that consistency.

Use the owner-selected direction: game-making clarity, flexible document workspaces and direct visual editing. Epics [29](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/2968) and [30](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/2985) are the first concrete consumers. Extract their reusable conventions; retain their specialized authoring flows in their own contracts.

Authority order: guardrails and accepted ADRs; explicit owner decisions and the resulting `docs/` contracts; validated editor-specific designs; older research proposals and historical captures. This document governs common presentation and interaction placement. [Board authoring](board-authoring.md) governs its specific workflow; the character story writes its T-50–T-54 mapping before implementation. No design document overrides persisted format or runtime semantics. When sources disagree, record the specific conflict and apply the later accepted decision; do not silently resurrect old proposed behavior.

## Where things live

These are roles and default locations, not fixed pixel coordinates. Hosts can move or collapse views while preserving their purpose and editing context.

| Surface | Its job | What belongs here | What belongs elsewhere |
| --- | --- | --- | --- |
| Workspace header and application commands | Manage the project and invoke discoverable actions | Project identity, command/file search, shared save state/actions, named Run/Test entry points, help and view toggles | Object fields, paint modes and a second document tab system |
| Game navigation | Find game-making subjects by purpose | Boards, characters, items, enemies, moves, effects and other real providers | A duplicate editable database or a required setup sequence |
| Files navigation | Work with actual project resources | Folders, filenames and supported file operations; the same identities reached through Game | A second document model for the same asset |
| Document tabs and editor groups | Hold the things being edited | Board, character, enemy, item, artwork, animation, program and game-settings documents; deliberate split views | One tab per toolbar mode or transient selection |
| Active editor toolbar | Choose how to work on this document | Applicable select/paint/shape tools, snapping, zoom and tool options; contextual document actions | A permanent row for every editor feature or another global Save/Run system |
| Main document area | Perform the authoring task | Canvas, sheet, timeline, code or purposeful forms; character identity and starting values before advanced bindings | A generic property grid as the only way to edit pixels, shapes or timing |
| Outline / layers | Locate and organize parts of the active document | Named objects/layers/frames where supported, matching canvas selection, meaningful order and supported visibility/lock actions | Global asset browsing or runtime enablement disguised as visibility |
| Inspector | Inspect/edit the active selection or explicit document settings | Selection identity, relevant fields, placement/overrides, tool-specific detail, reference Open actions | The complete editor for a referenced definition |
| Asset / tileset browser | Choose reusable source material | Search/list/sheet, source preview, Choose/Create/Open, retained source selection and brush context | Placement fields or implicit painting whenever a tile is selected |
| Preview / timeline / results surface | Inspect a task's output or temporal structure | Asset playback, editor-specific timeline, diagnostics, history or test results when requested | An always-open generic bottom Run pane that consumes the canvas |
| Inline feedback | Explain a nearby state or problem | Units, validation, shared/local scope, missing-reference reason, pending/failed save | Technical implementation details that do not help a creator act |
| Dialog / picker | Complete a bounded choice or resolve a consequential conflict | Destination/name choice, file selection, destructive/conflict decisions, progress with cancellation where supported | An entire ordinary character, enemy, item or script editor |
| Editor preferences | Configure the author's tools | Theme, layout, input preferences and effective setting source | Game music, party, encounters or authored content |

The browser and inspector are distinct views even when they share a shelf. Choosing a brush must not require discarding the selected object's inspector state. A host may stack, tab or relocate these views; story 11.22 records the tested default and narrow arrangement. Normal board editing keeps the scene available alongside its controls. There is no requirement to display every view simultaneously.

## How to choose a destination

1. Is this an independently editable resource with its own identity and save/undo authority? Open its document editor in a tab.
2. Does this edit the selected part or placement of the active document? Put it in the inspector or directly beside the visual subject.
3. Does this choose an editing operation? Put it in the active editor toolbar, with only the relevant options.
4. Does this find a document? Use Game/Files/search. Does it choose reusable content for an operation? Use the shared asset browser or reference picker.
5. Does this organize objects within a document? Use its outline/layers or timeline, according to the task.
6. Does this change the game itself? Use the owning game/board/asset settings. Does it change the authoring environment? Use editor preferences.
7. Does this inspect output without authoring data? Use a clearly named preview/results surface. A preview is not a test run.

Examples: an old man's position belongs to the board inspector; his shared asset opens in its own tab; his activation script opens in the program editor; character starting stats live in the character document; starting-party membership belongs to game settings; an enemy definition belongs to the enemy document; encounter membership belongs to its supported owning surface. Do not infer new data relationships from these examples or put `.tem`/`.ene` references into a legacy `.itm` placement field.

## Focus and navigation

Document tabs identify resources. Internal section navigation organizes one resource's tasks; it is visually subordinate and never creates another document. The character's Overview/Appearance/Moves/Equipment/Progression/Advanced grouping remains a design hypothesis to validate in 29.1, not a mandate for six document tabs. Board modes are tools, not documents.

Selection updates the inspector; Open visits the resource. Ordinary repeated Open focuses an existing suitable view. A deliberate split has its own viewport/selection and the same document authority. Returning from a related visit restores the origin's viewport, selection, active tool and brush without resetting accepted edits.

Only one authoring view is active. The inspector and contextual commands follow it. Entering its inspector, outline, browser or toolbar retains that target; focusing another editor changes context. Two visible boards do not need a target dropdown or pin mode. Two views of one board can have different selections. Asynchronous actions capture the originating project/document/view/object; a later focus change cannot redirect their edit. A missing/closed origin produces a safe refusal or reconciliation rather than a guessed target.

Persist view state separately from document content. Hiding/recreating a shelf or webview preserves the document and undo authority; browsing and layout changes never dirty a game file. All lifecycle details remain ADR 0022's contract.

## Shared component and action vocabulary

| Pattern | Contract |
| --- | --- |
| Document heading / tab | Name and resource kind where needed; truthful saved/dirty/read-only state. The host may provide these, so avoid redundant competing status bars. |
| Section group | A meaningful heading with related controls; use spacing before decorative frames. Keep everyday fields prominent and specialist fields in clearly named sections. |
| Inspector section | Relevant properties for the selection. Interactions use Name, When, Then, Only if, Placement where applicable; walls use shape and placement. Do not force the interaction order onto unrelated editors. |
| Reference field | Show the actual referenced asset and scope. **Choose** selects/attaches an existing asset; **Create new** creates through a real provider and then attaches to the captured origin; **Open** edits the existing resource without replacing the reference. |
| Reference failure | Keep the unresolved value visible, explain the problem and offer supported locate/replace/create actions. Cancel preserves data. A successfully created asset remains recoverable if attachment fails. |
| Shared/local scope | Clearly distinguish the shared definition from a local placement or supported override. Show known uses without implying complete knowledge of dynamic references. Never invent Make unique or overrides without persistence support. |
| Tool button | Accessible name, selected/pressed state, keyboard path and tooltip where compact. An icon-only action must remain discoverable; a tooltip is not its sole accessible name. |
| Collection / list-detail | Readable meaningful entries, explicit add/remove/reorder, selected detail nearby. Preserve sparse/legacy slot identity; do not render hundreds of empty slots merely because storage has them. |
| Numeric field | Label, units, valid range/meaning and error beside it. Keep a numeric/list route alongside drawing when precision or accessibility needs it. |
| Visibility / lock / enabled | Distinct labels and states: show/hide affects presentation; lock affects editing; enabled affects game behavior only when the model supports it. |
| Empty state | Explain what is absent and provide the next supported action. Do not imply a capability exists through a nonfunctional primary button. |
| Advanced section | Exposes real technical depth without making common work depend on it; values remain preserved when collapsed. |
| Preview | Label what is shown: artwork playback, calculated estimate, or game-faithful composition. Do not substitute it for runner evidence. |
| Run / test action | Distinguish Run Game, Test Board, Test Program and saved tests. Reuse existing launch UI and save-first fixed-snapshot semantics; no second launch system. |
| Destructive/conflict action | Name the affected object/document and consequences; keep recoverable data and report failures truthfully. Use the existing host lifecycle, not a styling-specific save path. |

Use short action verbs and game-maker nouns. **Open** never means attach; **Choose** never means paint; **Preview** never means a gameplay test passed. Keep code and paths in monospace, normal labels in the UI font. Explain what a command does before technical units and timing. Do not expose implementation machinery in product copy unless it changes the author's choice.

## Visual language

The reference is the TK Reawakened website's midnight/navy surfaces, ivory text, warm gold emphasis and restrained brass framing, adapted for sustained editing. Keep artwork stages visually neutral so authored colors remain easy to judge. Use small radii and restrained separators; reserve floating elevation for menus/popovers. Do not put a decorative card around every field or import marketing typography, gradients and large spacing into dense controls.

Website references read on 2026-11-16: background `#0d121d`, surface `#151e31`, line `#394661`, trim `#907a4c`, ink `#f2eee4`, muted `#b4bed0`, gold `#f4c85b`, red `#e06070`. Source: `tk-reawakened-website/site/style.css`, also recorded in Epic 29. These are source swatches, not automatically contrast-approved control pairs. Gold backgrounds need a checked foreground; do not inherit a white label blindly.

Extend the existing `--tkr-*` semantic token family from #2703. Feature styles consume semantic roles rather than raw brand values. Preserve host theme bridges and derive corresponding light/dark/high-contrast treatments. VS Code colors and native chrome take precedence in that host; a branded standalone default is not permission to force a dark/gold theme into VS Code.

| Semantic role | Meaning and usage |
| --- | --- |
| App / panel / document / elevated surfaces | Hierarchy of workspace, supporting views, authored surface and transient controls |
| Stage | Neutral surroundings for art; checkerboards/grid distinguish transparency without recoloring the work |
| Primary / secondary / disabled text | Readability hierarchy; disabled controls retain a visible reason when needed |
| Subtle / strong borders | Group separation versus a control/selected boundary; chrome does not compete with artwork |
| Accent / accent foreground / subtle accent | Selected tools and deliberate primary emphasis; readable paired foregrounds |
| Focus ring | Keyboard location, visually distinct from selection and unaffected by whether a tool is active |
| Dirty / saving / saved | Document persistence state, with words or symbols; never use focus gold as the only unsaved indicator |
| Error / warning / success / information | Distinct semantic feedback with text/icon support; a decorative gold border is not a warning |
| Shared / local / read-only | Ownership and editability conveyed by labels as well as treatment |

Typography uses the host/system UI font and a small consistent hierarchy: document identity, section heading, ordinary label/value and supporting help. Preserve host font scaling. Use a consistent spacing scale based on the existing 4px rhythm; validate compact control rows and section gaps with real content. Small existing 4–6px radii are starting values, not a reason to override host focus/contrast. Story 11.22 records the validated size/spacing/type/token table; story 11.23 implements it once.

## State and accessibility contract

Default, hover, pressed/selected, keyboard focus, disabled, read-only, invalid, loading and empty are separate component states. Selected and focused can coexist visibly. Read-only is not a loading skeleton; disabled is not missing data. Pending/failed save cannot look like durable success. Unknown or stale derived previews say so.

Use native/semantic controls first. Navigation and primary actions work by keyboard; focus returns sensibly after a picker or tab visit. Use labels and patterns as well as color for selection, errors, overlay kinds and document state. Controls respect host high-contrast/forced-colors and reduced-motion preferences. A compact toolbar follows an appropriate accessible toolbar pattern; do not make every decorative icon a tab stop or let global shortcuts fire while typing in fields.

In a narrow editor group, reduce visible chrome through named disclosures or relocatable views before squeezing the document into unreadability. No whole-editor horizontal scrolling is required for ordinary forms; art canvases/code can pan or scroll for their actual content. A long asset name remains identifiable. A hidden inspector has an obvious way to reopen. Resizing or moving a view does not change document meaning or selection.

## Host mapping

This maps responsibilities, not a claim every proposed shelf already ships. Existing resource editors are native custom-editor **webview panels**, not contributed sidebar views; the precise current inventory is below.

| Shared role | Web / standalone | VS Code |
| --- | --- | --- |
| Workspace, tabs and groups | Existing shared workbench/host layout | Native editor tabs/groups; no nested workspace clone |
| Programs | Existing Monaco integration | Native text editor and TextDocument authority |
| Game/Files/outline | Shared navigation views | Appropriate contributed/native views through host integration |
| Inspector and asset browser | Shared content in workbench shelves | Contributed views; portable content and explicit active-view targeting |
| Save/undo/commands/settings | Existing platform-services and shared command surfaces | Native host lifecycle, commands and settings integration |
| Theme | Branded defaults plus supported light/dark/high contrast | Host theme colors, typography and high-contrast behavior |

Feature behavior stays in `editor-ui`, document authority in the existing model/host contracts, and host integrations behind platform-services. Do not force identical panel geometry across hosts or rebuild browser layout, focus, scheduling or controls for engine determinism.

## Validation and contribution rule

A new control or editor must answer: what document owns its data; where does it live; what does selection/Open/Create change; how does it return; what are its empty/error/read-only states; how is it reached by keyboard; and what happens in another host or narrow pane? Use an existing component pattern unless a task-specific difference is demonstrated. Add genuinely reusable patterns to this contract with a concrete consumer; keep specialist layout within its editor contract.

Story 11.22 produces annotated compositions and a component/state inventory against real existing surfaces, with unresolved proposals clearly marked. Use board, character, an item/enemy form, artwork/animation, program chrome and settings as contrasting examples. A gallery demonstrates components and semantics; it is not a new user-facing page full of implementation details.

Story 11.23 applies the shared tokens and components across the workbench and existing editor surfaces. It does not implement the specialized character/board redesigns in advance. Record actual host/version, commit, fixture, viewport and theme in before/after captures; inspect normal and 640px-wide document panes, keyboard use and light/dark/high-contrast states. Check meaningful focus, targeting and document-state behavior, not tests that merely restate CSS. Existing functional and host proofs continue to apply.

## Delivery ownership and existing work

| Work | Owns | Consumes |
| --- | --- | --- |
| 11.22 — shared design language and component contracts | Placement guide, interaction vocabulary, visual tokens/states, annotated validated host compositions and migration inventory | Accepted decisions and concrete experience requirements from Epics 29/30, existing #2703 tokens and PR #2950 |
| 11.23 — shared styling implementation | Reusable tokens/components, workbench/common control migration and actual cross-host visual verification | 11.22; no dependency on future 29/30 implementation |
| 29.1 (#2962) | Character-specific task grouping, hierarchy and navigation; uses shared styles | 11.22/11.23, existing character provider |
| 30.1 (#2974) | Board workspace and focus-following inspector behavior across hosts | 11.22/11.23, existing board/workspace providers |
| Later editor stories | Specialized composition, behavior and workflow evidence | Shared language/components; no parallel styling systems |

11.22 and 11.23 are additional foundation work after the original editor baseline. They do not reopen closed #2703 or 11.12. The original 11.13 closing proof retains its declared baseline scope; the new stories carry their own delivery/verification. Consumer research and contract drafting can proceed, but their implementation uses the delivered shared components. Avoid cycles: shared styling proves representative existing surfaces, not unfinished Epic 29/30 redesigns.

## 11.22 source and migration contract

Candidate measurements and contrast work are recorded in [editor-design-validation.md](editor-design-validation.md). Existing starting tokens are in `packages/editor-ui/src/tileset-art.css` (`--tkr-*`): 0.75/0.8125/0.875/0.9375rem type steps (12/13/14/15px at a 16px root), 4/6px radii, and theme bridges to VS Code. Use 13px-equivalent ordinary controls, 12px supporting help, 14px section identity and 15px document identity as the shared starting hierarchy, expressed in the existing relative units. Keep code/path typography monospace and preserve host scaling. Candidate captures record remaining legacy overrides rather than certifying them as the target. Shipping migration belongs to 11.23.

Authority trace: G1–G7 and accepted ADRs bind; owner decisions and these `docs/` contracts define placement and interaction; captured real-editor evidence validates candidate presentations; historical captures and early workshop proposals are subordinate. Persistence and lifecycle remain ADR 0022 and the editor model. `board-authoring.md` owns board-specific workflow. The character-specific grouping remains a 29.1 hypothesis; 30.1 owns board focus-following behavior. Neither consumer may create a parallel theme or document authority.

| Shared decision | Binding source / consumer | Consequence |
| --- | --- | --- |
| Resource documents versus selection properties | ADR 0022 D1–D4; Epic 30 and board-authoring contract | One document authority; tabs for independent resources, inspector for a placement/selection |
| Focus-following contextual tools | Epic 30 / 30.1; ADR 0022 D7 | Keep the origin view for asynchronous work; entering its shelf does not retarget an edit |
| Character's everyday identity before technical bindings | Epic 29 / 29.1 | Shared section/reference vocabulary; specialized section hierarchy remains 29.1's validation |
| Preferences are not authored game settings | ADR 0022 D6 | Separate editor configuration from `.gam` fields and dirty state |
| Named Run/Test versus previews | ADR 0022 D8–D9 | Reuse launch authority; artwork playback is not a successful game test |
| Dirty/saving/refused/read-only history | ADR 0022 D3, D11–D12 | Styling reports actual model/I/O outcomes and cannot manufacture saved success |
| Browser-native controls and shared host boundary | ADR 0031 and ADR 0025; owner direction in this repository | Reuse semantic HTML, layout and native focus; no styling-specific focus engine |
| Branded standalone defaults, native VS Code theme | Owner-approved Epic 29/30 direction; existing #2703 tokens | Extend semantic roles once; do not paint over authored art or native host chrome |

Use the existing 4px spacing rhythm: 4px within tightly related controls, 8px ordinary row/group separation, 12–16px between sections. Compact controls have a 24px minimum block target rather than a fixed height; allow text expansion. Use 4px control and 6px floating-surface radii where the host does not own them. These are shared implementation targets, not permission to clip a larger native control. At a measured 640px document pane, wrap toolbar groups and use named disclosures for supporting views before reducing content width; keep the document itself visible. Preserve long resource identity and a keyboard route to every collapsed view. Existing header overlap (#3028) is a migration defect, not an approved narrow layout.

Selected actions use paired accent foreground/background and a visible boundary or pressed state. Keyboard focus uses a separate two-pixel outline plus offset; selected and focused remain independently recognizable. Disabled controls cannot act; enabled read-only values remain selectable/readable and must not inherit disabled opacity/cursors (#3027). Validation names the problem beside the proposal; loading and saving describe pending work, while refusal retains the draft and offers the existing reconciliation actions. The validation record identifies which of these states were exercised and which require host implementation evidence.

The reusable cross-surface contracts are: document header/status, section group, selection-following inspector, reference field, shared/local labels, accessible tool button, sparse collection, numeric field, distinct visibility/lock/enabled states, empty/error/read-only states, advanced disclosure, preview/results, and named Run/Test actions. Host-owned tabs, save/undo and command surfaces remain host/platform-services responsibilities. Reuse the current editor-model commands, document lifecycle and provider; a visually plausible but provider-less control is not a component.

For every interaction, document the owning document and project, origin view/selection captured at interaction start, supported command/provider, cancellation and failure outcome, and return route. Selection changes inspector context; **Open** visits the referenced resource, **Choose** attaches a real existing resource, and **Create new** attaches only after successful provider creation to the captured origin. A late result cannot follow mutable global focus. Missing origins refuse/reconcile. No visual treatment manufactures a save, edit, reference, override, or provider capability.

These are composition contracts over existing owners and semantic HTML, not a requirement to invent a universal component class:

| Pattern boundary / current owner | Inputs | Output / state responsibility |
| --- | --- | --- |
| Header/status — `shell.tsx`, `settings-view.tsx`, owning host tabs | Actual document snapshot and host capabilities | Display identity, dirty/saving/error/read-only truth; invoke existing commands, never persist independently |
| Field/section — native label/input/select/fieldset in `game-settings-form.tsx`, `character-authoring-view.tsx`, `sprite-view.tsx`, `new-board-view.tsx` | Owning value/proposal, label, units, supported range, actual errors/read-only state | Existing view handler stages/edits the owner; native focus/validation plus shared semantic styles |
| Reference/Choose/Create — current field owner plus `asset-picker-view.tsx`, host `pickAsset`/visit and real creation provider | Current reference, project/document/view/selection origin and supported actions | Return a real chosen/created identity to the captured origin; no unsupported provider or styling-specific data store |
| Sparse collection/outline/tool group — `animation-view.tsx`, board/layers, sprite groups and existing native buttons | Real entries/slot identities, selection, supported operations | Render meaningful content, pressed/selection/accessibility state; owner handles edits, not the list's appearance |
| Empty/error/read-only/preview — owning view, `settings-view.tsx`, History and native dialog | Actual model/I/O outcome and recoverable data | Explain the next supported action and whose data is shown; preview never becomes another editable authority |
| Preferences — `preferences-view.tsx` through `createWorkbench.openPreferences`; native VS Code configuration | Author's effective editor configuration | Update the existing preferences model/host configuration, never `.gam` content |

| Action | Success and return route | Cancel / failure outcome |
| --- | --- | --- |
| Open reference | Existing visit/native Open focuses its independent resource; Return/Back restores the captured origin's view context | Missing resource leaves the reference/origin intact and explains the failure; visiting never replaces the reference |
| Choose reference | The real picker returns a supported identity; the field's existing edit transaction applies it to its captured origin | Cancel changes nothing; a missing/changed origin refuses or reconciles rather than following current global focus |
| Create and attach | Existing provider creates the named resource, then the captured field attaches it; Open visits it separately | Cancel before creation creates nothing; creation failure leaves the original field; successful creation remains recoverable if attachment fails |
| Apply / cancel staged fields | Existing form Apply commits one accepted document edit; ordinary document Save remains separate | Cancel staged fields discards only the unaccepted proposal, not already accepted document edits |
| Save | Existing captured-document command writes through its host, clears dirty only on durable success and retains editing context | Pending says Saving; I/O failure keeps draft/dirty and reports why; changed-on-disk uses the existing explicit resolution choices |
| Revert active document | Confirmed existing command reloads backing bytes into the same authority and returns to its view | Cancel retains the draft; reload failure reports the problem without styling manufacturing a successful reset |
| Cancel creation/picker | Existing dialog closes and restores the invoker's sensible focus/context | No new edit/resource; do not let late asynchronous completion attach to another document or selection |

| Current surface family | Shared owner for 11.23 | Native VS Code mapping | Kept outside shared styling |
| --- | --- | --- | --- |
| Workspace/header, commands, save state | `editor-ui/src/shell.tsx`, `command-palette.tsx`; host composition in `host-web/src/workbench.ts` | Native tabs, command palette, commands and lifecycle; platform-services integration | Host chrome, tab/group geometry, launch/save authority |
| Game/Files navigation | `editor-ui/src/files-view.tsx`, `game-view.tsx`; host workbench | Native/contributed views and trees | Provider inventory and file semantics |
| Board | `editor-ui/src/board-view.tsx`, `board-canvas.tsx`, `board-properties-view.tsx`; `host-web/src/index.ts` dispatch | Shared content in a native custom-editor webview panel (`.brd`) | Board tools/inspector behavior #30.1; no enemy provider |
| Character | `editor-ui/src/character-authoring-view.tsx`, `sprite-view.tsx`; `mount.ts` composition | Shared content in a native custom-editor webview panel (`.tem`) | 29.1 hierarchy and unfinished definition redesign |
| Item / enemy gap | `editor-ui/src/sprite-view.tsx`, `mount.ts`; item provider in `editor-model/src/kinds.ts` | Existing item content in a native custom-editor webview panel (`.itm`); no enemy editor | Expanded item authoring #1722; absent enemy provider #1734 |
| Artwork / tileset / animation | `tileset-art-view.tsx`, `tile-bitmap-view.tsx`, `tileset-browser.tsx`, `animation-view.tsx`; `mount.ts` composition | Shared content in native custom-editor webview panels (`.tst`, `.tbm`, `.anm`) | Specialized 29/30 layouts and authored pixels |
| Program | `program-view.tsx`, existing Monaco integration | Native text editor and TextDocument authority | Monaco/chrome and runtime behavior |
| Game settings | `game-settings-form.tsx`, `settings-view.tsx` | Shared content in a native custom-editor webview panel (`.gam`) | Authored game data authority and save semantics; not editor preferences |
| Editor preferences | `preferences-view.tsx` / `mountPreferences` in the browser workbench; existing settings model | Native Settings UI for `rpgToolkit.editor.*`, registered by `extensions/editor/package.json` `contributes.configuration`; no separate contributed PreferencesView | Authored game content and `.gam` document authority |
| Empty/loading/dirty/saving/failed/read-only | Each owning view and editor-model snapshot; shell status is host-owned | Native document status plus shared semantic labels where content-specific | Persistence outcomes; no synthetic success |

This is the complete shared-style migration boundary, not a claim the captures below already prove visual conformance. Program toolbar/chrome consumes common roles; preserve Monaco's syntax, editor typography and native VS Code text-editor ownership. Future 29/30 specialized work consumes this shared contract; it does not become a prerequisite for 11.23.

See [the validation record](editor-design-validation.md) for real-content capture provenance, dimensions, theme/state checklist and outstanding evidence. Candidate palettes and CSS live only under `tools/editor-design/`; they are not imported by product packages.

The real capture matrix and explicit evidence gaps are maintained in [editor-design-validation.md](editor-design-validation.md). 11.23 must also fix the existing VS Code theme-variable capitalization tracked by #3017: the official Quick Pick theme key is `quickInput.background` and therefore the CSS variable is `--vscode-quickInput-background` (not `--vscode-QuickInput-background`); see [VS Code theme colors](https://code.visualstudio.com/api/references/theme-color#quick-picker). This is a migration note, not a production style change in 11.22.

Additional concrete migration defects: [#3027](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/3027) separates enabled read-only fields from disabled controls; [#3028](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/3028) removes header/status overlap without hiding commands or long project identity. They are owned by 11.23. The inventory's item expansion (#1722) and missing enemy provider (#1734) remain named feature work, not styling placeholders.

## Sources

- [Epic 29 approved direction](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/2968), especially first-view hierarchy, shared visual language and specialized character sections.
- [Epic 30 approved direction](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/2985) and [board contract](board-authoring.md), especially tabs, focus-following shelf, source browser and placement/reference separation.
- [Earlier connected-workshop design](../../_bmad-output/initiative-rpgtoolkit-reawakened/ux-connected-editors/DESIGN.md) and [experience proposal](../../_bmad-output/initiative-rpgtoolkit-reawakened/ux-connected-editors/EXPERIENCE.md). Earlier diagrams/proposed pinning and side-record editors do not override the later tab-and-inspector decisions.
- [ADR 0022](../adr/0022-shared-editor-authoring-contracts.md), [ADR 0025](../adr/0025-editor-ui-framework-preact-tsx.md), [ADR 0031](../adr/0031-owned-art-editor-with-permissive-reuse.md), [guardrails](../guardrails.md) and [editor capabilities](../editor-features.md).
- Official engineering references read 2026-11-16: [VS Code views](https://code.visualstudio.com/api/ux-guidelines/views), [webview UX](https://code.visualstudio.com/api/ux-guidelines/webviews), [custom editors](https://code.visualstudio.com/api/extension-guides/custom-editors), [theme colors](https://code.visualstudio.com/api/references/theme-color), [webview persistence](https://code.visualstudio.com/api/extension-guides/webview#persistence), [command naming](https://code.visualstudio.com/api/ux-guidelines/command-palette), [W3C toolbar pattern](https://www.w3.org/WAI/ARIA/apg/patterns/toolbar/).

This records the shared contract, candidate evidence and explicit migration gaps. Production styling and native cross-host before/after validation belong to 11.23; specialized designs remain with their consumer tickets. No legacy GPL source was consulted.
