---
type: feature
title: "Character stats moves equipment and progression"
ticket: 5
status: built
---

# Character stats moves equipment and progression

## Scope

Author character identity, stat bindings, profile, special-move unlocks, equipment and level growth with shared sprite graphics and connected references.

Cover all starting stats and explicit variable bindings, profile image/tile/bitmap, up to 200 moves and unlock rules, equipment slots and accessory names, and level thresholds, growth and program; never regenerate bindings on display-name change.

## Acceptance and verification

A character with nondefault bindings, move rules, equipment and growth saves and reopens without changing unrelated legacy fields or regenerating bindings on rename.

Use the shared document lifecycle and preserve same-version unknown data; exercise relevant failure/cancel, keyboard access and save/reopen paths rather than relying on preview alone. Follow `discovery/inception-proposal.md`, `docs/editor-features.md` and G2/G7; do not claim checks passed without executing them.

## Dependencies and decision gate

Prerequisite 4 (shared sprite graphics) is delivered. Character reference paths are editable and persist; linked `.prg`/`.spc` authoring is not available from an unimplemented provider. The UI says so rather than pretending to open one; #2609 tracks that provider integration for the connected-editing work.

## Implementation and verification

- Shared model/bridge/view covers explicit stat bindings, identity, profile, move unlocks, equipment and level growth, retaining same-version residue. Renaming never regenerates variable bindings.
- Accepted edits are submitted immediately. Move edits carry individual fields so two views cannot replace a sibling field with stale data. Conflict reload updates the observed snapshot and invalidates stale drafts.
- VS Code retains hidden custom-editor contexts so native Save All and backup include accepted hidden edits. Closing a nonfinal split view does not drop its submitted edit.
- Focused model, character-view and host lifecycle checks passed (49/49; each under one second), as did full typecheck, lint and graph checks. An earlier strict run at `1bb` passed 4,728 tests; final-head CI is still required.
- Actual packaged VS Code web proof passed both Cancel and Keep flows, including character native Save All/reopen and art/bitmap stored-byte and pixel checks. The separate actual refused-save/concurrent-launch-edit guard proof also passed. Retained hidden frames are excluded from visual proof selection, not disabled in production.
- PR #2608 remains subject to independent review and required CI; `built` is not a merged/done claim.
