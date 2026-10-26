---
id: 15
type: story
title: "Actor-local defeated event from stock_battle"
parent: epic-battle
tracker_id: "#687"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/687"
after: [5, 6, 8]
hitl: false
risk: high
---

# Actor-local defeated event from stock_battle

## Description

Completes the stock_battle `defeated` event contract (BAT-12/EMIT-13). When an enemy actor first reaches 0 HP in battle, its actor-object event emits `defeated` once with `cause` (`damage`, `status`, or `script`) and `source` (actor id or null); the package then emits `stock_battle.defeated` on the game with the same plain detail. The event is once per enemy per battle, survives the ruled event-queue/save-restore boundary without duplication, and is absent on a run. Keep battle logic and event ownership in stock_battle, not core.

## Acceptance Criteria

1. **Actor-local event:** A named deterministic authored-RPGCode test proves each enemy actor emits `defeated` at its first defeat, once per enemy per battle, with the ruled cause and source fields for damage, status, and script causes.
2. **Global re-emission:** The package emits `stock_battle.defeated` on the game with detail identical to the actor-local event; event-queue save/restore does not duplicate it.
3. **Run behavior:** A run emits neither the actor-local nor the package-level defeated event.
4. **Ownership:** The event behavior remains in stock_battle; core does not gain battle-loop/event ownership.

## References

- parent — `_bmad-output/initiative-rpgtoolkit-reawakened/epic-battle/epic-battle.md`
- issue — #511 (outcomes, rewards and level-up)
- spec — `docs/spec/engine/battle.md#bat-12`
- spec — `docs/spec/engine/rpgcode-modules-and-objects.md#emit-13`

## Prerequisites

- Depends on: 5, 6, 8

## Guardrails

- G7 Clean-Room: implement from Reawakened docs/spec and current code only; never consult legacy GPL source.
- Keep battle rules and event ownership in stock_battle, not core.
