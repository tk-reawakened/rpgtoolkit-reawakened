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

Give a battle its music and sounds without adding a second audio path. The stock package plays the battle background's music through the media object with source `battle`, plays the menu move/confirm/cancel and battle cues as voices, and on the outcome stops the battle track and has the board's music re-posted from the battle's `boardKey`. `beforePlay` listeners can replace or cancel the battle track, exactly as they can for any other source.

Audio is not saved. A mid-battle load stops the stale track and starts the battle track for the restored battle; the board track comes back from the board after the battle, not from a private copy.

## Boundaries

No UI (7.11), no loop or rules. It does not add audio primitives to `core`; it uses the 21.5 media object and the 21.4 `beforePlay` hook. Null-audio runners must be first-class.

## Key Decisions

1. **Source and board music.** The battle track is requested with `{ source: "battle", track }`; the package keeps no private copy of the board track. On the outcome, the package stops `battle` and asks the board producer to re-post the board's music for `boardKey`, so a loaded battle restores the right track. The media object's state is the only audio state.

2. **`beforePlay`.** The hook runs for source `battle` and may return a replacement track or cancel. A cancelled battle track leaves the board track playing or silent as the hook decides; the package does not retry. A listener error is reported and the original track plays.

3. **Cue names.** Menu move, confirm and cancel come from the menu data; attack, special, item, damage, critical, defeat and level-up come from the battle data. A missing cue is silent, not an error, so an old game without a cue still battles.

4. **Voices.** Cues are voices, not music: they mix over the track and do not stop it. Two cues in the same tick both play; the package does not deduplicate, because two hits on two fighters are two sounds.

5. **Save and load.** The save contains no audio state. On load, if `battle` is non-null, the package stops any stale `battle` track (a different battle may have been playing) and starts the restored battle's track; on load outside a battle, it ensures no `battle` track is playing. When the restored battle ends, the board music is re-posted from `boardKey`.

6. **Null audio.** The null-audio runner records the same cue stream (source, track/cue, timing in ticks) and produces the same state hash as a real runner, so golden tests do not need a device.

## Acceptance

- [x] The battle track replaces the board track at start; on the outcome the `battle` track stops and the board's music is re-posted from `boardKey`. Tests: `packages/core/test/media-objects.test.ts` — “battle music replaces board music on the built-in track with the battle source”; `packages/core/test/engine-boot.test.ts` — “battleEnded dispatches before boardReturned and restores active board music before audio”.
- [ ] Source `battle` reaches `beforePlay`; a listener can replace or cancel; a listener error plays the original. Tests cover the battle source and replacement/cancellation, but none proves the listener-error fallback; `packages/core/test/audio-runtime.test.ts` — “a failed engine beforePlay dispatch rejects the start” tests rejection instead.
- [ ] Every battle and menu cue is a media cue with the ruled name; a missing cue is silent. The missing-music test covers music only; no named test asserts the complete battle/menu cue mapping.
- [ ] Voices mix without stopping the track; two same-tick cues both play. No named core test proves both clauses for battle cues.
- [ ] A save contains no audio; a mid-battle load starts the restored track and a non-battle load leaves no `battle` track. The named save test keeps playback state, and no named test proves this battle-track behavior through game save/load.
- [ ] The null-audio runner produces the same cue stream and state hash. No named core test compares both runners.

## Verification

Media-object fake tests for start/outcome ordering, `beforePlay` replace/cancel/error, cue naming and missing cues, same-tick cues, save/load audio behaviour, and a null-audio cue-stream test. Full suite, typecheck and lint.
