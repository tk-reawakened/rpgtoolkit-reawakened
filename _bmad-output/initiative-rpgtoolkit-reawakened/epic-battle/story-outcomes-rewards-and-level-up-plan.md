---
title: "Outcomes, rewards and level-up: win, run and lose"
type: 'feature'
ticket: 8
created: '2026-10-19'
status: done
baseline_revision: '4255ec6f520af495d3aa2db8ed2553cb685ea3ab'
risk: "high"
context:
  - "spec - docs/spec/engine/battle.md as ruled by 7.1 (BAT-8, BAT-12)"
  - "spec - docs/spec/engine/plugins-and-battle.md#e-71, #e-77"
  - "spec - docs/spec/engine/movement-and-collision.md#e-78"
  - "spec - docs/spec/engine/rpgcode-modules-and-objects.md (EMIT-13)"
  - "spec - docs/spec/engine/progression-and-levels.md (the default level-up equation, maximum level)"
  - "facts - docs/provenance/facts-round-11.md Q11 to Q13"
---

## Intent

Resolve a battle's outcome and apply the rewards and consequences E-77 and E-78 state, in the order the 3.1 facts record. The package reports the outcome with `battle.finish(code)`; the compatibility adapter of BAT-8 (owner-approved 2026-10-25) applies the automatic paths (run, win, lose) from generic operations, and the package handles the two plugin outcomes (1 and 3). Experience goes to every party member, gold is posted as one inventory effect, level-up uses the 20.6 default, and `defeated` is emitted once per enemy.

## Boundaries

No damage, status or AI (7.5 to 7.7). No inventory implementation: gold is a plain-data effect that Epic 8 consumes. No menus or save UI. The level-up equation and the maximum-level behaviour are `progression-and-levels.md`'s; this entry calls them and does not write a second curve.

## Key Decisions

1. **Who applies what (BAT-8).** Codes 0 (run), 2 (win) and 4 (lose) are automatic: after `finish(code)` the core performs the sequence below using only generic operations (experience award, one gold effect, message path, program run, `reset()`). Codes 1 and 3 are package-handled: the core does nothing. A code outside 0-4 is rejected at `finish`; a second `finish` is `battle.already-finished`.

2. **Run (R11-Q11).** The Run action is blocked for the whole fight if any one enemy forbids running: it is still listed but drawn differently, choosing it plays the cancel sound and keeps the turn. When allowed, one seeded `random(5)` draw succeeds when its result is `<= 2`; under uniform uint32 inputs, the absolute probability deviation from 2/5 is `3/(5*2^32) = 1.39698e-10`. This deviation is accepted without an RNG change. A failed attempt shows a message and spends the turn. A success shows a message and the battle ends at the start of the next pass; later charged players in that pass still have their statuses tick, and if that leaves every player at 0 HP the battle is a loss. Outcome 0 then runs one run program: the last enemy, in encounter order, that has one. No gold, no experience, no `defeated`. On return to the board, its music is read from the active board after `boardReturned` (7.10).

3. **Win (R11-Q12).** Outcome 2 sums every enemy's gold and experience. In this order: post the gold silently as one plain-data inventory effect `{ type: "addGold", amount }`; show the experience message if the total is above 0; give every party member, fallen included and in party order, the **full** experience total, and for each level gained run the level-up program if there is one, apply the 20.6 default stat rise (current HP and SMP are not refilled; FP is a single stat increased by the configured growth, not a separate current/max pair) and show the short level-gained message (not at maximum level); show the gold message if the total is above 0; then run the win program of the last enemy, in encounter order, that has one (only that one). The maximum-level experience retry of 3.1 is not reproduced: the actor owner terminates safely there.

4. **Lose (R11-Q13).** A loss is every player at 0 HP or below, checked between passes before the win check, so a simultaneous fall is a loss. Outcome 4 runs the game-over program if one is registered, and then the engine does **not** reset; without one it shows the game-over message and calls `reset()`. It awards nothing. The battle ends before the program runs so the program sees the board state, not a live battle. In every outcome the board music returns and the scene is redrawn.

5. **`defeated` (BAT-12).** Emitted by the package on each enemy actor the first time it reaches 0 HP, once per enemy per battle, with `{ cause: "damage" | "status" | "script", source: actorId | null }`. The package re-emits it on the game as `stock_battle.defeated` for global listeners (EMIT-8, EMIT-13). A defeated enemy stays in its slot as an inactive fighter; a run emits none; a loss does not emit for the players.

6. **Messages.** The reward, level-up and gold messages go through the existing message path in the order of decision 3. The text is data where the game supplies a format, otherwise the ruled default; the no-enemies message comes from the start path and is not repeated here.

