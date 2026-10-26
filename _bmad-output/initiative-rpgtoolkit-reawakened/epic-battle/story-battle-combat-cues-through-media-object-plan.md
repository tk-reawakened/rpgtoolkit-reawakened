---
title: "Battle combat cues through the media object"
type: 'feature'
ticket: 19
created: '2026-10-26'
status: draft
risk: "medium"
context:
  - "spec - docs/spec/engine/battle.md (BAT-10)"
  - "spec - docs/spec/formats/battle-data.md#fight-background-bkg"
  - "spec - docs/spec/engine/audio-media.md#audio-save-load"
  - "spec - docs/spec/engine/plugins-and-battle.md#e-71"
---

## Intent

Complete the combat-cue routing and end-to-end verification gaps in Epic 7.10 through the media object. First determine the cue inventory from the approved BAT-10, `.bkg`, and media contracts; do not infer or invent names, triggers, or battle/menu ownership.

## Boundaries

Only contract-supported battle-combat cues are in scope. Menu move/confirm/cancel cues remain with 7.11. If an approved contract does not establish a cue's name, trigger, or ownership, record the unresolved source gap and do not guess it. Do not add battle-specific audio data to BattleState; saved playback lives in the independent audio section.

## Acceptance

- [ ] Before implementation, record each approved battle-combat cue, trigger, and battle/menu ownership from the approved contracts; do not infer a map.
- [ ] Every contract-supported combat cue uses the media object; missing cues are silent and battle continues.
- [ ] Same-tick cues mix as voices over music.
- [ ] The `battle` source reaches `beforePlay`; cancellation and replacement work; listener failure rejects start with no fallback cue.
- [ ] Null and real runners produce the same cue stream and canonical state hash for identical battle inputs.
- [ ] Real battle save/load restores the battle and independent audio section, restarts battle music once, and on outcome returns music to the active board.
- [ ] BattleState contains no audio; no menu cue implementation is added.

## Verification

Use named tests on the real battle/media/save path, plus a paired null/real-runner replay. Before implementing, record the exact cue inventory and source contracts; assert cue counts/order, music playback state, canonical hashes, saved section ownership, and active-board return behavior.

## Plan Change Log

- 2026-10-26: created to isolate the 7.10 combat-cue/test gaps from 7.11 menu cues.
- 2026-10-27: made cue classification explicitly doc-first from approved contracts; kept menu cues in 7.11 and added the required 7.16 dependency.
