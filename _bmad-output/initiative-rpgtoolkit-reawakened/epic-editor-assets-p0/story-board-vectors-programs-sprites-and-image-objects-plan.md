---
type: feature
title: "Board vectors programs sprites and image objects"
ticket: 11
status: in-progress
created: 2026-11-17
baseline_revision: 5ce9dbbda611d35f8c376ecdc1052837c028b11e
review: thorough
review_source: auto
route: full
risk: high
context:
  - docs/guardrails.md
  - docs/editor-features.md
  - docs/spec/formats/board.md
  - docs/adr/0022-shared-editor-authoring-contracts.md
---

# Board vectors programs sprites and image objects

<frozen-after-approval reason="Owner delegated recommended decisions and autonomous Epic 12 delivery on 2026-11-16">

## Intent

Complete the retained P0 board object tools: vectors, program regions, placed item sprites and layer images. An author can create, select, move and inspect each on the existing board canvas, follow its linked source, undo edits, save and reopen without losing unrelated data.

## Boundaries & Constraints

Use the existing BoardDocument, board canvas geometry, command history, compositor and workspace visits. Shared UI owns all tools/inspectors; hosts provide only services and chrome. Read/write the opened version and preserve opaque residue, untouched objects and empty slots. Slot reordering is an explicit author action, never an incidental consequence of deleting or editing another object.

Do not implement P1 shading/lighting modes, autotile, clipboard expansion, image export, coordinate upgrades or full item behavior authoring (moved to Epic 29.7). Existing item graphics and authored item fixtures supply placements. No native scene conversion in this story. Never access legacy GPL source.

## I/O & Edge-Case Matrix

| Scenario | Expected behavior |
|---|---|
| Create/edit each object kind and save/reopen | Geometry, slot order, links, flags and conditions persist; unrelated board bytes/data survive |
| Undo/redo each completed gesture | One gesture is one command; unrelated objects and view state remain intact |
| Cancel in-progress geometry or asset picker | No document mutation or dirty state |
| Invalid geometry/value or unsupported/read-only board | Explain refusal and retain draft; no coercion or silent upgrade |
| Open linked program/item and return | Existing provider opens correct source; originating board/object selection restored |
| Missing picture or empty sprite reference | Visible 32×32 placeholder; editor remains usable |
| Immediate host save after an accepted command | Pending bridge acknowledgement settles before save |

</frozen-after-approval>

## Code Map

- `packages/editor-model/src/board-document.ts`: extend #1714's property/start work with validated object commands and plain snapshots over core's existing vectors/programs/items/images. Reuse same-version writer/read-back exactness.
- `packages/editor-model/src/board-editor.ts`, `board-geometry.ts`, `board-tools.ts`: existing DOM-free cell/pixel mapping, pointer/keyboard gesture and view state. Add focused object helpers rather than another editor state owner.
- `packages/editor-ui/src/board-view.tsx`, `board-canvas.tsx`: retain compact toolbar and shared Save; add mode selection and overlay/inspector components where focused files keep the view maintainable.
- `packages/editor-ui/src/mount.ts`, host-web and host-vscode board adapters: reuse #1714's linked-file navigation/return and pending-edits wiring, not a second callback protocol.
- Existing `editor-model` board document/editor/geometry tests, editor-ui board canvas/view tests, real browser board proof and `tools/editor-vscode-test` proof runner are the verification seams.
- Normative fields are `docs/spec/formats/board.md#vectors`, `#programs-triggers`, `#items-placed-on-the-board-sprites`, `#layer-images`; tool behavior is T-23/T-26/T-28/T-34/T-35 in `docs/editor-features.md`.

## Tasks & Acceptance

