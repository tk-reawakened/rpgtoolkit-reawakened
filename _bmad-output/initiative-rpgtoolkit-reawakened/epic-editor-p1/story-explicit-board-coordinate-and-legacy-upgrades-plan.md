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

The deterministic format tests include the committed minor-2/3 specification examples; they are not original Toolkit files. The real-host minor-2.2 proof additionally uses only the fetched `Caoquest/Boards/red.brd` fixture at ludotheque revision `0489f5da225438f8fcd62d958711dc7bad7e8207` (SHA-256 `ef946b9671bcc83091e9264d8e318e1be05ce27c8fd4adc61fefaec31f813d62`) at test time; it is not committed. Test workspaces create distinct synthetic tileset, image, item, MIDI and empty program placeholders and do not copy original artwork or RPGCode. This use makes no claim that the source game or fixture is licensed for redistribution. The minor-3 spec example remains test-only; no independently sourced original minor-3 or stacked pre-vector corpus was located, and the current stacked coverage is documented-geometry/unit-fixture coverage, not historical corpus parity. Track that evidence gap in #3475. Owner confirmed on 2026-11-24 that the missing original corpora are not an automatic PR blocker, but the evidence gap is not waived.

Coordinate actions write an exact-byte copy, reopen it in the editor, then apply and save one registered model command; one Undo returns that copy to its copied bytes while the source remains unchanged.

## Plan Change Log
2026-11-24: Added real-host test-time use of the pinned minor-2.2 board and author-created dependencies following documented file layouts; no original artwork, scripts, fixture bytes or game tree are committed. The fetched board's redistribution permission remains unverified. Retained #3475 for unavailable original minor-3/stacked evidence.
2026-11-24: The earlier VS Code proof failure was a test-frame selection error: the helper could act on a different board than the selected tab. A later browser-host refusal test reproduced a failed new-file write leaving an empty destination; the writer now aborts/removes the new entry, with focused unit/browser assertions. Tracked in #3486 and open until the fix merges.


## Review Triage Log

## Design Notes

The existing spec has exact forward stacked-to-rotated and tile-to-pixel rules. It explicitly refuses pre-vector rotated boards because their matrix mapping is not specified; this implementation must keep that refusal. The existing decoder converts pre-vector bytes while reading, so the upgrade workflow should consume those decoded values but only write a new copy after review.

## Verification

**Commands:**
- `node --test packages/editor-model/test/board-upgrade.test.ts packages/editor-model/test/board-preview.test.ts` -- passed, 21 tests including engine-pixel parity.
- `pnpm exec eslint packages/editor-model/src/board-upgrade.ts packages/editor-model/src/index.ts packages/editor-model/test/board-upgrade.test.ts packages/editor-model/test/board-preview.test.ts packages/host-web/src/workbench.ts packages/host-vscode/src/board-upgrade-commands.ts packages/host-vscode/src/extension.ts` -- passed.
- `pnpm test` -- passed: 5,973 passed, 36 skipped (missing optional legacy fixture corpus).

**Resume validation (2026-11-24):**
- `pnpm --dir tools/editor-vscode-test typecheck:tests` -- passed on the resume tree.
- `TKR_VSCODE_BOARD_UPGRADE_PROOF=1 pnpm --dir tools/editor-vscode-test proof -- --extension extensions/editor --workspace docs/spec/examples/game --game Main/example.gam` -- passed, including 13/13 proof setup tests. In the actual VS Code web host, the fetched minor-2.2 source was upgraded to a copy and run; source bytes stayed unchanged. The tile-to-pixel copy was saved, native Undo+Save restored its exact copied bytes, and Redo+Save restored the pixel-coordinate bytes. That still-converted copy was closed, reopened and run at absolute pixel `(2,2)` with the expected host hash. The proof also exercised Save-picker cancellation and refused destination writes while a pending script edit was present; no output was left, the source and script bytes were unchanged, and the edit remained in its editor. The proof explicitly saved that pending edit only after these preservation checks so the runner could start.
- `pnpm exec playwright test tools/browser/tests/editor-web-host.spec.ts -g "browser host upgrades the pinned original minor-2 board"` -- passed (1 test). It verifies the fetched minor-2.2 upgrade/reopen/run and both reopened tile-/pixel-coordinate runs; a distinctive authored checker pattern is asserted in rendered pixels. It also verifies save-picker cancellation, denied destination write/no partial file, pending script edit retention, and source/script byte preservation.
- `pnpm exec tsc -p packages/host-web/tsconfig.test.json && node --test packages/host-web/test/filesystem.test.ts` -- passed (5/5), including deletion of a newly created file when its durable write is refused.
- `pnpm exec eslint packages/host-web/src/filesystem.ts packages/host-web/test/filesystem.test.ts tools/browser/tests/editor-web-host.spec.ts tools/editor-vscode-test/web-proof.ts tools/editor-vscode-test/probe-extension/extension.js` -- passed.
- First full browser-suite run (159 tests) reported 151 passed and these 8 failures:
  - `editor-artwork.spec.ts:274` (`actual browser art gestures`, declared at :229): `expectPixel` expected RGBA `[23,55,60,255]`, received `[209,43,115,255]`.
  - `editor-artwork.spec.ts:554` (chosen `.tst` tile test, declared at :495): `expectPixel` expected transparent `[0,0,0,0]`, received `[32,176,224,255]`.
  - `editor-board-canvas.spec.ts:237` (test matrix at :122): after Undo expected 0 `village.tst2` cells; top-down received 7, iso-stacked 8, iso-rotated 5.
  - `tools/editor-vscode-test/connected-authoring-proof.ts:467` (browser connected-authoring test declared at `editor-connected-authoring.spec.ts:44`): old-run tick failed to exceed `gameTickAfterSave + 1` after `host.revealRun()`.
  - `editor-font.spec.ts:209` (test declared at :138): after Undo expected glyph ink `"0,0"`, received `"0,0 7,0 0,1 1,1 2,1"`.
  - `editor-program.spec.ts:342` (test declared at :172): after Undo, program text still contained `castint(val)`.
- The same 8 cases passed together when filtered on PR base `1222d6c` (24.9s) and PR head `d3b798a` (22.8s). This does not establish whether the full-suite failures are pre-existing, a branch interaction, or nondeterministic; keep them unresolved and do not label them unrelated.
- A second full suite run (159 tests) reported 158 passed; only connected-authoring failed. This time the run was active at tick 438, but `editor-connected-authoring.spec.ts:227` timed out waiting for `.tkr-run-current .tkr-run-snapshot` (proof helper line 468). Exact case-filtered reruns passed on both base and head; cause remains unconfirmed.
- Minor-3 and stacked original-board evidence remains unavailable; #3475 stays open.
