---
id: 30
type: story
title: "Complete battle event-contract regression coverage"
parent: epic-battle
tracker_id: "#750"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/750"
covers: [CAP-9]
after: [17]
hitl: false
risk: medium
---

# Complete battle event-contract regression coverage

## Description

Close remaining test gaps in the ruled stock `defeated` event and `beforeDamage` contract. Keep coverage grounded in the specified event shapes and paths; do not decide an unresolved null-versus-zero source representation in this story.

## Acceptance Criteria

Verify: Stock defeated-event tests assert the exact `{ cause, source }` detail keys and one local plus one game-level `stock_battle.defeated` emission; the custom no-stock fixture emits a valid ruled `{ cause, source }` detail and asserts actor/game counts after draining the event queue; beforeDamage tests assert its exact detail keys, one item-origin damage path, and amount mutation across the owner-defined HP/SMP clamp boundary, with the resulting cancellation or damage observed.

## References

- parent — _bmad-output/initiative-rpgtoolkit-reawakened/epic-battle/epic-battle.md
- spec — docs/spec/engine/battle.md, BAT-12
- spec — docs/spec/engine/rpgcode-modules-and-objects.md, EMIT-13
- tests — packages/core/test/battle-outcomes-stock.test.ts
- tests — packages/core/test/battle-damage.test.ts

## Notes

- Audit evidence: existing stock event tests read `cause`/`source` but do not assert the exact own-key set; the custom fixture currently emits `{ actorId }` (`packages/core/test/fixtures/authored/battle-main-file-custom-fight.prg:96-101`); damage tests cover physical, special, drain, and multi-target paths but not the noted clamp boundary or item origin.
- Scope: use a known actor ID for `source`; leave the unresolved null-versus-zero representation to its owning contract decision rather than adding an assertion here.
- Risk rationale: medium — Incorrect event details, mutation, or emission behavior could break RPGCode scripts consuming battle events.
