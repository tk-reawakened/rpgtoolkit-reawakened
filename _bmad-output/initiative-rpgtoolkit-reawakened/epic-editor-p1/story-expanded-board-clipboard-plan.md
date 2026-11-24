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
