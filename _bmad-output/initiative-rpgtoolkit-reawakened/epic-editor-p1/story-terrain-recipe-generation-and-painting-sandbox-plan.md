---
type: feature
title: "Terrain recipe generation and painting sandbox"
ticket: 27
status: draft
risk: high
---

## Intent

Generate the approved native terrain variant set from editable base and edge recipes, with a sandbox for islands, corners, junctions and narrow passages that uses the actual terrain-painting provider.

## Scope and acceptance

1. Take editable base/edge/corner inputs and approved generation parameters to build the complete native terrain-role set, including its 47-variant layout where specified by 21. Keep recipes and deliberate per-role overrides editable.
2. Label generated native roles and all missing assignments explicitly. Never call the generated layout legacy-compatible without the sample-derived mapping owned by 7.
3. Provide a sandbox with island, edge, inner/outer corner, junction and narrow-passage arrangements. It calls the actual 8 painting/re-evaluation service; it is not a second implementation with nicer preview results.
4. Save the generated kit and place it in a scene through the existing 12.17 collision/under provider. Changing terrain art must not silently rewrite unrelated gameplay properties.
5. Regeneration tracks changed inputs and preserves role identities and overrides, with reviewed replacement and truthful per-file output/recovery results.
6. Independently check every required role and representative neighbourhoods, then revise an input and compare sandbox, saved/reopened kit and real scene/runner results. Native and legacy mapping evidence remain separate.

## Verification

Generate all required variants, compare independent expected neighbourhoods in the sandbox and a saved scene, revise an input and preserve overrides, and distinguish native role order from sample-backed legacy order.

## Dependencies and decisions

Prerequisites: 13.26, 13.8, 12.17. Owner-approved breakdown; the corresponding tracker issue is recorded in tickets.toml. Contract choices still require the approval specified in 13.21. Read the [epic](epic-editor-p1.md), [owner refinement decisions](discovery/art-workspace-refinement.md), [research](../../../docs/findings/pixel-art-platform/research.md), [ADR 0022](../../../docs/adr/0022-shared-editor-authoring-contracts.md) and [ADR 0031](../../../docs/adr/0031-owned-art-editor-with-permissive-reuse.md). A-6 maps to CAP-16. No code implements an unsettled format/timing choice before 21's normative approval. Keep model/host boundaries, permissive licensing and fast focused verification; browser-led presentation is not a deterministic-runtime restriction.