7. **`canRun`.** `canRun` is true only when no enemy forbids running; `battle.finish(0)` while it is false raises the catchable `battle.cannot-run` and leaves the battle running.

## Acceptance

- [x] Seeded win, run, and lose paths produce the ruled outcomes, rewards, and consequences in the win order. Tests: `packages/core/test/battle-outcomes-core.test.ts` — “the core win adapter awards XP, posts one gold effect and runs the enemy win program”; “the core run adapter grants no rewards and runs the enemy run-away program”; “the core loss adapter clears battle before the game-over program and skips reset”; “the core loss adapter uses the message and reset fallback without a game-over program”. `packages/core/test/battle-outcomes-stock.test.ts` — “a stock victory sums XP/gold, rewards fallen and living members, orders level-up growth, and runs only the last win program”; “a successful seeded run skips later turns but ticks later statuses, runs only the last program, and grants no reward”; “a simultaneous player and enemy fall selects loss before victory”.
- [ ] Experience goes in full to every party member, fallen included, and maximum-level members do not loop. The named victory test verifies XP, levels, current HP, maximum HP, and the max-level case, but no named test proves that current SMP remains unchanged; FP is a single stat increased by configured growth, not a current/max pair.
- [ ] Gold is posted exactly once as an inventory state-write effect with payload `{ type: "addGold", amount }`. Tests verify one effect and its summed amount; no named test proves an inventory owner consumes or applies the effect. Tests: `packages/core/test/battle-outcomes-core.test.ts` — “the core win adapter awards XP, posts one gold effect and runs the enemy win program”; `packages/core/test/battle-outcomes-stock.test.ts` — “a stock victory sums XP/gold, rewards fallen and living members, orders level-up growth, and runs only the last win program”.
- [ ] `defeated` fires once per enemy per battle, not on a run, carries the ruled fields, and is re-emitted as `stock_battle.defeated`. The named tests prove each of two distinct enemies emits locally before game re-emission with damage source/payload through event-queue restore, no duplicate after revival, and no actor-local or game-level defeated event on a successful run. Test: `packages/core/test/battle-outcomes-stock.test.ts` — “enemy defeated emits once locally before game re-emission for each enemy, including after event-queue restore”.
- [x] The game-over program runs without a reset, or the message shows and `reset()` is called when none is registered. Tests: `packages/core/test/battle-outcomes-core.test.ts` — “the core loss adapter clears battle before the game-over program and skips reset”; “the core loss adapter uses the message and reset fallback without a game-over program”.
- [x] A forbidden run keeps the turn; a seeded allowed run succeeds on a 2-in-5 result and a failed attempt spends its turn; only one run and one win program run. Tests: `packages/core/test/battle-outcomes-stock.test.ts` — “a forbidden run keeps charge and consumes no random draw”; “a successful seeded run skips later turns but ticks later statuses, runs only the last program, and grants no reward”; “a failed seeded run spends its turn; the run roll is deterministic at both sides of the 2-in-5 boundary”; “a stock victory sums XP/gold, rewards fallen and living members, orders level-up growth, and runs only the last win program”.
- [x] A simultaneous fall of both sides is a loss. Test: `packages/core/test/battle-outcomes-stock.test.ts` — “a simultaneous player and enemy fall selects loss before victory”.

## Verification

Seeded win/run/lose tests, an ordering test for the win sequence, a per-member experience/level-up test (including a maximum-level member), a gold-effect test, a `defeated`-count, payload and re-emit test, a game-over/reset test, a `canRun` and run-chance test, and a simultaneous-fall test. Full suite, typecheck and lint.

## Plan Change Log

- 2026-10-25: reconciled with `battle.md` BAT-8 and BAT-12 and facts round 11: reward order (gold, experience message, level-ups, gold message, one win program); run chance 2 in 5 and a failed run spends the turn; the game-over program replaces the reset; one run and one win program (the last enemy's that has one); the re-emit is `stock_battle.defeated`.

- 2026-10-26 (owner ruling, Jensen; applied by the director): the run implementation is `random(5) <= 2`; the accepted modulo bias is about 1 in 10^10 with no RNG change. Gold uses the `{ type: "addGold", amount }` effect shape, and level growth does not describe FP as a current value.
- 2026-10-26 (calculation clarification, per Main): the owner's earlier “about 1 in 10^10” estimate is an absolute probability deviation from 2/5 of `3/(5*2^32) = 1.39698e-10` under uniform uint32 inputs; the deviation remains accepted with no RNG change.

- 2026-10-26 (evidence wording clarification, per Main): acceptance item 2 describes the inventory payload `{ type: "addGold", amount }`; the named tests assert its shape and summed amount but do not demonstrate consumption by an inventory owner.
