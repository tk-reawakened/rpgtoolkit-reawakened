---
type: feature
title: "Refactor sweep"
ticket: 13
status: built
route: oneshot
route_source: auto
risk: low
baseline_revision: bb877f82e64b43e15614cdab2e6718dc36c4596f
review: quick
review_source: pinned
lenses_ran: [quick]
context: ["docs/guardrails.md", "docs/editor-features.md"]
---

# Refactor sweep

<frozen-after-approval reason="behavior-preserving Epic 12 cleanup">

## Intent

The three native VS Code editors independently find the changed span and submit the same kind of workspace edit. Share that operation so they preserve surrounding source and native undo in the same way. Keep each editor's validation, diagnostics, save and conflict behavior unchanged. Do not add new authoring features.

</frozen-after-approval>

## Implementation Notes

The native clip, geometry and terrain providers are the three callers. Keep their distinct no-change outcomes. The earlier linked-art and program issues (#3040, #3111, #3114, #3121) were handled by connected authoring. Corrupt imported ANM dimension hardening remains explicitly deferred in #3067; the sweep does not change imported animation behavior or take on the item editor work moved to Epic 29.

## Verification

Run the real VS Code Web native clip and native scene lanes to cover keyboard undo/redo, review cancellation, saved text, and reopen. Run editor document conformance and typecheck.

## Dependencies and decision gate

Prerequisites: 12.1, 12.2, 12.3, 12.4, 12.5, 12.7, 12.8, 12.9, 12.10, 12.11, 12.12, 12.15, 12.16 and 12.17. The former 12.6 scope moved to 29.7 and is outside this retained-work sweep. Epic 12 completes before 29; check actual providers before implementation.
