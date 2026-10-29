---
title: 'Complete battle event-contract regression coverage (7.30, #750)'
type: 'chore'
ticket: 30
created: '2026-10-29'
status: done
baseline_revision: '802772f92a77611346cb1aa1385d1411a9ea5205'
route: 'oneshot'
route_source: 'auto'
risk: 'medium'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 1
context:
  - "guardrails - docs/guardrails.md"
  - "spec - docs/spec/engine/battle.md#bat-12"
  - "spec - docs/spec/engine/rpgcode-modules-and-objects.md#emit-13"
  - "issue - #750 (7.30, complete battle event-contract regression coverage)"
  - "plan - _bmad-output/initiative-rpgtoolkit-reawakened/epic-battle/story-complete-battle-event-contract-regression-coverage.md"
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The ruled `defeated` and `beforeDamage` event contracts (BAT-12, EMIT-13) are only partly regression-tested. The stock outcome test reads `cause`/`source` but never checks that the detail carries exactly those keys; the authored no-stock custom fight fixture emits `{ actorId }`, which is not the ruled `{ cause, source }` shape, and nothing proves a custom loop suppresses the stock package's game-level re-emission; the damage test covers physical, special, drain and multi-target paths but not the owner HP/SMP clamp boundary under listener mutation, nor the item-origin path.

**Approach:** Extend the existing behavioural tests in place. Assert the exact own-key set of each real event detail (obtained from a real battle event, never echoed from a constant), fix the authored custom fixture to emit the ruled `{ cause, source }`, and add clamp-boundary mutation plus an item-origin cancelable-dispatch case that go through the package's own damage seam.

</frozen-after-approval>

## Tasks & Acceptance

**Execution:**
- [x] `packages/core/test/battle-outcomes-stock.test.ts` -- capture the local and game `defeated` detail handles in the observed-listeners fixture and assert each own-key set is exactly `cause`, `source`, keeping the existing one-local-then-one-game ordering and known-actor-id source assertions.
- [x] `packages/core/test/fixtures/authored/battle-main-file-custom-fight.prg` -- emit the ruled `{ cause: "script", source: hero.id }` from both enemies, record the detail handles and a game-level `stock_battle.defeated` counter.
- [x] `packages/core/test/battle-custom-fight.test.ts` -- in the main-file all-API run, assert both local details carry exactly `cause`/`source` with the hero's real actor id as source and that no game-level `stock_battle.defeated` was emitted with stock absent or replaced.
- [x] `packages/core/test/fixtures/authored/battle-damage.prg` -- capture the plain `beforeDamage` detail and its pre-mutation `damage`, and add one HP target and one SMP target whose listener mutates the amount past the owner clamp.
- [x] `packages/core/test/battle-damage.test.ts` -- assert `beforeDamage`'s exact `source`/`target`/`damage` keys and values, and that a mutated over-boundary amount is clamped by the actor owner (HP and SMP) while the package reports the applied amount.
- [x] `packages/core/test/fixtures/authored/battle-actions.prg` -- add an `itemdispatch` scenario that listens on `beforeDamage` around `stockBattle.item`, recording the detail and optionally mutating or cancelling it.
- [x] `packages/core/test/battle-actions.test.ts` -- assert exactly one cancelable `beforeDamage` dispatch for an item-origin action with the exact detail, that a mutation past the maximum heals only to the maximum, and that cancellation leaves the target unchanged.

**Acceptance Criteria:**
- Given a stock battle where an enemy first reaches 0 HP, when its `fallen` is observed, then the local `defeated` detail has exactly the own keys `cause` and `source`, `cause` is `damage`, `source` is the attacking player's actor id, and exactly one `stock_battle.defeated` follows with the same exact keys.
- Given a custom fight program run with `stock_battle` absent (and present-but-replaced), when it emits `defeated` itself, then each local detail has exactly `cause` and `source` with the hero's real actor id, and no `stock_battle.defeated` reaches the game.
- Given a stock damage operation with a listener, then the `beforeDamage` detail has exactly `source`, `target` and `damage`; a mutated amount beyond the target's HP or SMP is clamped at 0 by the owner and the returned applied amount is what actually moved.
- Given an item-origin damage operation, then exactly one cancelable `beforeDamage` is dispatched, its detail names the user, the target and the item's negative amount, a mutation past the maximum heals only to the maximum, and a cancellation leaves the target's stats untouched.

## Implementation Notes

Files changed: `packages/core/test/battle-outcomes-stock.test.ts` and `battle-custom-fight.test.ts` (exact detail keys read from the live VM object the listener kept), `battle-damage.test.ts` (exact `beforeDamage` detail plus HP/SMP clamp-boundary mutation), `battle-actions.test.ts` (item-origin single cancelable dispatch, mutation past the maximum, cancellation), the three authored fixtures (`battle-damage.prg`, `battle-actions.prg`, `battle-main-file-custom-fight.prg`), `CHANGELOG.md`, and this plan.

Surprise: the custom-fight projection hash compared globals holding event-detail object handles, whose handle numbers legitimately differ once the stock package is loaded; those two globals are excluded from the compared projection with a comment, while the exact-key assertion reads them before that point.

Oneshot route: this is a test-only change confined to the battle test files and their authored fixtures, with no production code touched; it reuses the existing rigs rather than adding new ones.

## Verification

**Commands:**
- `node --test packages/core/test/battle-outcomes-stock.test.ts packages/core/test/battle-custom-fight.test.ts packages/core/test/battle-damage.test.ts packages/core/test/battle-actions.test.ts` -- expected: all four files pass.
- `pnpm typecheck`, `pnpm lint`, `pnpm test:strict`, `pnpm golden`, `pnpm golden:bun`, `pnpm graph`, `pnpm licence`, `pnpm provenance`, `pnpm catalogue:check`, `pnpm command-docs:check` -- expected: all green.

## Plan Change Log

- 2026-10-29 (ledger chore): `ticket: '30'` → `ticket: 30` (bare entry id); the `chore` type was already correct. Frontmatter only, content unchanged.
- 2026-10-29 (completed): marked done after PR #768 (`b014d142`) merged; issue #750 closed 2026-10-29T16:36:24Z. Test-only: the stock outcome test now asserts the exact `cause`/`source` keys on the actor-local `defeated` and its `stock_battle.defeated` re-emission, the authored custom fight program is corrected to `{ cause: 'script', source: heroId }` and proves nothing re-emits it, and the damage tests cover `beforeDamage`'s exact detail, the owner's HP/SMP clamp after listener mutation, and one item-origin dispatch. `CHANGELOG.md` records the same. No spec change. PR #768 CI green with `unit (core-battle)` 6m30s.
