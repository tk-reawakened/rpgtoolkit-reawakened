---
type: feature
title: "Put character identity and starting stats first"
ticket: 2
status: draft
tracker_id: "#2963"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/2963"
---

# Put character identity and starting stats first

## User outcome

An author sees who they are editing, sets the character's portrait and starting values, and can find advanced script bindings when needed.

## Scope and dependencies

CAP-15/CAP-18, T-50. Depends on 29.1 and delivered lifecycle 11.3 (#1701). This story completes the first-view fix for #2959 using the navigation foundation. Preserve 12.5's model, command, persistence and explicit-binding behavior.

## Acceptance criteria

1. The everyday first view presents the character name, profile preview/assignment and starting experience, health/max health, defense, fight, special-move power/max power and level in understandable groups. Use plain names with legacy abbreviations where helpful; distinguish current from maximum values.
2. Profile assignment supports the existing documented source kinds and shows a useful preview or an explicit missing/invalid state. Empty profile content explains the available assignment action. Replacing or cancelling does not change unrelated data.
3. The nine explicit script bindings live in an accessible Advanced section with clear labels and concise help. A display-name change never regenerates them. Any existing explicit default/reset action stays deliberate and undoable.
4. Identity and stats are accessible at the epic's target viewport/pane sizes without a preceding stance-grid scroll. Keyboard navigation and error associations remain usable. Changing sections and returning retains accepted edits and appropriate focus/context.
5. Invalid or incomplete numeric input produces an understandable field message and does not submit an unintended zero, clamp, or partial model change. Use the existing documented validation contract; do not invent new runtime limits in the view.
6. A fixture with nondefault bindings and unrelated legacy/residue fields survives editing, undo/redo, save/reopen and conflict reload with only intended values changed. Both supported profile assignment and its failure/cancel path are exercised.
7. Link the implementation PR to #2959 and close it only after the actual first-view and keyboard evidence satisfies its acceptance. Do not close it from the planning PR.

## Implementation boundaries

Character identity/stat presentation owns this story. The shared document is still authoritative and host save controls remain the ones supplied by the shell. Follow 29.1's `docs/` contract and ADR 0022; no local editable duplicate, host-specific feature or automatic binding rewrite.

## Verification

Focused component/model integration checks prove validation, explicit binding preservation and undo. A host walkthrough proves visible hierarchy and stored values after reopen. Include light/dark captures and a keyboard pass; carry forward any unresolved #2652 lifecycle limitation explicitly rather than claiming redesign fixes it.

## Sources

- `docs/editor-features.md`, T-50.
- `docs/spec/formats/character.md#layout`.
- `docs/adr/0022-shared-editor-authoring-contracts.md`, shared document/lifecycle contracts.
- #2959 evidence; existing character plan 12.5; 29.1 experience contract.

## Completion record

Not implemented. Record captures, exact commands/results and the fixing PR when delivered.
