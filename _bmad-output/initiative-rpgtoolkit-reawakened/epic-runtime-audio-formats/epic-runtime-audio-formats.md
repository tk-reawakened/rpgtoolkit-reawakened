---
type: epic
title: "Compressed audio: runtime audio formats"
parent: initiative-rpgtoolkit-reawakened
covers: ["CAP-7", "CAP-12"]
risk: high
tracker_id: "#3471"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/3471"
---

# Compressed audio: runtime audio formats

## Outcome

Authors can ship smaller audio assets without expanding them to WAV in the game package. Players hear those tracks on the approved shipped hosts, with reliable timing and whole-clip loops. WAV and MIDI playback stay unchanged. The owner approved this epic regardless of codec; **Ogg Opus is the leading candidate, not a selection**.

## Done when

1. The owner has selected a runtime profile and supported host matrix using measured evidence, and the approved contract is documented before implementation. Compare compressed package size, time to first sound, and peak and retained decoded memory for long tracks against WAV. An unsupported host or stream is reported explicitly, not silently dropped or converted to WAV.
2. A shipped package preserves the compressed bytes and logical asset names and plays through the real player paths within the approved matrix. Independently counted trim, duration in 60 Hz ticks and audible loop boundaries agree; WAV and MIDI regressions and deterministic replay checks pass.
3. Codec and container handling stays in probe and decode adapters where the existing seams suffice; any change to the mixer, cues, saves or package format needs demonstrated necessity and a separate decision. Exact versions, shipped artefacts, licences, notices and CSP evidence are recorded for the selected path.

## Boundaries and ownership

- This epic owns runtime profile evidence and the eventual first-party compressed playback path. Reuse Epic 6's metadata, source and timing contracts (CAP-7), and Epic 9's browser, Electron, Capacitor and packaged-game surfaces (CAP-12); do not reopen their WAV/MIDI baseline or duplicate a player or package writer.
- Author inputs are a separate question from what the first-party runtime plays. Evaluate MP3, `.m4a` (an MP4-family container: distinguish AAC from ALAC), FLAC and other common inputs as potential import/tool paths, not as promises of native playback. Epic 14 owns editor import policy and tooling, audition/editor integration and export integration ([14.11](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1752), [14.12](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1753), [14.14](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1755)); it receives runtime proof and tool findings from this epic. Video conversion and custom loop tags are out of scope.
- Optional host/codec adapters composed through existing registries or seams are not a public third-party codec plugin feature. Investigate their distinction only: no new public API, loader, container, shared data shape, G6 bypass, or bundled dependency choice is authorised.

## References and sequencing

- [Proposed ADR 0044](../../../docs/adr/0044-media-import-contracts-and-tool-licensing.md), [audio format policy](../../../docs/spec/engine/audio-media.md#audio-format-policy), [runner CSP and audio path](../../../docs/spec/engine/runners.md#csp-and-the-audio-path), and [G6](../../../docs/guardrails.md#g6--licence-gate).
- 31.1 is the only authorised child and the first end-to-end feasibility check: probe a compressed asset, derive duration, play it through the packaged hosts and compare the evidence with WAV/MIDI. It reports evidence and a recommendation to the owner and [#1752](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1752); it does not approve a codec or wait on 14.11. Profile approval and production delivery are not part of this initial breakdown; no implementation tickets are scheduled.
- 31.1 pins completed providers 6.5, 6.11, 6.12, 6.15, 9.5, 9.7, 9.11 and 9.16. The browser Worklet path (9.18) and mobile wrapper (9.12) exist as evidence targets, not claims of full packaged codec coverage or whole-story completion. The spike reports any missing real host evidence as an explicit gap, rather than waiting on unrelated closure work or narrowing the host matrix.
