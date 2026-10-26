---
title: "Battle combat cues through the media object"
type: 'feature'
ticket: 19
created: '2026-10-26'
status: draft
risk: "medium"
context:
  - "spec - docs/spec/engine/battle.md (BAT-10)"
  - "spec - docs/spec/engine/audio-media.md#audio-save-load"
  - "spec - docs/spec/engine/plugins-and-battle.md#e-71"
---

## Intent

Complete the combat cue routing and end-to-end verification gaps in Epic 7.10 through the media object, using the approved active-board and audio-save contracts.

## Boundaries

Only battle-combat cues are in scope. Menu move/confirm/cancel cues remain with 7.11. Do not add battle-specific audio data to BattleState; saved playback lives in the independent audio section.

## Acceptance

- [ ] Every ruled combat cue uses the media object; missing cues are silent and battle continues.
- [ ] Same-tick cues mix as voices over music.
- [ ] The `battle` source reaches `beforePlay`; cancellation and replacement work; listener failure rejects start with no fallback cue.
- [ ] Null and real runners produce the same cue stream and canonical state hash for identical battle inputs.
- [ ] Real battle save/load restores the battle and independent audio section, restarts battle music once, and on outcome returns music to the active board.
- [ ] BattleState contains no audio; no menu cue implementation is added.

## Verification

Use named tests on the real battle/media/save path, plus a paired null/real-runner replay. Assert exact cue counts/order, music playback state, canonical hashes, saved section ownership, and active-board return behavior.

## Plan Change Log

- 2026-10-26: created to isolate the 7.10 combat-cue/test gaps from 7.11 menu cues.
