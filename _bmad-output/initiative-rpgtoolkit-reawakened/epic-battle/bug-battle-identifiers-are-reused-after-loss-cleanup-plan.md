---
title: 'Battle identifiers are never reused within one run'
type: 'chore'
ticket: 24
created: '2026-10-29'
status: done
baseline_revision: '0174eb5f'
route: 'full'
route_source: 'auto'
risk: 'medium'
review: 'quick'
review_source: 'pinned'
lenses_ran: [quick]
review_loop_iteration: 0
context:
  - 'docs/guardrails.md'
  - 'docs/spec/engine/battle.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `start()` computes the next battle identifier from the live `battle` section (`packages/core/src/battle/port.ts:123-124`). Loss cleanup commits `null` (`endLoss`, `:176-181`), so a game-over program that starts another battle in the same run receives an identifier already used. Reproduced (raw output, current `origin/main`): `PROBE status=finished first=1 second=1 outcome=null gameOver=1 diagnostics=[]`.

**Approach:** Give the battle owner a run-scoped counter that survives loss cleanup: an optional plain-data `nextBattleId` in the saved `engine` section, following the existing `nextRequestId` precedent (optional engine fields need no schema bump). `start()` takes that counter and advances it; failure paths consume no identifier. Document the counter and its run lifetime in BAT-2 first, as its own commit.

## Boundaries & Constraints

**Always:** Uniqueness within a run is the contract, not monotonicity — tests assert "differs from every identifier already used", never `id2 = id1 + 1`. The counter is plain JSON data (G1/G3); no `Date`, randomness, module-level mutable state or host handles. `battle` stays `null` when no battle is active (BAT-2). `reset()` is the only run boundary.

**Never:** Do not add a 21st top-level state section (AD-10), bump a section schema version, or change the `battle` section shape. Do not touch `stock/stock_battle/**`, `battle-outcomes-stock.test.ts`, `battle-custom-fight.test.ts` or BAT-3's mapping rows (peer owns them). No legacy GPL source (G7).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| FIRST_START | fresh state, no counter, no battle | identifier `1`; counter becomes `2` | No error |
| AFTER_LOSS | battle `1` ended by `endLoss()`, then `start()` | identifier ≠ `1` | No error |
| RESTORE_IDLE | save/restore with `battle: null` and counter `2` | next identifier `2` (same run) | No error |
| AFTER_RESET | engine `reset()` after a battle | numbering restarts at `1` (new run) | No error |
| LEGACY_SAVE | save without `nextBattleId`, battle `id: 7` | identifier `8`; no reuse after that | No error |
| BAD_COUNTER | restored `engine.nextBattleId` not a positive safe integer | load refused with located `restore.shape` | `restore.shape` |

</frozen-after-approval>

## Code Map

- `packages/core/src/battle/port.ts:47-55` -- `BattleOwnerStore`; add required `readBattleCounter(): number | undefined` and `commitBattleCounter(next: number): void`. `:123-124` is the defective id derivation.
- `packages/core/src/battle/port.ts:106-130` -- `start()`: derive, guard, commit counter with the section.
- `packages/core/src/script/vm.ts:344-349` -- production store over `state`; back it with `state.engine.nextBattleId`.
- `packages/core/src/script/virtuals.ts:89-93` -- the default owner's store; same wiring.
- `packages/core/src/save/sections/engine.ts:46-70` -- add `readonly nextBattleId?: number` beside `nextRequestId`.
- `packages/core/src/save/snapshot.ts:776-790` (`validateShape`) -- validate an optional `engine.nextBattleId` as a positive safe integer.
- `packages/core/test/zz-744-probe.test.ts` -- the verified repro (temporary; it was deleted once the permanent tests landed): harness pattern for the end-to-end test — `createScriptServices` + `startProgram(inline "battle.finish(4)")` + `advanceScriptTick` with a poll answering `__battle_start_enemy_asset`, and a game-over program that calls `__battle_prepare_enemies("slime.ene", "")`.
- Tests: `packages/core/test/battle-api.test.ts:66-110` (owner store literals; `makeState`), `packages/core/test/battle-state.test.ts` (save/restore + canonical hash), `packages/core/test/battle-outcomes-core.test.ts:75-120` (`makeState`, `runOutcome`), `packages/core/test/battle-save-golden.test.ts:17-35` (store literal + goldens `fixtures/save/battle-v2-*.json`), `packages/core/test/battle-cues.test.ts:427`, `battle-loop.test.ts:170`, `media-objects.test.ts:249`, `battle-ai.test.ts:344` (store literals to extend).
- `docs/spec/engine/battle.md:35-52` -- BAT-2 rule paragraph; do not edit BAT-3.

## Tasks & Acceptance

**Execution:**
- [ ] `docs/spec/engine/battle.md` -- add the BAT-2 "battle numbers" paragraph (storage, advance rule, run lifetime incl. the dated decision and the legacy-save fallback) -- spec-first, cites BAT-2.
- [ ] `packages/core/src/save/sections/engine.ts`, `packages/core/src/battle/port.ts`, `packages/core/src/script/vm.ts`, `packages/core/src/script/virtuals.ts` -- implement the counter and advance it in `start()` -- the fix.
- [ ] `packages/core/src/save/snapshot.ts` -- shape-check an optional `engine.nextBattleId` -- refuse a corrupt counter at load.
- [ ] `packages/core/test/battle-outcomes-core.test.ts` + new fixture `fixtures/authored/battle-outcome-game-over-restart.prg` -- end-to-end regression: start battle, lose it through the adapter, game-over program starts another, assert the identifier is unused -- ticket reproduction.
- [ ] `packages/core/test/battle-api.test.ts` -- owner-level loss then start -- direct contract.
- [ ] `packages/core/test/battle-state.test.ts` -- save/restore with no active battle keeps numbering; engine `reset()` restarts it -- settles the lifetime decision.
- [ ] Extend the remaining `createBattleOwner` store literals (`battle-save-golden`, `battle-cues`, `battle-loop`, `media-objects`, `battle-ai`) -- keep them compiling with the new store fields.
- [ ] `packages/core/test/fixtures/save/battle-v2-mid.json` -- regenerate only if the persisted shape changes (a mid-battle save now carries `engine.nextBattleId`), and say why in the commit -- G5.
- [ ] Delete `packages/core/test/zz-744-probe.test.ts` -- the permanent tests replace it.

