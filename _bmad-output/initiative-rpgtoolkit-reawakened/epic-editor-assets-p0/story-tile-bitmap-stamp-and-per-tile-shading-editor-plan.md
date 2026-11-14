---
type: feature
title: "Tile bitmap stamp and per tile shading editor"
ticket: 8
status: built
---

# Tile bitmap stamp and per tile shading editor

## Scope

Create and edit sized tile bitmap stamps with tile draw and erase, per-cell RGB shading, grid and preview using the shared browser.

Support width/height in tiles, drawing and erasing from the shared browser, per-cell RGB −255 to +255 with hue/lightness controls and visible grid/redraw; save a whole stamp and preserve unrelated data.

## Implementation decisions

- `.tbm` is a registered document kind (`tile-bitmap`, ADR 0026) with its own codec over the core tile-bitmap reader and writer. Commands: `set-bitmap-cell` (a tile reference, `""` erases and keeps the shade), `set-bitmap-shade` (three whole numbers, -255 to +255) and `set-bitmap-size` (1 to 40 tiles, the editor's limit; the file has none). A resize keeps cells that stay inside, and the stored extra row and column, the version stamp and trailing bytes are written back as read, so an edit changes only the bytes it means to.
- The view shows the cell grid (one tab stop, arrow keys; Select, Draw and Erase tools; Enter, Space or a click applies the tool, Delete erases), the shade controls for the selected cell (number fields, a hue picker and a lightness slider defined in T-62), a typed tile field, a grid switch and Redraw over the engine-composed picture, and the shared browser as the tile palette. Choosing a tile in the browser changes nothing until Draw is used.
- The picture is composed in `editor-model` (`previewTileBitmap`) from the document's current bytes and the project's tile files by the core compositor; hosts only carry it (the VS Code extension host posts it, as for a board). A tile the project lacks is drawn empty and named.
- A tile bitmap chosen in the browser is a whole stamp brush: the selection carries the file path and its size in tiles (`stamp`), and edits nothing. Placing a stamp on a board is the board tile tools' work (12.10, "whole `.tbm` stamp"); until then the board's one-cell paint ignores a stamp.
- The browser's actions menu offers "Edit tile bitmap" for a `.tbm` where the host can open a tab (browser workbench; VS Code through a linked visit); other hosts keep it unavailable and say so.

## Acceptance and verification

A shaded multi-cell bitmap saves and reopens with its dimensions and tile cells intact and can be selected as a whole stamp brush.

Use the shared document lifecycle and preserve same-version unknown data; exercise relevant failure/cancel, keyboard access and save/reopen paths rather than relying on preview alone. Follow `discovery/inception-proposal.md`, `docs/editor-features.md` and G2/G7; do not claim checks passed without executing them.

## Dependencies and decision gate

Prerequisites: 2. None newly identified; check the linked proposal and actual providers before implementation.
