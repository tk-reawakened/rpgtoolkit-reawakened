---
title: "A lethal status still runs the enemy custom AI turn (7.22, #742)"
type: bugfix
ticket: 'bug-a-lethal-status-skips-the-enemy-custom-ai-turn'
created: '2026-10-29'
status: built
baseline_revision: bb7519baec13ea8d9748e2313223b152db0fa8da
route: oneshot
route_source: auto
risk: medium
review: quick
review_source: pinned
lenses_ran: [quick]
review_loop_iteration: 0
context:
  - docs/guardrails.md
  - docs/spec/engine/battle.md
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem.** BAT-6 says a status that takes a fighter to 0 HP does not stop the turn: an enemy with a custom AI program still runs it, while its attacks, moves and items do nothing. The stock package's enemy turn returned at `fighter.hp < 1` before reaching the custom-AI branch, so a lethal status at a charged boundary silently skipped that program.

**Approach.** In `stock/stock_battle/startup.prg`, move the `hp < 1` guard behind the custom-AI branch, so only a fallen enemy without a custom program is refused. A fallen attacker's `attack`, `special` and `item` already refuse a source at 0 HP, so the program runs with no effect. Extend `packages/core/test/battle-ai.test.ts` with the real stock loop: a lethal-status enemy, a living control, and a fallen enemy with a normal AI level.

</frozen-after-approval>

## Implementation Notes

- Repro first, on `bb7519ba` (unfixed), through the real `battle()` loop in `battle-ai.test.ts` (`battle-ai-loop.prg`, enemy `customAi: 1`, one-round `.ste` with `hpAmount`): lethal status (hp 5, amount 5) observed `customcalls = 0`; the otherwise identical living control (hp 20, amount 5) observed `customcalls = 1`.
- Spec is not wrong or silent: BAT-6 already states the rule verbatim, and BAT-7 already fixes the custom program's `source`/`target`. No spec change, so no separate docs commit.
- `performAi` keeps its own `hp < 1` guard, which is the single authority for the built-in levels (including the `ai(level)` hand-off); the turn seam does not repeat it.
- The custom-AI branch must know `customai`, so it sits after `stockBattle.enemyData`. A fallen enemy whose custom AI is off therefore reads its `.ene` once on that turn where the old guard refused first: one cached asset round trip and, for an unreadable file, the ordinary located diagnostic. Accepted as the cost of applying BAT-6, which cannot be decided without the enemy's data.
- Files changed: `stock/stock_battle/startup.prg`, `packages/core/test/battle-ai.test.ts`.
- #743 edits a different region of `startup.prg`; rebase onto `origin/main` before merging if needed.

## Verification

**Commands:**
- `node --test packages/core/test/battle-ai.test.ts` — the new test fails on the unfixed file (`0 !== 1`) and passes with the fix.
- `pnpm fixtures:fetch`, `pnpm typecheck`, `pnpm lint`, `pnpm test:strict`, `pnpm golden`, `pnpm golden:bun`, `pnpm graph`, `pnpm licence`, `pnpm provenance`, `pnpm catalogue:check`, `pnpm command-docs:check` — all green from the worktree root.

## Review Triage Log

Quick lens, one pass, findings: 0 high / 0 medium / 3 low / 0 false / 0 maybe-false.

- `startup.prg:465-481` — a fallen normal-AI enemy now reads its `.ene` and the note claimed the guard sat before that read. **low, patch.** The read is real and unavoidable (BAT-6 cannot be decided without `customai`); the plan note was corrected to record it as an accepted cost.
- `startup.prg:479-481` — the turn-level `hp < 1` guard duplicated `performAi`'s and read as load-bearing. **low, patch.** Removed the duplicate; the comment now names `performAi` as the authority for the built-in levels.
- `battle-ai.test.ts:796-798` — `customcalls === 0` in the level-3 case could never fail. **low, patch.** Dropped the vacuous assertion; the player-HP and enemy-SMP assertions are the discriminating ones.