**Acceptance Criteria:**
- Given a battle that ended by loss cleanup, when a game-over program starts another battle before returning, then its identifier differs from every identifier used earlier in the run.
- Given a save with no active battle, when it is restored and a battle starts, then the identifier continues the run's numbering.
- Given an explicit engine reset, when a battle starts, then numbering restarts at `1`.
- Given the full gate list, when run from the worktree root, then every gate passes.

## Implementation Notes

- 2026-10-29 — Repro first, on unfixed `origin/main` (probe, raw output): `PROBE status=finished first=1 second=1 outcome=null gameOver=1 diagnostics=[]` — a game-over program that starts another battle after loss cleanup received the identifier already used. With only the id derivation reverted to the old line, the new tests fail: `battle identifier 1 reuses 1 in one run` (owner-level), `battle identifier 1 reuses the earlier 1 in one run` (loss adapter), `a restored game continues its numbering` (save/restore).
- 2026-10-29 — Dated decision, as planned: a run is the engine's lifetime. `reset()`/lifecycle restart restarts numbering at `1`; save/restore continues it. Recorded in BAT-2 ("Battle numbers") and here.
- `packages/core/src/engine/engine.ts:963` — `syncEngineState()` rebuilds the `engine` section every tick, so it now carries `nextBattleId` through; without that the counter would vanish on the next sync and a mid-battle save would not carry it. The only addition beyond the Code Map.
- `start()` also refuses when `id + 1` would leave the safe-integer range, so a persisted counter is always a positive safe integer.
- G5: `fixtures/save/battle-v2-mid.json` was regenerated once. Structural diff against the previous fixture is exactly `added /engine/nextBattleId = 2`; no section schema version moved and `battle-v2-out.json` is untouched. `battle-save-golden.test.ts` now expects `["battle", "engine"]` to differ and pins both counter values.
- Tests: no wall-clock assertions; the added tests run in single-digit milliseconds inside the existing suites.

## Review Triage Log

Review pass 1 (2026-10-29, lens `quick`, 3 findings, none `false`/`maybe-false`):

| # | Finding | Verdict | Route | Action / evidence |
|---|---|---|---|---|
| 1 | `docs/spec/engine/battle.md:50` — the new "Battle numbers" paragraph sat between BAT-2's rule and BAT-2's own `*Evidence:*` line, so that evidence read as the counter rule's. | low | patch | Checked BAT-3/BAT-8/BAT-13/BAT-15: each rule closes with its own evidence. Added the counter rule's own `*Evidence:*`/`*Rejected:*` line and left BAT-2's line adjacent to the rule it documents. |
| 2 | `packages/core/test/battle-save-golden.test.ts:53` — test name still said the saves differ "only under `battle`" while the assertion requires `["battle", "engine"]`. | low | patch | Renamed the test to name the engine run counter too; the golden message now reports what actually drifted. |
| 3 | `CHANGELOG.md` — no Unreleased entry for a persisted-shape change (mid-battle saves now carry `engine.nextBattleId`; the save fixture was regenerated). | low | patch | Added one plain-language Unreleased bullet stating the fix, the run lifetime and the regenerated fixture. |

## Design Notes

Dated decision (2026-10-29, this ticket): **a run is the engine's lifetime.** `reset()` (and any lifecycle restart that rebuilds the engine section, such as a main-file change) ends a run, so numbering restarts at `1`; a save/restore does not end a run, because the counter is ordinary save data, so a restored game continues its numbering with or without an active battle. A pre-#744 save has no counter: the next battle takes one past the active battle's `id`, or `1` when no battle is active — the best that older data allows.

`start()` uses `Math.max(counter ?? 1, activeId + 1)` so a counter that lags a live section can never reuse that section's identifier.

## Verification

**Commands:**
- `pnpm test` (or `node --test packages/core/test/battle-*.test.ts`) -- expected: the new tests pass, the probe deleted.
- `pnpm typecheck`, `pnpm lint`, `pnpm test:strict`, `pnpm golden`, `pnpm golden:bun`, `pnpm graph`, `pnpm licence`, `pnpm provenance`, `pnpm catalogue:check`, `pnpm command-docs:check` -- expected: all green.

## Plan Change Log

- 2026-10-29 (ledger chore): frontmatter repaired after the build — `type: 'bugfix'` → `type: 'chore'` and `ticket: '24'` → `ticket: 24` (bare entry id); plan content unchanged. `tickets.py status` reported entry 24 as `review`/`built` with no `problems` or `drift` both before and after the repair.
- 2026-10-29 (completed): marked done after PR #765 (`40e62db5`) merged; issue #744 closed 2026-10-29T16:24:48Z. The run-scoped `engine.nextBattleId` counter, the BAT-2 rule (`a2adcff5`, spec-first) and the one deliberate G5 golden regeneration of `fixtures/save/battle-v2-mid.json` (only `/engine/nextBattleId` added) are recorded in the PR; `unit (core-battle)` was green.
