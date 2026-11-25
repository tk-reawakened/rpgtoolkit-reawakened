---
type: feature
title: "Explicit board coordinate and legacy upgrades"
ticket: 15
status: in-progress
risk: high
baseline_revision: 6222cb1f6
route: full
route_source: auto
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

Implement confirmed and previewed stacked-to-rotated and tile-to-pixel conversions plus pre-vector board upgrade, moving tiles and every applicable object while retaining originals.

## Boundaries & Constraints

**Always:** Use the coordinate formulas and the pre-vector field conversions already specified in `docs/spec/`; keep scripts unchanged; preserve source bytes by creating a new board, never overwriting the original. The shared board document model and editor command registry own mutations; UI and hosts use platform-services. Coordinate conversion is one undoable model change. Cancel, refusal, changed source, and failed writes preserve the source and pending edits.

**Never:** Guess the unspecified pre-vector rotated layout or alter script literals; do not silently convert on open, overwrite existing files, or claim parity not supported by fixtures. Do not change `../rpgtoolkit`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Coordinate preview/accept | Supported saved board, no pending edits | Preview conversions, then write transformed copy and open it | Source remains unchanged |
| Cancel or stale source | User cancels; source changes during review | No output and no source mutation | Explain cancellation or require a fresh review |
| Pre-vector upgrade | Minor 2/3 board accepted by documented converter | Write minor-4 copy with converted vectors, programs, shading and positions | Unsupported coordinate layouts are refused with located error |
| Conflict/write failure | Destination exists or host write fails | Preserve source and current document | Report the host error; never report success |

</frozen-after-approval>

## Code Map

- `docs/spec/formats/board.md#coordinates` -- coordinate formulas, effective grids, tile/pixel flag and stacked-to-rotated mapping.
- `docs/spec/formats/legacy/older-binary-versions.md#board-minor-2-and-3-pre-vector` -- accepted conversion fields, vectors, programs, tint and explicit rotated refusal.
- `docs/editor-features.md#t-30-coordinate-upgrades` -- one-way upgrades and unchanged script literals.
- `packages/core/src/world/coords.ts` -- reusable coordinate transforms.
- `packages/core/src/formats/registry/core-decoders.ts` and `packages/core/src/formats/board/pre-vector-convert.ts` -- pre-vector dispatch and conversion.
- `packages/editor-model/src/board-document.ts`, `commands.ts` -- board snapshot/commands and shared command registry.
- `packages/editor-ui/src/board-view.tsx` and `packages/host-web/src/workbench.ts` -- actual board surface and browser command integration.
- `packages/host-vscode/src/extension.ts` -- VS Code command surface and project-bound platform services.

## Tasks & Acceptance

**Execution:**
- [x] Add pure, validated board-copy conversion planning for coordinate upgrades; map every tile and shade cell, transform only applicable position units, preserve all other board data.
- [x] Add a non-destructive pre-vector upgrade flow using the existing reader/converter and a new `.brd` destination; refuse unsupported inputs and stale source.
- [x] Add preview/confirmation and accessible commands in the shared editor, then expose them through browser and VS Code hosts using real services.
- [x] Add tests using real supported board fixtures for conversion geometry, vectors, programs, shading, tile references, script-literal stability, cancellation, conflict, write failure, reopening and runner rendering.

**Acceptance Criteria:**
- Given an iso-stacked board, when the author previews and accepts conversion, then tile and shade cells map to the rotated effective grid and every represented tile/object retains its specified board-pixel position.
- Given a board using tile coordinates, when the author accepts pixel-coordinate conversion, then the flag and applicable positions convert once while script text and unrelated model data remain byte-for-byte or field-for-field unchanged.
- Given a supported pre-vector board, when the author upgrades it, then all documented tile types, programs, shading and object positions are converted into a reopened/renderable vector-board copy while the original bytes remain unchanged.
- Given cancel, unsupported data, source conflict or failed destination write, then neither the original nor pending edits are lost and no partial copy is reported as successful.
- Given either real editor host, when the author invokes an upgrade, then command palette and surface actions use the same registered command and actual platform services.

## Implementation Notes
Coordinate upgrades create reviewed copies rather than editing an open document. The coordinate planner maps every tile and shading cell through the normative geometry; existing vectors, trigger regions, sprites, images, lights and start positions are already stored in board pixels and remain field-identical. Tile-to-pixel changes only `coordType` bit 4. The shared copy service rejects pending edits, stale source bytes, invalid destinations, existing destinations, unsupported layouts and write failures before reporting success. Browser workbench commands and VS Code contributed commands call that service; the browser's active-board commands refuse while a document is dirty, saving, conflicted or still handing over edits, and VS Code settles live webviews first.

The proof uses committed binary fixtures under `docs/spec/examples/versions/board/` (minor 2/3 pre-vector and minor 4 vector), not captured Toolkit project files. The vector fixture is converted to stacked for geometry testing. The runner proof compares engine `viewbrd` RGBA pixels before and after the stacked-to-rotated conversion. The fixture set has no committed pre-vector rotated board, so that refusal is proved by changing the documented coordType byte in the minor-3 fixture.

## Plan Change Log

## Review Triage Log

## Design Notes

The existing spec has exact forward stacked-to-rotated and tile-to-pixel rules. It explicitly refuses pre-vector rotated boards because their matrix mapping is not specified; this implementation must keep that refusal. The existing decoder converts pre-vector bytes while reading, so the upgrade workflow should consume those decoded values but only write a new copy after review.

## Verification

**Commands:**
- `node --test packages/editor-model/test/board-upgrade.test.ts packages/editor-model/test/board-preview.test.ts` -- passed, 21 tests including engine-pixel parity.
- `pnpm exec eslint packages/editor-model/src/board-upgrade.ts packages/editor-model/src/index.ts packages/editor-model/test/board-upgrade.test.ts packages/editor-model/test/board-preview.test.ts packages/host-web/src/workbench.ts packages/host-vscode/src/board-upgrade-commands.ts packages/host-vscode/src/extension.ts` -- passed.
- `pnpm test` -- passed: 5,973 passed, 36 skipped (missing optional legacy fixture corpus).
