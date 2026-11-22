---
title: "Name the getpath accepted counts and prove them at the VM boundary"
type: bugfix
ticket: '29'
created: '2026-11-22'
status: 'ready-for-dev'
baseline_revision: 'd8a348c58298f6dc27a5097f939d54bd45b595d9'
route: 'oneshot'
route_source: 'auto'
risk: 'low'
review: 'none'
review_source: 'auto'
lenses_ran: []
review_loop_iteration: 0
context:
  - '{project-root}/docs/guardrails.md'
  - '{project-root}/docs/spec/engine/rpgcode-errors-and-threads.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `checkArity` derives "takes 1 to 4 argument(s)" from the parameter model, but `playergetpath` and `itemgetpath` accept exactly 1 or exactly 4 and reject 2 and 3 in the handler. The generic message advertises counts that always fail, and every getpath test bypasses `checkArity`, so the VM boundary and the rejected 0/5+ arities are unproven.

**Approach:** Follow the issue's "fix proves": add a VM-level test that `playergetpath(0)` and the four-argument form run through the VM, and that 0, 2, 3 and 5+ arguments all raise a catchable arity error naming one or four. Represent the accepted counts in the parameter model (for example an accepted-counts field), or make a documented wording amendment of ticket 23 criterion 5. Also fix ticket 23's ambiguous "none beyond the handle" phrasing.

## Boundaries & Constraints

**Always:** Keep the error catchable and located; keep the handler's rejection of 2 and 3 arguments; keep one source of truth for the accepted set; update ticket 23's wording when the contract is clarified.

**Never:** Widen the handler to accept 2 or 3 arguments just to match the generic message; add a bespoke message path that duplicates the VM's counting logic without a model change; change R-69's accepted counts.

</frozen-after-approval>

## Verification

**Test strategy:**
- Add VM-level tests (not direct spec calls) for both `playergetpath` and `itemgetpath`: the one-argument and four-argument forms reach the handler, and 0, 2, 3 and 5+ arguments each raise a catchable `arity.mismatch` naming one or four.
- Assert the VM and handler agree on the accepted set.
- Perturbation: restore the generic 1-to-4 message and confirm the naming test fails; remove the VM-level accepted-form test guard and confirm the boundary case fails.

**Commands:**
- `node --test packages/core/test/movement-rulings.test.ts`.
- `pnpm bmad:tickets:test`.

## Implementation Notes

## Perturbation Check

| Guard reverted | Test that failed |
|---|---|
| | |
