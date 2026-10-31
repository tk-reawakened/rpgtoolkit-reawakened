---
type: epic
title: "Media as objects and events: voices, tracks and the media object"
parent: initiative-rpgtoolkit-reawakened
covers: ["CAP-5", "CAP-7"]
assignee: ""
risk: medium
---

# Media as objects and events: voices, tracks and the media object

## Description

Epic 6 shipped the audio core (tracks, voices, a fixed-tick clock, cues and waits) with a procedural RPGCode surface: `mediaTrack`, `mediaPlay(file, track, flags, priority, syncTrack, &voice)`, a family of `media*` commands that take a track name and an integer voice slot, `media*` queries, and the `tkMD_*` constants. That surface is net new: the 3.1 engine had only `void mediaplay(file)` and the old `midi*`, `wav*` and `mp3*` aliases. Epic 19 now gives RPGCode dictionary objects, auto-bound methods and a first-class emitter, and Epic 20 uses them for actors. This epic puts Media on the same model, so a script that plays a sound gets back an object that carries the core audio information and emits events, exactly as a battle or an actor does.

## Outcome

`mediaPlay(file)` returns a voice object. The voice reports its core state (track, file, state, position, length, volume, loop) and emits events a script can listen to. Tracks are objects too, reached through a global `media` object that is itself an emitter. Anything that makes sound, whether a script call, a board arrival, an animation frame, a battle or a menu, can be observed and, where it makes sense, cancelled or changed by one cancelable `beforePlay` event. The game file declares the audio settings (tracks, voice counts, the voice cap and the default SoundFont). The old procedural net-new surface is gone and every 3.1 audio command still behaves exactly as before.

## Done when

1. `mediaPlay(file)` and the `midiplay`, `playmidi`, `mediaplay`, `mediastop`, `mediarest`, `midirest`, `wav`, `mp3`, `wavstop`, `mp3pause` and `setvolume` aliases behave as the Epic 6 parity ledger fixes them, with unchanged cue streams and goldens.
2. `mediaPlay` returns a voice object. The voice reads its core state, controls itself (stop, pause, resume, seek, loop, fade, volume, wait) and goes stale, with a located diagnostic, when its slot is taken by a later voice.
3. The `media` object and each track are emitters. Voices emit `started`, `stopped`, `ended`, `looped`, `paused`, `resumed` and `faded`; the track and `media` re-emit them, so `media.on("ended", ...)` hears every voice. Events are plain data, come from core audio state at the waits phase of the tick, and never from a runner's `audio.ended` report.
4. A cancelable `beforePlay` on `media` fires for every start of a voice, scripted or engine-originated, and carries its source (`script`, `board`, `animation`, `battle`, `menu`, `video`). Listeners may cancel it or change its file, volume or loop.
5. The main file carries an additive audio settings block (tracks with voice counts, the voice cap, the default SoundFont) that replaces the startup `defaultSoundFont` value and runtime `mediaTrack`. Legacy rows are untouched and settings stay out of saves.
6. A save carries playback as data. Audio state holds no callbacks; listeners live in script state and a package that is missing on load loses its listeners with a diagnostic, never a refused load.
7. `mediaTrack`, `mediaLoad`, the other net-new `media*` commands and queries, `&voice`, the `tkMD_*` constants and the `priority` and `syncTrack` arguments are removed, and every caller, fixture, golden, catalogue row and doc is migrated.
8. A pure-RPGCode package (ducking and stems driven by events) is pinned in a golden.
9. Every Epic 6 audio golden that does not use the removed surface is unchanged; typecheck, lint, licence, provenance, catalogue and command-docs gates pass.

## Boundaries

Changes `core/audio` only at its script-facing edge (events out, `beforePlay` in) and replaces the `media*` built-in pack. Does not change the audio state schema's playback fields, the cue stream, the runner protocol, the synth or Epic 9's audio handoff. Does not add positional audio, automatic ducking or a mixer UI. Epic 4's effect records for board music and frame sounds keep their shape; the applier gains one cancelable step in front of them. Legacy 3.1 compatibility is the oracle; Reawakened's own prior surface is replaced without shims.

## References

- spec - `docs/spec/engine/audio-media.md` (media command family, voices and layers, legacy command mapping, parity ledger)
- spec - `docs/spec/engine/rpgcode-functions.md` (audio rows), `docs/spec/formats/main-file.md`
- epic - `epic-audio-synth/epic-audio-synth.md`; `epic-rpgcode-platform/epic-rpgcode-platform.md`; `epic-actors/epic-actors.md`
- code - `packages/core/src/audio/`, `packages/core/src/script/packs/media.ts`, `packages/core/src/script/virtuals.ts`
- constraint - `docs/guardrails.md`, G1, G2, G3, G5, G7
- owner decisions - the 2026-10-19 conversation (recorded in Notes)

## Notes

