---
type: feature
title: "Standard artwork exchange without mandatory drawing tools"
ticket: 29
status: draft
risk: high
---

## Intent

Implement the approved image/sheet and animation interchange contract so externally authored art can be imported, used and exported with explicit metadata/loss disclosure and no requirement to open our drawing UI.

## Scope and acceptance

1. Implement the image/sheet and animation metadata contract approved in 21 with PNG following existing storage policy. Use the reviewed extraction service from 4 and source/timeline/recipe adapters rather than a separate import UI or source model.
2. An artist may produce static sheets and animation externally, import them, bind/use their regions and run a playable game without opening our drawing UI or reconstructing the art with our tools.
3. External originals remain intact. A rendered PNG is not a layered document; expose omitted layers, adjustments, collision/terrain or timing metadata when an exchange cannot represent them. Export the supported metadata explicitly instead of assuming a picture contains it.
4. Import/export compare dimensions, named region mapping, pixel alpha/key behavior, frame order/timing and stable references. Declare unsupported features, refuse ambiguous destructive updates, and show loss before commit.
5. Keep original third-party editable files as sources when supplied. This does not promise structural Aseprite/PSD import/export or a lossless round trip through a foreign editor.
6. Use independent externally authored fixtures and expected metadata, not only export-then-import self-comparison. Cover wholly external and mixed workflows, cancellation, malformed metadata and save refusal through the real hosts and runner.

## Verification

Use independent externally authored fixtures to create and run a game without our drawing UI, then exchange a mixed-workflow asset while checking pixels, regions, alpha, frame order/timing and retained editable originals.

## Dependencies and decisions

Prerequisites: 13.4, 13.25, 13.26. Owner-approved breakdown; the corresponding tracker issue is recorded in tickets.toml. Contract choices still require the approval specified in 13.21. Read the [epic](epic-editor-p1.md), [owner refinement decisions](discovery/art-workspace-refinement.md), [research](../../../docs/findings/pixel-art-platform/research.md), [ADR 0022](../../../docs/adr/0022-shared-editor-authoring-contracts.md) and [ADR 0031](../../../docs/adr/0031-owned-art-editor-with-permissive-reuse.md). A-8 maps to CAP-16. No code implements an unsettled format/timing choice before 21's normative approval. Keep model/host boundaries, permissive licensing and fast focused verification; browser-led presentation is not a deterministic-runtime restriction.
