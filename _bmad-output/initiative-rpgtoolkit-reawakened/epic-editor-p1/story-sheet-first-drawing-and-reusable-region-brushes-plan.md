---
type: feature
title: "Sheet-first drawing and reusable region brushes"
ticket: 23
status: draft
risk: high
---

## Intent

Add a shared sheet canvas with continuous cross-cell strokes, growing workspace, multi-cell selection and reusable region brushes without changing stable tile identities or copying artwork into each board placement.

## Scope and acceptance

1. Open/create a reusable kit independently of a board and draw on a shared sheet with visible cell boundaries. Pencil strokes remain continuous across cells and form one undo command; keyboard/numeric routes cover selection and operations.
2. Grow the workspace without renumbering existing tile identities. Moving or remapping artwork must not silently reinterpret an existing named region.
3. Select, move, copy and transform rectangular or explicit multi-cell selections with a clear scope. Retain the full operation service from 3, not a reduced pencil-only replacement.
4. Make a reusable region brush from selected artwork and paint it through the existing board palette/commands, consuming the tile-bitmap/stamp composition provider from 12.8. Separate source references from placements; changing palette order cannot duplicate or replace every placement's pixels.
5. Show hard-edged zoom, grid, palette and board-scale/neighbour previews without dirtying source when only the view changes. Use browser capabilities under ADR 0031 rather than forcing a universal custom input stack.
6. Verify a cross-cell roof and brush on two boards, source save/reopen, one-stroke undo, growth and stable references. Entry 24 adds the contextual shared-versus-local decision; this story owns the reusable sheet canvas, not scene relinking.

## Verification

Draw a roof across cell boundaries, move and transform a selected region, reuse its brush on two boards, grow the sheet and save/reopen while checking exact pixels, stroke-level undo and unchanged existing references.

## Dependencies and decisions

Prerequisites: 13.3, 12.8. Owner-approved breakdown; the corresponding tracker issue is recorded in tickets.toml. Contract choices still require the approval specified in 13.21. Read the [epic](epic-editor-p1.md), [owner refinement decisions](discovery/art-workspace-refinement.md), [research](../../../docs/findings/pixel-art-platform/research.md), [ADR 0022](../../../docs/adr/0022-shared-editor-authoring-contracts.md) and [ADR 0031](../../../docs/adr/0031-owned-art-editor-with-permissive-reuse.md). A-2 maps to CAP-16. No code implements an unsettled format/timing choice before 21's normative approval. Keep model/host boundaries, permissive licensing and fast focused verification; browser-led presentation is not a deterministic-runtime restriction.
