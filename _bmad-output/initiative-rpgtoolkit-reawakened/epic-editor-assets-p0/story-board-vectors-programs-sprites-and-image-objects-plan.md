---
type: feature
title: "Board vectors programs sprites and image objects"
ticket: 11
status: in-progress
created: 2026-11-17
baseline_revision: 9b0e39e341ccb76740e04f53294b866f7a63bb63
review: thorough
review_source: auto
route: full
risk: high
context:
  - docs/guardrails.md
  - docs/editor-features.md
  - docs/spec/formats/board.md
  - docs/adr/0022-shared-editor-authoring-contracts.md
  - docs/design/editor-design-language.md
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

- [x] Model object commands: create/edit/remove and deliberate slot reorder where specified; validate numeric widths and exact text storage; preserve every unedited field, reserved value and residue. Keep file/inline program text intact.
- [x] One active mode: Tiles, Vectors, Programs, Sprites or Images, with keyboard access. Keep Scroll/Zoom. P1 modes are not falsely presented as working.
- [x] Vector/program geometry: click points, close/right-click, Ctrl+right-click open, Shift axis/diagonal snap, Ctrl snapping inversion, Alt nearby point deletion/segment split/resume; nearest selection, point box selection and movement, Delete, Z subdivision, X resume, coordinate-aware rectangle. Provide labeled numeric point alternatives.
- [x] Vector inspector: index/handle, supported type, closed flag, layer, under flags, stairs target layer, explicit order, editable points, visibility and delete. Preserve deprecated type 4 if opened without offering it as a new type.
- [x] Program inspector: file or inline RPGCode, Choose/Open, layer, step/key trigger, distance-repeat, stop movement, run-once conditions and explicit run-if/then-set variables, editable polygon.
- [x] Sprite inspector: shared item Choose/Open; tile/pixel bottom-centre position, layer and index; local activation/multitask overrides, trigger, loading/run-if/then-set conditions. Explain instance versus shared definition.
- [x] Image inspector: file, top-left pixel position, layer, transparent RGB key and canvas colour picking. Keep loaded draw mode/reserved fields. Canvas shows south-rest item art, missing-art placeholders, type-coloured geometry, selection highlighting and per-type visibility.
- [x] Test persistence/undo/cancel and accessible routes; prove new evidence tests fail for targeted behavior removal and restore green. Add paced real-host creation/edit/save/reopen/linked-return proofs for both hosts.
- [ ] Update changelog, plan evidence and review triage. File real defects, fix practical blockers and backlog non-blocking edge cases without scope growth.

Given one authored board containing each object kind and opaque residue, editing one kind then saving/reopening retains its intended fields and every unrelated kind. Given the same ordinary task in browser and VS Code, pointer and keyboard/numeric routes reach the same saved outcome and linked-file return restores the selected object.

## Implementation Notes

#1714 merged in #3021 at `e7f1fd71f3d20ccc8a2cfe9cc15e127a81c08e0f`. This delivery starts on fresh main `5ce9dbbda611d35f8c376ecdc1052837c028b11e` in `/private/tmp/tkr-1721-board-objects`, branch `feat/1721-board-objects`. The later main change is desktop acceptance evidence, not a production board implementation change. #1721 is assigned and in the current sprint; its unique canonical/stock preflight agrees.

The owner-approved #2970 cutover is merged: retired 12.6 belongs to Epic 29.7. Use existing item graphics and authored behavior fixtures here. The current normative board format, not a future design language or native scene schema, defines this story.

Shared data seam: extend the existing `set-board-fields` command and board snapshot with `vectors`, `programs`, `sprites` and `images`; preserve same-version exact read-back, undo and pending acknowledgements. Compare record values structurally, not by object-property insertion order. Authoring defaults and explicit removal/renumbering follow `docs/editor-features.md#p0-board-objects`, committed before implementation.

Two implementation owners cover model persistence and the new focused inspector component. Parent owns the existing controller/canvas/view, host wiring, real proofs, integration and publication. Workers use absolute paths in this worktree, skip all builds/lint/tests/formatters mid-flight, do not commit/push/merge, and never edit each other's assigned files. Parent verification is authoritative.

The review candidate was rebased onto current main `9b0e39e341ccb76740e04f53294b866f7a63bb63`. Incoming 11.22 changes add the validated shared design/migration contract and evidence, not production board code. Its native-control, document/placement ownership and captured-origin contracts apply; shared styling implementation remains 11.23 and specialized workspace redesign remains Epic 30.

## Plan Change Log

- 2026-11-16: expanded the draft against T-23/T-26/T-34/T-35 while #1714 is in flight; retained all existing acceptance and excluded P1/future family-editor scope.
- 2026-11-17: #3021 and all prerequisites verified merged; canonical #1721 preflight/stock agreement and no competing open PR verified. Owner-delegated recommendations settle snapping, draft cancellation and explicit slot removal in the normative editor rules before code.

## Review Triage Log

- Parent local verification, before independent review: fixed opaque white/no-key sprite pixels (#3029), drafts lost through Tiles (#3030), board game-folder asset resolution (#3033), dialog Escape reaching the canvas (#3038), omitted packaged inspector CSS (#3042), an inert cancellation test (#3043), legacy preview test-adapter assumptions (#3049), and character extensions advertised by the placed-item picker (#3055). Independent lenses have not yet returned.
- The real linked item provider opens correctly but its own graphics preview omits the game-folder root (#3040). This is recorded for the immediately following connected-authoring story #1723, not falsely claimed fixed by the board placement preview.

## Verification

- Node 24.21.0 / pnpm 12.10.1. The focused new renderer/model/controller/geometry/preview/inspector run passed 43/43 in 689.653083ms; its longest case was 18.227959ms. The actual BoardView draft-through-Tiles route is covered separately.
- Real browser proof passed after rebuilding, including 96px rendered-art hit testing outside the generic fallback, native modal Escape/focus, every object kind's creation and edits, staged colour picking plus one-step undo, source visits/return, saved raw-slot/residue checks and reopening (7.2s case). The actual styled screenshot was inspected.
- Packaged VS Code focused proof passed both native iterations in 30.62s total with `@vscode/test-web` 0.0.81 / Insiders `8a14f0cc1b08d531eb83255ea3764ae22aa932b5`. Native history uses workbench keys; Save waits for shared saved state and native clean-tab completion, followed by settling pacing. The actual native screenshot was inspected.
- Negative controls: removing explicit null handling failed four pixel tests; removing acknowledgement registration let Save complete prematurely and failed the consumer guard; dropping image writes and bypassing exact read-back each failed persistence/refusal evidence. Path-only cancellation initially stayed green, so #3043 added a draft-removal assertion; the same mutation then failed and restored code passed. Dropping bounds in each actual host failed the same rendered-art selection assertion (expected raw slot 1, received no selection). All mutations and temporary screenshot code were restored.
- Full typecheck and lint passed. After repairing ten stale request/canvas test-adapter failures, the integrated strict suite passed 5163/5163 with zero skips/todos. Graph, licence, provenance, catalogue and command-doc checks passed. The toolchain check found stale generated release notes; the canonical renderer's output was applied and its own check passed. The final inspector run passed 11/11, including acknowledged Save, and plan context paths/changelog anchor resolve. Headless goldens, full rebuilt browser/normal packaged VS Code proofs and independent review remain pending. No golden re-recording is planned.
- Core hot-path cost is constant key selection per visible sprite, with no new scan or state copy and no repeated white-fallback allocation. Paired same-package measurements and machine are in `tools/perf/README.md` and #3029; no speedup is claimed.
