---
id: 20
type: story
title: "Battle-section save golden"
parent: epic-battle
tracker_id: "#692"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/692"
after: [2]
hitl: false
risk: medium
---

# Battle-section save golden

## Description

Add a deliberate deterministic save golden for the battle section, as required by Epic 7.2 acceptance. Compare equivalent snapshots with and without an active battle so the golden diff demonstrates that only the root `battle` section changes; the saved battle data contains the ruled fighter references and charge, not copied actor stats/status or audio. Preserve the schema-v1 empty-placeholder migration fixture and do not update unrelated goldens.

## Acceptance Criteria

1. A named deterministic save-golden test captures out-of-battle and mid-battle snapshots with all non-battle sections identical.
2. The golden diff contains changes only under `battle` and shows its versioned party/fighter references, background, `canRun`, outcome and charge.
3. Battle save data includes no HP/SMP/stat/status copies or audio; audio playback remains in the separate audio section.
4. The existing schema-v1 empty-placeholder migration fixture remains valid.
5. No unrelated golden changes are recorded (G5).

## References

- parent — `_bmad-output/initiative-rpgtoolkit-reawakened/epic-battle/epic-battle.md`
- issue — #505 (battle state and save acceptance)
- spec — `docs/spec/engine/battle.md` (BAT-2, BAT-13)
- spec — `docs/spec/formats/save-game.md`

## Prerequisites

- Depends on: 2

## Guardrails

- G7 Clean-Room: use Reawakened specifications and current code only; never consult legacy GPL source.
- G5 Goldens: update only the requested battle-section save golden and preserve unrelated goldens.
- Preserve the schema-v1 migration; the live placeholder being gone does not remove the migration.
