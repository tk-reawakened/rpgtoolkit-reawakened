---
title: "Battle music and sounds through the media object"
type: 'feature'
ticket: 10
created: '2026-10-19'
status: done
baseline_revision: '4255ec6f520af495d3aa2db8ed2553cb685ea3ab'
risk: "medium"
context:
  - "spec - docs/spec/engine/battle.md as ruled by 7.1 (BAT-10)"
  - "spec - docs/spec/engine/audio-media.md as amended by 21.1"
  - "spec - docs/spec/engine/plugins-and-battle.md#e-71"
  - "code - packages/core/src/ports/audio.ts (the media object and beforePlay)"
---

## Intent

Give a battle its music and sounds without adding a second audio path. The battle-start producer requests the battle background's music through the media object with source `battle`; menu move/confirm/cancel and battle cues play as voices. After outcome handling, `boardReturned` causes the board/audio producer to request music from the active board (or `null` for silence). The audio applier applies that request using ordinary same-file, replacement and clear rules; outcome handling does not unconditionally stop a battle track. A `beforePlay` listener may replace or cancel the battle request, while a listener failure rejects only the separate music-start request, not battle start.

`BattleSection` contains no battle audio. Playback state is saved in the independent audio section, and audio-media's save/load rule governs restoration. After the battle, the board's music is read from the active board rather than a private copy or saved board key.

## Boundaries

No UI (7.11), no loop or rules. It does not add audio primitives to `core`; it uses the 21.5 media object and the 21.4 `beforePlay` hook. Null-audio runners must be first-class.

## Key Decisions

1. **Source and board music.** The battle track is requested with `{ source: "battle", track }`; the package keeps no private copy of the board track. After outcome handling, the engine emits `battleEnded`, then returns to the active board and emits `boardReturned`; the board/audio producer posts the active board's music or `null` for silence with source `board`. The audio phase applies the request under ordinary replacement, same-file carry-on and clear rules. Outcome handling does not unconditionally stop a battle track. `battle.boardKey` is not used to look up music.

2. **`beforePlay`.** The hook runs for source `battle` and may return a replacement track or cancel. A cancelled battle track follows the hook's decision; the package does not retry. If dispatch fails, only the music-start request is rejected; battle start is not rejected or undone.

3. **Cue names.** Menu move, confirm and cancel come from the menu data; attack, special, item, damage, critical, defeat and level-up come from the battle data. A missing cue is silent, not an error, so an old game without a cue still battles.

4. **Voices.** Cues are voices, not music: they mix over the track and do not stop it. Two cues in the same tick both play; the package does not deduplicate, because two hits on two fighters are two sounds.

5. **Save and load.** `BattleSection` contains no battle audio. Playback state is persisted in the independent audio section; `audio-media.md#audio-save-load` governs restoration. Battle data restores separately, and the outcome returns to the active board whose own music is read after `boardReturned`, not from `battle.boardKey`.

6. **Null audio.** The null-audio runner records the same cue stream (source, track/cue, timing in ticks) and produces the same state hash as a real runner, so golden tests do not need a device.

## Acceptance

- [x] The battle track replaces the current music at start when the request is accepted; after outcome, `boardReturned` causes the board/audio producer to request music from the active board (or `null` for silence), not look up `battle.boardKey`, and ordinary same-file, replacement and clear rules apply. Tests: `packages/core/test/media-objects.test.ts` — “battle music replaces board music on the built-in track with the battle source”; `packages/core/test/engine-boot.test.ts` — “battleEnded dispatches before boardReturned and restores active board music before audio”.
- [ ] Source `battle` reaches `beforePlay`; a listener can replace or cancel; a listener failure rejects the music-start request only, not battle start. `packages/core/test/audio-runtime.test.ts` — “a failed engine beforePlay dispatch rejects the start” proves the audio request's rejection, not a battle-start rejection.
- [ ] Every battle and menu cue is a media cue with the ruled name; a missing cue is silent. The missing-music test covers music only; no named test asserts the complete battle/menu cue mapping.
- [ ] Voices mix without stopping the track; two same-tick cues both play. No named core test proves both clauses for battle cues.
- [ ] A save persists audio playback in the independent audio section, while `BattleSection` contains no battle audio; a mid-battle load follows the audio-media restore rule. The named save test preserves playback state, but no named test proves battle-music restoration through a full game save/load.
- [ ] The null-audio runner produces the same cue stream and state hash. No named core test compares both runners.

## Verification

Media-object fake tests for start/outcome ordering, `beforePlay` replace/cancel/error handling (a failed dispatch rejects the music-start request only), cue naming and missing cues, same-tick cues, save/load audio behaviour, and a null-audio cue-stream test. Full suite, typecheck and lint.

## Plan Change Log

- 2026-10-26 (owner ruling, Jensen; applied by the director): return music from the active board after `boardReturned`, not by `battle.boardKey`; listener failure rejects start; `BattleSection` has no audio while playback remains saved in the independent audio section.
- 2026-10-26 (event-order clarification, per Main): the outcome path does not promise an unconditional battle-track stop; after `boardReturned`, the board/audio producer posts active-board music or `null`, then normal same-file, replacement and clear rules apply.

- 2026-10-26 (scope clarification, per Main): “start” in the owner ruling above refers to the separate battle music-start request. `battle.ts` starts the battle before making that request, and the failed-dispatch test proves rejection of the audio request only; it does not reject or undo battle start.
