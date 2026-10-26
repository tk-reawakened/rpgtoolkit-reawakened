---
title: "Test gaps for battle state, API, combat, and AI"
type: 'feature'
ticket: 17
created: '2026-10-26'
status: in-progress
risk: "high"
context:
  - "spec - docs/spec/engine/battle.md (BAT-2–BAT-7)"
  - "spec - docs/spec/engine/rpgcode-functions.md (battle built-ins)"
  - "pull request - #696 (test-gap work in progress)"
  - "spec - docs/spec/engine/progression-and-levels.md"
  - "spec - docs/spec/formats/save-game.md"
---

## Intent

Add real, named deterministic tests for remaining Epic 7.2–7.7 acceptance gaps, leaving already-proven behavior alone and avoiding unrelated source or golden changes.

## Boundaries

Tests only. Do not modify runtime rules, the RNG algorithm, or save goldens; ticket 7.20 owns the battle-section save golden. Do not add source-text guards: the existing API-error/ERR-2 tests and G3 TypeScript lint already cover those behaviors/restrictions.

## Acceptance

- [x] Validator input is unchanged; valid restore has no diagnostics; out-of-battle save has `battle: null`; BattleState contains no actor HP/SMP/status copies. Tests (`packages/core/test/battle-state.test.ts`): “battle validation locates malformed outcomes and non-finite charge without mutating input”; “restoring a valid battle emits no restore.battle-fighter diagnostics”; “an out-of-battle serialized snapshot contains battle: null”; “battle state snapshots preserve fighters, charge and outcome in the canonical hash” (no hp/smp/status copies; statuses stay on the actor).
- [x] Registered battle built-ins are checked against the catalogue and docs. Evidence: the existing CI gate `pnpm command-docs:check` (`tools/command-docs/check.mjs`, which includes `BATTLE_PLUGIN` and parses `docs/spec/engine/rpgcode-functions.md`) fails on a registered command without `doc` (`doc.required`) and on registered summary text differing from its spec row (`native.summary-mismatch`); `pnpm command-docs:test` covers the checker. No duplicate test added. Not enforced by it: that every registered public command has a spec row at all.
- [x] Cover SMP attack underflow, AOE actions without critical draws, non-empty inventory immutability, special availability/status order, and exactly-once `fallen` for lethal Fight/Special/Item. Tests (`packages/core/test/battle-actions.test.ts`): “attackAmount clamps an SMP-pool underflow at zero”; “attackall and drainall ignore active critical limits and consume no random draws”; “using an item leaves an existing inventory list unchanged”; “a special move applies its status after the move program runs”; “a lethal Fight fires fallen exactly once”; “a lethal Special Move fires fallen exactly once”; “a damaging item fires fallen exactly once”; “availableSpecials filters unaffordable moves…” (`battle-ai.test.ts`).
- [x] Cover status HP/SMP/program/aging order, actor-owned status state, and both signed effect bounds. Tests (`packages/core/test/battle-loop.test.ts`): “status programs observe HP and SMP effects before the counter ages”; “signed status amounts heal and damage while clamping HP and SMP at both bounds”; actor-owned status state is asserted in the `battle-state.test.ts` snapshot test above.
- [x] Cover level-0/2 healing AI, post-target draw order, and AI configuration ownership. Tests (`packages/core/test/battle-ai.test.ts`): “healing specials choose living allies by level and may target an already-full ally”; “enemy AI pins coin, special pick, target, and post-target combat draw order”; “ai(level) handoff leaves another enemy's level-three behavior unchanged”.
- [x] Do not duplicate the existing atomic `battle.bad-fighter`/`battle.bad-outcome` or ERR-2 continuation tests; no static source-text guard or golden changes. Verified by absence: no new API-error, ERR-2, source-text or golden test was added.

## Verification

Run focused battle state/snapshot, API/catalogue, actions, loop/status, and AI tests. Do not add static source-text assertions; existing tests cover API errors and ERR-2 continuation, and G3 lint covers restricted TypeScript APIs. Run repository checks in the main verification pass.

## Plan Change Log

- 2026-10-26: created to cover the audit's remaining test gaps for Epic 7.2–7.7.
- 2026-10-27: removed duplicate API-error/ERR-2 tests and the static source-text guard from the planned work.
- 2026-10-27: reconciled against merged PR #696 and the existing `command-docs:check` gate; every acceptance item now cites its test or check.
