---
type: feature
title: "Auto tile sample evidence and ordering ruling"
ticket: 7
status: done
risk: high
---

## Intent

Acquire rights-cleared community auto-tile sample sets and establish the index-to-neighbour variant order from independently checkable examples under G7.

## Scope and acceptance

Document fixture origin and permissions without copying GPL source; establish corner gating and representative island, edge, inner/outer corner, junction and narrow passage as well as full index mapping; inadequate evidence is a blocker.

## Verification

A person reviews sample provenance, permission, indexed imagery, independent expected neighbourhood cases and unresolved ambiguity, approving a complete evidence-backed mapping or leaving implementation blocked.

## Dependencies and decisions

Prerequisites: 12.1. Apply the epic Notes, format specs, AD-18/19/20/22/29 and connected-authoring direction; T-25 maps to CAP-16. Preserve version and residue, use the existing shared model and browser, and route host access through platform-services. Where provider or host capability is unavailable, preserve data and report the limitation; do not simulate it.

Entry 8 was gated on a human-approved, complete compatibility mapping with rights-cleared evidence.

## Closure evidence

The human adoption gate was satisfied by the owner's merge of [#3498](https://github.com/tk-reawakened/rpgtoolkit-reawakened/pull/3498) at `e8faf060a74138a73e14ee1e83c216625e2e9800`, which closed [#1732](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1732). The accepted route is the clean-room [Toolkit 3.1 slot table](../../../docs/spec/editor/autotiling.md#12-tile-layout) and [original procedural example](../../../docs/spec/editor/autotiling.md#6-example), not the historical generic order or unlicensed community artwork. The optional released-editor probe was not required to close the story and is not claimed as a completed observation.

At `5ec33c3728f490f5ef0399e708f7be93918e9d51`, `python3 docs/spec/tools/test_autotile_example.py` passed all 11 tests. The tests cover all 47 legal shapes, the reserved slots, and hand-read cases for islands, corners, junctions, passages, edges and reshaping after erase. The fixture checks compare the committed board and tileset byte for byte with the original generator. This resolves the legacy compatibility evidence gate for 13.8, not the implementation of terrain painting.
