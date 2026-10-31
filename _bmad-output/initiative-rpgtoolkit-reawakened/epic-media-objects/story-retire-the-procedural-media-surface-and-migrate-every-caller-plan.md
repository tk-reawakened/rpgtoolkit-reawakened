---
title: "Retire the procedural media surface and migrate every caller"
type: 'feature'
ticket: 6
tracker_id: "#485"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/485"
parent: epic-media-objects
created: '2026-10-19'
status: built
baseline_revision: 'c282ad391e569d9cbc3ba8d949f03d37ea3deb9c'
risk: "medium"
context:
  - "code - packages/core/src/script/packs/media.ts, virtuals.ts"
  - "fixtures - packages/core/test/fixtures/audio/, tools/fixtures/audio/"
  - "spec - docs/spec/engine/audio-media.md#media-5, docs/spec/engine/rpgcode-functions.md"
---

## Intent

Lane C (objects). Clean cutover: nothing of the removed surface stays as a shim or alias.

MEDIA-5 (owner ruling, 2026-10-19) retires the net-new procedural media surface that Epic 6 authored
before the media object existed, and keeps every Toolkit 3.1 name. Entries 21.1–21.5 built the object
model (`media`, `media.track`, the voice `mediaPlay` returns) and made the internal method-target
commands (`mediatrackget`, `mediatrackfade`, `mediavoice*`) invisible to authors through
`doc.access: "internal"`. This entry removes what is left of the second API.

## Boundaries

Only the net-new names the 21.1 list names. Every 3.1 alias stays: `mediaplay` (one-argument legacy
form), `mediastop` (including the `track[, voice]` extension), `midiplay`, `playmidi`, `mediarest`,
`midirest`, `wav`, `mp3`, `wavstop`, `mp3pause`, `setvolume`, `playavi`, `playavismall`, and the legacy
plugin stubs (`fademidiin`, `fademidiout`, `setmidivolume`) stay exactly as they are.

The internal method targets of the media objects are not part of the retired surface: they are already
`doc.access: "internal"` (21.5), produce no catalogue row and no command-doc entry, and the VM dispatches
a hydrated host method straight to the named command. Deleting them would break `media.track.fade()` and
every voice method, so they remain.

## Removed surface

| Removed | Replaced by |
|---|---|
| `mediatrack(name[, voices])` | game-file audio settings (MEDIA-4); a script cannot configure tracks |
| `mediaload(track, file)` | `mediaPlay(file, { track, wait: false })` |
| `mediapause` / `mediaresume` | `voice.pause()` / `voice.resume()` |
| `mediaseek(track, seconds[, voice])` | `voice.seek(seconds)` |
| `medialoop(track, on[, voice])` | `voice.loop = 0/1` on the voice object |
| `mediafade(track, percent, seconds[, voice])` | `voice.fade(percent, seconds)` / `track.fade(percent, seconds)` |
| `mediawait([track[, voice]])` | `voice.wait()` |
| `mediavolume(...)` | `voice.volume = n` / `track.volume = n` / `setvolume` for the master |
| `mediastate` / `mediaflags` / `mediaplaying` | the voice object's `state`, `loop`, `file`, `position`, `length` fields |
| `mediafile` / `mediaposition` / `medialength` / `mediatracks` | the same fields, and `media.<track>` for configured tracks |
| `getvolume()` | `track.volume` / `voice.volume` (master stays `setvolume`) |
| `soundfont(file)` / `soundfontreset()` | game-file `defaultSoundFont` (MEDIA-4) |
| `tkMD_ONCE`, `tkMD_LOOP`, `tkMD_WAIT`, `tkMD_RESTART`, `tkMD_SYNC`, `tkMD_STOPPED`, `tkMD_PLAYING`, `tkMD_PAUSED` | the `mediaPlay` options dictionary and the voice object's fields |
| positional `priority` / `syncTrack` arguments, the `&voice` integer output | the options dictionary's `priority`/`sync` and the returned voice object |

