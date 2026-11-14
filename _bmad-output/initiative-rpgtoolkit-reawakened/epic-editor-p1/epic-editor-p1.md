---
type: epic
title: "P1 editor tools"
parent: initiative-rpgtoolkit-reawakened
covers: ["CAP-16"]
assignee: ""
risk: low
tracker_id: "#1359"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1359"
---

# P1 editor tools

## Description

Tile editor, tile grabber, tileset and bitmap font editors, enemy, special move, status effect and battle background editors, lighting and shading, the auto-tiler, undo and clipboard, export image and legacy upgrade wizards.

Owner-approved expansion: a connected artwork workspace with persistent layered/animated sources, sheet-first drawing, contextual variants, reusable recipes, terrain and isometric construction, and standard-format external artist workflows. The story split and repository/GitHub publication were approved together; implementation still follows the contract gates below.

## Outcome

Authors get the full legacy toolset beyond P0; the CAP-16 success check is the signal.

The supplied tools cover the complete artwork workflow without making them mandatory: authors can succeed with external tools and supported exchange formats, or mix both routes without losing their editable sources.

## Done when

1. Each P1 tool opens, edits and saves its legacy format and the result loads in the runner and re-opens unchanged.
2. The auto-tiler picks tiles from the 8-neighbour rules and matches the variant order of community sample sets.
3. Export image writes the current view or the whole board without editor overlays.
4. The coordinate and legacy-board upgrades of T-30 and T-31 run in the editor with correct object movement.
5. A reusable kit can be drawn across cells, edited in board/scene context, animated and assembled from recipes; saving and reopening retains layers, frames, recipe parameters, stable references and originals separately from generated game assets.
6. Terrain and isometric construction produce verified saved outputs usable by the actual board/scene and runner providers, with the existing collision and walk-behind contracts intact.
7. An author can complete artwork in third-party tools, exchange it through the specified formats and run the game without using our drawing UI; reviewed reimport handles changed regions and pending edits without silently discarding work.

## Boundaries

P1 tools of editor-features section 11. Not P0 or P2.

The expanded artwork requirements below map to CAP-16. Epic 11 continues to own shared documents, history, navigation, host capabilities and run/test services; Epic 12 owns the shared browser, generic animation editing, native scene placement and collision integration; Epic 27 owns the baseline native tile/pack contracts and their I/O/checker. This epic owns the artwork-specific contract extension and implementation after those providers, not a second format family, browser or lifecycle. An application-specific editable-file adapter is separate scope; standard exchange must not depend on one. No new core runtime format reader is authorized here.

## References

- spec - _bmad-output/initiative-rpgtoolkit-reawakened/spec-rpgtoolkit-reawakened/spec-rpgtoolkit-reawakened.md, section Capabilities
- reference - docs/editor-features.md, sections 4, 6, 7, 11
- decision - [Artwork refinement decisions and scope](discovery/art-workspace-refinement.md)
- research - [Pixel-art platform investigation](../../../docs/findings/pixel-art-platform/research.md)
- architecture - [Owned editor and permissive reuse](../../../docs/adr/0031-owned-art-editor-with-permissive-reuse.md)

## Notes

- Audit (2026-10-31): this envelope has no `tickets.toml` breakdown, so it has no `tracker_id` and no GitHub parent issue, contrary to the initiative's mirror rule. Recorded, not fixed: a parent issue needs a real breakdown, and inventing entries to satisfy the rule was rejected. Filed as issue #882; `epic-editor-foundation` is the one to break down first because Epic 22's 22.9 waits on its seams. See `DISCOVERY-envelope-audit.md`.


- Open question: the auto-tiler variant ordering must be rebuilt from sample sets under G7; which sample sets? Entries wait on that answer.
- Decision: epic set approved by the user, 2026-10-10.
- Waits on editor-assets-p0 because: the board editor and shared tileset browser.
- Decision: envelope re-sliced against the architecture spine, 2026-10-10.
- Handoff (owner direction, 2026-11-09): the proposed tile, asset and board architecture is [research flow 11](../research-editor-ux-for-beginners/flows/11-tile-asset-and-board-architecture.md). For this epic it proposes unifying T-25 and T-36 to T-38 into a Tile & Iso Studio backed by a DOM-free Tile Forge in `editor-model` (sheet slicer, kitbash stack, flat → iso projection reusing `isoSourceOffset`, three-face iso blocks, tall-iso decomposition, Tilesetter-style 47-variant autotile generator), plus isometric and image-mask boundary tracing, and the `.tkrtile` / `.tkrpack` YAML formats (schema page in `docs/spec/` first, per G7). Settle at inception; not yet part of the Done-when list.

