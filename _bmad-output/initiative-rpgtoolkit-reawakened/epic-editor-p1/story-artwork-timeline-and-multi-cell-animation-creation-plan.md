---
type: feature
title: "Artwork timeline and multi-cell animation creation"
ticket: 25
status: draft
risk: high
---

## Intent

Create editable tile and region animations from sheet selections with frame duplication, ordering, onion skin and tiled/in-context playback, using the approved timing/lowering contract and existing TAN and clip providers.

## Scope and acceptance

1. Select sheet regions/frames to create a tile or multi-cell artwork animation. A timeline within the artwork workspace supports create/duplicate/delete/reorder frames with source-preserving edits and clear timing controls.
2. Provide onion skin, a tiled loop and board-context preview as non-mutating views. Editing a duplicate must not alter the original frame through accidental shared storage.
3. Persist editable frame data through 22; consume 13.6 for legacy TAN and 12.7/27.4 for existing animation/clip integration. Do not duplicate their generic file editors or silently change TAN speed 1–200, ordered empty slots or clip delay semantics.
4. Implement the exact approved 21 multi-cell timing and lowering contract, including loop boundaries and placement phase. Create real saved game outputs used by the actual runner, not independent preview-only clocks presented as game behavior.
5. Show source/output and invalidation state; parameter preview, playback and onion-skin settings are not source edits. Undo/redo covers source frame and timing edits.
6. Verify a multi-cell water loop at representative boundary ticks, compare saved/reopened source and independent expected runner frames, and cover empty frames, duplicate isolation, cancellation and output-write refusal. Do not simulate every intervening tick in a slow unit test.

## Verification

Author a multi-cell water loop, edit a duplicated frame, save/reopen source and outputs, and compare frame boundaries, empty-frame behavior and coordinated playback against independent expected runner states without substituting editor preview.

## Dependencies and decisions

Prerequisites: 13.6, 13.23, 12.7, 27.4. Owner-approved breakdown; the corresponding tracker issue is recorded in tickets.toml. Contract choices still require the approval specified in 13.21. Read the [epic](epic-editor-p1.md), [owner refinement decisions](discovery/art-workspace-refinement.md), [research](../../../docs/findings/pixel-art-platform/research.md), [ADR 0022](../../../docs/adr/0022-shared-editor-authoring-contracts.md) and [ADR 0031](../../../docs/adr/0031-owned-art-editor-with-permissive-reuse.md). A-4 maps to CAP-16. No code implements an unsettled format/timing choice before 21's normative approval. Keep model/host boundaries, permissive licensing and fast focused verification; browser-led presentation is not a deterministic-runtime restriction.
