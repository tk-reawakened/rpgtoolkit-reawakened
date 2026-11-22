---
title: "Resolve the thread target handle across the item built-ins without the index hazard"
type: bugfix
ticket: '30'
created: '2026-11-22'
status: 'ready-for-dev'
baseline_revision: 'd8a348c58298f6dc27a5097f939d54bd45b595d9'
route: 'full'
route_source: 'auto'
risk: 'high'
review: 'none'
review_source: 'auto'
lenses_ran: []
review_loop_iteration: 0
context:
  - '{project-root}/docs/guardrails.md'
  - '{project-root}/docs/spec/engine/rpgcode-functions.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `itemIdForThread` special-cases only `"source"`, so `"target"` falls through to a literal lookup and the item commands (and their player-side equivalents) become dry no-ops. E-94 says every actor handle accepts both. The naive widening is unsafe because player-program threads store actor-id strings, and an index lookup can match an unrelated sprite.

**Approach:** Follow the issue's acceptance: apply the path query's form-aware resolver (sprite id, item key, actor-id string, actor name, actor source file) consistently to every item built-in that resolves a handle through `itemId`/`itemIdForThread` — `itemlocation`, `itemstep`, `itempath`, `itemdirection`, `itemspeed`, `itemstance`, `pushitem`, `wander`, `eraseitem` — and the player-side equivalents. Add per-command tests, keep an unresolved `"target"` a dry no-op, and prove the numeric actor-id form cannot pick another actor. Update the E-94 note and CHANGELOG.

## Boundaries & Constraints

**Always:** Resolve `"source"` and `"target"` case-insensitively; use one form-aware resolver for both the path query and the shared `itemId` path; keep an unresolved target a dry no-op; keep state deterministic and serializable; update E-94 and CHANGELOG.

**Never:** Let a numeric actor-id string resolve by index to an unrelated sprite; widen the semantics of a command beyond the handle form; change R-69's path-query contract; touch the GPL source.

</frozen-after-approval>

## Verification

**Test strategy:**
- For each scoped item command and the player-side equivalents, an item-thread test and a player-thread test with `target` set; assert the resolved actor's position/movement/erasure.
- A regression where the thread `target` holds an actor-id string and an unrelated sprite shares its id/index; assert the named actor wins.
- An unresolved-`target` case asserting a dry no-op.
- Perturbation: remove the `"target"` branch and confirm each command test fails; add a naive index fallback and confirm the numeric regression fails.

**Commands:**
- `node --test packages/core/test/movement-rulings.test.ts packages/core/test/item-action-vm.test.ts`.
- `pnpm bmad:tickets:test`.

## Implementation Notes

## Perturbation Check

| Guard reverted | Test that failed |
|---|---|
| | |
