---
title: "Allow an untracked issue to get one linked ticket"
type: bugfix
ticket: '24'
created: '2026-11-21'
status: 'in-progress'
baseline_revision: '95c031c998abb661abc6f56d077105e2c6f64b5a'
route: 'oneshot'
route_source: 'auto'
risk: 'low'
review: 'none'
review_source: 'auto'
lenses_ran: []
review_loop_iteration: 0
context:
  - '{project-root}/docs/guardrails.md'
  - '{project-root}/AGENTS.md'
  - '{project-root}/CONTRIBUTING.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A GitHub issue with no BMAD ticket is reported `not_found`, and `AGENTS.md`, `CONTRIBUTING.md` and the preflight skill all told agents not to create one. The rule that every issue must have a ticket could never be satisfied for an issue that arrived without one, so valid work stopped.

**Approach:** Document the safe path: check that the issue exists, reconcile every `mentions` plan so existing work is not duplicated, create one BMAD ticket linked to the existing issue with `bmad-ticket`, rerun the preflight with `--check-stock`, and validate the store before handoff. Never create a second GitHub issue. Duplicate, conflicting and malformed identities remain blocking. Point the `not_found` message at that action while leaving the resolver read-only and non-zero on failure.

## Boundaries & Constraints

**Always:** Keep the resolver read-only; keep `not_found` non-zero and keep `mentions`; keep duplicate and conflicting identities blocking; keep the preflight's stock check and store validation in the handoff path.

**Never:** Create a duplicate GitHub issue; make the resolver write; weaken the fail-closed codes or the stock check; touch the GPL source.

</frozen-after-approval>

## Verification

**Commands:**
- `python3 -m unittest discover -s .agents/skills/tkr-issue-preflight/scripts/tests -p 'test_*.py'` — the suite passes (89 tests).
- `pnpm bmad:tickets:test` — the ticket contract tests and `--validate-store` pass.
- `uv run .agents/skills/tkr-issue-preflight/scripts/resolve_issue.py "#3342" --project-root . --check-stock` — `ok: true`, `buildable: true`, the ticket's plan joined.
- Perturbation: restore the old `not_found` message and confirm the wording test fails; make the failure return 0 and remove `mentions` and confirm the pinning test fails; restore and rerun.

## Implementation Notes

The change is documentation plus one message string. `resolve()` still raises `Fail("not_found", ..., mentions=store.mentions(number))`, so the process exits 1 and the JSON carries the mentioned plans; no file is written. The skill's `not_found` branch now instructs the linked-ticket flow, every other `ok: false` keeps its verbatim-report-and-stop rule, and `CONTRIBUTING.md` says the resolver itself does not write. The test at `test_missing_number_fails_and_lists_plans_that_mention_it` asserts the new wording and the absence of the old; `test_not_found_still_exits_non_zero_and_keeps_the_mentions_list` pins the exit status and the `mentions` payload.

## Perturbation Check

| Guard reverted | Test that failed |
|---|---|
| `not_found` message restored to "do not create an issue or a ticket" | `test_missing_number_fails_and_lists_plans_that_mention_it` |
| Failure exit code changed to 0 | `test_not_found_still_exits_non_zero_and_keeps_the_mentions_list` |
| `mentions` dropped from the failure payload | `test_not_found_still_exits_non_zero_and_keeps_the_mentions_list` |