## Tasks & Acceptance

- [ ] `docs/spec/engine/rpgcode-functions.md` — delete the eleven audio rows for the retired commands;
      keep `mediaplay`, `mediastop`, the 3.1 aliases and `setvolume` with their current text.
- [ ] `docs/spec/engine/audio-media.md` — MEDIA-5 records the cutover as delivered and names the
      replacement for each retired call, so a reader of the ruling sees the object surface, not a plan.
- [ ] `packages/core/src/script/packs/media.ts` — delete the retired `BuiltinSpec`s, the `tkMD_*`
      exports and the helpers only they used; `MEDIA_COMMANDS` keeps `mediaplay`, `mediastop`, the 3.1
      aliases, the video commands and the internal method targets. No alias or shim is added.
- [ ] `packages/core/src/audio/model.ts` — drop the `tkMD_*` re-exports and their comment; the internal
      `MEDIA_*` flag constants stay (the applier uses them).
- [ ] `packages/core/src/script/index.ts` — stop exporting the removed names.
- [ ] `packages/core/src/script/catalogue-responders.ts` — the media fallback name set loses the retired
      spellings, so no catalogue row or documentation marker survives.
- [ ] `tools/fixtures/audio/` + `packages/core/test/fixtures/audio/` — the oracle's standard-call labels
      move from the retired positional form to the ruled options/object form (`mediaPlay(file, { track:
      "sfx", loop: false })`, `voice.wait()`, …), and the generated scene fixtures are re-recorded.
- [ ] `packages/core/test/audio-oracle.ts`, `audio-runtime.test.ts` — no removed name remains in a label,
      comment or test name; the assertions keep their meaning.
- [ ] `_bmad-output/initiative-rpgtoolkit-reawakened/epic-media-objects/epic-media-objects.md` — the
      Notes record the cutover next to the 2026-10-19 decision it implements (history is not rewritten).
- [ ] Repository search: no removed name outside `docs/provenance/`, the epic Notes' history, the 21.1
      list, this plan and the other closed plans that record the decision.

**Acceptance criteria**

1. A repository search finds no removed name outside the ruled history notes.
2. Catalogue and command-docs gates pass with the rows gone.
3. `mediaPlay(file[, options])`, the returned voice object and every 3.1 alias behave exactly as before.

## Key Decisions

1. Each re-recorded golden gets a written reason (G5): the audio scene fixtures change **only** in the
   `as` labels that named a retired constant; every tick row, cue, track state and hash is unchanged, and
   the oracle's own derived timeline is the same code path.
2. The internal method-target commands stay, because the VM dispatches `obj.method()` through the command
   table by name; they stay `doc.access: "internal"` and therefore remain absent from the catalogue and
   from `rpgcode-functions.md`.
3. `tkMD_SYNC` is retired even though no 21.1 row named it: it is the same net-new constant family and no
   caller outside the pack used it.
4. The oracle's prose that explains 3.1 semantics may still *describe* a flag by name in
   `docs/provenance/` (ruled extraction history), but not in the generated fixtures or in test labels.

## Verification

- `node --test packages/core/test/audio-*.test.ts` and the audio/media battle-cue suites.
- `pnpm typecheck`, `pnpm lint`, `pnpm fixtures:test`, `pnpm fixtures:author:check`,
  `pnpm audio-protocol:check`, `pnpm catalogue:check`, `pnpm command-docs:check`, `pnpm graph`,
  `pnpm golden`, `pnpm golden:bun`, `pnpm licence`, `pnpm provenance`, `pnpm no-skips:test`,
  `pnpm closing`.
- Repository search for every removed spelling, with `docs/provenance/` and the closed plans excluded.

## Plan Change Log

- 2026-10-30 (built): surface removed, callers migrated, fixtures re-recorded for label text only.
