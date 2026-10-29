---
title: "A lethal status skips the enemy custom AI turn"
ticket: 22
status: done
---

## Completion Record

Built and merged as PR #764 (`802772f9`, "fix(battle): run a fallen enemy's custom AI turn"); issue #742 closed 2026-10-29T16:06:14Z.

- Code: the stock turn seam no longer returns early for a fighter at 0 HP, so an enemy brought down by its own status still runs its custom AI program on its charged turn; the action guards refuse a fallen fighter's attacks, moves and items, and the built-in AI levels refuse a fallen fighter.
- Tests: `battle-ai.test.ts` covers the custom-AI turn for a status-lethal enemy with a living control, and `battle-actions.test.ts` covers the fallen-source action refusals.
- Verification: PR #764 CI passed all jobs, `unit (core-battle)` in 5m13s.

This plan was created by `tickets.py mark` because the build registered no plan of its own; it records only the merged facts above.
