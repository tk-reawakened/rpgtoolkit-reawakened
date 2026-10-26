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

Only one BAT-12/EMIT-13 test gap remains: a lethal `script` cause in `stock_battle`. Drive an enemy's first defeat through a script-originated stat update (authored `hp(...)`), then assert the actor-local `defeated` and game-level `stock_battle.defeated` events each carry exactly `{ cause: "script", source: null }`. Script-originated stat writes carry no attacking actor and BAT-12 permits `source: actorId | null`, so a non-null source is not available without inventing a new API; scripts observe null as the zero actor-id sentinel. PR #693 already covers damage/status causes, event ordering, per-enemy deduplication after revival, event-queue restore, and run suppression; do not duplicate that coverage.

## Acceptance Criteria

1. **Script-caused defeat:** A named deterministic authored-RPGCode test causes an enemy's first lethal stat update with `cause: "script"` through authored RPGCode `hp(...)`; capture actor-local and game-level event details, assert each has cause `script` and a null source (zero sentinel in script), and assert one delivery of each.
2. **Existing coverage:** Do not repeat the damage/status, restore, revival-deduplication, or run cases covered by merged PR #693.
3. **Ownership:** The event behavior remains in stock_battle; core does not gain battle-loop/event ownership.

## References

- parent — `_bmad-output/initiative-rpgtoolkit-reawakened/epic-battle/epic-battle.md`
- issue — #511 (outcomes, rewards and level-up)
- pull request — #693 (merged damage/status, queue-restore, and run coverage)
- spec — `docs/spec/engine/battle.md#bat-12`
- spec — `docs/spec/engine/rpgcode-modules-and-objects.md#emit-13`

## Prerequisites

- Depends on: 5, 6, 8

## Guardrails

- G7 Clean-Room: implement from Reawakened docs/spec and current code only; never consult legacy GPL source.
- Keep battle rules and event ownership in stock_battle, not core.