- Decision (2026-11-08): incept all editor epics; entry 2's art reuse evidence and approval precede entry 1, the real `.tst` edit/save/reopen/board-use tracer, not a browser or a new document model.
- Source conflict: the 2026-10-31 audit above is historical; this envelope now has parent #1359 and this breakdown, but its child issue mirroring is a separate publication step.
- Source conflict: section 11's P1 list omits T-39 although section 4 and research F-05 explicitly inventory animated tiles; entry 6 owns `.tan` editing and consumes the one 12.2 browser.
- Source conflict: T-42–44 and T-46 are not assigned a priority in section 11; CAP-14 and 10.5/10.7 own language rewrites and formatting, while entry 16 owns the P1 editor-facing review/apply workflows, including project-wide upgrade and cleanup, without a second formatter or syntax engine.
- Source conflict: T-73's 2.x project-layout upgrade is listed in the feature inventory but the initiative spec explicitly makes it a non-priority non-goal; no implementation is assigned without a future owner scope decision, and unpublished entry 17 is retired. T-71 is not a distinct compiler tool; P0 packaging owns the distribution package.
- Source conflict: AD-18's same-version preservation and the Done-when legacy save obligation cannot be met by assuming every reader has a matching writer; enemy's minor-0 text reader and binary-only `writeEnemy` are a concrete example (`packages/core/src/formats/actor/enemy.ts`); each affected entry must prove or implement same-version writing from the normative format spec, or obtain a docs-first owner ruling before changing format, never silently upgrade.
- Requirement map to CAP-16: T-36 → 1–3; T-37 → 4; T-38 → 5; T-39 → 6; T-25 → 7–8; T-56 → 9; T-57/58 → 10; T-63 → 11; T-23/26 lighting and shading → 12; T-28 expanded clipboard → 13 (basic board undo belongs to 12.1); T-32 → 14; T-30/31 → 15; T-42–44/46 editor presentation → 16 (transform providers 10.5/10.7); integrated acceptance → 19; T-65 → 20.
- External dependencies: 11.1–11.4 supply shared contracts, lifecycle and linked visits; 11.7 supplies text integration; 12.1 board tracer, 12.2 the one contextual browser, 12.3 board properties, 12.11 board object modes and inspector, and 12.4 shared sprite editing; 10.5 and 10.7 are existing language-tool provider entries. Each leaf names the actual provider it needs; parent must declare the cross-epic edges.
- Art-tool reuse remains an evidence-gated choice, not a selected dependency: entry 2 compares suitable maintained candidates and an in-house route for license/transitives G6, host/keyboard/offline support, document/undo integration and required pixel operations before any new dependency is installed; if no candidate qualifies, implement in-house.
- Auto-tiler ordering is not established by the generic blob rule: entry 7 must obtain and document rights-cleared community samples and independently verify indexed variants, recording provenance and ambiguous cases before entry 8 may implement a mapping; absence of adequate evidence blocks parity, never invent an order or read GPL source.
- Shared registration and integration is owned by entry 1; art, board and database stories modify their own feature modules, with ordering inside each lane and adapter/registry changes routed through the initial stable registration contract; none creates a second browser. No synchronised multi-cell animation channel, cross-document atomic undo, plugin UI or hot reload is assumed.

- Decision (2026-11-13, owner approved breakdown and publication): product direction is owned editor with permissive reuse and browser-led interaction; 13.2 selects components, not whether to own the product. The source preservation and third-party workflow requirements below reflect the owner's subsequent decisions, not additional scope approved merely by ADR 0031.
- Added CAP-16 requirements: A-1 persistent editable layers/frames/recipes and source/output separation → 21–22; A-2 sheet-first drawing and reusable region brush → 23; A-3 shared/local contextual editing → 24; A-4 artwork timeline and multi-cell water animation → 21, 25; A-5 reusable non-destructive recipes → 26; A-6 terrain generator and actual-provider sandbox → 27; A-7 isometric construction, anchors and tall blocks → 28; A-8 standard external exchange, handoff and reviewed reimport without compulsory drawing UI → 21, 29–30. Existing T-ID requirements remain assigned; 18 and 19 close the full union.
- Sequencing: entry 1 remains the small legacy tracer after entry 2. Entry 21 specifies and obtains approval for source/interchange/timing changes before entry 22 implements persistence; 3 then supplies the complete toolset and 23 its sheet interaction. Contextual variants consume 12.16/12.17; animation consumes 13.6, 12.7 and 27.4. Terrain and iso consume the recipe service and existing scene/collision providers. Native generation never substitutes for entry 7's sample-derived legacy compatibility evidence.
- Contract gate: 21 must settle storage ownership, exact animation timing and supported output lowering in normative docs and a separate docs-first commit before dependent code. Do not smuggle a new native extension, per-frame runtime timing, synchronised channels or source schema into a UI implementation. If a new kind or runtime contract is necessary, obtain the required ADR/contract approval as part of 21 before its implementation can start; the committed capability must not be reduced to a preview or unsupported message.
- Complete, not captive: our tools must supply the artwork workflow, but external artists can use standard exchange without our drawing UI. Preserve original third-party source files; accepting their rendered output does not claim structural import or lossless editable round trips. PNG follows the existing image policy. The precise sheet/animation metadata exchange is a required output of 21, not an unnamed assumed JSON convention.
- Parallel ownership: entries consume shared commands/models rather than edit private copies. The source service and registration seam belong to 22 and 1; each later feature owns its own UI module and adapter. Route shared model/interface changes through their named prerequisite owner. Browser-driven presentation does not relax saved-source, host I/O, licensing, preservation or core determinism contracts.

