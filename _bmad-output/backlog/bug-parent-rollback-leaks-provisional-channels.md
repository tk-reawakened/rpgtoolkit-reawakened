---
id: 17
type: bug
title: "Rolling back a parent surface edit leaks its provisional pixel channels"
parent: none
covers: []
after: []
tracker_id: "#3279"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/3279"
refined: true
hitl: false
risk: medium
severity: P2
---

# Rolling back a parent surface edit leaks its provisional pixel channels

## Description

When a nested surface edit commits one channel of a pixel, a later failure of its parent can preserve other, uncommitted parent channels from that same pixel. The child change must remain while every failed parent change is rolled back.

## Reproduction

On Node v26.13 at merged revision `d907521ec9aabd54c4a16e096c05b9071a2af1ce`, create a 1×1 surface and begin a batch. In a bounded parent edit, set red to 11. Complete a nested bounded edit that sets green to 22, then throw from the parent. Catch the error and end the batch. Actual pixel: `[11, 22, 0, 0]`. Expected: `[0, 22, 0, 0]`.

## Cause Hypothesis

Nested commit reconciliation compares and commits a whole pixel when only one of its channels changed, so the parent’s provisional red value is copied into rollback state.

## Verify

`node --test --test-name-pattern="issue #3279" packages/core/test/surface-batch.test.ts`

## Acceptance Criteria

1. **Parent rollback preserves the child channel**
   **Given** a 1×1 surface in a batch, a parent edit that sets red to 11, and a nested child edit that sets green to 22
   **When** the parent throws and the batch ends
   **Then** the pixel is `[0, 22, 0, 0]`
2. **Tests cover the condition found and fixed**
   **Given** the focused rollback regression tests
   **When** the Verify command runs
   **Then** each new test name contains `issue #3279`, the output shows every matching test ran and passed, and the tests cover the reported channel leak, a child that changes red back to its original bitmap value after an earlier committed red change, and a committed descendant surviving its ancestor’s rollback
3. **Or: no change is needed, with proof**
   **Given** the reproduction
   **When** it is run against the implementation
   **Then** red is already restored while green remains, or the report was mistaken, with evidence recorded in Notes; this supersedes criteria 1 and 2

## References

- parent — none
- specification — `docs/spec/engine/runners.md`, “Surface reads, presentation and game state”
- regression evidence — https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/3279
- merged change — https://github.com/tk-reawakened/rpgtoolkit-reawakened/pull/3264

## Notes

- Evidence: the 1×1 reproduction returned `[11, 22, 0, 0]` instead of `[0, 22, 0, 0]`.
- Assumption: In this reproduction, rollback restores the red channel written by the failing parent while preserving the child's green write. This does not decide priority for competing writes to the same channel.
- Scope note: This ticket fixes the demonstrated case where a child changes green and the failing parent changed red on the same pixel; it does not set a general policy for overlapping writes to the same channel.
- Risk reason: an aborted edit can persist pixels that its caller did not commit.
