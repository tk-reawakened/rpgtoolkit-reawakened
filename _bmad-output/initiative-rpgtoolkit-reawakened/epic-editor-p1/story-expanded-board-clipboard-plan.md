---
type: feature
title: "Expanded board clipboard"
ticket: 13
status: draft
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
