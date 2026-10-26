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

Give a battle its music and sounds without adding a second audio path. The stock package plays the battle background's music through the media object with source `battle`, plays the menu move/confirm/cancel and battle cues as voices, and stops the battle track on outcome. After `boardReturned`, the board/audio producer reads music from the active board; it does not look up music by `battle.boardKey`. A `beforePlay` listener may replace or cancel the battle track, while a listener failure rejects battle start.

`BattleSection` contains no battle audio. Playback state is saved in the independent audio section, and audio-media's save/load rule governs restoration. After the battle, the board's music is read from the active board rather than a private copy or saved board key.

## Boundaries

No UI (7.11), no loop or rules. It does not add audio primitives to `core`; it uses the 21.5 media object and the 21.4 `beforePlay` hook. Null-audio runners must be first-class.

## Key Decisions

1. **Source and board music.** The battle track is requested with `{ source: "battle", track }`; the package keeps no private copy of the board track. On outcome, the battle track stops and `boardReturned` causes the board/audio producer to read the active board's own music. `battle.boardKey` is not used to look up or restore music.

2. **`beforePlay`.** The hook runs for source `battle` and may return a replacement track or cancel. A cancelled battle track follows the hook's decision; the package does not retry. If a listener fails, the battle start rejects rather than playing the original track.

3. **Cue names.** Menu move, confirm and cancel come from the menu data; attack, special, item, damage, critical, defeat and level-up come from the battle data. A missing cue is silent, not an error, so an old game without a cue still battles.

4. **Voices.** Cues are voices, not music: they mix over the track and do not stop it. Two cues in the same tick both play; the package does not deduplicate, because two hits on two fighters are two sounds.

5. **Save and load.** `BattleSection` contains no battle audio. Playback state is persisted in the independent audio section; `audio-media.md#audio-save-load` governs restoration. Battle data restores separately, and the outcome returns to the active board whose own music is read after `boardReturned`, not from `battle.boardKey`.

6. **Null audio.** The null-audio runner records the same cue stream (source, track/cue, timing in ticks) and produces the same state hash as a real runner, so golden tests do not need a device.

## Acceptance

- [x] The battle track replaces the board track at start; after outcome, `boardReturned` restores music from the active board, not `battle.boardKey`. Tests: `packages/core/test/media-objects.test.ts` — “battle music replaces board music on the built-in track with the battle source”; `packages/core/test/engine-boot.test.ts` — “battleEnded dispatches before boardReturned and restores active board music before audio”.
- [ ] Source `battle` reaches `beforePlay`; a listener can replace or cancel; a listener failure rejects battle start. `packages/core/test/audio-runtime.test.ts` — “a failed engine beforePlay dispatch rejects the start” proves rejection.
- [ ] Every battle and menu cue is a media cue with the ruled name; a missing cue is silent. The missing-music test covers music only; no named test asserts the complete battle/menu cue mapping.
- [ ] Voices mix without stopping the track; two same-tick cues both play. No named core test proves both clauses for battle cues.
- [ ] A save persists audio playback in the independent audio section, while `BattleSection` contains no battle audio; a mid-battle load follows the audio-media restore rule. The named save test preserves playback state, but no named test proves battle-music restoration through a full game save/load.
- [ ] The null-audio runner produces the same cue stream and state hash. No named core test compares both runners.

## Verification

Media-object fake tests for start/outcome ordering, `beforePlay` replace/cancel/error, cue naming and missing cues, same-tick cues, save/load audio behaviour, and a null-audio cue-stream test. Full suite, typecheck and lint.

## Plan Change Log

- 2026-10-26 (owner ruling, Jensen; applied by the director): return music from the active board after `boardReturned`, not by `battle.boardKey`; listener failure rejects start; `BattleSection` has no audio while playback remains saved in the independent audio section.
