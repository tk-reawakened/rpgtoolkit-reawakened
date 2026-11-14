---
type: feature
title: "Reusable non-destructive kitbash recipes"
ticket: 26
status: draft
risk: high
---

## Intent

Compose referenced source pieces, transforms and editable adjustments into reusable recipes with saved parameters, explicit overrides and source-change regeneration while preserving original pixels and stable output identities.

## Scope and acceptance

1. Compose referenced source pieces in ordered layers with position, crop, transforms and editable adjustments. The approved recipe contract, not a screenshot or derived flattened image, remains authoritative.
2. Save reusable recipe parameters and explicit local overrides. Reusing the recipe preserves independent output identities and does not turn all placements into pixel copies.
3. Source changes identify affected outputs, preserve overrides, and allow reviewed regeneration. Missing pieces and dependency cycles produce diagnostics without substituting unrelated imagery or modifying the original.
4. Generate outputs through the adapter from 22. Reuse drawing/effect services from 3/23 and existing tile/pack references; do not introduce another compositor/document model as a side effect of this UI.
5. Previewing adjustments is clean; committed parameter changes are undoable. Record source and generated-file save results separately, retaining recovery if only some writes succeed.
6. Build a house from roof/wall/door sources, reuse it with a recolour override, modify one source, regenerate and reopen, and check exact affected pixels, stable references, preserved originals/overrides and cancel/failure behavior.

## Verification

Build a house from shared pieces, revise one source and a local override, then regenerate and reopen while checking exact affected outputs, preserved overrides, unchanged originals and truthful stale/missing-source diagnostics.

## Dependencies and decisions

Prerequisites: 13.23. Owner-approved breakdown; the corresponding tracker issue is recorded in tickets.toml. Contract choices still require the approval specified in 13.21. Read the [epic](epic-editor-p1.md), [owner refinement decisions](discovery/art-workspace-refinement.md), [research](../../../docs/findings/pixel-art-platform/research.md), [ADR 0022](../../../docs/adr/0022-shared-editor-authoring-contracts.md) and [ADR 0031](../../../docs/adr/0031-owned-art-editor-with-permissive-reuse.md). A-5 maps to CAP-16. No code implements an unsettled format/timing choice before 21's normative approval. Keep model/host boundaries, permissive licensing and fast focused verification; browser-led presentation is not a deterministic-runtime restriction.
