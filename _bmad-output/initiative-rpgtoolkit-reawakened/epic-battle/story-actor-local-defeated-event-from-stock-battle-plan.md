---
title: "Actor-local defeated event from stock_battle"
type: 'feature'
ticket: 15
created: '2026-10-26'
status: in-progress
risk: "high"
context:
  - "spec - docs/spec/engine/battle.md#bat-12"
  - "spec - docs/spec/engine/rpgcode-modules-and-objects.md#emit-13"
  - "issue - #511 (outcomes, rewards and level-up)"
---

## Intent

Finish the BAT-12/EMIT-13 `defeated` behavior on the enemy actor and preserve the existing package-level `stock_battle.defeated` notification. Keep this event package-owned; core remains battle-agnostic.

## Boundaries

Handle damage, status, and script causes, once per enemy per battle, and no event on run. Preserve the plain `{ cause, source }` payload and event-queue/save-restore behavior. Do not add a core battle loop or change the event contract.

## Acceptance

- [ ] A named authored-RPGCode test observes actor-local `defeated` for each cause with the ruled `cause` and `source` values, exactly once per enemy per battle.
- [ ] The package emits `stock_battle.defeated` on the game with identical payload, without duplicate emission after event-queue save/restore.
- [ ] A run produces neither actor-local nor package-level `defeated`.
- [ ] The implementation remains in stock_battle; no core battle/event ownership is added.

## Verification

Run focused actor-event and stock outcome tests, then the repository checks required by the task. The event assertions use the real authored RPGCode event path and compare the observed details and counts.

## Plan Change Log

- 2026-10-26: created as Epic 7 follow-up to BAT-12/EMIT-13 and issue #511 acceptance gaps.
