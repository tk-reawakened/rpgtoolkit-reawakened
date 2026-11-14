---
type: feature
title: "External artist handoff and reviewed reimport"
ticket: 30
status: draft
risk: high
---

## Intent

Add host-capability-aware external handoff and explicit reimport with changed-source review, stable-region mapping, pending-edit conflicts and output regeneration, without requiring automatic watchers or a particular external application.

## Scope and acceptance

1. Provide an external-art route that exposes the relevant original and the documented exchange recipe. Where platform-services can launch an external application, offer that capability; otherwise provide explicit file export/import or download/upload handoff. No host may claim a successful launch it cannot perform.
2. Reimport is explicit and reviewed. Automatic file watching is not required, and no application is mandatory. Compare the changed source, affected regions, recipes/outputs and uses before applying changes.
3. Resolve pending local edits, moved/resized/removed regions and overlapping changes through explicit retain/replace/remap/cancel decisions. Never silently overwrite either the artist's original or unsaved in-editor work.
4. Preserve stable definition identities where mappings are retained; deleting a used region requires a reviewed replacement or refusal. Regeneration uses 22/26, not an unrelated pipeline.
5. Apply per-file save reporting and checkpoint recovery; a refused generated-output write leaves the editable source, external original and local work recoverable and marks stale output truthfully.
6. Verify an external revision while local changes exist, including removed regions, shared uses and a local variant; exercise review, cancel, accepted reimport, failed writes and a host without external-launch capability.

## Verification

Revise an external sheet while local edits exist, review moved/removed regions and affected uses, then accept or cancel reimport and exercise failed output writes while preserving originals, local work and recoverable per-file results.

## Dependencies and decisions

Prerequisites: 13.29, 13.24. Owner-approved breakdown; the corresponding tracker issue is recorded in tickets.toml. Contract choices still require the approval specified in 13.21. Read the [epic](epic-editor-p1.md), [owner refinement decisions](discovery/art-workspace-refinement.md), [research](../../../docs/findings/pixel-art-platform/research.md), [ADR 0022](../../../docs/adr/0022-shared-editor-authoring-contracts.md) and [ADR 0031](../../../docs/adr/0031-owned-art-editor-with-permissive-reuse.md). A-8 maps to CAP-16. No code implements an unsettled format/timing choice before 21's normative approval. Keep model/host boundaries, permissive licensing and fast focused verification; browser-led presentation is not a deterministic-runtime restriction.
