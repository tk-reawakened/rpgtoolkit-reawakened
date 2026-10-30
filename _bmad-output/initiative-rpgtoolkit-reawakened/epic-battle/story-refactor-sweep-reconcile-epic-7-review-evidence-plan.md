---
title: 'Reconcile Epic 7 review evidence'
type: chore
ticket: 33
created: '2026-10-30'
status: done
baseline_revision: '95a44313a17afa52d10664960943a754c38f37f6'
route: oneshot
route_source: auto
risk: medium
review: ''
review_source: ''
lenses_ran: []
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Epic 7's closure record predates the review follow-up work and must not be mistaken for current proof of completion.

**Approach:** Add a source-grounded evidence matrix for 7.21–7.32 and explicitly identify outstanding work while retaining historical records and leaving #503 open.

</frozen-after-approval>

## Implementation Notes

One-shot documentary reconciliation; preserve original statuses and historical audit rows. #780 owns subsequent BAT-13-specific reconciliation.

Appended the baseline-pinned inventory to the epic record, retaining the historical audit. All twelve follow-up issues were observed closed; #758 and #503 remain open. Independent review subsequently identified the #746 documentation gap and the need to distinguish BAT-13's approved comparison scope from the literal #751 and parent requirement.

Focused documentary checks before independent review: `git diff --check` passed; inspected the historical table, cited tests for outcomes, AI, background, identifiers, custom fights, encounter, audio and save/load, and the owner rulings in BAT-2, E-74 and BAT-14. PR-to-issue associations were collected from GitHub search.

The subsequent documentary audit compared all twelve issue acceptance criteria with the cited source, regression assertions and owner decisions. The matrix records scope limits and unresolved parent criteria. Independent review found that the #746 rejected alternative was absent from E-74 itself; the owner-approved alternative is now recorded there in doc-only commit `0093ba19`.

## Plan Change Log

- 2026-10-30: Review triage added #805 / 7.34 for #751's unmodified full-state comparison and any required owner ruling; #806 / 7.35 owns #742's lethal-status custom AI attack/move/item combined evidence. Both are Epic 7 children, not prerequisites for this evidence sweep. Parent #503 remains open until all relevant children and actual criteria are verified.
- Corrected live #503 criterion 8 to active-board music under the existing BAT-10 owner ruling (2026-10-26); preserved historical audit rows and all original ticket statuses and plan checkboxes. #780 follows #779 and #753 and is not a prerequisite of this sweep.
- 2026-10-30: Evidence PR #807 merged as `9d50e8aa247184f87d59b93c34efe4bb5b060b31` after independent review of head `1d384693a4990a36d7ff17d9db764f1bb5f94aa1` reported no remaining findings and CI run 41128019807 passed. This metadata change completes 7.33 only; #503 remains open.

## Review Triage Log

| Finding | Disposition and owner |
|---|---|
| #751 normalizes three full-state components | Open: #805 / 7.34 compares unmodified hashes and seeks the owner's decision if contracts conflict. No acceptance criterion was silently changed. |
| #742 tests lethal attack but moves/items separately | Open: #806 / 7.35 owns the real combined-scenario proof; current evidence establishes a coverage gap, not a defect. |
| #503 criterion 8 named `battle.boardKey` | Corrected live parent to active-board music using the explicit 2026-10-26 BAT-10 owner ruling; #758 remains open for the separate audio defect. |
| Parent-wide criteria and closure ordering | #503 closure owner must revalidate its criteria and relevant children, including #805, #806, #758 and later #780. #753 records gaps and does not wait on #780. |
| #743 other-format coverage | The authored PNG UI golden and .tbm/fallback cases provide partial coverage; the #503 closure audit owns the remaining supported-format evidence. |
| #746 rejected alternative missing from E-74 | Fixed doc-first in `0093ba19` using the approved spike decision; no runtime or RNG change. |
| BAT-13 normalized comparison versus literal #751 and parent equality | Clarified: BAT-13 approves the bounded normalized comparison, while #805 owns the distinct literal full-state requirement. |

## Verification

The full local gate was run at `4343828a`: typecheck, lint, test:strict (2,374 passed, none skipped), golden, golden:bun, graph, catalogue:check, command-docs:check, licence, provenance and dump:check all passed. The Bun closing check matched eight baselines, including six expected TK2-support failures. After the E-74 doc-only clarification, `git diff --check 4343828a` and `pnpm command-docs:check` passed.

Inspect each evidence citation against the baseline and current issue status; check the historical rows and prior checkboxes remain intact.
