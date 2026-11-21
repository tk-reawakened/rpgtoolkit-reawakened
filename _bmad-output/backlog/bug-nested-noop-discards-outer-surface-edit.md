---
id: 18
type: bug
title: "Nested no-op surface edit discards the outer unbatched edit"
parent: none
covers: []
after: []
tracker_id: "#3280"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/3280"
refined: true
hitl: false
risk: medium
severity: P2
---

# Nested no-op surface edit discards the outer unbatched edit

## Description

A nested bounded surface edit that makes no changes can cause an outer unbatched edit to be discarded. The outer edit must still apply when its nested call is a no-op.

## Reproduction

On Node v26.13 at merged revision `d907521ec9aabd54c4a16e096c05b9071a2af1ce`, create one 1×1 surface and do not start a batch. In an outer bounded edit on that surface, set red to 42, then call a nested bounded edit on the same surface with the empty range `{ first: 1, last: 0 }` and no writes. Actual pixel: `[0, 0, 0, 0]`. Expected: `[42, 0, 0, 0]`.

## Cause Hypothesis

The nested no-op increments the surface revision. The outer editor then treats its detached buffer as stale and returns without applying its own change.

## Verify

`node --test --test-name-pattern="issue #3280" packages/core/test/surface-batch.test.ts`

## Acceptance Criteria

1. **A nested no-op does not discard its parent edit**
   **Given** one new 1×1 surface and no batch
   **When** an outer bounded edit sets red to 42 and calls an empty-range nested edit on the same surface
   **Then** reading back the final RGBA bytes returns `[42, 0, 0, 0]`
2. **Tests cover the condition found and fixed**
   **Given** the focused surface regression tests
   **When** the Verify command runs
   **Then** the regression test name contains `issue #3280`, the output shows it ran and passed rather than reporting zero matches, and the tests cover any related nested behavior changed by the fix
3. **Or: no change is needed, with proof**
   **Given** the reproduction
   **When** it is run against the implementation
   **Then** the outer edit already commits, or the report was mistaken, with evidence recorded in Notes; this supersedes criteria 1 and 2

## References

- parent — none
- specification — `docs/spec/engine/runners.md`, “Surface reads, presentation and game state”
- regression evidence — https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/3280
- merged change — https://github.com/tk-reawakened/rpgtoolkit-reawakened/pull/3264

## Notes

- Evidence: the reported 1×1 reproduction returned `[0, 0, 0, 0]` instead of `[42, 0, 0, 0]`.
- Risk reason: a nested no-op can silently lose a caller's script-surface drawing.
