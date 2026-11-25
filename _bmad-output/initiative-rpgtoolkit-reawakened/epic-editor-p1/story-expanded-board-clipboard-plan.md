---
type: feature
title: "Expanded board clipboard"
ticket: 13
status: done
risk: medium
---

## Intent

Add copy, cut, paste and select-all for tile and shade regions and whole vectors, programs, sprites and images to the existing board commands.

## Scope and acceptance

Use platform-services clipboard and AD-19 command ownership; P0 already owns basic board undo, so do not replace it or claim cross-document atomicity.

## Verification

Every supported selection survives copy and cut/paste with undo/redo and reload, while partial point sets and lights are explicitly rejected without mutation.

## Dependencies and decisions

Prerequisites: 12, 12.11. Apply the epic Notes, format specs, AD-18/19/20/22/29 and connected-authoring direction; T-28 maps to CAP-16. Preserve version and residue, use the existing shared model and browser, and route host access through platform-services. Where provider or host capability is unavailable, preserve data and report the limitation; do not simulate it.

## Status

**Built 2026-11-24 (13.13, #1738).** Rules are in `docs/editor-features.md#p1-board-clipboard` (spec commit first, G7). `platform-services` declares an optional text `clipboard` (`readText`, `writeText`, capability `clipboard`); `host-web` and the VS Code webview back it with the page clipboard and declare the capability only when the page has one. `editor-model/src/board-clipboard.ts` holds the pure copy, paste and clear functions and the versioned clipboard text; `board-editor.ts` adds `copy`, `cut`, `paste`, `selectAll` (whole objects in an object mode) and `selectAllPoints`; one region paste or cut is one `set-tiles` command (gestures `paste`, `cut`, new `shadeCells`), one object paste or cut is one `set-board-fields` command. Partial point sets, lights, an empty selection, foreign or newer clipboard text, a wrong mode, an off-board region, a missing layer and a host without a clipboard are refused with a message and no change to board, history or clipboard.

Tests: `editor-model/test/board-clipboard.test.ts` (all three layouts, all four object families, undo, redo, reload bytes, every refusal), `editor-ui/test/board-clipboard-view.test.ts`, `platform-services/test/clipboard.test.ts`, `host-web/test/clipboard.test.ts`, and the real-Chromium `tools/browser/tests/editor-board-clipboard.spec.ts` (real keyboard and clipboard, saved bytes read back).

**Known limits, not fixed here:**
- Pasted objects keep their stored position and layer; there is no paste-at-pointer for objects.
- A VS Code webview may refuse clipboard reads without focus or permission; the refusal is reported and nothing changes. Not exercised in a real VS Code host.
- The clipboard holds one board's data as text; it does not carry tile files, so a region pasted into a board that lacks the tileset shows the tile names only.
- Cutting objects renumbers later stored slots; the question before a cut says so.

**Review round (2026-11-24, #3360).** Independent model and surface reviews raised eight findings; all eight were valid and are fixed with regression tests: a cut now verifies, after the clipboard write awaits, that the copied slots still hold what was copied (stale-index cut refused); a pasted shade channel is checked against the record's `i16` range, so a baked shade past ±255 round-trips while the painted brush stays ±255; a clip covering the whole stored grid pastes at the stored origin, so the whole grid can be pasted onto another layer on an isometric board whose corner cell the pointer cannot reach; Select all with nothing visible clears the earlier selection; clipboard text whose version is not a number is refused instead of throwing; an unchanged paste still selects its destination; a pasted object starts with no points selected; and the clipboard keys act from non-text controls (checkbox, radio, colour, `<select>`) while text fields keep their own. The browser objects proof also caught a layout regression: a new button in the object-mode actions row wrapped that row and moved the canvas mid-drag, so the new selection actions live in the always-present clipboard row instead.

**Second review round (2026-11-24, #3360).** Seven more valid defects found by the model re-review and the surface re-review, all fixed with behavioural tests: a region cut now freezes its cells and verifies the tiles *and* shade still match after the clipboard write (a change under the selection refuses the whole cut); an object cut freezes the source before asking, so a slot replaced while the question is open refuses instead of silently cutting the replacement; the clipboard-key exemption was narrowed so Delete/Backspace on a focused `<select>` no longer erases the selection; a paste the file refuses no longer moves the selection (only an accepted edit, or a genuine no-op, selects its destination); "Select all points" is offered only in the vectors and programs modes; a clipped rotated-isometric selection whose stored bounding box starts on a cell with no place on the picture pastes back at the stored origin the clipboard now records, which also subsumes the whole-grid case; and a paste re-checks the lights mode and busy state after its clipboard read.

**Third review round (2026-11-24, #3360).** Five more valid defects, fixed with regressions: a cut's requirement now travels with the command as a compare-and-set the document checks against its own stored board, so a split VS Code view with a stale snapshot cannot remove what it did not copy (a test drives an editor whose `board()` is a stale snapshot while `apply` reaches the authoritative document); Ctrl+Z and Ctrl+Y no longer reach the board from a focused list, checkbox or colour control (only the four clipboard keys bypass the focus guard); a no-op paste that fell back to the copied origin reports the destination's column and row; a clip with gaps writes only its cells and selects nothing, so a later cut cannot take an unpasted cell; and a region whose text carries no origin is pasted only at the cursor (never at an invented origin), while a malformed origin is refused.

**Fourth review round (2026-11-24, #3360).** Three more valid defects, all about a stale editor copy of the board: a region paste now names every covered cell and shade so the stored board decides what changed (a stale view no longer skips a cell another view changed), an object paste requires the family exactly as it was read (a concurrent add is not overwritten; the paste is refused), and a sparse paste clears the previous selection even when it changed nothing (a later cut cannot take unrelated cells). The document also reports a no-op refusal as `unchanged`, so treating "already shows that" as a paste for selection purposes is decided by the authoritative model, and the two stale-view tests drive an editor whose `board()` is a captured old snapshot while `apply` reaches the real document.

**Fifth review round (2026-11-24, #3360).** Two valid defects from the surface review and one weakened test: an all-zero shade paste on a board without a shading layer created an empty layer (dirty, an undo step, and a layer in the saved file) — the model now reads a missing layer as zeros, so asking for zeros changes nothing; a cell that already stores the pasted reference kept being rewritten to the first lookup-table slot when the table names that reference twice (dirty for no visible change) — the tile writer now skips a cell whose stored reference already is the tile, keeping its own slot, for any duplicated reference and not only the empty one; and the Ctrl+Y focus test had nothing to redo, so it could not fail — it now seeds a redoable edit and proves the key neither undoes nor redoes from a focused list.

### Closure verification

[#3360](https://github.com/tk-reawakened/rpgtoolkit-reawakened/pull/3360) merged at `d187a87f9df07bc8c44fd4bb04f5fd9d2c5d862c`. [#1738](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1738) is closed and the Roadmap card is `done`. Both independent implementation reviews accepted the final head, and [all 26 checks passed](https://github.com/tk-reawakened/rpgtoolkit-reawakened/actions/runs/45468233055/attempts/2).

Acceptance checked locally at that merge:

| Clause | Committed tests and observable result |
| --- | --- |
| Tile and shade regions: Select all, copy, cut and paste | `packages/editor-model/test/board-clipboard.test.ts:80–169` checks all three layouts: actual tile references and shading after paste, one undo step, exact redo bytes, and reload. The cut clears both together and undo restores the original bytes. The whole-layer case checks Select all across layers. |
| Whole vectors, programs, sprites and images | `packages/editor-model/test/board-clipboard.test.ts:210–262` runs both paths for each family: Select all, field-for-field copy/paste, exact undo/redo and reload, plus cut confirmation, cancellation and removal as one edit. |
| Reject partial point sets and lights without mutation | `packages/editor-model/test/board-clipboard.test.ts:265–314` checks an explicit refusal, unchanged serialized bytes, clipboard and edit history, and rejects light data on paste. |
| Real browser commands and persistence | `tools/browser/tests/editor-board-clipboard.spec.ts:84–168` exercises the real browser clipboard and shortcuts, reads saved board bytes after paste/undo/redo, and checks the vector cut confirmation and partial-point refusal. |

`pnpm build` passed; `node --test packages/editor-model/test/board-clipboard.test.ts packages/editor-ui/test/board-clipboard-view.test.ts packages/platform-services/test/clipboard.test.ts packages/host-web/test/clipboard.test.ts` passed 67/67 with no skips. `TKR_BROWSER_SUITE=editor-web PLAYWRIGHT_PORT=<free-port> pnpm exec playwright test tools/browser/tests/editor-board-clipboard.spec.ts` passed 2/2. Eight additional local probes using the board-model test setup passed: cut → paste → reload plus undo and redo of both commands for each of the three layouts and four object families, and a partial-program point selection refused without changing bytes, history or clipboard.
