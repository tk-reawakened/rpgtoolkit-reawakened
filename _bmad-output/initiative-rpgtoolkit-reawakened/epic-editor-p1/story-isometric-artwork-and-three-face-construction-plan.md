---
type: feature
title: "Isometric artwork and three-face construction"
ticket: 28
status: draft
risk: high
---

## Intent

Build reusable flat-to-isometric and top/left/right-face artwork with explicit dimensions, anchors, projection and tall-block decomposition, preserving editable sources and consuming existing collision/under placement services.

## Scope and acceptance

1. Offer non-destructive flat-to-iso projection and construction from top, left and right artwork, with explicit dimensions, projection, anchor and face alignment. A view toggle cannot convert away the only source copy.
2. Use the approved 21 recipe and existing projection conventions; expose tall-block decomposition and component outputs with stable identity and correct logical versus projected coordinates.
3. Keep independently editable face sources and overrides; regenerate after an input change without destroying original flat art or replacing unrelated outputs.
4. Place built blocks/props through 12.17 and its source-authored collision/under rules. Do not reinvent collision or infer it from transparency. Image-mask boundary tracing must be an explicit reviewed construction operation, never an automatic gameplay change.
5. Use the shared sheet, adjustment and recipe services rather than an unrelated iso application. Report and recover per-file write failures.
6. Construct an archway and tall block, inspect independent expected projected pixels, seams and anchors, revise a face, save/reopen and verify actual scene rendering, collision and walk-behind, including cancel and source preservation.

## Verification

Construct and revise an isometric archway and tall block, compare projected pixels, anchors, seams and source preservation, and place saved outputs in a real scene with correct collision, walk-behind and no destructive view toggle.

## Dependencies and decisions

Prerequisites: 13.26, 12.17. Owner-approved breakdown; the corresponding tracker issue is recorded in tickets.toml. Contract choices still require the approval specified in 13.21. Read the [epic](epic-editor-p1.md), [owner refinement decisions](discovery/art-workspace-refinement.md), [research](../../../docs/findings/pixel-art-platform/research.md), [ADR 0022](../../../docs/adr/0022-shared-editor-authoring-contracts.md) and [ADR 0031](../../../docs/adr/0031-owned-art-editor-with-permissive-reuse.md). A-7 maps to CAP-16. No code implements an unsettled format/timing choice before 21's normative approval. Keep model/host boundaries, permissive licensing and fast focused verification; browser-led presentation is not a deterministic-runtime restriction.
