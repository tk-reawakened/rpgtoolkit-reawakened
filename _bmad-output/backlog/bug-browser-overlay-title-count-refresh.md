---
id: 2
type: bug
title: "Browser overlay test reads the vector count before the title refreshes"
parent: none
covers: []
after: []
assignee: ""
tracker_id: "#2120"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/2120"
refined: true
hitl: false
risk: medium
severity: P2
---

# Browser overlay test reads the vector count before the title refreshes

## Description

The browser debug-overlay test can observe a title with `0 vectors` even though the fixture contains one vector and the browser draw list matches the headless draw list. The test should wait for the live board's title refresh to report the fixture's expected count, while still failing if that count remains wrong.

## Reproduction

At pinned `origin/main` commit `6076b911437ea7f30db986d39dfaf3de7c491d5e`, run `pnpm install --frozen-lockfile`, `pnpm build`, `pnpm fixtures:fetch`, then `pnpm exec playwright test tools/browser/tests/debug-overlays.spec.ts`. The reported run had 2 passing tests and 1 failure at `tools/browser/tests/debug-overlays.spec.ts:170`: expected `1 vectors`, received `Debug Overlays 0 vectors, 3 FPS`. The same test had already verified browser/headless draw-list parity. This original failure is recorded from issue #2120; it was not rerun for this ticket.

## Cause Hypothesis

The test may accept an initial title before the asynchronous live board state has been reflected in the title, then assert the vector count too early. This is a hypothesis; the work must distinguish a synchronization gap in the test from a persistent runtime count defect.

## Acceptance Criteria

1. **The live title refresh is awaited without weakening the count check**
   **Given** the browser fixture with one closed vector and a browser draw list that matches headless
   **When** the debug-overlay test reads the title
   **Then** it waits for a refreshed title containing the expected `1 vectors` value and still fails if the persistent title count is wrong
2. **The synchronization and count evidence is protected**
   **Given** the debug-overlay browser test
   **When** it runs
   **Then** draw-list parity remains asserted, the expected count remains strict, the test passes after the fix, and a targeted deliberate wrong-count perturbation fails for the expected count assertion
3. **Or: no runtime change is needed, with proof**
   **Given** the reported reproduction
   **When** the browser state and title refresh are examined
   **Then** the evidence distinguishes an initial stale title from a persistent wrong count, and any runtime defect is reported rather than hidden by a test-only wait

## Verification

At the fix, `pnpm exec playwright test tools/browser/tests/debug-overlays.spec.ts --grep "title carries the count"` passed (1 passed, 2.1s). Temporarily expecting 2 vectors made the same test fail at the title matcher with the observed refreshed title `Debug Overlays 1 vectors, 60 FPS`; restoring the expected count to 1 passed again (1 passed, 2.1s). The original reported full-file failure was not rerun.

## References

- parent — none; standalone backlog bug for existing issue [#2120](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/2120)
- test — `tools/browser/tests/debug-overlays.spec.ts:169` (count-refresh matcher; reported failure was at line 170 before the change)
- title lifecycle — `packages/runner-web/src/live-session.ts` and `packages/runner-web/app/main.ts`

## Notes

- Evidence: the restored targeted test observed the expected refreshed `1 vectors` title; deliberately expecting 2 failed with the actual title still at 1. This supports a test synchronization gap, not a persistent count failure on the tested path; no runtime code changed.
- Decision: follow the issue owner's requested synchronization behavior; preserve the strict expected count and draw-list parity checks.
