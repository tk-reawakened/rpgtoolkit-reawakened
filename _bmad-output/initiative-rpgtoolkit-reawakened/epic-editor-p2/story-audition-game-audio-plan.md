---
type: feature
title: "Audition game audio"
ticket: 5
status: draft
risk: medium
---

# Audition game audio

## Scope

Provides accessible play, stop and loop audition of supported game audio through existing synth and host audio services, including the project default SoundFont and explicit capability and autoplay failures.

Use packages/synth and platform-services rather than another sound engine; report unsupported formats and browser autoplay unlock explicitly. The Epic 6 handoff also names MP3/OGG and AVI transcode on import; this audition story does not implement an importer or transcoder, and the initiative owner must assign or decide that separate handoff rather than treat preview as fulfilling it.

## Acceptance and verification

MIDI and WAV play and stop in supported hosts with the configured SoundFont, loop is observable, unsupported media is explained, and audition does not alter or save the source asset.

The [issue acceptance](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1748) is capability-gated: it specifies WAV/MIDI, loop, the configured SoundFont, refusal messages and no source writes, but does not enumerate a VS Code audio adapter or separate sound-picker preview surfaces. The shipped browser editor provides audio output; the board's editable reference accepts music or effect files from the project's media folder without applying the draft or running a game. A host without audio output (including the current VS Code host) reports that audition is unavailable. This is not a claim of VS Code playback parity or an import-time preview contract.

`tools/browser/tests/editor-audio-audition.spec.ts` exercises the shipped browser page with a real project directory, native AudioWorklet PCM, audible output beyond a single WAV duration, Stop, MIDI with the configured bank, an unsupported format and unchanged project bytes. The supported browser deployment owns the concrete adapter; the shared editor receives output through `platform-services`.

## Dependencies and decisions

Requires 6.5 (WAV/MIDI metadata), 6.15 (audio protocol), 9.5 (synth cue player and web output), 9.6 (SoundFont resolution), 11.1, 11.4 and 11.6 (project setting). Follow the approved contracts and capability declarations; do not assume unimplemented provider behavior.
