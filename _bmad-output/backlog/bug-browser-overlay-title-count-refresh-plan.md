---
title: "Browser overlay test reads the vector count before the title refreshes"
type: bugfix
ticket: bug-browser-overlay-title-count-refresh
created: 2026-11-12
status: done
baseline_revision: 6076b911437ea7f30db986d39dfaf3de7c491d5e
route: oneshot
route_source: auto
risk: medium
review: none
review_source: auto
lenses_ran: []
review_loop_iteration: 0
context: []
assignee: "aljopro"
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The browser overlay test can assert a transient title count of zero before the live board state has been reflected, even when the rendered draw list is already correct. This creates a false failure and does not prove whether a persistent runtime count is wrong.

**Approach:** Synchronize on the refreshed title showing the fixture's expected vector count, keeping the count assertion strict and preserving browser/headless draw-list parity. Verify the count assertion still catches an intentionally wrong expectation; do not mask a persistent runtime count defect.

</frozen-after-approval>

## Verification

**Commands:**
- `pnpm exec playwright test tools/browser/tests/debug-overlays.spec.ts --grep "title carries the count"` -- expected: targeted browser test passes after waiting for the live title refresh.
- Temporarily change the expected vector count to an incorrect value and run the same targeted test -- expected: failure at the expected-count assertion, not timeout or unrelated setup; restore the intended count and rerun the test successfully.

## Implementation Notes

This is a small, single-test synchronization change; no runtime change is planned unless evidence shows the count remains wrong after the live board is ready.
`pnpm exec playwright test tools/browser/tests/debug-overlays.spec.ts --grep "title carries the count"` passed with the intended count (1 passed, 2.1s). For the perturbation, changing the expected title count from 1 to 2 failed at the strict title matcher: the live title was `Debug Overlays 1 vectors, 60 FPS`; restoring 1 passed the same test again (1 passed, 2.1s). The headless/browser draw-list parity check remained in the target test. No runtime code was changed.

## Closure Evidence

Audited at fetched `origin/main` `5da14d90972c0060c8e37ccd4450ce613f197822`, which is PR #2140's merge commit.

| Clause | Test (file:line) | Evidence |
|---|---|---|
| Wait for refreshed title to carry exact expected vector count. | `tools/browser/tests/debug-overlays.spec.ts:168-169` | Polls until the title matches exactly `1 vectors`; targeted run passed (1 passed, 2.1s). |
| Preserve draw-list parity and strict count; catch wrong expectation. | `tools/browser/tests/debug-overlays.spec.ts:161-169` | Asserts 4 headless line commands, browser list equality, and exact title count. Mutating expectation to 2 failed with received title `Debug Overlays 1 vectors, 60 FPS`; restored run passed. |
| No runtime count change is needed on this path. | `tools/browser/tests/debug-overlays.spec.ts:164-169`; PR #2140 | Live title reached 1 after the refresh; test-only fix sufficed, with no runtime code changed. |

The issue's original full-file failure was not rerun. PR #2140's required `gate` check passed: https://github.com/tk-reawakened/rpgtoolkit-reawakened/actions/runs/43238305106/job/131257956954. Issue #2120 was auto-closed by the merge.
