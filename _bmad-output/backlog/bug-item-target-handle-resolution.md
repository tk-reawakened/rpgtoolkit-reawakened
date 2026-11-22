---
id: 30
type: bug
title: "Item built-ins do not resolve the calling thread's target context handle"
parent: none
covers: []
after: []
assignee: ""
tracker_id: "#3331"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/3331"
refined: true
hitl: false
risk: high
severity: P1
---

# Item built-ins do not resolve the calling thread's target context handle

## Description

Item built-ins accept `"source"` but not `"target"`, although E-94 says every actor handle accepts both. On `main`, `itemIdForThread` special-cases only `"source"`; `"target"` falls through to the literal-handle path, resolves no item, and the command becomes a dry no-op.

Verified on `main`:

- An item thread with `target` set to a live item: `itemlocation("target")` returns `0` and writes `x=0, y=0, layer=1` instead of the item's position.
- `wander("target")` in an item use/equip/remove program queues no movement, even though the program's `target` names an actor.
- `itemgetpath("target")` was fixed privately for #3315 (PR #3328 resolves every form the engine writes into a thread's `source`/`target`), but the shared `itemId` path used by the other item commands was deliberately not widened there.

Widening the shared resolver is not a drop-in fix: thread `source`/`target` for player programs hold actor-id strings (for example `"7"`), not sprite ids, so a naive `"target"` resolution can make `wander("target")` move an unrelated item whose id/index equals that number. The fix needs the same form-aware resolver used by the path query — sprite id, item key, actor-id string, actor name, actor source file — applied consistently to the item commands, with a regression that the numeric actor-id form cannot pick a different actor.

## Reproduction

1. Build a state with an item thread whose `target` names a live item.
2. Call `itemlocation("target")`.
   Actual: returns `0` and writes zeroes/`layer=1`; expected: the item's position.
3. Call `wander("target")` in an item use/equip/remove program.
   Actual: no movement is queued; expected: a one-step move for the targeted item.
4. Repeat with a player-program thread whose `source`/`target` holds an actor-id string such as `"7"`.
   Expected: `"target"` resolves that actor and never an unrelated item whose id/index is 7.

## Cause Hypothesis

`itemIdForThread` resolves only the literal `"source"` keyword against the thread's sprite list, and then delegates to `itemIdFor`, which has no concept of the thread's `target` or of the engine's actor-id-string forms. The path query solved the same problem with its own form-aware resolver, but that resolution was not shared with `itemId`, so the item commands silently treat `"target"` as a literal name.

## Acceptance Criteria

1. **Every scoped item command accepts target**
   **Given** an item or player thread
   **When** `itemlocation`, `itemstep`, `itempath`, `itemdirection`, `itemspeed`, `itemstance`, `pushitem`, `wander` or `eraseitem` is called with `"target"` case-insensitively
   **Then** it resolves the actor the engine stored in the thread's `target`, including the actor-id-string form used by player hooks
2. **The numeric form cannot pick a different actor**
   **Given** a thread `target` holding an actor-id string such as `"7"`
   **When** any of those commands resolves `"target"`
   **Then** it resolves actor 7 and never an unrelated sprite whose id or index is 7 by accident
3. **An unresolved target stays a dry no-op**
   **Given** a thread whose `target` names no live actor
   **When** one of those commands resolves `"target"`
   **Then** the command remains a dry no-op, as the handler does today, and does not raise unexpectedly
4. **The contract is documented**
   **Given** the fix
   **When** E-94 and CHANGELOG are read
   **Then** the note records that every item handle accepts `"source"` and `"target"`, and the same resolution applies to the player-side equivalents
5. **Each command has a test**
   **Given** the item built-in suite
   **When** the change lands
   **Then** every scoped command above and the player-side equivalents have a test for the `"target"` form and the numeric regression

## References

- issue — https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/3331
- E-94 — `docs/spec/engine/rpgcode-functions.md#e-94-built-in-library`
- resolver — `packages/core/src/script/packs/movement.ts` (`itemIdForThread`, `itemIdFor`)
- private fix — #3315 / PR #3328 (path-query form-aware resolver)
- tests — `packages/core/test/movement-rulings.test.ts`, `packages/core/test/item-action-vm.test.ts`

## Notes

- The #3315 fix deliberately did not widen `itemId`; this ticket owns the shared resolver and the numeric-id hazard it introduces.
- The scope explicitly includes the player-side equivalents, not only the item commands.
- Severity is P1 because the commands currently silently no-op on a documented handle form.
