---
title: 'Stock RPG dialogue bridge drops script-emitted events with no target'
type: 'bugfix'
ticket: '13'
created: '2026-11-19'
status: 'built'
baseline_revision: '4340727b09c0596b68325f721e12182421780124'
route: 'oneshot'
route_source: 'auto'
risk: 'medium'
review: 'quick'
review_source: 'pinned'
lenses_ran: [quick]
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A script-emitted `dialogue.completed` with no target reaches the native event view with target ID zero, which the stock RPG bridge rejects instead of forwarding `talked` to the speaking actor.

**Approach:** Restore the documented `null` target value at the script-to-native event boundary for this dialogue event, then prove targetless and valid-target delivery through the stock RPG startup bridge.

</frozen-after-approval>

## Implementation Notes

The `readEvent` boundary normalizes zero to null only while the matching script-emitted event is actively dispatching; native event details outside that dispatch remain unchanged. Core regressions cover targetless script events, distinct positive targets, and a retained script event invoked again after its dispatch. The stock bridge spec checks exact actor/target/text detail and single delivery for both targetless and valid-target script events; its dogfood baseline was regenerated.

## Review Triage

- Quick review required coverage of both script-emitted targetless and positive-target bridge deliveries, with exact detail assertions. Added exact actor, target, and text assertions for both stock bridge cases plus a distinct-positive-target core regression.
- Quick review found the stale-event regression did not retain the VM object and was using a native event sidecar, so it did not prove the active-dispatch guard. Replaced it with a script-emitted event retained by a VM global, asserted the object remained live and had no native sidecar after dispatch, then verified a second bridge invocation was rejected.
- Follow-up quick review confirmed the VM-rooted script-event regression exercises the active-dispatch guard; no actionable defects remained.

## Verification

**Commands:**
- Run the complete affected core event test file and stock RPG bridge spec independently; each must pass and the newly added focused test must take under one second.
- Run focused package typecheck and lint for changed code.
- Run `pnpm script:dogfood` to execute the real stock package proof.
- Run related stock-menu/stock package tests if present to confirm no affected consumers break.

**References:** `docs/spec/engine/rpgcode-modules-and-objects.md#emit-13`, `docs/spec/engine/plugins-and-battle.md#e-123`, `docs/spec/engine/actors.md#actor-events`, `stock/stock_rpg/bridge.spec.prg`.
