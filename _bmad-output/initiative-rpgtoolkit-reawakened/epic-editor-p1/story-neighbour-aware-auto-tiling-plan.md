---
type: feature
title: "Neighbour aware auto tiling"
ticket: 8
status: 'done' # draft | ready-for-dev | in-progress | in-review | built | done | blocked | dropped
created: '2026-11-26'
baseline_revision: '3337932d06b075bcccb24f7d394b24037c4c44f8'
route: 'full'
route_source: 'auto'
review: ''
review_source: ''
lenses_ran: []
review_loop_iteration: 0
context: ['docs/guardrails.md', 'docs/spec/editor/autotiling.md']
risk: high
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

Implement T-25 painting from the normative clean-room specification [autotiling.md](../../../docs/spec/editor/autotiling.md): its `AUTOTILES_` naming rule, 52-slot tile table, eight-neighbour corner gating and 3 × 3 reshape, re-evaluating affected neighbours.

## Scope and acceptance

Show missing role assignments and tested arrangements. The legacy order is the spec's table, settled in 13.7 (#1732); do not substitute a generic blob order for it.

**Owner direction (2026-11-26):** autotiling only affects the editor, so ours may be friendlier than the original (see T-25). What must be kept is using and importing original `AUTOTILES_` sets. Boards need no import step, because they store ordinary tile references.

- **Recognise** an original set when its **file name** (not the whole path) starts with `AUTOTILES_` in any letter case and it loads as a `.tst` or `.iso`. Sets in sub-folders count. Let an author also mark any tileset as using the 52-slot layout without renaming it.
- **Warn, never refuse,** where the original accepted silently: fewer than 52 tiles (name the missing shapes and show them as gaps, not blanks), a square set on an isometric board or the reverse, and autotiling switched on with an ordinary set chosen.
- **Show state** the original never showed: a visible autotile indicator, and a note when Shift limits the reshape to one set.
- **Preview** an imported set as its 47 shapes using its own tiles, so wrongly ordered art is obvious. Nothing can check art automatically.
- Fill and Rectangle may work in autotile mode; the original refused them.

Also consume the approved native rule contract through 27.13 and the scene editing route from 12.16. Label native role assignments explicitly; native role order is not the legacy 52-slot order, and generating a native set does not make it an original-format set. Entry 27 supplies the generator and sandbox later; this entry owns the painting command they call, not duplicate terrain logic.

## Verification

Painting and erasing match the spec's tile table and reshape rules, checked against hand-read cases and the spec example in `docs/spec/editor/examples/autotiling/` (which `docs/spec/tools/test_autotile_example.py` already checks). Original `AUTOTILES_` sets import with the warnings above, and painting or erasing recomputes adjacent cells across board edges and undo/redo.

## Dependencies and decisions

Prerequisites: 1, 12.1, 12.2, 7, 27.13, 12.16. Apply the epic Notes, [autotiling.md](../../../docs/spec/editor/autotiling.md) and the approved native and legacy format specifications; T-25 maps to CAP-16. Preserve undo/history ownership and re-evaluate the affected neighbourhood through the actual board/scene provider.

## Review fixes in scope

Preserve the existing uncommitted same-cell Shift fix and its regression while completing the four review findings. Keep explicit marks across source switches and shared views for the lifetime of the project/workspace session; do not change board or tileset file formats. Changes to a native tile document or its referenced artwork must invalidate previews, and startup must not overwrite a newer asset read. The earlier story acceptance remains in force.

</frozen-after-approval>

## Code Map

