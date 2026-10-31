---
title: "Pure-RPGCode media package fixtures and legacy golden verification"
type: 'feature'
ticket: 7
tracker_id: "#486"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/486"
parent: epic-media-objects
created: '2026-10-19'
status: built
baseline_revision: '2ea1768e5081ab3ce80e2f5f55f9d7c4bd54c4c3'
risk: "medium"
context:
  - "fixtures - packages/core/test/fixtures/media/ (new), packages/core/test/fixtures/plugins/ (audio-stems.prg is the 18.7 predecessor)"
  - "golden - golden/audio/media-packages.json (new)"
  - "spec - docs/spec/engine/audio-media.md#media-1, #media-2, #media-3"
---

# Pure-RPGCode media package fixtures and legacy golden verification

## Intent

Lane D (proof). Ducking, stems and region music written as RPGCode packages on events, the case the epic exists for.

Three packages are authored in RPGCode only, loaded by name from the main file's package list, and pinned:
`ducking` fades `music` while a `ui` voice plays, `stems` starts the next ambient layer when the current
one ends, and `region_music` rewrites board-started music through `beforePlay`. Nothing here is
TypeScript: the catalogue entries carry the authored `.prg` as their startup program.

## Boundaries

Fixtures and goldens only. No audio rule, event, cue or tick change; no new built-in; no engine code.
The packages use only the ruled surface: `media.on`, `media.music`, `mediaPlay` and `beforePlay` detail
mutation (MEDIA-1, MEDIA-2, MEDIA-3).

## Key Decisions

1. Packages load by name from the manifest: the authored game lists `ducking`, `stems` and `region_music`
   in its main-file package list and the catalogue resolves each to its own program file. A file
   reference (not inline text) is what gives each package its own program identity, so two packages'
   lambdas cannot collide in the shared definition table.
2. The package programs use lambdas stored in globals rather than named functions handed to `media.on`:
   the listener argument must be a callable value, and a bare function name is not one.
3. Each re-recorded golden gets a written reason (G5): `golden/audio/media-packages.json` is a **new**
   golden recorded from the pinned scenario (seed 31, 130 ticks). Its values are the live per-tick
   hashes the engine reports (`report.stateHash`), not the hashes of a restored state, so the pin fails
   on a lossy restore. No existing golden changed.
4. The golden records the per-tick state hashes of the combined scenario — ducking, stems and region
   music running together — so a change in the stems chain, the region rewrite or the audio
   event/apply ordering they depend on moves a hash. Ducking is covered by its cue assertion instead:
   its track fade lands in `audio.settings.trackVolumes`, which the state hash excludes by design, so
   no hash can observe it.

## Acceptance

- [x] `packages/core/test/fixtures/media/ducking.prg` — ducks `music` to 40 while any `ui` voice plays and
      restores 100 when the last one ends or stops.
- [x] `packages/core/test/fixtures/media/stems.prg` — a one-shot ambience layer ends into the next authored
      layer, driven by `ended` on the ambience track.
- [x] `packages/core/test/fixtures/media/region-music.prg` — a board-sourced `beforePlay` rewrites the
      board's own file to the region theme; every other source keeps its file.
- [x] `packages/core/test/audio-packages.test.ts` — loads the three by name and asserts each consequence
      (region file only, `media.fade` targets `[40, 100]`, the three ambience layers in order), pins
      `golden/audio/media-packages.json`, and checks a save at every tick restores to that tick's hash.
- [x] `golden/audio/media-packages.json` — the recorded per-tick hashes and the final hash.
- [x] A control run without the packages plays the board's own `theme.mid` and nothing else.

**Acceptance criteria**

1. Deterministic from the seed: two runs produce identical per-tick hashes, and a save at every tick
   restores to that tick's hash.
2. Each pinned golden is explained (Key Decisions 3–4).
3. The three packages load by name from the manifest.
4. All 3.1 audio goldens and sample plays are unchanged: no existing fixture or golden is edited.
5. Typecheck, lint, licence, provenance, catalogue and command-docs gates pass.

## Verification

`node --test packages/core/test/audio-packages.test.ts` (4 tests), then the full local gate set:
`pnpm typecheck`, `pnpm lint`, `pnpm graph`, `pnpm test:strict`, `pnpm fixtures:author:check`,
`pnpm fixtures:test`, `pnpm audio-protocol:check`, `pnpm catalogue:check`, `pnpm command-docs:check`,
`pnpm licence`, `pnpm provenance`, `pnpm no-skips:test`, `pnpm golden`, `pnpm golden:bun`, `pnpm closing`.

## Plan Change Log

- 2026-10-30 (built): three packages authored, the scenario test and its new golden recorded; no existing
  golden or fixture touched.
