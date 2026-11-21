---
id: 16
type: bug
title: "Nested bounded surface edit is lost when its outer unbounded edit throws"
parent: none
covers: []
after: []
tracker_id: "#3278"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/3278"
refined: true
hitl: false
risk: medium
severity: P2
---

# Nested bounded surface edit is lost when its outer unbounded edit throws

## Description

Calling the exported core surface-editing APIs can lose a successful bounded child edit when an outer unbounded edit throws. The child pixels must survive, while the failed parent’s pixels must roll back.

## Reproduction

On Node v26.13 at merged revision `d907521ec9aabd54c4a16e096c05b9071a2af1ce`, the original 1×1 `editSurface` / `editSurfaceWithBounds` reproduction returned `[0, 0, 0, 0]` instead of `[0, 55, 0, 0]`. An expanded 2×1 reproduction uses an unbounded `editSurface` parent to set pixel 0 red to 33, then a successful bounded `editSurfaceWithBounds` child to set pixel 1 green to 55, before the parent throws. After catching the error and ending the batch, actual pixels are eight zero bytes; expected pixel 0 is `[0, 0, 0, 0]` and pixel 1 is `[0, 55, 0, 0]`.

## Cause Hypothesis

The first unbounded edit creates the batch entry. Its error path drops that entry even after a nested bounded edit has committed pixels into it.

## Verify

`node --test --test-name-pattern="issue #3278" packages/core/test/surface-batch.test.ts`

## Acceptance Criteria

1. **The child edit survives while the failed parent edit rolls back**
   **Given** a 2×1 surface in a batch, with an unbounded parent edit setting pixel 0 red to 33 and a nested bounded edit setting pixel 1 green to 55
   **When** the parent throws and the batch ends
   **Then** pixel 0 is `[0, 0, 0, 0]` and pixel 1 is `[0, 55, 0, 0]`
2. **Tests cover the condition found and fixed**
   **Given** the focused surface regression tests
   **When** the Verify command runs
   **Then** the regression test name contains `issue #3278`, the output shows it ran and passed rather than reporting zero matches, and the checks prove both child survival and parent rollback
3. **Or: no change is needed, with proof**
   **Given** both API reproductions
   **When** they are run against the implementation
   **Then** the child edit already survives and the parent edit is rolled back, or the report was mistaken, with evidence recorded in Notes; this supersedes criteria 1 and 2

## References

- parent — none
- specification — `docs/spec/engine/runners.md`, “Surface reads, presentation and game state” (persistent script-owned surface state; not a callback rollback rule)
- implementation intent — https://github.com/tk-reawakened/rpgtoolkit-reawakened/pull/3264, nested-edit rollback behavior
- regression evidence — https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/3278

## Notes

- Evidence: the original 1×1 reproduction returned `[0, 0, 0, 0]` instead of `[0, 55, 0, 0]`; the expanded 2×1 reproduction returned eight zero bytes instead of a rolled-back parent pixel and a committed child pixel.
- Risk reason: incorrect batch rollback can lose script-owned pixels that a caller already committed.
