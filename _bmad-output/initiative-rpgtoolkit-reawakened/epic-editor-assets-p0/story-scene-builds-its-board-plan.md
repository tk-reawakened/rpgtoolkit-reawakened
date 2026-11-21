---
type: feature
title: "A scene builds its board, with vectors made from tile and asset collision"
ticket: 15
status: in-progress
baseline_revision: '2e2f2680f22f72c0658d661754f085751bc3a53e'
route: full
route_source: auto
risk: high
---

# A scene builds its board, with vectors made from tile and asset collision

## Scope

Implements the lowering of a scene to a legacy `.brd` in `editor-model`, through the board writer `core` already has: tiles and their lookup table, placed pack assets expanded into images or tiles, and the board's solid and under vectors built from the collision stored with each tile and each asset. The build is repeatable, never reorders existing slots, and records the hash of what it wrote so an outside edit to the `.brd` is found and offered as an import, not overwritten.

Follow [ADR 0019](../../../docs/adr/0019-tkr-authoring-formats.md) decision 4 and consequences 2 and 3, and section 5 of the draft [`docs/spec/formats/tkr-authoring.md`](../../../docs/spec/formats/tkr-authoring.md) as replaced by the contract pages of 27.8, 27.11 and 27.12. The documents obey the rules in [`docs/spec/formats/native-contracts.md`](../../../docs/spec/formats/native-contracts.md) (common stamp, identity by path, closed top level, `pluginData`), and the shared editor contracts in [ADR 0022](../../../docs/adr/0022-shared-editor-authoring-contracts.md). Nothing converts on open or on save ([ADR 0019](../../../docs/adr/0019-tkr-authoring-formats.md) decision 5): the build is a function the caller invokes.

## Acceptance and verification

On an authored scene: two builds give identical bytes; the built board loads in the headless runner and its draw list matches the scene's own preview; a tile marked solid yields a solid vector over its cells and a pack asset's under vector appears moved to its placement; adding one object leaves every earlier slot index unchanged; a byte changed in the built `.brd` is reported before the next build writes.

