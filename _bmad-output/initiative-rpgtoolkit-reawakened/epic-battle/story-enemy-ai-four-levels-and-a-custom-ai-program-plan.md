---
title: "Enemy AI: four levels and a custom AI program"
type: 'feature'
ticket: 7
created: '2026-10-19'
status: done
baseline_revision: '4255ec6f520af495d3aa2db8ed2553cb685ea3ab'
risk: "medium"
context:
  - "spec - docs/spec/engine/battle.md as ruled by 7.1 (BAT-7)"
  - "spec - docs/spec/engine/plugins-and-battle.md#e-76"
  - "facts - docs/provenance/facts-round-11.md Q8 to Q10"
  - "code - packages/core/src/spine/rng.ts (the seeded shared RNG)"
---

## Intent

Implement E-76's four enemy AI levels and the custom `useCode` AI program in the stock package, so an enemy chooses a target and an action deterministically from the seeded stream. The `ai(level)` built-in sets the acting enemy's level for that turn.

## Boundaries

No damage or status application (7.5, 7.6). AI chooses; the action code applies. No UI. The custom program runs with the same battle API as any other script and cannot reach package internals.

## Key Decisions

1. **Levels 0-3 (R11-Q8).** 0: a fair coin; heads an ordinary attack on a random living player, tails try a special move. 1: always try a special move, targets random. 2: like 0 with the weakest target. 3: like 1 with the weakest target. Enemies never defend or rest. The levels are transcribed into `battle.md#bat-7`.

2. **Trying a special.** Choose with equal chances among the enemy's specials whose cost is at most its current SMP; the "usable in battle" flag is not checked. If none qualifies, make an ordinary attack with the same target rule.

3. **Draw order (a Reawakened choice).** The coin (one seeded draw from {0, 1}, levels 0 and 2 only), then the special pick, then the target, then the combat draws of 7.5. A test pins the sequence so a refactor cannot silently change outcomes.

4. **Weakest and ties.** "Weakest" is the living player with the lowest current HP (not the lowest share of maximum); a tie goes to the earlier party position; fallen fighters are skipped and never targeted. If no living player remains the AI turn is skipped (3.1 divides by zero here and that is not reproduced); the outcome path (7.8) resolves the battle.

5. **Healing specials.** FP below 0 is healing, FP of exactly 0 is harmful. A healing special goes to the enemy's own side: at levels 0 and 1 a random living ally (possibly the enemy itself or an ally at full HP), at levels 2 and 3 the living ally with the lowest current HP. A harmful special targets the player chosen by the level's target rule.

6. **Custom `useCode` (R11-Q10).** The program runs with `source` = the enemy and `target` = a random living player, and nothing else happens: it must act itself through the same API (attack, special, item) or hand over to a built-in level, and it may choose another target. A program that returns without acting spends the turn and the charge returns to 0. An unhandled error is reported and, per ERR-2, the program continues at its next step; the enemy's turn ends when the program returns.

7. **Level input.** `ai(level)` validates 0-3 and sets the level on the acting enemy; a level outside the range is a catchable error (3.1 silently did nothing). A custom `useCode` program takes precedence over the level's table for that enemy.

## Acceptance

- [x] Each of the four levels makes the ruled choices over a seeded run, including the coin, special-first and weakest-target cases. Test: `battle-ai.test.ts` — “all four AI levels follow their coin, special and target boundaries across seeds”.
- [x] An unaffordable special falls back to a physical attack; healing specials choose the ruled allies by level; harmful specials target players. Tests: `battle-ai.test.ts` — “affordable specials are chosen equally, unaffordable moves are filtered, and no affordable move falls back to attack”; “healing specials choose living allies by level and may target an already-full ally”; “zero-FP moves are harmful and target players”.
- [x] A custom AI program receives source/target, can act or hand off, and ERR-2 continues after errors; the enemy's turn ends when the program returns; a no-op custom program spends its turn. Tests: `battle-ai.test.ts` — “custom AI receives source/target handles, can act or hand off, and ERR-2 continues after errors”; “a no-op custom AI spends its turn without an automatic attack”.
- [x] Every draw is in the ruled order and weakest-target ties are deterministic. Tests: `battle-ai.test.ts` — “all four AI levels follow their coin, special and target boundaries across seeds”; “weak-target ties preserve earlier party position and no living player draws no RNG”.
- [ ] `ai(level)` validates its argument and applies to the acting enemy only. The named custom-AI test asserts `ai(4)` raises `builtin.bad-arg`, but no named test proves the level change affects only the acting enemy.
- [x] With no living player the AI skips its turn without division by zero. Test: `battle-ai.test.ts` — “weak-target ties preserve earlier party position and no living player draws no RNG”.
- [ ] No unseeded randomness or wall clock is used. The named equal-seed test compares decision hashes, but no test asserts that those APIs are absent.

## Verification

A seeded per-level choice test, an affordability test, a healing/harmful target test, a tie-break test, a no-living-player test, a custom-program test (success, no-op and error), and an `ai()` argument test. Full suite, typecheck and lint.

## Plan Change Log

- 2026-10-25: reconciled with `battle.md` BAT-7 and facts round 11: level 1 targets randomly; healing targets differ by level; the coin and draw order; skipped turn when no player is left; `ai()` rejects an out-of-range level.

- 2026-10-26 (owner ruling, Jensen; applied by the director): a custom-AI error follows ERR-2, so an unhandled error is reported and the program continues; the enemy turn ends when the program returns.
