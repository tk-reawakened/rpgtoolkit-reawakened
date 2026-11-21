---
title: "TK2 CheckButton does not write the clicked slot to its output argument"
type: bugfix
ticket: 21
created: 2026-11-21
status: ready-for-dev
baseline_revision: 70e337bdc3495158547e3a9d74115a8b156df880
route: oneshot
route_source: auto
risk: medium
review: ""
review_source: ""
lenses_ran: []
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The TK2 title path supplies an output variable to `CheckButton`, but the current command rejects that form and leaves the chosen slot unset.

**Approach:** Add an optional by-reference output to the existing nonblocking query. Preserve the existing boolean result; write the numeric hit slot or zero on a miss as recorded in the clean-room spec.

</frozen-after-approval>

## Implementation Notes

This issue is included because it is the same unchanged Final Destiny title path and is required for clicking New Game to route correctly. Shared implementation and fixture proof are recorded in the #2153 build plan.

## Verification

**Commands:**
- `node --test packages/core/test/input.test.ts` -- hit and miss output regressions pass.
- `pnpm typecheck` -- project types pass.
