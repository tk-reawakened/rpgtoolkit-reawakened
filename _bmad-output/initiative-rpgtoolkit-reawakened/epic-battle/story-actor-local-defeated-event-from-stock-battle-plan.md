---
title: "Actor-local defeated event from stock_battle"
type: 'feature'
ticket: 15
created: '2026-10-26'
status: done
risk: "high"
context:
  - "spec - docs/spec/engine/battle.md#bat-12"
  - "spec - docs/spec/engine/rpgcode-modules-and-objects.md#emit-13"
  - "issue - #511 (outcomes, rewards and level-up)"
  - "pull request - #693 (merged actor-local damage/status, queue-restore, and run coverage)"
---

## Intent

Finish the only remaining BAT-12/EMIT-13 test gap: a script-caused lethal enemy update must exercise the actor-local event and its existing package-level re-emission. PR #693 covers the other causes and the shared delivery semantics; keep this follow-up narrow.

## Boundaries

Add only the lethal script-cause case. Do not repeat damage/status, event ordering, queue restore, revival deduplication, or run behavior already proved by #693. Do not add a core battle loop or change the event contract.

## Acceptance

- [ ] A named authored-RPGCode test causes an enemy's first lethal stat update with `cause: "script"` and an actor-id source, then captures actor-local and game-level event details.
- [ ] Each captured detail deep-equals exactly `{ cause: "script", source: actorId }`, and each listener receives exactly one event.
- [ ] Existing #693 tests cover damage/status causes, ordering, restore, revival deduplication, and run suppression; do not duplicate them.
- [ ] Event ownership remains in stock_battle; core remains battle-agnostic.

## Verification

Run the focused actor-event test and stock outcome tests. The new test uses the real authored RPGCode event path and checks exact payloads and counts; rely on merged #693 for the other causes and restore/run coverage.

## Plan Change Log

- 2026-10-26: created as Epic 7 follow-up to BAT-12/EMIT-13 and issue #511 acceptance gaps.
- 2026-10-27: narrowed the acceptance after merged PR #693; only the script-cause event path remains.
- 2026-10-28: marked done after PR #698 (`541bfeff`) merged and closed #687 COMPLETED; the authored `hp(battle.fighter(0,0), 0)` test asserts one actor-local and one game-level `stock_battle.defeated` event with cause `script` and a null source, and event ownership stays in `stock/stock_battle/startup.prg`.