Preserve same-version unknown data through the build, and assert the repeatability and slot-order boundaries directly rather than replaying an authoring session. Follow `discovery/inception-proposal.md`, G2 (the YAML reader stays out of `core`), G5 (the runner's inputs are ordinary boards) and G7; do not claim checks passed without executing them.

## Dependencies and decision gate

Prerequisites: 12.1, 27.13, 27.14. Follow the reader and writer behaviour of 27.13 and 27.14 and the contract pages written by 27.8, 27.11 and 27.12; the tileset and asset-pack readers are the only source of the collision the build lowers into vectors.

## Code Map

- `docs/spec/formats/native-scene.md`, `native-tileset.md`, `native-asset-pack.md` and `tkr-authoring.md` specify data and slot order; generated geometry, art and persisted build hashes need docs-first decisions.
- `packages/native-data/src/scene.ts`, `tileset.ts`, `asset-pack.ts` define native models; `packages/native-data-import/src/scene.ts` maps a decoded board to a scene.
- `packages/core/src/formats/board/model.ts` and `writer.ts` provide the board model and serializer; `editor-model/src/board-geometry.ts` provides cell geometry.
- `packages/editor-model/src/board-preview.ts`, `binary-document.ts`, `document-history.ts` and `workspace.ts` provide preview, save-conflict, history and host seams.

## Tasks & Acceptance

- [ ] Specify generated tile/pack outputs, collision tracing and build-baseline storage before implementing those choices.
- [x] Lower scene-owned board fields, preserving slots and legacy residue, and serialize with the core writer.
- [ ] Resolve native art and build deterministic visuals and collision; append generated records after scene-owned records.
- [ ] Implement output conflict detection, durable baseline and reviewed recovery through platform services.
- [ ] Verify repeatable bytes, preview/engine draw-list agreement, collision geometry, slot stability and external-edit refusal; independently review and run local checks before publishing.

## Implementation Notes

Build-output ownership was specified in docs-first commit `a350ff795e`: project-local SHA-256 records, no untrusted overwrite, and explicit partial-write reporting. Native art generation still needs the documented image-format and tile-recipe decisions.

The in-progress coordinator builds ordinary source-cell tilesets, pack images and translated vectors; a scene preview renders its generated board and the save coordinator detects changed output. The test proves preview pixels match the engine and an outside edit is not overwritten. Recovery offer and host integration remain. The builder deliberately reports unavailable for boundary tracing and unspecified advanced tileset recipes; these must be resolved before this story can be marked done (#3221).

The [terrain cutover rules](../../../docs/design/terrain-scene-formats.md#approved-cutover-decisions) supersede old allocation and tile geometry assumptions. Preserve the accepted compiler sequence from #3261: lower through the public board model, resolve artifacts and geometry before writing, verify against the real runner, then connect the same build to the terrain tools in #1733 and #1851. Raised isometric art stays editable but cannot be emitted until the overlay is proven. Flat terrain does not wait for that proof.

## Plan Change Log

- #3232 connects the terrain scene to the normal Save, keyboard Save and Save All paths, and uses a board-test launch for Play so the `.gam` file's startup board does not select the scene. Generating these derived assets is not a format conversion of the source document. A source write and a generated-output write can have different outcomes.
- #3267: compile the resolved terrain grid, tile collision, pack raster art and vectors, and traced boundaries in `scene-build.ts`, then write the board once. Save and Play use that project build; the preview renders the same generated files in memory. Boundary tracing sees the final grid after overrides, not the original runs. The reader/checker/rename wire cutover is still #3273.

## Review Triage Log

- Required unit shards found inline styles incompatible with strict host CSP (#3265) and a missing terrain-scene conformance case (#3266).
- Keep #3232 in draft while the terrain build and preview do not use the same compiler, pack geometry and recovery are not wired through the host path, and checker/rename still need to cover the new reference model.
- Review identified a second compiler that omitted packs and boundary tracing (#3267); until unified lowering is ready, the terrain build refuses these inputs without writing an incomplete board. Other blockers are exact verified playback (#3268), input freshness and competing writes (#3270), the nested game asset root (#3271), and conflict recovery (#3272).
- The checker and rename cutover (#3273), refusing stale outputs during packaging (#3274), and project-wide tileset ownership (#3275) also block merge. Nested `Tiles` runtime path handling is tracked in #3276.
- #3267 is addressed: the production path no longer refuses supported packs or boundaries or omits them. Automatic wall caps still refuse as specified. The remaining draft blockers above are unchanged.

## Verification

- Scene board lowering: 4 focused tests passed.
- Ownership, pack vectors, tile collision and PNG: 20 focused tests passed.
- Tile encoding: 12 focused tests passed after correcting fixture assumptions (#3222). PNG fixture comparison is tracked in #3223.
- 49 focused tests passed together; editor-model build and test typecheck, targeted lint, dependency graph and provenance passed. A subsequent engine-view and saved-output conflict integration test also passed; current changes require final verification after review.
- Chromium's connected-authoring journey passed: paint, touch up, reshape, rebuild via the workbench Save button, keyboard Save and Save All, reopen, and play the compiled pond with the `.gam` startup board set elsewhere. The live draw list contained the manual bank and both water cels.
- 42 focused document conformance and save tests and the strict-CSP source check passed after removing the inline styles and adding the terrain-scene lifecycle case.
- VS Code Web workbench proof passed with the packaged extension (`TKR_VSCODE_NATIVE_SCENE_PROOF=1`): the terrain editor writes through the native text document; Ctrl/Cmd+S builds an empty override; workbench Save All rebuilds the base tile after clearing it; Play saves a fresh edit and launches `Boards/terrain-proof.brd`, not the startup board. Finding the main file through the virtual workspace filesystem fixed #3277.
- The mixed-scene proof passed through the production workspace Save All: exact tile slots and ordered rail, pack, and traced boundary vectors; identical repeated outputs; unchanged source during preview; equal in-memory and saved previews; and matching headless-engine pixels and loaded vectors. All 17 focused tests, host typechecks, scoped lint, and the Chromium terrain journey passed.

Run focused editor-model and native-data tests, package typechecks, targeted lint, dependency graph and provenance; run the smallest headless-engine proof that compares scene preview with the built board.
