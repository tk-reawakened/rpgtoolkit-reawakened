---
type: epic
title: "Build playable places through connected board authoring"
parent: initiative-rpgtoolkit-reawakened
covers: ["CAP-15", "CAP-16", "CAP-18"]
after: ["epic-editor-assets-p0", "epic-editor-p1"]
assignee: ""
risk: high
stepsCompleted: ["input-selection", "requirements", "ownership-map", "story-breakdown"]
inputDocuments: ["spec-rpgtoolkit-reawakened/spec-rpgtoolkit-reawakened.md", "architecture-rpgtoolkit-reawakened/architecture-rpgtoolkit-reawakened.md", "research-editor-ux-for-beginners/decisions.md", "research-editor-ux-for-beginners/flows/01-board-editor.md", "ux-connected-editors/DESIGN.md", "ux-connected-editors/connected-authoring-and-tests.md", "../../../docs/design/board-authoring.md", "../../../docs/design/editor-project-metadata.md", "../../../docs/adr/0022-shared-editor-authoring-contracts.md"]
tracker_id: "#2985"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/2985"
---

# Build playable places through connected board authoring

## Problem and outcome

Board authoring spans painting, geometry, interactions, people/items, images, atmosphere and board settings. The legacy surfaces expose these as technical modes, raw indices and separate property pages. Our approved experience keeps a persistent scene canvas and a contextual inspector, and connects the author to real asset editors in document tabs.

An author can build and test a playable room, follow a reference into its script or definition, and return without losing selection, viewport, tool or brush. With two boards visible the inspector follows the focused board; entering its auxiliary controls retains that target. Definition tabs edit shared assets, while the inspector edits the local placement and its supported overrides.