- `packages/editor-model/src/board-editor.ts` and `test/board-autotile.test.ts` contain the preserved uncommitted per-move Shift fix and consumer regression. `board-autotile.ts` currently recognizes only the selected marked source.
- `packages/editor-ui/src/brush.ts`, `tileset-browser.tsx` and `board-view.tsx` own project-scoped brush state, marking and board interaction. `host-vscode/src/document-bridge.ts` serializes and validates its patches across webviews; `host-web/src/index.ts` owns the browser session. Keep shared views consistent without writing source files.
- `packages/editor-model/src/terrain-scene-project.ts` parses tilesets and native tiles but exposes only tile paths for standalone assets. Scene builds also read native tile documents and each sample's referenced image/crop. `editor-ui/src/terrain-assets.ts` compares snapshots and `terrain-scene-view.tsx` uses snapshot identity to decide whether a preview is current. Cover both browser and VS Code consumers.
- `packages/host-vscode/src/native-terrain-text-editor.ts` captures initial inventory before registering refresh, then sends that captured inventory on ready. `terrain-scene-webview.tsx` accepts initialization and subsequent asset messages. A newer read can therefore be lost during startup; reuse the monotonic latest-read discipline in `packages/host-web/src/terrain-scene-mount.ts`, adapted so it protects asset delivery rather than editor mounting.

## Tasks & Acceptance

**Execution:**

- [x] `packages/editor-model/src/board-autotile.ts`, `board-editor.ts`, `packages/editor-ui/src/brush.ts`, `tileset-browser.tsx`, `board-view.tsx`, `packages/host-vscode/src/document-bridge.ts` and their targeted tests — keep an explicit-mark set in the existing project browser session, carry it through the VS Code browser-state bridge and use it when recognizing every affected neighbour after switching brushes or erasing. Preserve name recognition, isolation, unmarking, project separation, Shift and undo. Audit all session initializers, validators, literals and bridge consumers for the changed contract.
- [x] `packages/editor-model/src/terrain-scene-project.ts`, `packages/editor-ui/src/terrain-assets.ts`, related UI and host tests — fingerprint content actually used by a scene build: parsed native tile content plus each referenced sample image's bytes and crop, not merely paths. Same-path content edits make an old preview non-current; unchanged reads remain no-ops. Preserve failed-read clearing and update every snapshot producer and consumer.
- [x] `packages/host-vscode/src/native-terrain-text-editor.ts` and focused host/webview tests — order initialization and refresh so the latest successful or failed inventory is authoritative at ready, including reads started before readiness, out-of-order completions and disposal. Preserve scene state and do not allow old initialization or reads to replace newer assets.
- [x] `packages/editor-model/test/board-autotile.test.ts`, `packages/editor-model/test/terrain-roles.test.ts`, `packages/editor-model/test/scene-pack-placement-build.test.ts`, `packages/editor-ui/test/board-autotile-view.test.ts`, `packages/editor-ui/test/terrain-scene-roles-view.test.ts`, and focused host proof/tests — add consumer-level regressions: same-cell Shift transition; marked-set overwrite and persistence across brush switches; changed same-path tile/sample preview pixels; startup delivery of newest assets.
- [x] Update `CHANGELOG.md` for user-visible fixes. Add exact reproductions to existing #3530 and #3533 (the review found relevant open trackers) rather than duplicating them; verify any additional defect's tracker before creating one.

**Acceptance criteria:**

- Given a Shift-down on a tile, when an unshifted pointer move remains in that tile, then the resulting board reshapes the adjacent other set; stationary release alone does not manufacture a second move.
- Given a nonconventionally named marked tileset, when another brush overwrites or erases one of its adjacent cells without Shift, then remaining marked cells close their edges; switching back retains the mark in that project session, and unmarking stops recognition.
- Given a visible preview, when a referenced `.tkrtle` document or its sample image changes crop or bytes without changing paths or recipe, then the old preview is no longer current and a new preview reflects changed pixels. An unchanged read does not invalidate it.
- Given a scene panel starting while assets change, when a newer refresh completes before or after ready, then visible roles and preview basis use the latest read; a failed latest read clears old roles and reports why.

## Implementation Notes

## Plan Change Log

## Review Triage Log

## Design Notes

Marks are project-session state, not legacy board metadata: changes propagate across the existing host/webview session bridge and never leak between projects. Do not silently persist marks into board files or invent a new file format. The preview fingerprint follows actual native build inputs (tile documents, referenced image bytes and crops), while UI role summaries may remain unchanged. Preserve ordered read supersession and disposal semantics at startup.

## Verification

After implementation, compile the affected TypeScript projects and run the complete directly affected test files:

- `pnpm exec tsc -b packages/editor-model packages/editor-ui packages/host-vscode packages/host-web` — expected: successful affected-project compilation.
- `node --test packages/editor-model/test/board-autotile.test.ts packages/editor-model/test/terrain-roles.test.ts packages/editor-model/test/scene-pack-placement-build.test.ts packages/editor-ui/test/board-autotile-view.test.ts packages/editor-ui/test/terrain-scene-roles-view.test.ts packages/host-vscode/test/terrain-assets-trigger.test.ts packages/host-web/test/terrain-scene-mount.test.ts` — expected: all affected file tests pass; include any new focused bridge/startup test file.
- Exercise the VS Code native-scene proof for saved recipe refresh and add a focused consumer proof for startup/read ordering and changed tile/sample pixels; do not claim either passed unless actually run.
- Where practical, remove each new guard in an isolated copy and run its focused consumer test; record the failing assertion and restored result. Never weaken tests or mutate the preserved handoff to make a check pass.

## Acceptance closure evidence

This closure is recorded in a follow-up to merged implementation PR [#3521](https://github.com/tk-reawakened/rpgtoolkit-reawakened/pull/3521), merge commit `ba2c32efe916653b5ae1c8564dc1682d9ab60b2f` (implementation tree `b8914355dc7e0fbc9ed1200f6aefeb15f707f4d0`). The pinned audit base `9f2008fe95e95fdb70d2c3a3ab9ac838135f0519` contains that merge.

| Acceptance | Assertions |
|---|---|
| Legacy slot table, eight-neighbour corner gating, 3 × 3 / stacked-isometric reshape, board-edge isolation, Shift isolation, and one-edit undo | `packages/editor-model/test/board-autotile.test.ts`: hand-read table/mask/edge tests and whole-edit undo; `tools/browser/tests/editor-autotile.spec.ts`: real-board 47-shape/reshape/erase/undo proof. |
| Original set recognition, ordinary/short/mismatched-set warnings without refusing paint, plus the 47-shape preview and missing-shape gaps | `packages/editor-ui/test/board-autotile-view.test.ts` and the browser proof. This follow-up adds both square-set/isometric-board and isometric-set/square-board cases against the actual board view, loading the committed `.tst` and `.iso` examples from the tileset browser, asserting the warning, then painting. |
| Native terrain-role coverage and refusal explanations use native rules, not legacy ordering | `packages/editor-model/test/terrain-roles.test.ts` and `packages/editor-ui/test/terrain-scene-roles-view.test.ts`: complete/partial coverage, uncovered neighbourhoods, located refusal, authored rule display, refresh and stale-preview assertions. |
| Placed-scene source identity and normal undo/redo/save behavior | `packages/editor-model/test/scene-pack-placement-build.test.ts`, `packages/editor-model/test/terrain-scene-document.test.ts`, and `packages/editor-model/test/terrain-scene-save.test.ts`: identity-based placement resolution/build, single-edit undo/redo, and saved-scene behavior. |

On the pinned base, the focused acceptance audit passed **69/69 Node tests** across `board-autotile.test.ts`, `board-autotile-view.test.ts`, `terrain-roles.test.ts`, `terrain-scene-roles-view.test.ts`, `terrain-scene-document.test.ts`, and `terrain-scene-save.test.ts`; `tools/browser/tests/editor-autotile.spec.ts` passed **2/2** in Chromium. This follow-up’s final scoped run, `pnpm exec tsc -b packages/editor-ui && node --test packages/editor-ui/test/board-autotile-view.test.ts`, passed **11/11**. As a disposable sensitivity probe, restricting the warning predicate to square-on-isometric made the new reverse-direction test fail at its visible-warning assertion; the production predicate was restored before the passing run.

PR #3521's final integration verification record for `b8914355dc` reports `pnpm typecheck`, 11 focused Node test files, generated-help and bundle checks, the dependency graph, and ticket-store validation passing. Its Linux run `20261127-173016505-5bb9fa` reports four Chromium cases and the native VS Code scene proof passing; the subsequent macOS check covered the narrowed browser-host fix and existing fight-background editor proof. No implementation or Project state is changed by this closure follow-up.

