---
type: feature
title: "Board canvas navigation layers and tile tools"
ticket: 10
status: built
---

# Board canvas navigation layers and tile tools

## Scope

Complete board creation, coordinate-aware canvas navigation, layer visibility and P0 tile drawing, selection, flood, erase, rectangle and dropper with basic undo and redo.

New blank/template board with coordinate system, dimensions, layers, background and remembered dialog preference; pan, wheel, zoom, grid, layer visibility/current layer; draw/select/move/copy/flood/erase/rectangle/dropper, full-grid TBM stamps, 2D and isometric snapping, reversible edits, and appropriate T-33 preferences.

## Acceptance and verification

Editing representative 2D and both isometric boards exercises snapping, visible layers, brush tools and reversible document edits without treating selection or pan as mutations.

Use the shared document lifecycle and preserve same-version unknown data; exercise relevant failure/cancel, keyboard access and save/reopen paths rather than relying on preview alone. Follow `discovery/inception-proposal.md`, `docs/editor-features.md` and G2/G7; do not claim checks passed without executing them.

## Dependencies and decision gate

Prerequisites: 12.2, 11.5 and 4.18. The isometric compositor must exist before either isometric layout is accepted; the 2D tracer alone is not its provider.

## Delivered (built for review)

- **Model (`editor-model`).** `board-geometry` (cells, snapping, neighbours, viewport and zoom for the three layouts), `board-tools` (paint, flood, rectangle, move/copy, stamp from `.tbm`), `board-editor` (tool, layer, visibility, viewport, selection, gestures; one gesture is one `set-tiles` command), `board-creation` (blank and template boards, validation, no overwrite, remembered choices), `set-tiles` in the board document, and `previewBoard` over both isometric layouts with layer and background visibility.
- **View (`editor-ui`).** The canvas, tool bar, visible-layers list, selection controls, Undo/Redo, the new-board dialog, and keyboard paths (cell grid with Space, tool shortcuts, numeric move/copy).
- **Hosts.** Browser workbench: New board…, Undo and Redo, board preferences. VS Code: `tkr.newBoard`, picture requests and board preferences over the bridge; Undo and Redo stay the workbench's.
- **Rules settled** in `docs/editor-features.md`: cells and on-board rule for iso-rotated, flood connectivity and "across layers", the iso-stacked picture rectangle, stamp semantics (tiles and per-cell tints placed as board shading), template contents.
- **Proofs.** `tools/browser/tests/editor-board-canvas.spec.ts` drives the production workbench page in Chromium (real mouse, wheel and keyboard, all three layouts, canvas pixels, saved bytes read back from the folder); `tools/editor-vscode-test/web-proof.ts` (`runBoardCanvasScenario`) does the same in the packaged extension in VS Code for the Web, with VS Code's own Undo and Redo.
- **Not in this story.** Vectors, programs, sprites and images (12.11); shading and lighting and the expanded clipboard (P1); the tile editor.
