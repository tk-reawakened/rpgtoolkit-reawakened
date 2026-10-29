---
title: "Statuses remain after a stock battle ends"
ticket: 21
status: done
---

## Completion Record

Built and merged as PR #761 (`bb7519ba`, "fix(battle): end every participant's statuses with the battle"); issue #741 closed 2026-10-29T15:38:51Z.

- Spec (doc-first, G7): `474a352d` rules that once the final outcome is selected the core outcome adapter removes every status counter from every fighter in either party, after that outcome's own handling and before `battleEnded`, through the actor owner's ordinary removal in file-name order; actors in neither party keep their statuses.
- Code: `14c1335f` applies that rule in the battle outcome adapter, with regression tests in `battle-outcomes-core.test.ts` and `battle-outcomes-stock.test.ts` and the authored fixture `battle-outcome-loop.prg`. `CHANGELOG.md` states the same rule, including handled codes 1 and 3, the same-pass status ticks after a successful escape, and loss taking precedence over escape.
- Verification: PR #761 CI passed all jobs, `unit (core-battle)` in 6m23s.

This plan was created by `tickets.py mark` because the build registered no plan of its own; it records only the merged facts above.