- [ ] Model object commands: create/edit/remove and deliberate slot reorder where specified; validate numeric widths and exact text storage; preserve every unedited field, reserved value and residue. Keep file/inline program text intact.
- [ ] One active mode: Tiles, Vectors, Programs, Sprites or Images, with keyboard access. Keep Scroll/Zoom. P1 modes are not falsely presented as working.
- [ ] Vector/program geometry: click points, close/right-click, Ctrl+right-click open, Shift axis/diagonal snap, Ctrl snapping inversion, Alt nearby point deletion/segment split/resume; nearest selection, point box selection and movement, Delete, Z subdivision, X resume, coordinate-aware rectangle. Provide labeled numeric point alternatives.
- [ ] Vector inspector: index/handle, supported type, closed flag, layer, under flags, stairs target layer, explicit order, editable points, visibility and delete. Preserve deprecated type 4 if opened without offering it as a new type.
- [ ] Program inspector: file or inline RPGCode, Choose/Open, layer, step/key trigger, distance-repeat, stop movement, run-once conditions and explicit run-if/then-set variables, editable polygon.
- [ ] Sprite inspector: shared item Choose/Open; tile/pixel bottom-centre position, layer and index; local activation/multitask overrides, trigger, loading/run-if/then-set conditions. Explain instance versus shared definition.
- [ ] Image inspector: file, top-left pixel position, layer, transparent RGB key and canvas colour picking. Keep loaded draw mode/reserved fields. Canvas shows south-rest item art, missing-art placeholders, type-coloured geometry, selection highlighting and per-type visibility.
- [ ] Test persistence/undo/cancel and accessible routes; prove new evidence tests fail for targeted behavior removal and restore green. Add paced real-host creation/edit/save/reopen/linked-return proofs for both hosts.
- [ ] Update changelog, plan evidence and review triage. File real defects, fix practical blockers and backlog non-blocking edge cases without scope growth.

Given one authored board containing each object kind and opaque residue, editing one kind then saving/reopening retains its intended fields and every unrelated kind. Given the same ordinary task in browser and VS Code, pointer and keyboard/numeric routes reach the same saved outcome and linked-file return restores the selected object.

## Implementation Notes

#1714 merged in #3021 at `e7f1fd71f3d20ccc8a2cfe9cc15e127a81c08e0f`. This delivery starts on fresh main `5ce9dbbda611d35f8c376ecdc1052837c028b11e` in `/private/tmp/tkr-1721-board-objects`, branch `feat/1721-board-objects`. The later main change is desktop acceptance evidence, not a production board implementation change. #1721 is assigned and in the current sprint; its unique canonical/stock preflight agrees.

The owner-approved #2970 cutover is merged: retired 12.6 belongs to Epic 29.7. Use existing item graphics and authored behavior fixtures here. The current normative board format, not a future design language or native scene schema, defines this story.

Shared data seam: extend the existing `set-board-fields` command and board snapshot with `vectors`, `programs`, `sprites` and `images`; preserve same-version exact read-back, undo and pending acknowledgements. Compare record values structurally, not by object-property insertion order. Authoring defaults and explicit removal/renumbering follow `docs/editor-features.md#p0-board-objects`, committed before implementation.

Two implementation owners cover model persistence and the new focused inspector component. Parent owns the existing controller/canvas/view, host wiring, real proofs, integration and publication. Workers use absolute paths in this worktree, skip all builds/lint/tests/formatters mid-flight, do not commit/push/merge, and never edit each other's assigned files. Parent verification is authoritative.

## Plan Change Log

- 2026-11-16: expanded the draft against T-23/T-26/T-34/T-35 while #1714 is in flight; retained all existing acceptance and excluded P1/future family-editor scope.
- 2026-11-17: #3021 and all prerequisites verified merged; canonical #1721 preflight/stock agreement and no competing open PR verified. Owner-delegated recommendations settle snapping, draft cancellation and explicit slot removal in the normative editor rules before code.

## Review Triage Log

## Verification

Run focused object-model/geometry/UI/host tests once implementation is complete, inspect new test durations, then paced browser/VS Code real-surface proofs. Run local typecheck/lint/strict suite and required graph/licence/provenance/toolchain/golden gates before pushing. Review independently against the full diff and real acceptance. CI confirms locally tested work; no golden changes expected.
