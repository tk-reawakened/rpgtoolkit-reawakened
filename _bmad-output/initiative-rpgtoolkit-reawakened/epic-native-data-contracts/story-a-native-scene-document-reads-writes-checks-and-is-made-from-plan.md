---
title: 'Read, write and import native scenes'
type: 'feature'
ticket: 14
created: '2026-11-18'
status: 'in-progress'
baseline_revision: '0df89080daae07b6733fd22ba6312f8d58881442'
route: 'full'
route_source: 'auto'
risk: 'high'
review: ''
review_source: ''
lenses_ran: []
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="owner approved the scene contract and delegated routine decisions for autonomous Epic 12 delivery">

## Intent

Creators need to read, edit and check native scene documents and explicitly convert existing boards without losing stored placements, indices or unmodelled data. Implement the approved pre-release contract and an opt-in board importer.

## Boundaries & Constraints

**Always:** Follow `docs/spec/formats/native-scene.md`, `board.md`, ADR 0019 and the common native preservation contract. Preserve plugin blocks and unrelated comments byte for byte, stable raw slots, overshoot, reserved values, and the distinction between absent and empty data. Conversion and recovery are explicit, reviewed operations that never overwrite a scene.

**Never:** Inspect legacy GPL source; silently convert on open, auto-repair, or broaden this ticket into scene-editor UI or runtime loading. Do not represent a refused import as successful.

## I/O & Edge-Case Matrix

| Scenario | Input | Expected | Failure handling |
|---|---|---|---|
| Read/write | Authored scene with comments and plugin data | Source-backed write reproduces bytes | Refuse unsafe regeneration |
| Edit | Move one placement | Only its changed scalar lines differ | Report invalid edits |
| Import | Board with slots, reserved values and overshoot | Scene keeps semantic data, order and indices | Report conversion refusals |
| Existing scene | Target already exists | No overwrite or implicit conversion | Return a located refusal |
| Recovery | Outside edit to generated board | Reviewable recovery scene and at-risk feature notes | Never overwrite the source scene |

</frozen-after-approval>

## Code Map

- `docs/spec/formats/native-scene.md` defines the scene model, reader, conversion, recovery and per-field dispositions; `board.md` defines raw board data.
- `packages/native-data/src/tileset.ts`, `asset-pack.ts`, `check.ts`, `rename.ts`, `art-references.ts` provide source-preserving document and checker/rename patterns.
- `packages/native-data-import/src/import.ts` and `packages/core/src/formats/board/` provide the importer seam and decoded board model; export the new importer through the package entry.
- `packages/native-data/src/index.ts` exposes scene APIs. Integrate scene validation into the project checker without duplicating stamp or plugin errors.

## Tasks & Acceptance

- [x] Implement scene reader, writer, validation and scalar edits with source preservation.
- [x] Implement explicit board import and recovery; preserve representable board fields and stable slots.
- [x] Integrate exports, checker and rename; add an end-to-end test converting an authored board and checking the resulting scene.
- [x] Finish independent review and address practical blockers.
- [ ] Push and merge the reviewed PR after required checks; close the linked issue and reconcile metadata.

## Implementation Notes

The importer uses the shared scene model rather than a duplicate public type. Scene checks report invalid scene fields and verify referenced pack projection; the latter fixes #3210.

## Plan Change Log

## Review Triage Log

- Independent document review found flow-list edits that could shift slots, multiline flow edits that were refused, and aliases that could abort checking; fixed under #3211, with the project-check regression strengthened under #3216.
- Import review found equivalent path spellings could defeat no-overwrite or return the wrong target (#3213), a serialization test did not prove empty slots existed (#3214), and required normalization notes were missing (#3215); fixed with focused regressions.
- Shared YAML anchors and comments in multiline empty flow mappings are uncommon authoring cases recorded as #3212 rather than release blockers.

## Verification

- 110 focused tests passed together, including board conversion, scene serialization and checking, slot preservation, recovery/no-overwrite and opaque plugin data. Each new test reported under one second.
- Affected package builds and test typechecks, targeted lint, dependency graph (1,137 modules; zero violations) and provenance (1,742 files; zero violations) passed.
- After the final target-path fix, all 46 importer tests, its build, test typecheck and lint passed.

Run the native-data and native-data-import scene tests individually and together, inspect their individual durations, then run affected package builds and test typechecks, targeted lint, dependency graph and provenance. Exercise a real authored board through conversion, scene serialization and checker; prove no overwrite and plugin-byte preservation.
