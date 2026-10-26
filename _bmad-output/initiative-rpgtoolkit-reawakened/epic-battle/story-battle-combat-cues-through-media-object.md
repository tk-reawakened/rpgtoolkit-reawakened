---
id: 19
type: story
title: "Battle combat cues through the media object"
parent: epic-battle
tracker_id: "#691"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/691"
after: [10, "21.4", "21.5"]
hitl: false
risk: medium
---

# Battle combat cues through the media object

## Description

Complete the combat-cue and verification remainder of Epic 7.10 through the media object. Route every ruled battle-combat cue through media; a missing cue is silent; same-tick combat cues mix as voices over music. Verify the battle-source `beforePlay` cancellation/replacement path and that listener failure rejects start, compare cue streams and state hashes between null and real runners, and exercise a real battle save/load that restarts battle music from saved playback in the independent audio section. Outcome music returns to the active board, not a `boardKey` lookup. Menu move/confirm/cancel cues remain in 7.11.

## Acceptance Criteria

1. Every ruled combat cue is emitted through the media object; a missing cue is silent and does not interrupt the battle.
2. Two same-tick combat cues both play as voices over continuing battle music.
3. Source `battle` reaches `beforePlay`; cancellation suppresses playback and replacement uses the replacement. A listener failure rejects music start without a fallback cue.
4. Identical seeded battle/action inputs produce equal cue streams and state hashes on null and real runners.
5. An end-to-end active-battle save/load restores BattleState and the independent audio section, restarts battle music exactly once from saved playback, keeps audio out of BattleState, and returns to music for the active board on outcome.
6. Do not add menu move/confirm/cancel cue behavior here; menu cues remain in 7.11.

## References

- parent — `_bmad-output/initiative-rpgtoolkit-reawakened/epic-battle/epic-battle.md`
- issue — #513 (battle music and sounds)
- spec — `docs/spec/engine/battle.md` (BAT-10)
- spec — `docs/spec/engine/audio-media.md#audio-save-load`
- spec — `docs/spec/engine/plugins-and-battle.md#e-71`

## Prerequisites

- Depends on: 10, 21.4, 21.5

## Guardrails

- G7 Clean-Room: use Reawakened specifications and current code only; never consult legacy GPL source.
- No battle-specific audio field in BattleState; audio playback belongs in the independent audio section.
- Menu cue work remains with 7.11.

## Notes

- Owner ruling, 2026-10-26: listener failure rejects start; playback is saved in the independent audio section, not BattleState; outcome returns music to the active board.
