# Epic 21 closure audit — media objects

Audit of `epic-media-objects.md`'s Done-when against merged `origin/main` (`02fb6fa0` at the time of
writing), entry by entry. Completed plans are the historical record and are not rewritten here; this
page adds the verdict and the evidence.

## Verdict

**Complete for every buildable entry; one owner-gated entry is still open, so the epic is not formally
closed.** Entries 1–11 are delivered and their issues closed (#480, #481, #482, #483, #484, #485, #486,
#487, #758, #825, #826). Entry 12 (`#843`) is an owner ruling — the load-time contract for listeners
whose package is missing — and remains open, which is also the one clause of Done-when 6 this audit
cannot mark met.

## Done-when, criterion by criterion

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | `mediaPlay(file)` and the `midiplay`, `playmidi`, `mediaplay`, `mediastop`, `mediarest`, `midirest`, `wav`, `mp3`, `wavstop`, `mp3pause`, `setvolume` aliases behave as the Epic 6 parity ledger fixes them, cue streams unchanged | Met | `packages/core/test/audio-*.test.ts` (145 tests), the media/battle-cue files (205 together) and `tools/fixtures/test/audio.test.mjs` (24 oracle tests); `golden/audio/cues.json` unchanged since #482; `pnpm closing` matches 8/8 baselines. |
| 2 | `mediaPlay` returns a voice object that reads state, controls itself and goes stale with a located diagnostic | Met | `packages/core/test/media-objects.test.ts`, `audio-runtime.test.ts` (stale reads/writes, methods, `media.unknown-voice`). |
| 3 | `media` and each track are emitters; voices emit the seven events; plain data from core state at the waits phase, never a runner report | Met | `audio-events.test.ts`, `audio-lifecycle-runtime.test.ts`, `audio-lifecycle-engine.test.ts`, `audio-lifecycle-replay.test.ts`. |
| 4 | Cancelable `beforePlay` for every start, carrying its source, with file/volume/loop mutation | Met | `battle-cues-engine.test.ts` (board, battle and cancel paths), `audio-runtime.test.ts` (detail and validation), `audio-packages.test.ts` (a script package rewriting a board start). |
| 5 | The main file's additive audio settings block replaces the startup font and runtime `mediaTrack`; legacy rows untouched; settings stay out of saves | Met | `format-main-file.test.ts`, `engine-boot.test.ts` (track merge, voice-cap overflow, default SoundFont), `audio-restore.test.ts` and the save projection (`hashGameState` excludes settings). |
| 6 | A save carries playback as data; listeners live in script state; a missing package loses its listeners with a diagnostic, never a refused load | Partly met | Playback-as-data: `audio-restore.test.ts`, `save-*.test.ts`. Never-refuses-a-load: `battle-custom-fight.test.ts:610`, `battle-start.test.ts:442,472`, `engine.test.ts:403`, `stock-packages.test.ts:206`. Listeners are session data rebuilt by start-up (`packages/core/src/script/package-startup.ts:41-100`) and an uninstalled listener command diagnoses `plugin.listener-unknown-command` (`vm.ts:386`, `events-game.test.ts:490`); the specific "package missing at load" listener contract is **#843**, still open. |
| 7 | `mediaTrack`, `mediaLoad`, the other net-new `media*` commands and queries, `&voice`, the `tkMD_*` constants and the `priority`/`syncTrack` arguments are removed and every caller migrated | Met | #838: commands, constants, catalogue rows, reference rows, effect-name keys and orphaned helpers removed; a repository search finds no removed name outside the ruled history notes. |
| 8 | A pure-RPGCode package (ducking and stems driven by events) is pinned in a golden | Met | #846: `packages/core/test/fixtures/media/*.prg`, `audio-packages.test.ts`, `golden/audio/media-packages.json` (128 live per-tick hashes plus a save-at-every-tick comparison). |
| 9 | Every Epic 6 audio golden that does not use the removed surface is unchanged; typecheck, lint, licence, provenance, catalogue and command-docs pass | Met | `golden/audio/cues.json` untouched since #482, `pnpm golden`, `pnpm golden:bun`, `pnpm closing` (8/8), and the named gates green on the closing PR (#859). |

## What remains

- **#843 (entry 21.12, owner-gated):** rule the load-time contract for a listener whose package is
  missing — dropped with a diagnostic, or refused — and, once ruled, settle the test that proves it.
  That closes the remaining half of criterion 6.
- Follow-up entries that landed after the original breakdown are part of the same verdict: #758 (voice
  binding after a canceled board music), #825 (bind tolerates a non-live voice record), #826 (one
  `media.play` voice root and the end-of-tick audio ordering).
