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

Reconcile the Epic 7 specifications and plans with the approved rulings without changing runtime behavior. BAT-3 documents `battle.background` and actor-object handles, with fighter-handle errors using `battle.bad-fighter` distinct from `battle.bad-outcome`; BAT-7 says custom-AI errors are reported and the program continues under ERR-2, with the turn ending when the program returns; BAT-8 records `random(5) <= 2` and its negligible modulo bias (about 1 in 10^10), not an RNG change; BAT-9 keeps `skill = -1` legacy-callback-only, outside the rebuilt package contract; BAT-10 returns music to the active board and keeps saved playback in the independent audio section, not BattleState. Reconcile BAT-11–15 evidence/rulings, E-73/E-78, R-57's settled status, missing battle built-in rows in rpgcode-functions, and stale plan wording while preserving historical notes that remain useful.

## Acceptance Criteria

1. BAT-3 lists `battle.background` and actor-object handles; all fighter-handle failures use shared `battle.bad-fighter`, distinct from `battle.bad-outcome`.
2. BAT-7 matches ERR-2: a custom-AI error is reported, execution continues in the program, and the turn ends when that program returns.
3. BAT-8 records `random(5) <= 2` and accepts its negligible modulo bias (about 1 in 10^10); do not change the RNG.
4. BAT-9 confines `skill = -1` to the legacy callback and excludes it from the rebuilt package contract.
5. BAT-10 returns music to the active board, not a `boardKey` lookup; playback is saved in the independent audio section and not in BattleState.
6. BAT-11–15 evidence, owner markers and rejected alternatives are complete where required; E-73 links to the battle rules; E-78 is reconciled with settled R-16; R-57 is no longer labeled open.
7. The battle built-in catalog includes the registered `fp`, `givefp`, and `dp` rows, and the 7.8/7.10 plan wording reflects these rulings.
8. Change documentation/planning only; do not change runtime behavior or the RNG.

## References

- parent — `_bmad-output/initiative-rpgtoolkit-reawakened/epic-battle/epic-battle.md`
- issue — #504 (battle rulings and BAT-1–15)
- spec — `docs/spec/engine/battle.md` (BAT-3, BAT-7–15)
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

- Owner ruling, 2026-10-26: accept `random(5) <= 2` with negligible modulo bias (about 1 in 10^10); document it and do not change the RNG.
- Owner ruling, 2026-10-26: active-board return, not `boardKey` lookup; battle audio is saved in the independent audio section, not BattleState.
