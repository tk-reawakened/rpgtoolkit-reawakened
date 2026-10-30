---
title: 'Reconcile Epic 7 review evidence'
type: chore
ticket: 33
created: '2026-10-30'
status: in-review
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

Appended the baseline-pinned inventory to the epic record, retaining the historical audit. All twelve follow-up issues were observed closed; #758 and #503 remain open. The director will arrange independent review; no review is claimed here.

Focused documentary checks: `git diff --check` passed; inspected the historical table, cited tests for outcomes, AI, background, identifiers, custom fights, encounter, audio and save/load, and the owner rulings in BAT-2, E-74 and BAT-14. PR-to-issue associations were collected from GitHub search. The complete detailed assertion-by-assertion audit remains for independent review.

Subsequent documentary audit compared all twelve issue acceptance criteria with the cited source, regression assertions and owner decisions. The matrix names scope limits, including #751's normalized rather than literal whole-state hash comparison, #742's separately tested fallen moves/items, and #743's control not covering every other format. Parent criteria not fully revalidated are explicitly listed. Independent review remains pending.

## Plan Change Log

- 2026-10-30: Review triage added #805 / 7.34 for #751's unmodified full-state comparison and any required owner ruling; #806 / 7.35 owns #742's lethal-status custom AI attack/move/item combined evidence. Both are Epic 7 children, not prerequisites for this evidence sweep. Parent #503 remains open until all relevant children and actual criteria are verified.
- Corrected live #503 criterion 8 to active-board music under the existing BAT-10 owner ruling (2026-10-26); preserved historical audit rows and all original ticket statuses and plan checkboxes. #780 follows #779 and #753 and is not a prerequisite of this sweep.

## Review Triage Log

| Finding | Disposition and owner |
|---|---|
| #751 normalizes three full-state components | Open: #805 / 7.34 compares unmodified hashes and seeks the owner's decision if contracts conflict. No acceptance criterion was silently changed. |
| #742 tests lethal attack but moves/items separately | Open: #806 / 7.35 owns the real combined-scenario proof; current evidence establishes a coverage gap, not a defect. |
| #503 criterion 8 named `battle.boardKey` | Corrected live parent to active-board music using the explicit 2026-10-26 BAT-10 owner ruling; #758 remains open for the separate audio defect. |
| Parent-wide criteria and closure ordering | #503 closure owner must revalidate its criteria and relevant children, including #805, #806, #758 and later #780. #753 records gaps and does not wait on #780. |
| #743 other-format coverage | The authored PNG UI golden and .tbm/fallback cases provide partial coverage; the #503 closure audit owns the remaining supported-format evidence. |

## Verification

Inspect each evidence citation against the baseline and current issue status; check the historical rows and prior checkboxes remain intact.
