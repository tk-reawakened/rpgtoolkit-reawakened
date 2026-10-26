---
id: 19
type: story
title: "Battle combat cues through the media object"
parent: epic-battle
tracker_id: "#691"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/691"
after: [10, 16, "21.4", "21.5"]
hitl: false
risk: medium
---

# Battle combat cues through the media object

## Description

Complete the remaining Epic 7.10 combat-cue routing and verification through the media object. Before implementation, determine the cue names, triggers, and battle/menu ownership only from the approved BAT-10, `.bkg`, and media contracts; do not invent a cue map. Route only the contract-supported battle cues through media, keep missing cues silent, verify same-tick voice mixing, battle-source cancellation/replacement and listener-failure rejection, compare null/real runner cue and hash parity, and exercise real battle save/load with playback in the independent audio section. Outcome music returns to the active board; menu cues stay in 7.11.

## Acceptance Criteria

1. **Doc-first cue inventory:** Before implementation, record each approved battle-combat cue, its trigger, and its ownership from the approved BAT-10, `.bkg`, and media contracts. Do not infer cue names or assign menu cues to battle; an unresolved mapping is a source gap, not permission to invent one.
2. **Cue routing:** For each contract-supported combat cue, a named real-path test proves media routing; a missing cue is silent and does not interrupt battle.
3. **Mixing:** Two same-tick combat cues both play as voices over continuing battle music.
4. **Start listener:** Source `battle` reaches `beforePlay`; cancellation suppresses playback and replacement uses the replacement. A listener failure rejects music start without a fallback cue.
5. **Runner parity:** Identical seeded battle/action inputs produce equal cue streams and state hashes on null and real runners.
6. **Save and return:** An end-to-end active-battle save/load restores BattleState and the independent audio section, restarts battle music exactly once from saved playback, keeps audio out of BattleState, and returns outcome music to the active board.
7. **Menu boundary:** Menu move/confirm/cancel cues remain in 7.11.

## References

- parent — `_bmad-output/initiative-rpgtoolkit-reawakened/epic-battle/epic-battle.md`
- issue — #513 (battle music and sounds)
- issue — #688 (approved documentation dependency)
- spec — `docs/spec/engine/battle.md` (BAT-10)
- spec — `docs/spec/formats/battle-data.md#fight-background-bkg`
- spec — `docs/spec/engine/audio-media.md#audio-save-load`
- spec — `docs/spec/engine/plugins-and-battle.md#e-71`

## Prerequisites

- Depends on: 10, 16, 21.4, 21.5

## Guardrails

- G7 Clean-Room: use Reawakened specifications and current code only; never consult legacy GPL source.
- No battle-specific audio field in BattleState; audio playback belongs in the independent audio section.
- Menu cue work remains with 7.11.

## Notes

- Owner ruling, 2026-10-26: listener failure rejects start; playback is saved in the independent audio section, not BattleState; outcome returns music to the active board.
- Doc-first mapping uses approved contracts only; do not create or infer a combat-cue map. Menu cues remain with 7.11.