- Decision: Jensen, 2026-10-19: Epic 6's media surface is net new, so only 3.1 compatibility must be preserved. There is ONE handle model and it is an object: `mediaPlay` returns a media (voice) object with the core audio information on it and events that can be processed on it, as the battle system's objects and events do. No integer `&voice` handle and no object façade over one.
- Decision: Jensen, 2026-10-19: legacy `mediaplay` is `void` and took one argument, so returning an object is compatible; every 3.1 call site is a bare statement.
- Confirmation: Jensen, 2026-10-23: the one-argument `mediaPlay(file)` form returns the MEDIA-1 voice object with the 3.1 music/loop defaults; the legacy-game corpus review found those calls are bare statements, so existing callers ignore the added value.
- Decision: Jensen, 2026-10-19: the core audio system is configured in the game file (`.gam` is the csproj of the toolkit); the default SoundFont lives there too.
- Decision: Jensen, 2026-10-19: naming standard: events are past-tense state changes (`ended`, `fallen`); cues stay imperative (`media.play`); diagnostics keep their `media.*` codes.
- Decision: owner position carried over from the Epic 19 party session (2026-10-19): actors and saves hold data only, never callables; listeners are script state, saved per 18.6.
- Source conflict: `docs/spec/engine/audio-media.md` (P3, P6, P7) specifies the procedural `media*` commands, `&voice` and `tkMD_*` as the author surface vs the owner's one-object-handle decision. Entry 21.1 amends the spec; the playback state, cue, wait and fade rules in it stand.
- Source conflict: `audio-media.md` (deferrals table) parks the project default SoundFont until the native project-file entry is incepted vs the owner's decision that it lives in the game file now. Entry 21.2 settles it with the Epic 19.9 mechanism.
- Source conflict: `audio-media.md#r-59-routing` and the effects table route engine-originated audio (board music, frame sounds, battle music) straight to the applier, so no script wrapper sees it vs the one `beforePlay` event. 21.4 adds the cancelable step at the applier.
- Assumption A-1 (to confirm): this is its own epic (21) rather than a slice of Epic 19, so closed Epic 6 stays a true record and Epic 19 does not grow; if the owner prefers a slice, entries 21.1 to 21.8 move to Epic 19 unchanged.
- Assumption A-2 (to confirm): working API names: global `media`, `media.track("ambience")`, `media.music`, `voice.stop()`, `voice.pause()`, `voice.resume()`, `voice.seek(seconds)`, `voice.fade(percent, seconds)`, `voice.wait()`, `mediaPlay(file[, options])` with a named-options dictionary (`track`, `loop`, `volume`, `priority`, `sync`, `wait`). 21.1 lists the final spelling.
- Assumption A-3 (to confirm): an engine-originated cancelable event has no script thread to park. Taken: Epic 19.11 and 21.1 rule it together; the working design is a short, budgeted dispatch inside the audio phase that runs listeners in registration order and never waits on input.
- Assumption A-4 (to confirm): the legacy `mediaplay(file)` plays on `music`, looping, as the Epic 6 parity ledger records; this has not been re-checked against the 3.1 behaviour beyond that ledger.
- Assumption A-5 (to confirm): objects with built-in methods need a host-provided or hydrated method mechanism in Epic 19 so a voice object carries data only and no closures in a save; entry 19.1 rules it and 21.5 depends on it.
- Sequenced: 21.1 rulings first; 21.2 (formats lane) and 21.3 (events lane) run in parallel after it; 21.4 follows 21.3 and 19.11; 21.5 follows 21.2, 21.3 and Epic 19's objects and receivers; 21.6 retires the old surface; 21.7 proves it; 21.8 sweeps.
- Handoff: Epic 7 (stock battle) and Epic 8 (stock menu) play their battle, cursor and menu sounds through this surface and list this epic in their `after`.
- Handoff: Epic 9's audio handoff is unchanged (cues and the runner protocol are not touched).
- Principle: see the initiative Notes Decision of 2026-10-19 (3.1 is a compatibility layer, not the model); 19.1 writes ADR 0009 and the CLAUDE.md working note.
- Delivered: entry 21.6 removed the retired surface from the command table, catalogue and reference (no alias or shim); the internal method targets stay `doc.access: "internal"`, so authors see only `mediaPlay`, the objects and the 3.1 aliases. The oracle's standard-call labels now use the options/object form; the re-recorded audio fixtures differ in those labels only.
- Delivered: entry 21.8 swept the seams — the media pack and its host types are registered once, the script barrel no longer exports the pack's internal `MEDIA_COMMANDS`/`readAudioView`, `ENGINE_PHASES` still lists `audio` once after `animation`, and the nine broken internal doc anchors are fixed. The Done-when is checked item by item in the plan with merged evidence.
- Audit: the closure audit (`discovery/closure-audit.md`) records the Done-when criterion by criterion against merged main: entries 1-11 are delivered and their issues closed, criterion 6's listener half and entry 21.12 (#843) remain owner-gated, so the epic stays open until that ruling lands.
