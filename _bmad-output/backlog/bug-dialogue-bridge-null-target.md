---
id: 13
type: bug
title: "Stock RPG dialogue bridge drops script-emitted events with no target"
parent: none
covers: []
after: []
tracker_id: "#2026"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/2026"
refined: true
hitl: false
risk: medium
severity: P2
---

# Stock RPG dialogue bridge drops script-emitted events with no target

## Description

A script can emit the documented `dialogue.completed` event without a target actor, but the stock RPG package does not deliver the corresponding `talked` event to the speaking actor. A targetless dialogue must still reach that actor with `targetId` represented as `null`.

## Reproduction

1. Start `stock/stock_rpg/startup.prg` and attach an actor listener for `talked`.
2. Emit `game.emit("dialogue.completed", { actorId: specActorId, targetId: 0, text: "Hello" })`, the RPGCode representation of an absent target.
3. Allow queued event delivery to run.
4. Actual: the native bridge receives target ID zero and the stock actor bridge rejects the event. Expected: one `talked` event reaches the speaking actor with `targetId` equal to `null` and the original text.

## Cause Hypothesis

An absent RPGCode value crosses the native event boundary as numeric zero. The dialogue event adapter preserves that sentinel instead of restoring the documented null target, so the stock RPG bridge rejects the malformed identifier.

## Acceptance Criteria

1. **A targetless dialogue is bridged**
   **Given** the stock RPG startup and a live speaking actor listener
   **When** a script emits `dialogue.completed` with that actor's ID, target ID zero, and text
   **Then** exactly one `talked` event reaches the speaking actor with the same actor ID and text and a null target ID.
2. **Valid targeted dialogue remains unchanged**
   **Given** a live speaking actor and a second live target actor
   **When** a script emits `dialogue.completed` with both positive actor IDs
   **Then** exactly one `talked` event reaches the speaking actor with both IDs and the text unchanged.
3. **Regression tests prove the bridge contract**
   **Given** the stock RPG bridge spec and its event detail tests
   **When** they run
   **Then** they cover both targetless and targeted script events, using cooperative delivery and the actual stock startup path.
4. **Or, no change is needed, with proof**
   **Given** the targetless reproduction
   **When** the current stock bridge is exercised
   **Then** it delivers the event with a null target ID, or the reported failure is otherwise disproved with evidence recorded in Notes.

## References

- Issue — https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/2026
- Event contract — docs/spec/engine/rpgcode-modules-and-objects.md#emit-13
- Dialogue contract — docs/spec/engine/plugins-and-battle.md#e-123
- Stock actor event vocabulary — docs/spec/engine/actors.md#actor-events
- Existing related bridge proof — stock/stock_rpg/bridge.spec.prg

## Notes

- Issue comments distinguish this targetless script-event boundary bug from the separately corrected folded field-name handling. Do not change the published event shape or actor detail access rules.
