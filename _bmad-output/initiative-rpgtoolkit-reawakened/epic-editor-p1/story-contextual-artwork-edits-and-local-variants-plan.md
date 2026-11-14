---
type: feature
title: "Contextual artwork edits and local variants"
ticket: 24
status: draft
risk: high
---

## Intent

Open artwork from selected board or scene placements with neighbour and usage context, offering shared editing or a new local variant and returning to the original camera and selection through existing navigation.

## Scope and acceptance

1. From a selected tile/region/stamp placement, open its editable source and show board neighbours, the actual selected owner and known uses; uncertain dynamic references must not be presented as a complete use count.
2. Before mutation offer Edit shared, Make unique for these selected uses, or Cancel. The unique route creates an independent source/definition and relinks only the explicitly selected owner/cells, not every matching image.
3. Preserve source collision/under metadata through the existing 12.17 service, not by inferring geometry from recoloured pixels. Selection and view switches never mutate artwork.
4. Use the shared linked-visit navigation to return to the same board/scene camera, layer and selection. Reuse the sheet canvas and palette rather than a second browser or per-host editor.
5. A cancelled or failed multi-document variant operation retains originals and recoverable per-file state under ADR 0022. Do not promise cross-document atomic undo or save.
6. Verify a shared shelf seam in two scenes and a roof recoloured only in one scene; inspect persisted references, source pixels, collision/under and navigation, including undo/recovery and refusal cases.

## Verification

Repair a shelf seam shared by two scenes, then make one selected roof unique and recolour it, proving the other scene is unchanged, collision/under metadata survives, return context is restored and partial save failures remain recoverable.

## Dependencies and decisions

Prerequisites: 13.23, 12.16, 12.17. Owner-approved breakdown; the corresponding tracker issue is recorded in tickets.toml. Contract choices still require the approval specified in 13.21. Read the [epic](epic-editor-p1.md), [owner refinement decisions](discovery/art-workspace-refinement.md), [research](../../../docs/findings/pixel-art-platform/research.md), [ADR 0022](../../../docs/adr/0022-shared-editor-authoring-contracts.md) and [ADR 0031](../../../docs/adr/0031-owned-art-editor-with-permissive-reuse.md). A-3 maps to CAP-16. No code implements an unsettled format/timing choice before 21's normative approval. Keep model/host boundaries, permissive licensing and fast focused verification; browser-led presentation is not a deterministic-runtime restriction.
