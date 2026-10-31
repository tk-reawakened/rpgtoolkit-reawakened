---
title: "Pure-RPGCode media package fixtures and legacy golden verification"
type: 'feature'
ticket: 7
created: '2026-10-19'
status: built
baseline_revision: 'd9689e25'
risk: "medium"
context:
  - "fixtures - packages/core/test/fixtures/plugins/ (audio-stems.prg is the 18.7 predecessor)"
  - "golden - golden/scenes/"
---

## Intent

Lane D (proof). Ducking, stems and region music written as RPGCode packages on events, the case the epic exists for.

## Boundaries

Fixtures and goldens only.

## Key Decisions

1. Packages load by name from the manifest and use no TypeScript.

## Acceptance

1. Deterministic with a save at every tick.
2. Legacy audio goldens unchanged.

## Verification

Headless goldens; full gate set.

## Implementation Notes

- Fixtures: `packages/core/test/fixtures/media-packages/{ducking,stems,region-music}.prg`, authored from
  `docs/spec/engine/audio-media.md#media-1`, `#media-2` and `#media-3` only (G7; no runtime parser, no sample game,
  no legacy source). Ducking counts `ui` voices through `media.on("started"/"ended"/"stopped")` and drives
  `media.music.fade(percent, seconds)`; stems starts the next layer from `media.on("ended")` with
  `mediaPlay(file, { track: "ambience", loop: 0 })`; region-music rewrites `event.detail.file` in
  `media.on("beforePlay")` when `source == "board"` and `track == "music"`.
- Package start-ups are **file** program references resolved through a package catalogue
  (`PackageCatalogueEntry.startup`), not inline programs: an inline start-up's listener closures lose their
  captured handles (`callable.unknown-def`), which the fixture hit first and avoided through the
  `fileProgramRef` path PKG-4/PKG-7 specify.
- Behaviour proof: `packages/core/test/media-packages.test.ts` boots the authored game through the real engine and
  asserts the exact consequence of each package — music starts `media/region.mid` although the board declared
  `board.mid`; the music track fades at ticks 6 and 35 (the `ui` start and its end); `ambience` walks
  `stem1.wav → stem2.wav → stem3.wav` — plus a save/restore round trip at **every** tick of a 120-tick run and a
  same-seed replay comparing the whole cue stream and every per-tick state hash.
- Golden: `packages/runner-harness/src/media-packages-golden.ts` composes the same authored game from core's public
  writers (the module carries no Node I/O; the CLI supplies the fixture bytes and the start-up text), the `golden`
  job gains stage 8, and `golden/media/packages.json` pins the cue stream, the final tick and the final state
  hash. The section runs only where the authored fixtures exist, so a temp golden root and the existing CLI tests
  behave exactly as before.
- Guard test: `packages/runner-harness/test/media-packages-golden.test.ts` pins determinism and proves a drifted
  cue or state hash is named rather than accepted.

## Verification

Observed on this branch:

- `node --test packages/core/test/media-packages.test.ts`: 3 tests pass (59 ms, 344 ms, 40 ms).
- `node --test packages/runner-harness/test/media-packages-golden.test.ts`: 2 tests pass (372 ms).
- `pnpm test:strict`: 2426 tests, 2426 passed, 0 skipped.
- `pnpm golden`: exit 0, `media-golden: authored media packages: 12 cues and state cd6051aef98a89f6 stable`,
  `golden: 24 compared`, `scripts: 27 programs ok`, every scene exact.
- `pnpm closing`: 8/8 games match their baselines. `pnpm golden:bun`: exit 0, same media-golden line under Bun.
- `pnpm typecheck`, `pnpm lint`, `pnpm fixtures:author:check`, `pnpm graph` (517 modules), `pnpm licence` (0
  violations), `pnpm provenance` (719 files, 0 violations), `pnpm catalogue:check`, `pnpm command-docs:check`
  (exit 0): green.

## Golden explanation

The record is new, so nothing previously pinned moved (`--record` rewrote only `golden/media/packages.json`).
Its cue stream is the three packages' observable effect on the authored game — `soundfont.set`, the `ui` start,
the three `ambience` layers, the replaced `music` start and the two music fades — at ticks that follow from the
fixed tick, the 30-tick one-shot length and the 0.5 s fades, not from wall-clock timing. The final state hash pins
that the same seed replays identically; the record is a G5 addition for entry 21.7 and is not a sample-game golden.

## Notes

- `tickets.toml` needed no change: the entry already carries `tracker_id = "#486"`.
- No spec text changed: MEDIA-1/2/3 already specify everything the packages use.
- Proposed rulings: none.
