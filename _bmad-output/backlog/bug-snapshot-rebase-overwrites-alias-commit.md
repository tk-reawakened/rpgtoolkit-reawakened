---
id: 19
type: bug
title: "Snapshot rebase overwrites a newer alias surface commit"
parent: none
covers: []
after: []
tracker_id: "#3281"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/3281"
refined: true
hitl: false
risk: medium
severity: P2
---

# Snapshot rebase overwrites a newer alias surface commit

## Description

A newer pixel value committed through an alias view of a surface can be overwritten by an older provisional edit when the active editor resumes after snapshotting. The snapshot boundary must not let a stale editor replace pixels that were committed later.

## Reproduction

On Node v26.13 at merged revision `d907521ec9aabd54c4a16e096c05b9071a2af1ce`, create two 2×1 surface-section views with separate `entries` maps that both point to the same surface record. Begin a batch on the primary view and enter a bounded edit that provisionally sets pixel 0 red to 10. In its callback, begin a batch on the alias view, commit red 20 to that same initially zero pixel, snapshot a game state using the alias view, and end the alias batch. Complete the primary edit and end its batch. Actual pixel 0: `[10, 0, 0, 0]`. Expected pixel 0: `[20, 0, 0, 0]`.

## Cause Hypothesis

When rebasing an active editor without a recorded editor commit, the provisional buffer is treated as the prior committed value and can overwrite a newer canonical snapshot.

## Verify

`node --test --test-name-pattern="issue #3281" packages/core/test/surface-batch.test.ts`

## Acceptance Criteria

1. **A stale editor cannot overwrite the newer alias commit**
   **Given** separate 2×1 surface-section views whose entries maps reference the same surface record and an active parent edit changing pixel 0 red to 10
   **When** an alias batch changes that same initially zero pixel to red 20, a whole-state snapshot is taken inside the alias batch, and both edits finish
   **Then** pixel 0 remains `[20, 0, 0, 0]`
2. **Tests cover the condition found and fixed**
   **Given** the focused alias rebase regression tests
   **When** the Verify command runs
   **Then** each new test name contains `issue #3281`, the output shows the same-pixel overwrite test and the distinct-pixel preservation test ran and passed, and zero matches cannot satisfy the check
3. **Or: no change is needed, with proof**
   **Given** the reproduction
   **When** it is run against the implementation
   **Then** pixel 0 already contains the newer alias value, or the report was mistaken, with evidence recorded in Notes; this supersedes criteria 1 and 2

## References

- parent — none
- specification — `docs/spec/engine/runners.md`, “Surface reads, presentation and game state”
- regression evidence — https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/3281
- merged change — https://github.com/tk-reawakened/rpgtoolkit-reawakened/pull/3264

## Notes

- Evidence: the reported final pixel was `[10, 0, 0, 0]`; the newer alias commit `[20, 0, 0, 0]` was overwritten.
- Risk reason: the wrong surface value can enter a saved snapshot or remain in live state after concurrent edits.
