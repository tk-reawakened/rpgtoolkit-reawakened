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

Untrusted blob validation, schema migrations, failure atomicity, hydration order, thread state compatibility and deterministic replay. Legacy `.sav` import follows entry 1's scope ruling and may be a separate implementation path within this entry.

## Acceptance

Current and prior-version saves restore through the approved order, matching and mismatching thread identities take the ruled branch, invalid payloads fail without unsafe partial state, and successful restore gives equal hashes and future behavior.

## Verification

Use authored valid, old-version, malformed and identity-mismatch fixtures; snapshot at each waiting kind, restore and replay, and assert diagnostics and no unexpected event or input consumption.

## Implementation map

Compose section migrations, `loadBlob`, package startup and actor hydration; do not save compiler-owned instruction offsets as portable positions unless entry 1 explicitly rules their compatibility.

## Accepted ledger handoff (2026-10-29)

#593 owns validation, migrations, atomic load/rollback, hydration order and the existing compiler/source thread compatibility rule. Apply the accepted `docs/spec/formats/save-game.md#game-ledger-and-savable-continuation` without replacing normal VM snapshots with ledger-only recovery. #778 owns the ledger projection and hash gaps; coordinate the validation boundary rather than implementing it twice. Invalid or conflicting derived data must not silently discard progress. Preserve old saves and thread continuation; prove candidate/readback consistency, references, compatibility failures and replay behavior in the owning tests. This note is a requirement handoff, not evidence that those changes are implemented or that this story is complete.
