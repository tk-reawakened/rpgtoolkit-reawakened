---
id: 16
type: story
title: "Epic 7 documentation and rulings reconciliation"
parent: epic-battle
tracker_id: "#688"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/688"
after: [1]
hitl: false
risk: medium
---

# Epic 7 documentation and rulings reconciliation

## Description

Reconcile the remaining Epic 7 documentation gaps with approved rulings and without runtime changes. BAT-3 needs `battle.background`, actor-object handles, and shared `battle.bad-fighter` distinct from `battle.bad-outcome`; BAT-8 records `random(5) <= 2` and its negligible modulo bias (about 1 in 10^10); BAT-9 confines `skill = -1` to the legacy callback; BAT-11–15 evidence/rulings, E-73/E-78, R-57, battle built-in catalog rows, and stale plan wording need reconciliation. BAT-7's ERR-2 wording and BAT-10's active-board/audio-save ruling are already documented and are not duplicate work here.

## Acceptance Criteria

1. BAT-3 lists `battle.background` and actor-object handles; fighter-handle failures use shared `battle.bad-fighter`, distinct from `battle.bad-outcome`.
2. BAT-8 records `random(5) <= 2` and accepts its negligible modulo bias (about 1 in 10^10); do not change the RNG.
3. BAT-9 confines `skill = -1` to the legacy callback and excludes it from the rebuilt package contract.
4. BAT-11–15 evidence, owner markers, and rejected alternatives are complete where required; E-73 links to the battle rules; E-78 is reconciled with settled R-16; R-57 is no longer labeled open.
5. The battle built-in catalog includes registered `fp`, `givefp`, and `dp` rows, and stale 7.8/7.10 plan wording is corrected.
6. Change documentation/planning only; do not change runtime behavior or the RNG.

## References

- parent — `_bmad-output/initiative-rpgtoolkit-reawakened/epic-battle/epic-battle.md`
- issue — #504 (battle rulings and BAT-1–15)
- pull request — #695 (documentation reconciliation in progress)
- spec — `docs/spec/engine/battle.md` (BAT-3, BAT-8–9, BAT-11–15)
- spec — `docs/spec/engine/plugins-and-battle.md` (E-73, R-57)
- spec — `docs/spec/engine/movement-and-collision.md#e-78`
- spec — `docs/spec/engine/progression-and-levels.md` (R-16)
- spec — `docs/spec/engine/rpgcode-functions.md` (battle built-ins)
- spec — `docs/spec/engine/rpgcode-modules-and-objects.md#emit-13`
- spec — `docs/spec/engine/audio-media.md` (saved playback section)
- plan — `_bmad-output/initiative-rpgtoolkit-reawakened/epic-battle/story-outcomes-rewards-and-level-up-plan.md`

## Prerequisites

- Depends on: 1

## Guardrails

- G7 Clean-Room: use Reawakened specifications and project artifacts only; never consult legacy GPL source.
- Documentation/planning reconciliation only; no runtime or RNG changes.

## Notes

- Owner ruling, 2026-10-26: BAT-7 ERR-2 continuation and BAT-10 active-board/independent-audio wording are already documented; do not duplicate them.
