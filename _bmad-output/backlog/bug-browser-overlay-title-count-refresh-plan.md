---
title: "Browser overlay test reads the vector count before the title refreshes"
type: bugfix
ticket: bug-browser-overlay-title-count-refresh
created: 2026-11-12
status: in-review
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
