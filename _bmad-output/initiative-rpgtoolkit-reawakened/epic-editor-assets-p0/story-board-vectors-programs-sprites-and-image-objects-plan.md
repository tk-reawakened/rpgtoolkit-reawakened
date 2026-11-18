---
type: feature
title: "Board vectors programs sprites and image objects"
ticket: 11
status: done
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
- [x] Update changelog, plan evidence and review triage. File real defects, fix practical blockers and backlog non-blocking edge cases without scope growth.

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

- Parent local verification, before independent review: fixed opaque white/no-key sprite pixels (#3029), drafts lost through Tiles (#3030), board game-folder asset resolution (#3033), dialog Escape reaching the canvas (#3038), omitted packaged inspector CSS (#3042), an inert cancellation test (#3043), legacy preview test-adapter assumptions (#3049), and character extensions advertised by the placed-item picker (#3055). All four independent review lenses subsequently returned; normalized dispositions are recorded below.
- The real linked item provider opens correctly but its own graphics preview omits the game-folder root (#3040). This is recorded for the immediately following connected-authoring story #1723, not falsely claimed fixed by the board placement preview.

## Verification

- Node 24.21.0 / pnpm 12.10.1. The initial integrated strict suite passed 5163/5163. After the review repairs, all-project typecheck and 805 affected editor-model/UI/web/native-host tests passed with zero failures/skips/todos (13303.607125ms). The final inspector run passed 18/18 in 795.470042ms; its longest case was 21.453417ms. The real-controller run passed 12/12 in 361.092209ms.
- The expanded rebuilt browser object journey passed in 12.7s: actual owning-project item choice and its separate **Use it** confirmation, canvas create/select/move for all four families, snapped off-grid anchor translation, Ctrl+Enter open program, numeric edits, native modal Escape/focus, source visits/return, accepted slot reorder/removal, exact saved Undo bytes and recreation. Its completed screenshot was inspected. The earlier complete browser run passed 131/132; its sole obsolete rotating-release-note assertion (#3070) was deleted rather than re-pinned, and that exact real Monaco/help journey subsequently passed in 5.3s.
- The complete normal packaged VS Code proof passed in 221.41s using `@vscode/test-web` 0.0.81, not the focused shortcut. All 13 harness checks passed, followed by animation creation/recovery, sprite save/reopen, actual project creation, board properties/linked native programs, board objects/definition visits/confirmed choices/saved raw records, both cancel/keep suites, art conflict/reload and autosave negative controls. Native history uses workbench keys; Save waits for shared saved state and clean native tabs, with settling pacing.
- Negative controls: explicit-null removal failed four pixel tests; acknowledgement removal let Save finish prematurely; dropped image writes and bypassed exact read-back failed persistence/refusal. An originally inert path-cancellation test was corrected in #3043 and then failed its matching mutation. Missing actual host bounds failed rendered-art selection in both hosts. New diagonal split tests reject the old always-unsnapped formula (70 versus 64); wrong removal survivors and dropped reorder insertion fail complete record assertions. Bypassed stale/layer guards and a single-line inline editor fail all five targeted inspector cases. Every mutation and temporary screenshot statement was restored; normal artifacts were rebuilt.
- Full typecheck/lint, graph, licence, provenance, catalogue and command-doc checks passed. Final changed-surface lint, current toolchain/CSP/generated-help checks and canonical ticket-store validation passed. Node and Bun each passed 24 golden comparisons and all scene/audio goldens; both closing runs matched 8/8 baselines with no re-recording. Four initial review lenses were individually triaged; two independent re-reviews of repair commit `d8423512719cc0b5dec7e1aec84e4c7adf2564de` found no actionable defects. Remote main was rechecked at `9b0e39e341ccb76740e04f53294b866f7a63bb63`.
- Core hot-path cost is constant key selection per visible sprite, with no new scan or state copy and no repeated white-fallback allocation. Paired same-package measurements and machine are in `tools/perf/README.md` and #3029; no speedup is claimed. #3067 remains Backlog/no sprint; #3040 is the immediately following connected-authoring work, not a claimed result here.

## Code Review

### 2026-11-17 — pinned candidate fc3437867211aeb36bffee2c8efbf8b6a6fa0259

**Four layers completed; none failed. 0 decision-needed, 12 patch groups, 2 defer groups, 3 rejected findings.** The owner has already authorized autonomous correction of normal blockers and backlog treatment of rare edges; no per-finding approval pause is needed. B = blind, E = edge, V = verification, I = intent, P = parent local verification. Every member retains its own verdict before grouping.

Repair checkpoint `d8423512719cc0b5dec7e1aec84e4c7adf2564de` was independently re-reviewed for state/geometry and host/root/proof correctness; both reviewers returned no findings. All patch groups below are locally exercised, including the full normal packaged native proof. Only publication/CI/merge receipts remain.

- [x] [Review][Patch] **High — stale whole-record inspector drafts (#3060).** B1/high and E1/high: applying a handle draft after canvas movement restores old geometry. B2/high and E2/high: Undo of removal can make the retained slot index identify a different record. The same absent immutable source baseline causes both overwrites. Compare the latest stored source structurally, retain/refuse stale drafts, and preserve intervening changes. [`board-objects-view.tsx:53-86`]
- [x] [Review][Patch] **Medium — inline code line breaks (#3061).** E3/medium: a text input normalizes multiline RPGCode, joining statements/comments. Use a native textarea and verify exact saved/reopened code. [`board-objects-view.tsx:109-112`]
- [x] [Review][Patch] **Medium — open-path keyboard completion (#3062).** B3/medium and E4/medium: the modifier branch returns before Ctrl+Enter reaches path completion. Route pending-path Enter first; prove the actual two-point open program in both hosts. [`board-view.tsx:324-361`]
- [x] [Review][Patch] **Medium — Draw modifier precedence (#3063).** B4/medium: ordinary segment clicks split a stored object rather than starting a neighbor. B5/medium: Alt away never resumes its selected stored path. The missing Alt dispatch distinction causes both outcomes. The docs-first clarification is committed at `15b32e7d00`; verify ordinary/Alt split, resume, cancel and finish. [`board-editor.ts:479-519`]
- [x] [Review][Patch] **Medium — split-point snapping (#3064).** B6/medium: the synthesized Ctrl value always disables grid snapping. Forward the actual modifier; diagonal insertion must differ between default and Ctrl. [`board-editor.ts:471-477`]
- [x] [Review][Patch] **Medium — invisible canvas targets (#3065).** B7/medium: Draw uses a retained selection without hit-test layer/type visibility. Apply the same canvas visibility predicate without disabling explicit inspector actions on hidden records. [`board-editor.ts:507-516`]
- [x] [Review][Patch] **Medium — newly changed layer ranges (#3066).** B8/medium: newly entered 0/out-of-board layer values hide the authored object. Refuse those changed fields while retaining unusual untouched loaded values; entering Stairs also validates its newly interpreted target. [`board-objects-view.tsx:107-133`]
- [x] [Review][Patch] **Medium — real destructive/canvas proof gap (#3068).** V1/medium is a pre-verified regression gap: no real-controller removal/reorder assertion and host proofs only cancel removal. I1/medium independently identifies missing canvas create/select/move routes. Extend real model history/save/reopen and both host journeys, not mock callbacks or record-count echoes. [`board-object-controller.test.ts`; `board-objects-proof.ts`]
- [x] [Review][Patch] **Low — unsupported raster Open affordance (#3069).** I2/low: the image picker accepts raster pictures but current source providers edit TBM, not raw BMP/PNG/JPEG/GIF. Keep the real TBM visit and explain/disable unsupported raster editing; do not invent another editor or claim raw raster authoring. [`board-objects-view.tsx:132-133`]
- [x] [Review][Patch] **Medium — owning-project asset picker (P1, #3033).** Native root layout and browser global-main layout miss canonical board-owned `Game/Example/Item` choices. Capture source identity, preserve FS case and Main-file declared layout, and exercise actual Choose item through Save/reopen. [`custom-editor.ts:598`; `workbench.ts:495`]
- [x] [Review][Patch] **Low — rotating release-note copy assertion (P2, #3070).** Actual full browser run opened current What's New successfully but required an old sentence outside its first-12 notes. Delete the wording pin; retain actual dialog/link/focus behavior. [`editor-program.spec.ts:249`]
- [x] [Review][Patch] **Medium — integration compilation/test contract (P3, #3074).** Local repair checks exposed dropped workbench/preview-test imports, host-wrapper identity misuse, wrong nearest-vertex expectations and incomplete two-stage chooser driving. Correct the real APIs/math/confirmation flow; full configured typecheck and affected actual-provider journeys passed before publication.
- [x] [Review][Defer] **Medium, rare imported input — ANM preview dimensions (B9, #3067).** The new caller reaches the existing unchecked `new Uint8Array(width * height * 4)` allocator with signed ANM dimensions. Backlog/no sprint per the owner's rare-edge instruction; do not allocate extreme buffers to demonstrate it. Future verification should isolate the bad placement as a placeholder/warning. [`board-sprite-preview.ts:55-62`; `sprite-document.ts:516-523`]
- [x] [Review][Defer] **Medium, next ready story — linked item graphics root (I3, #3040).** The provider opens its real definition but its preview still reads package-root Misc/Bitmap paths. This known connected-authoring defect is owned by #1723, immediately next; it is not claimed fixed by placement preview or source-name assertions.

#### Rejected

- **B10/false — missing command registration.** `editor-commands.ts:40-84` collects the focused surface's accessible buttons/selects, preserves disabled state and invokes their existing handlers; `command-palette.tsx:275` connects it. New modes/object actions participate automatically. Adding another registration convention would duplicate the existing one.
- **I4/false — runtime execution proof required here.** `docs/editor-features.md#p0-board-objects` explicitly defines authoring-only behavior; program/condition storage is not a claim that the preview executes those programs.
- **I5/false — unrestricted losslessness claimed.** The story retains the existing same-version codec/read-back/refusal boundary, not arbitrary unsupported formats. Authored raw-slot/residue and exact Undo assertions support that bounded claim; unsupported values remain refused/read-only.

## Merged delivery

- PR [#3085](https://github.com/tk-reawakened/rpgtoolkit-reawakened/pull/3085) merged on 2026-11-17 as `4ff4ed3dee07c66119867f5a859a797797a4b798`, retaining verified candidate `942a47026c52ba96bdeca0d713a80a9f8e1058e5`.
- All 20 repository checks completed successfully before merge. The issue and all 19 linked fixed-defect issues are closed; their existing Project items are Done. The local proof and independent review receipts above remain the acceptance evidence.
- #3040 continues immediately in 12.12/#1723; rare #3067 remains backlog. Neither is claimed fixed by this delivery.
