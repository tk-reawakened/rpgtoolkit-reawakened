---
id: 32
type: story
title: "Verify active-board return music after battle"
parent: epic-battle
tracker_id: "#752"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/752"
covers: [CAP-7, CAP-9]
after: [8, 19]
hitl: false
risk: low
---

# Verify active-board return music after battle

## Description

Verify that a battle return uses the currently active board's music when that board differs from the saved battle board key.

## Acceptance Criteria

Verify: A deterministic full-engine battle begins on board A, then board B becomes active while `battle.boardKey` remains A; after a win returns from battle, distinguishable music proves that B's track, not A's, is selected; this does not duplicate generic audio runner parity.

## References

- parent — _bmad-output/initiative-rpgtoolkit-reawakened/epic-battle/epic-battle.md
- spec — docs/spec/engine/battle.md, BAT-10
- spec — docs/spec/engine/audio-media.md
- tests — packages/core/test/battle-cues-engine.test.ts

## Notes

- Audit evidence: `packages/core/test/battle-cues-engine.test.ts:341-347` verifies win-return only. The additional fixture must make board B active while `battle.boardKey` remains A and give the two boards distinguishable music.
- Exclusion: #691 owns generic null/real audio parity and restart behavior.
- Risk rationale: low — Incorrect active-board return assertions could miss a music-restoration edge case, but this ticket adds test coverage without changing runtime.
