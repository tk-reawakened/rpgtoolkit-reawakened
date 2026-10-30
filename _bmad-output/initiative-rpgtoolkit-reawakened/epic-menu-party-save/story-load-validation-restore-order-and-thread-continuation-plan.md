---
title: "Load validation, restore order and thread continuation"
type: 'feature'
ticket: 10
created: '2026-10-22'
risk: "high"
context:
  - "spec - docs/spec/formats/save-game.md (R-13, field 46 compatibility)"
  - "spine - AD-7, AD-10, AD-23"
---

## Intent

Load a canonical blob only after validating it and restore all section owners, package services and waiting/running threads according to entry 1's normative compatibility rule.

## Boundaries

Untrusted canonical-blob validation, schema migrations, failure atomicity, hydration order, thread state compatibility and deterministic replay. Legacy `.sav` import is explicitly out of scope under R-13/E-122 in entry 1; do not add it to this story.

## Acceptance

Current and prior-version canonical saves restore through the approved order; a compiler-version mismatch refuses the whole save before payload validation and leaves live state unchanged. With a matching compiler, changed source restarts only its own saved thread, while missing programs/includes or syntax errors refuse before commit. Every saved program reference is compiled, including object-record references when no callable requires it. Package startup precedes actor behavior resolution; missing behavior follows the accepted default-and-diagnostic rule. Restored threads preserve their continuations and future deterministic behavior.

## Verification

Use authored current/prior-version, malformed, compiler-mismatch, missing-program/include and source-changed fixtures. Cover VM/object references, each waiting kind, package-startup/actor-behavior ordering, rejected-load state atomicity, and snapshot/restore/replay including RNG, clock and event/input state. Do not claim equipment reconciliation complete: asset-aware validation/rebuilding of inventory-derived actor equipment state remains an unresolved integration dependency shared with #778.

## Implementation map

Preflight the schema and every saved program compiler reference before any payload parsing, including the game-save audio projection wrapper; then compose section migrations, `loadBlob`, package startup and actor hydration. For each changed file-backed thread, compile only the current source as its restart target and refuse the whole load if that source or its includes do not compile. Do not save compiler-owned instruction offsets as portable positions unless entry 1 explicitly rules their compatibility.

## Accepted ledger handoff (2026-10-29)

#593 owns validation, migrations, atomic load/rollback, hydration order and the existing compiler/source thread compatibility rule. Apply the accepted `docs/spec/formats/save-game.md#game-ledger-and-savable-continuation` without replacing normal VM snapshots with ledger-only recovery. #778 owns the ledger projection and hash; coordinate the validation boundary rather than implementing it twice. Invalid or conflicting derived data must not silently discard progress. Preserve old canonical saves and thread continuation; prove candidate/readback consistency, references, compatibility failures and replay behavior in the owning tests. This handoff does not show these changes are implemented or this story complete.

### Unresolved integration dependency

The accepted ledger contract makes inventory assignments authoritative and actor equipment bonuses/references derived. Resolving that projection requires asset-aware item authority and validation; the current plan has no evidence that load can reconstruct it safely without synthesizing bonuses or executing behavior hooks. Do not guess at either. Record this as an unresolved #593/#778 integration dependency until the owning asset-authority work defines and tests the reconciliation boundary. This is not an acceptance claim that equipment reconciliation has been implemented.
