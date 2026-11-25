---
type: chore
title: "Prove compressed audio playback on shipped players, starting with Ogg Opus"
ticket: 1
status: draft
risk: high
---

# Prove compressed audio playback on shipped players, starting with Ogg Opus

## Scope

Investigate Ogg Opus first, not as a selected format. Use small authored or rights-cleared fixtures and an independently counted playable-frame oracle; add a representative long stereo track for resource measurements. Use disposable prototypes, not production changes. The outcome is a reproducible report with a recommendation and explicit gaps for the owner and [14.11 / #1752](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1752), not a ruling or shipping dependency choice.

## Acceptance and verification

1. **Real hosts and failures.** Run the packaged browser, Electron and Capacitor paths, including real WebView/device or emulator output, using their shipped policies and actual AudioWorklet graph, plus any fallback proposed as supported. Record host, OS/browser/WebView and artifact versions and exact invocation; show rendered audio rather than only a decoder result. Exercise unavailable/malformed/unsupported input; missing or failed lanes remain visible as unproven or blocked and must not be disguised as successful WAV fallback or a smaller matrix. Pace heavy runs per [AGENTS.md](../../../AGENTS.md).
2. **Timing and compatibility.** Independently count playable frames after pre-skip and end trim for Ogg Opus ([RFC 7845](https://www.rfc-editor.org/rfc/rfc7845)), verify deterministic 60 Hz length, repeat, seek and completion independent of device callbacks, and prove audible gapless whole-clip wraps at 44.1 and 48 kHz output, reporting any unavailable rates explicitly. Compare against existing WAV/MIDI cues and audible playback. No custom loop tags.
3. **Cost and seams.** Inspect compressed asset bytes in the package; compare package bytes, time to first sound, and peak and retained memory on long tracks with repeat and overlapping voices against WAV. Record whether full decoded PCM fits before recommending it, including any worklet transfer/copy cost. Test sharing `AudioInfo` for timing and `PreparedPcm` / `openPrepared` or `AudioSource` for playback, isolating format handling in probes and decode adapters. Show that mixer, cue, save and package contracts stay unchanged or identify a demonstrated need; do not design a new shape, container, public plugin API, or loading mechanism. An optional host adapter is not a public third-party plugin.
4. **Licences, policies and authoring.** Compare host-native and eligible bundled decoder candidates only as needed; pin exact artifact and dependency candidates and identify CSP, applicable licence/patent terms, transitive components and notice obligations under [G6](../../../docs/guardrails.md#g6--licence-gate). No policy relaxation, plugin exemption or bundling approval. Separately record author-supplied MP3, M4A/AAC, M4A/ALAC, FLAC and other common inputs, practical conversion/authoring options and missing-tool diagnostics. Include Audacity, `opusenc` and FFmpeg as author-installed recipe candidates; encoding settings are suggestions, not admission criteria. Hand editor and package-export integration to Epic 14; do not test or decide the independent video profile here.

## Prerequisites and evidence gaps

- Pin the completed Epic 6 metadata/source/PCM/conformance providers 6.5, 6.11, 6.12 and 6.15, and the completed Epic 9 shared session/audio/package/Electron providers 9.5, 9.7, 9.11 and 9.16. Those are paths to test, not compressed playback evidence.
- Reuse the Worklet artifacts from [9.18 / #1044](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1044) and the mobile wrapper from [9.12 / #940](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/940). The former's original acceptance evidence was browser-only; the latter is still in progress. Identify exact host/CSP gaps in the report; neither whole story is a prerequisite to beginning the spike. No dependency on 14.11 approval.
