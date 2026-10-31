---
title: 'Name the media.play voice root once and document the end-of-tick audio root'
type: 'chore'
ticket: 11
created: '2026-10-30'
status: 'built'
baseline_revision: 'c282ad391e569d9cbc3ba8d949f03d37ea3deb9c'
risk: 'low'
context: []
---

## Intent

PR #821 added a third hardcoded copy of the `media.play` argument index that carries a script voice handle, and
did not document the new end-of-tick root it added (issues #826, #758's follow-up review F1+F4). This entry makes
the audio section the one owner of that root and writes the rule down where the spec and the changelog state it,
with no behaviour change.

## Implementation Notes

- New `packages/core/src/audio/pending.ts` owns both facts: `MEDIA_PLAY_VOICE_ARG` (the argument index) and
  `pendingAudioRoots(state)` (the `media.voice` records named by the engine section's held `media.play` effects,
  as values for the unreferenced-object pass). It imports only `script/objects.ts` and types, so no import cycle
  is created between `events/` and `audio/`.
- Producer `packages/core/src/audio/script.ts` builds the effect arguments and assigns the handle at
  `MEDIA_PLAY_VOICE_ARG`; consumer `packages/core/src/audio/runtime.ts` reads `args[MEDIA_PLAY_VOICE_ARG]`;
  reader `packages/core/src/events/dispatch.ts` passes `pendingAudioRoots(state)` into `collectGarbage` alongside
  `eventRoots` and `extra` (the same seam `script/layers.ts` uses for `layerRoots`). No literal voice index
  remains in `packages/core/src`.
- `collectStateGarbage`'s JSDoc now names the held-`audio` root beside the emitter roots, the parked cancelable
  emit and `extra`.
- Docs commit first (G7), commit `732ec581`: `docs/spec/engine/audio-media.md` pin 4 states that a held play keeps
  its `media.voice` object alive through the end-of-tick pass; `docs/spec/engine/rpgcode-modules-and-objects.md`
  R-34's roots list names that object; `CHANGELOG.md` says the effect *applies* rather than *finishes*. Each new
  sentence is marked as an implementation note for entry 21.11; no owner name or date is invented.
- New test `packages/core/test/audio-pending-roots.test.ts`: a held `media.play` keeps its `media.voice` across
  `collectStateGarbage`, an applied play leaves no root (the object is freed), and a held play whose argument names
  something other than a `media.voice` contributes no root and is freed.

## Verification

Observed in this worktree at baseline `c282ad39` plus the two commits:

- `pnpm typecheck`: green; `pnpm lint`: green (`check-core-deps` allowlist unchanged); `pnpm graph`: no violations
  (511 modules, 2594 dependencies).
- `pnpm fixtures:fetch` then `pnpm test:strict`: 2397 tests, 2397 passed, 0 skipped.
- `pnpm fixtures:author:check`, `pnpm licence` (0 violations), `pnpm provenance` (712 files, 0 violations),
  `pnpm catalogue:check`, `pnpm command-docs:check` (exit 0): green.
- `pnpm golden` (24 compared, 27 programs ok, scene S-01 exact), `pnpm closing` (8/8 games match their baselines),
  `pnpm golden:bun` (exit 0): green. No golden, hash or baseline drift — the refactor is behaviour-preserving.

## Notes

- The audio hold queue stays uncapped (unlike `EFFECT_PENDING_CAP`); unchanged here, recorded in issue #825 for an
  owner ruling.
- `MEDIA_PLAY_VOICE_ARG` is exported from the audio module but not from the package barrel: the end-of-tick reader
  imports it directly, so no new public surface is added and no unused re-export exists.
