---
title: 'Bind tolerates a voice record that is not a live media.voice'
type: 'bugfix'
ticket: 10
created: '2026-10-30'
status: 'built'
baseline_revision: '27d5e342190064f3dc3bd8f1ba062d3fe7ea5986'
risk: 'medium'
context: []
---

## Intent

Finish what #758's Expected asked for. `bind` receives the voice handle from a `media.play` effect's argument;
when that handle names no live voice, or a `media.voice` this play did not build, it must tolerate the missing
ref — skip the length diagnosis and the emitter adoption, keep the play's own result — instead of dereferencing
`mediaVoiceRef(record)!` into `findVoice`. The restored-save path is the case #821 left reachable: a save keeps
the held `media.play` effect (`engine.pendingEffects.audio`) and the restore revalidates only that the field is an
object (`packages/core/src/save/snapshot.ts:186`), so a handle that was freed and reallocated reaches `bind`.

## Implementation Notes

- `packages/core/src/audio/script.ts` (`bind`): a record counts as this play's voice only when it is a
  `media.voice` host object carrying a string `track` member (the shape `play` writes). Anything else is
  tolerated: no `slot`/`cueId` write into a foreign object, no length diagnosis, no emitter adoption. The
  applier's own result is kept for a handle still in `waiting` (`results.set(handle, result)`), which is what
  `play` reads in the same tick.
- New regression `packages/core/test/media-voice-bind-restore.test.ts`: the first test builds the effect with the
  real producer, reallocates the handle, round-trips `snapshot` → `restoreGameState`, and registers the real
  audio applier; it fails on the pre-fix commit with `TypeError: Cannot read properties of null (reading
  'track')` at `findVoice` (`audio/model.ts:200`) via `bind` (`audio/script.ts:162`). The second test keeps the
  ordinary path honest: a play applied in its own tick still returns `started` and binds a complete voice.
- `packages/core/test/battle-cues-engine.test.ts`: the #821 regression now also observes every `media.voice`
  object at the `audio` phase of each tick (after the applier binds, before the end-of-tick pass) and asserts a
  `ui` voice with a string `track` and integer `slot`/`cueId` was bound in a tick later than the one that
  created it. With the end-of-tick rooting removed, that assertion fails ("the bound voice outlived the
  tick that created it"), so a fix that only swallows the null cannot pass it.

## Verification

Observed on this branch (all from the worktree at `fix/825-media-voice-bind`):

- Pre-fix, the new restored-save test fails with the exact #758 `TypeError` (`findVoice` → `bind`); post-fix it
  passes. The battle-cues-engine file passes 7/7 with the strengthened assertions.
- `pnpm typecheck`, `pnpm lint`: green.
- `pnpm fixtures:fetch` then `pnpm test:strict`: 2397 tests, 2397 passed, no skips.
- `pnpm fixtures:author:check`, `pnpm graph` (510 modules), `pnpm licence` (0 violations), `pnpm provenance`
  (711 files, 0 violations), `pnpm catalogue:check`, `pnpm command-docs:check`: green.
- `pnpm golden` (24 compared, 27 scripts, scenes exact), `pnpm closing` (8/8 games match their baselines),
  `pnpm golden:bun`: green. No golden, hash or baseline drift.

## Notes

- The audio hold queue is uncapped, unlike `EFFECT_PENDING_CAP` (256) in `engine/effects.ts`. That predates
  #821, is not changed here and is recorded in issue #825 for an owner ruling.

## Proposed rulings

None: the change implements issue #758's stated Expected and adds no new normative behaviour.
