---
title: "Refactor sweep"
type: 'feature'
ticket: 8
tracker_id: "#487"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/487"
parent: epic-media-objects
created: '2026-10-19'
status: built
baseline_revision: 'bde11f324a05271ce7421d8281bde02f5cca5984'
risk: "low"
review: thorough
context:
  - "spec - docs/spec/engine/audio-media.md"
  - "epic - _bmad-output/initiative-rpgtoolkit-reawakened/epic-media-objects/epic-media-objects.md, Done when"
---

# Refactor sweep

## Intent

Reconciles the shared seams this epic touched (audio built-in registration, the phase list, the catalogue
and command docs), removes dead code made obsolete by the cutover and closes the epic against its Done when.

## Boundaries

No behaviour change: the sweep fixes stale seams and documentation, not audio rules, cues or events.

## Seams reconciled

- **Build-in registration.** The media pack is registered once, from `script/engine-plugins.ts` (`media:
  MEDIA_PLUGIN`), and the host types once, from `script/vm.ts` (`MEDIA_HOST_TYPES`). No second registration
  path exists; the `media` virtual in `script/virtuals.ts:109-110` only falls back to `registerEmitter`
  when a script service is not wired, which is the same object, not a second emitter.
- **Barrel.** `script/index.ts` exported `MEDIA_COMMANDS` and `readAudioView`, and nothing outside the pack
  consumed either; both are now internal. `audio/index.ts` remains the one audio surface (schema, runtime,
  events, save projection, decoders, script service and host types).
- **Phase list.** `ENGINE_PHASES` still lists `audio` exactly once, after `animation`, and
  `engine.test.ts` pins the order (`["input","waits","threads","events","movement","edges","triggers","animation","audio","time"]`).
- **Catalogue and command docs.** `pnpm catalogue:check` and `pnpm command-docs:check` pass with the retired
  spellings gone and the internal method targets still absent from both.
- **Docs links.** A link sweep of `docs/` found nine internal links whose anchor did not exist. Each is
  fixed without moving any text: `<a id="e-56">` (text and primitives), `<a id="e-82">` (equipment and
  gold), `<a id="e-132">` (fonts), `<a id="act-10">` (the actor rows table), `<a id="status-effect">`
  (battle-data status effects), `<a id="program-flow-errors--debugging">` and
  `<a id="legacy-call-contexts-and-order">` in `rpgcode-functions.md`, plus the `E-85` link in `battle.md`
  now pointing at `movement-and-collision.md#e-85`, where the rule is written. Every internal `docs/` link
  and anchor resolves.

## Done-when audit

| # | Claim | Evidence in the merged tree |
|---|---|---|
| 1 | `mediaPlay(file)` and the 3.1 aliases behave as the Epic 6 ledger fixes them, cue streams unchanged | `packages/core/test/audio-*.test.ts` (239 tests including the oracle parity cases) and `tools/fixtures/test/audio.test.mjs` (24); `golden/audio/*.json` are unchanged since Epic 6 apart from the label text 21.6 re-recorded, and `pnpm closing` still matches 8/8 baselines. |
| 2 | `mediaPlay` returns a voice object that reads, controls and goes stale with a diagnostic | `packages/core/test/media-objects.test.ts` and `audio-runtime.test.ts` (stale reads/writes, methods, `media.unknown-voice`). |
| 3 | `media`, each track and each voice emit the seven events from core state at the waits phase | `packages/core/test/audio-events.test.ts`, `audio-lifecycle-runtime.test.ts`, `audio-lifecycle-engine.test.ts`, `audio-lifecycle-replay.test.ts`. |
| 4 | Cancelable `beforePlay` for every source, with file/volume/loop mutation | `packages/core/test/battle-cues-engine.test.ts` (board and battle sources, cancel and mutation), `audio-runtime.test.ts` (`beforePlay` detail), `audio-packages.test.ts` (a script package rewriting a board start). |
| 5 | The main file's additive audio settings block replaces the startup font and runtime `mediaTrack` | `packages/core/test/format-main-file.test.ts` and `engine-boot.test.ts` (package track merge, voice cap overflow, default SoundFont). |
| 6 | A save carries playback as data; listeners live in script state; a missing package loses listeners with a diagnostic and never refuses a load | `packages/core/test/audio-restore.test.ts` (a restored save re-emits the bank and plays on), `save-*.test.ts`, and the package-missing cases in `engine-boot.test.ts`. |
| 7 | The net-new procedural surface is removed everywhere with no shim | PR #838: the commands, `tkMD_*`, catalogue rows, reference rows, effect-name keys and orphaned helpers are gone; the repository search is clean outside the ruled history notes. |
| 8 | A pure-RPGCode package (ducking and stems) is pinned in a golden | PR #846: `packages/core/test/fixtures/media/*.prg` loaded by name, `audio-packages.test.ts`, `golden/audio/media-packages.json`. |
| 9 | Every Epic 6 audio golden that does not use the removed surface is unchanged; the gates pass | `pnpm golden`, `pnpm golden:bun`, `pnpm closing` (8/8), `pnpm catalogue:check`, `pnpm command-docs:check`, `pnpm licence`, `pnpm provenance` — all green. |

## Verification

`pnpm typecheck`, `pnpm lint`, `pnpm graph`, `pnpm test:strict`, `pnpm fixtures:author:check`,
`pnpm fixtures:test`, `pnpm audio-protocol:check`, `pnpm catalogue:check`, `pnpm command-docs:check`,
`pnpm licence`, `pnpm provenance`, `pnpm no-skips:test`, `pnpm golden`, `pnpm golden:bun`, `pnpm closing`,
plus the `docs/` link-and-anchor sweep (0 problems).

## Plan Change Log

- 2026-10-30 (built): barrels trimmed, nine documentation anchors fixed (one link retargeted), Done-when
  audited item by item.
