---
id: 38
type: bug
title: "Skin-view tests time out waiting for initial preview reads in CI"
parent: none
covers: []
after: []
assignee: ""
tracker_id: "3594"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/3594"
refined: false
hitl: false
risk: medium
severity: P2
---

# Skin-view tests time out waiting for initial preview reads in CI

## Description

Two native-skin view tests can fail in the unit CI shard before reaching their folder-ownership assertions. Their settle helper does not observe the initial preview reads, even though the focused test file passes locally. The tests should drive the initial render's effects before checking which project paths the preview reads.

## Reproduction

1. Run CI workflow `unit (4)` for PR #3520 at head `077aee573d18b9bef95b7e82b1c4b074564d3157`.
2. Observe the test “a refresh re-resolves the project folders, so a moved game needs no pick (#3536)” fail at its wait for both `Game/Old/Bitmap/window.png` and `Game/Old/Bitmap/button.png`.
3. Observe “choosing the picture already named is a successful no-edit that adopts the picker's folders (#3536)” fail at its wait for `Game/Old/Bitmap/window.png`.
4. Both errors are `AssertionError: the skin view did not settle` from `settleUntil`; the full focused file passed locally before the change.

## Cause Hypothesis

The initial view render schedules its preview reads from Preact effects, but these two tests mount outside `act`. Their helper yields with `setImmediate` for a bounded number of turns, which can finish before the scheduled effects run under CI load. The same initial reads are observed when the mount is driven through `act`.

## Acceptance Criteria

1. **Initial preview reads settle in CI**
   **Given** the two ownership tests run in the unit shard
   **When** the skin view first renders
   **Then** their waits observe the expected initial project reads and continue to their folder-ownership assertions.
2. **The behavior assertions remain meaningful**
   **Given** the focused skin-view tests
   **When** the initial reads are driven deterministically
   **Then** the tests still verify the old and new folders, unchanged-pick behavior, and no-edit state without increasing arbitrary wait limits.
3. **Or: no change is needed, with proof**
   **Given** the reported CI revision and reproduction
   **When** the focused tests run
   **Then** the expected behavior already holds without the regression change, or the report was mistaken, with the evidence recorded in Notes — this supersedes 1 and 2.

## References

- CI job — https://github.com/tk-reawakened/rpgtoolkit-reawakened/actions/runs/45891490431/job/140158279754
- PR — https://github.com/tk-reawakened/rpgtoolkit-reawakened/pull/3520
- GitHub bug — https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/3594
- Test file — `packages/editor-ui/test/skin-view.test.ts`

## Notes

- Verification: `pnpm exec tsc -b packages/editor-ui/tsconfig.json && node --test packages/editor-ui/test/skin-view.test.ts` passed all 14 tests after the mount calls were wrapped in `act` (Node 26.13.0).
- The current `origin/main` checkout does not contain the native-skin view or this test file; the failure is specific to PR #3520.
