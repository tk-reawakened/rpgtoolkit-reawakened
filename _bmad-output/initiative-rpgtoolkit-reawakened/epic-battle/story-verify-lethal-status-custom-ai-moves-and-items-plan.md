---
title: "Verify lethal-status custom AI moves and items"
type: 'feature'
ticket: 35
created: '2026-10-30'
status: 'done'
baseline_revision: '2573a98d7bb27d94c6570d511ae23b777056215d'
route: 'full'
route_source: 'pinned'
risk: 'medium'
review: 'thorough'
review_source: 'pinned'
lenses_ran: []
review_loop_iteration: 0
context:
  - /private/tmp/tkr-806/docs/spec/engine/battle.md
  - /private/tmp/tkr-806/docs/guardrails.md
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** #742 proved that an enemy killed by its status at the charged boundary still runs custom AI and cannot attack, but its move and item refusals were only tested in separate action-level cases. The combined real-turn evidence requested by #806 is missing; no runtime defect is currently established.

**Approach:** Extend the authored custom-AI fixture and drive it through the actual stock `battle()` loop with deterministic lethal and living-control cases. Prove attack, special move and item outcomes independently; change runtime code only if the real path reproduces a BAT-6 violation.

## Boundaries & Constraints

**Always:** Follow BAT-6/BAT-7; assert one custom-AI execution at the charged boundary; show each action works in the living control; preserve deterministic setup and #742 behavior.

**Never:** Alter the ruled behavior, rewrite historical ticket status, weaken unrelated checks, modify the residual #742 worktree, or make runtime changes without a reproduced failure.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Lethal status | Living custom-AI enemy at charge 123; one-round status takes HP to 0; custom program attempts attack, special and item | AI runs exactly once; target HP/SMP, enemy SMP and inventory remain unchanged by all three actions | Any action effect is a BAT-6 regression; fix only that reproduced path and retain a regression assertion |
| Living control | Same authored action program and assets; enemy survives its status tick | Attack damages a target; move damages/drains its target and spends source SMP; item heals its target and consumes one inventory unit | Deterministic fixed seed and authored assets; fail on missing evidence |

</frozen-after-approval>

## Code Map

- `packages/core/test/battle-ai.test.ts` loads `stock/stock_battle/startup.prg`, installs its `stock_battle` package, and uses `battle-ai-loop.prg` (`battle()`) to run the actual stock loop. Existing `runChargedPass` at lines 761–800 covers lethal status, one custom-AI attack, and a living control.
- `packages/core/test/fixtures/authored/battle-ai-custom.prg` is the custom-AI program; its current `attack` mode resolves `source`/`target` and calls `stockBattle.attack`. Extend with one mode that attempts all three actions in the same call and records per-action observations.
- `stock/stock_battle/startup.prg:449-480` runs custom AI after status damage; `:486-621` contains attack, special and item entry points, each with a fallen-source guard. Reuse them; do not duplicate battle logic.
- `packages/core/test/battle-actions.test.ts:252-285` shows the inventory-owner adapter needed to apply `battleconsume`; its authored item and special-move asset helpers establish the repository pattern.
- `docs/spec/engine/battle.md#bat-6` requires fallen actors' attacks, moves and items to do nothing while custom AI still runs; BAT-7 defines the custom program turn. `_bmad-output/initiative-rpgtoolkit-reawakened/epic-battle/epic-battle.md:95` records this precise remaining evidence gap.

## Tasks & Acceptance

**Execution:**
- [ ] `packages/core/test/fixtures/authored/battle-ai-custom.prg` -- add a deterministic mode that attempts attack, move and item in one custom-AI turn and stores intermediate target/resource observations.
- [ ] `packages/core/test/battle-ai.test.ts` -- extend the charged-pass test with the real stock loop, authored action assets, inventory owner application and lethal/living cases; assert exactly one AI call, unchanged lethal-case targets/resources/inventory, and each action's effective living-control result.
- [ ] `packages/core/test/battle-ai.test.ts` -- run the new test by itself and keep it under the repository's one-second ordinary-test limit; no sleeps or timing assertions.
- [ ] `_bmad-output/initiative-rpgtoolkit-reawakened/epic-battle/epic-battle.md` -- update only the #806 evidence row after observed verification, preserving the historical #742 record and parent-closure caveats.

**Acceptance Criteria:**
- Given a status-bearing custom-AI enemy alive when its turn begins, when the real stock loop processes the status at charge 123 and the status lowers HP to zero, then its custom AI runs exactly once and attempted attack, special and item cause no target, resource or inventory effect.
- Given the same fixed-seed action program and available assets with an enemy that survives the status tick, when that turn runs, then attack, special and item each produce their intended target/resource effect and the item owner consumes exactly one unit.
- Given either scenario, when the fixture is replayed from the same seed and state, then the same per-action outcomes are observed; existing #742 acceptance remains intact.

## Implementation Notes

Planning confirms the stock loop already calls the custom program after the status tick and each stock action has an HP guard. The inventory test path requires an owner adapter; a missing adapter must not be mistaken for item behavior. First run the new actual-loop test. If it passes, keep the change test/evidence-only; if it fails, isolate the failed action and repair only the reproduced BAT-6 defect.
- 2026-10-30: The focused real-stock-loop case passed (139 ms for the new combined test). It proves one custom-AI call, no attack/move/item target or resource effects and no inventory consumption for the status-lethal source; the living control proves each action works and consumes one item. Both scenarios replay identically with the same seed. No runtime defect reproduced, so no runtime code changed.
- Full local verification passed: typecheck, lint, fixture fetch/strict suite (2,394/2,394, no skips), authored fixture check/test, headless golden, Bun golden/closing, dependency graph, licence, provenance, catalogue, command-docs, and closing.

## Plan Change Log


## Review Triage Log


## Design Notes

Record observations immediately after each attempted action so a later action cannot mask an earlier action's result. Capture item consumption through the existing inventory owner rather than inferring it from the script call. The actual turn's AI call counter plus the normal stock package's `battle()` entry prove the behavior is not a copied test loop.

## Verification

**Commands:**
- `node --test packages/core/test/battle-ai.test.ts` -- targeted stock-loop tests pass; inspect the new test's reported duration.
- `pnpm test` -- full unit suite and TypeScript build pass.
- `pnpm run lint`, `pnpm run graph`, `pnpm run fixtures:author:check`, `pnpm run fixtures:test`, `pnpm run golden`, `pnpm run golden:bun`, `pnpm run licence`, `pnpm run provenance`, `pnpm run catalogue:check`, `pnpm run command-docs:check`, and `pnpm run closing` -- required repository CI checks pass; observe each result before enabling auto-merge.

**Manual checks:**
- Inspect the final diff to verify only the three requested actions and their living controls were added, no runtime change was made without a reproduced failure, and no legacy GPL source was opened.