Jensen requested documentation and implementation tickets on 2026-11-16 and explicitly proposed a separate epic from the initial editor Epics 11–13. This epic owns the connected board experience; it neither replaces those foundations nor reopens completed field-coverage work. Epic 29 (#2968) owns character, NPC, item and enemy definition authoring. Item #1722 is now 29.7 (formerly 12.6), and enemy #1734 is now 29.8 (formerly 13.9); their issue identities remain unchanged.

## Approved contract and selected inputs

The implementation contract is [docs/design/board-authoring.md](../../../docs/design/board-authoring.md). It records the focus rules, canvas/outline/inspector interaction, tab visits, creation/attachment failure semantics, supported reference boundaries, board settings, host constraints and official reference pack.

The input set is the existing capability specification and architecture, the accepted parts of the earlier editor research and connected-workshop design, and the owner's current board discussion. Earlier research proposals are not all approved features: exact labels and outline grouping remain design choices, and proposed universal databases, inferred routes or new template languages are not included. There is no new product-wide PRD or renumbering of its capabilities. Local acceptance topics below refine CAP-15/CAP-16/CAP-18 only.

The legacy screenshots are UI/task references. No GPL source was read. The record describes current desired behavior, not an implementation audit or proof that an old screenshot represents today's editor.

## Requirements and ownership

Each scoped outcome has one primary story; 30.7 verifies the combined journey. Capability identifiers are retained from the existing specification.

| Existing source | Scoped outcome | Primary owner |
| --- | --- | --- |
| CAP-15/CAP-18; ADR 0022 D1–D3/D7; owner focus clarification | Shared persistent canvas, focus-following inspector, explicit originating targets, actual VS Code/web integration | 30.1 |
| T-20–T-23/T-26/T-34; ADR 0019 | Outline/canvas selection, overlap selection, precise geometry and separate overlays | 30.2 |
| T-24/T-62; accepted contextual-browser direction | Contiguous sheet painting and artwork visits with retained brush context | 30.3 |
| CAP-15/CAP-16/CAP-18; ADR 0022 D2/D4 | Open/create references in real editor tabs; placement versus definition and safe attachment | 30.4 |
| T-26/T-35; board/program format contracts | Understandable interaction inspector and explicit exit/arrival visit | 30.5 |
| T-26/T-27/T-29; Epic 13 lighting provider | Board settings, images and atmosphere in context | 30.6 |
| CAP-15/CAP-16/CAP-18; ADR 0022 D8 | Cross-host creator walkthrough, lifecycle/focus regressions and real saved-snapshot board test | 30.7 |
| Owner direction, shared editor metadata (first pass); CAP-15/CAP-18; ADR 0022 D2/D4 | Follow-on: optional friendly names and short descriptions for board placements, regions and interactions via the shared project metadata provider, gated on provider, stable identity and lifecycle investigation | 30.8 |

Cross-cutting nonfunctional requirements: single document authority and host-owned lifecycle; no accidental cross-board/project edits; supported format/residue preservation; theme and keyboard accessibility; useful narrow/relocated views; browser-native editor capabilities; shared compositor; no speculative runtime changes; fast unit checks and paced host proofs. These apply to each owner above and are integrated in 30.7.

## Delivery sequence

**Owner sequencing, 2026-11-16: finish Epics 12 and 13 before implementation starts in Epics 29 and 30.** Both completion gates are recorded in this epic's frontmatter. Planning does not start implementation; neither earlier epic waits back on 29/30. This does not require all of 29 to finish before all of 30: consuming stories still wait for their actual definition providers.

1. **30.1 (#2974) — Establish the board workspace and focus-following inspector.** First vertical slice in real VS Code and web hosts; establish the common targeting and shelf contract.
2. **30.2 (#2976) — Select and shape the scene through an outline and readable overlays.** Preserve precise geometry and runtime semantics while making selection and visibility understandable.
3. **30.3 (#2978) — Paint from the shared sheet browser and visit artwork without losing the brush.** Integrate the existing sheet and brush providers into the board flow.
4. **30.4 (#2980) — Open and create linked definitions in their own editor tabs.** Connect legitimate asset references and preserve the origin through success, cancellation and failure.
5. **30.5 (#2982) — Edit interactions and board exits through the selection inspector.** Preserve advanced data and custom source; make supported common interactions and destination visits clear.
6. **30.6 (#2983) — Edit board settings images and atmosphere with the canvas in view.** Group relevant controls around the scene and consume the existing lighting provider.
7. **30.7 (#2984) — Prove the connected board-authoring journey across editor hosts.** Deliver recorded creator evidence and regression checks with the real runner.
8. **30.8 — Name and describe board elements through shared project metadata.** Follow-on to this sequence, added after the original seven; it does not reopen or alter the 30.7 proof. Starts with an investigation and identity/lifecycle gate, then connects names and descriptions to the outline, canvas, inspector and visits with accessible discovery. The GitHub issue is not yet published.

30.1 consumes the shared design-language and styling work in 11.22/11.23; board-specific focus/selection behavior remains here. Research can proceed before those deliver, but implementation reuses their shared components. 30.2–30.4 follow 30.1; 30.4 also waits for the actual item/NPC and enemy definition editors in 29.7/29.8. 30.5 follows 30.2/30.4; 30.6 follows 30.1/30.4; 30.7 follows 30.2–30.6. The store carries those exact prerequisites. Stories start in the backlog (Project status draft, no sprint); implementation is not started by this planning change.

30.8 follows 30.2, 30.4, 30.5 and 30.7 and carries the Epic 12 and 13 acceptance gates (12.14, 13.19) explicitly. It also waits for the shared project metadata work in Epic 11: the owner-approved storage, identity and lifecycle contract (11.25), shared persistence (11.26), the shared friendly-name and description component (11.28) and safe file rename versus name editing (11.29). Those stories own the open storage and identity questions; 30.8 must not build a board-local metadata store or decide them, and it is blocked until they land. The original seven stories' outcomes and 30.7's acceptance are unchanged by it.

## Existing work and boundaries

| Existing issue/provider | Relationship |
| --- | --- |
| Shared design language and styling, 11.22 (#2987) / 11.23 (#2988) | Own the common placement/interaction/component contract and its visual implementation; 30.1 consumes them. See [shared design language](../../../docs/design/editor-design-language.md). |
| Epic 11 #1357 | Supplies document authority, platform-services, native hosts, focused commands, save and launch contracts. |
| PR #2950, open at planning time | Reuse its final compact tools, focused commands and shared Save; no competing toolbar or save implementation. |
| #1713 and #2322 | Own browser/brush and sheet/region-brush capabilities. 30.3 integrates them into this experience. |
| #1720/#1721 | Existing board tools and object commands; 30.2/30.5 present and connect them. |
| #1850/#1851/#1852 | Own scene lowering, .brd/.tkrscn editing and tile/asset collision. No second scene model here. |
| #1714 | Existing board properties/start; 30.6 reorganizes the experience while preserving behavior. |
| #1734 (29.8) / #1737 (13.12) | Enemy authoring is now owned by Epic 29; lighting remains in Epic 13. Consume these from 30.4/30.6 instead of recreating them. A missing enemy editor leaves that visit unmet. |
| #1723 | Owns broader connected-authoring/test services. 30.4/30.7 contribute board-origin integration and evidence. |
| Epic 29 #2968, planning PR #2970 | Character, NPC, item and enemy definition internals. 30.4 opens those editors; no duplicate definition UI work. Shared design language/styles remain in 11.22/11.23. |
| #2609/#2652 | Known linked-provider and pending-edit lifecycle issues; recheck at implementation and link fixes/unmet acceptance rather than suppressing failures. |
| #2961 | Known publisher area-classification bug; publish this epic with an explicit editor-ui map override, as Epic 29 did. No tool fix is included here. |
| [Shared project organization and friendly names](../../../docs/design/editor-project-metadata.md) / Epic 11 stories 11.25–11.29 | First-pass owner direction, not an approved contract. Storage (including whether a new project metadata file is needed), identity, precedence of names and move/rename/delete/external-change behavior are open and are ruled by 11.25 and implemented by 11.26/11.28/11.29, not assumed here. 30.8 applies the result to board elements and records only the board-specific identity investigation. Asset organization (groups, the Game drawer; 11.27) and a possible cross-category label view are not part of this epic. Epic comments #1357 and #2985 carry the owner request. |

The owner's full Epic 12/13 completion gates apply before implementation. Additional dependencies remain capability-specific, including shared language/styles in 11.22/11.23 and actual definition providers from Epic 29. At implementation inception, pin the current revision and reconcile provider status and overlap before editing shared components. Missing providers retain their existing owning issue; the integration story cannot call a disabled control a completed journey. Broader event builders, new encounter/runtime mechanics, arbitrary code interpretation, new formats, a universal database and wholesale shell replacement are out of scope.

## Done when

- The contract's room-to-exit walkthrough works in web/PWA and actual VS Code, with tabs for real linked resources and a shelf driven by the active authoring view.
- Auxiliary focus retains the target. A different focused editor updates it. Split views share authored data but keep independent view state. Async work captures its origin and cannot mutate another board after a focus/project switch.
- Placement versus shared-definition edits, same-version supported fields/residue, save/undo and native scene semantics are preserved. Unsupported references are never written into a convenient but wrong legacy field.
- Keyboard and numeric alternatives, normal/narrow panes, light/dark/high-contrast and relocatable/hidden inspector behavior have real evidence with revision, fixture and host version.
- Test Board uses ADR 0022 D8's existing save-first, explicit-party/start and fixed-snapshot semantics. A save failure prevents launch. Later edits do not hot-reload the run.
- Every story has its focused proof; 30.7 records the combined result and all discovered defects have issues. This planning PR closes none of the implementation tickets.
- Follow-on 30.8, once the shared metadata provider and stable identity exist, lets a creator name and describe placements, regions and interactions without renaming files, altering references or game behavior; projects without metadata behave as before, and ambiguous identity never attaches an annotation to the wrong object. This is not a condition of the outcomes above and no completed work is reopened.

## Source map

Input document paths in frontmatter are initiative-relative unless they start `../../../`, which is relative to this epic directory. Implementation derives from `docs/`, including the new [board authoring contract](../../../docs/design/board-authoring.md), [editor features](../../../docs/editor-features.md) T-20–T-35, [board format](../../../docs/spec/formats/board.md), [native authoring](../../../docs/spec/formats/tkr-authoring.md), [ADR 0022](../../../docs/adr/0022-shared-editor-authoring-contracts.md), and [board-test startup](../../../docs/spec/engine/main-loop-and-startup.md#reawakened-board-test-startup). The new contract includes dated official VS Code and W3C links and separates those constraints from our owner-approved focus policy.
