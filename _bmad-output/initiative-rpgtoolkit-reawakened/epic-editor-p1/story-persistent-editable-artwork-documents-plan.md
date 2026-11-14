---
type: feature
title: "Persistent editable artwork documents"
ticket: 22
status: draft
risk: high
---

## Intent

Implement the approved source contract through the existing native-data and editor document services, preserving layers, frames, recipes, original sources and stable region identities separately from generated outputs.

## Scope and acceptance

1. Extend the existing native-data/editor services according to 21; consume 27.6's native-text authority integration and 11.14's history/checkpoint groups, rather than creating a parallel registry, parser framework, history stack or persistence store. Establish the source-edit and generation adapter contract consumed by the later feature modules.
2. Open/create/save/reopen sources with ordered layers, frame contents/timing, named regions, referenced pieces, recipe parameters and overrides intact. Unrelated text, comments and opaque plugin data follow existing preservation rules.
3. Keep raster payloads and originals available; source saves do not replace editable documents with flattened pictures. Track source revision versus the last successfully written generated outputs.
4. Source commands and undo/redo use existing shared document identity. Close/revert/recovery retain the host's authority. A failed write leaves pending changes available; multi-file results and checkpoint recovery must be truthful, not atomicity claims.
5. Missing input files retain references with actionable diagnostics. Check/rename use the existing project/native-data path rather than repairing or relinking silently.
6. Provide the source/region/recipe adapter for later tools and prove source read/write through a thin real editor view; drawing tools, recipe UI and exchange UI belong to their later stories.

## Verification

Save and reopen a layered animated source with recipes, then edit one property and exercise undo, save refusal, missing sources and checkpoint recovery without flattening the source, losing unrelated data or misreporting output freshness.

## Dependencies and decisions

Prerequisites: 13.1, 13.21, 27.13, 27.6, 11.14. Owner-approved breakdown; the corresponding tracker issue is recorded in tickets.toml. Contract choices still require the approval specified in 13.21. Read the [epic](epic-editor-p1.md), [owner refinement decisions](discovery/art-workspace-refinement.md), [research](../../../docs/findings/pixel-art-platform/research.md), [ADR 0022](../../../docs/adr/0022-shared-editor-authoring-contracts.md) and [ADR 0031](../../../docs/adr/0031-owned-art-editor-with-permissive-reuse.md). A-1 maps to CAP-16. No code implements an unsettled format/timing choice before 21's normative approval. Keep model/host boundaries, permissive licensing and fast focused verification; browser-led presentation is not a deterministic-runtime restriction.
