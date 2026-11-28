---
type: chore
title: "Prove compressed audio playback on shipped players, starting with Ogg Opus"
ticket: 1
created: '2026-11-27'
status: built
baseline_revision: 'f81cd32a4ab22c0ea59adc58e89644a7398a088c'
route: full
route_source: auto
risk: high
review: quick
review_source: auto
lenses_ran: [quick, quick]
review_loop_iteration: 0
context: ['{project-root}/AGENTS.md', '{project-root}/docs/guardrails.md']
---

# Prove compressed audio playback on shipped players, starting with Ogg Opus

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The owner lacks packaged-player evidence to judge whether game audio can stay compressed. Decoder availability alone cannot establish correctly trimmed playback, repeat timing, or memory cost.

**Approach:** Use authored WAV and Ogg Opus pairs, plus existing WAV/MIDI controls, to exercise disposable adaptations of the actual browser, Electron and Capacitor players. Publish measurements and a recommendation for [14.11 / #1752](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1752), not a format or dependency decision.

## Boundaries & Constraints

**Always:** Work in the isolated tree. Keep production files, manifests, lockfiles, policies, mixer, cue, save and package contracts unchanged. Use the actual host package sources, unrelaxed CSP, audio worklet and a real unlock gesture. Run hosts serially, with settling pauses and bounded backoff, away from 13.21's heavy proofs.

**Never:** Substitute a decoder-only, silent, offline or desktop result for rendered mobile output. Don't relabel WAV as compressed success, add custom loop tags, approve a dependency, choose a codec, design a public plugin API, or change editor/export or video policy.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
| --- | --- | --- | --- |
| Trim and timing | Authored short stereo impulse/tone pair with nonzero pre-skip and end trim | [RFC 7845](https://www.rfc-editor.org/rfc/rfc7845) granule oracle agrees with playable frames; core duration, seek, repeat and completion agree at 60 Hz without device callbacks | Expose input- and output-rate frame discrepancies |
| Playback and cost | Short pair, long matched stereo pair, existing WAV/MIDI | Audible whole-clip wraps and unchanged controls; compare package bytes, onset, repeat and overlapping voice memory at actual 44.1/48 kHz graph rates | Label unavailable rates and separate graph output from physical output |
| Negative lanes | Missing asset, malformed Opus, unsupported format/layout, missing decoder or tool | Explicit diagnostics and no unintended audio; no silent fallback | Identify unsupported, failed and unproven rows separately |

</frozen-after-approval>

## Code Map

`tools/make-package/run.mjs` writes `.tpk` and its descriptor; reuse its canonical writer and verify logical-key byte identity without altering packaging.

- `tools/browser/tests/audio.spec.ts` already plays authored WAV through a real analyser and tests baseline MIDI with a Worklet; it uses 8 kHz fixtures and simulated cue timing, so it establishes neither Opus support nor 44.1/48 kHz tick alignment. `packages/synth/src/pcm.ts` supplies WAV `PreparedPcm`; there is no Opus decoder/source/fixture in the runtime paths found.
- `tools/desktop/probe-csp.mjs` and `packages/synth/test/browser-csp-probe.mjs` cover compressed SF3 bank samples, not compressed game-audio playback. The shipped player path is `packages/runner-web/src/live-session.ts` → `CuePlayer` → `PcmSink`/`AudioWorklet`. Desktop's CSP allowance for MIDI's eager WebAssembly decoder does not enable game-file decoding; strict browser/mobile CSP excludes that decoder.
- `tools/mobile/proof.mjs` checks demo presentation, canvas input, rotation and host blobs, but makes no audio assertions. There is no production or test Ogg Opus game-audio asset/source in the searched runtime/test paths; `.ogg` extension strings and placeholder headers alone are not playable fixture evidence.
- Probe prerequisites on this Mac: Node 26.13.0, pnpm 12.10.1, FFmpeg 9.0.1 with `libopus`, Playwright 1.64.0 with Chromium headless shell, Electron 45.2.1, Capacitor 8.5.3, JDK 21 (the shell's default was JDK 8), and an Android 13 arm64 AVD. `opusenc`, `opusdec` and SoX were not on `PATH`; the installed Audacity 3.7.5 GUI was identified but not used in the proof. FFmpeg is external, not a player dependency.
- [Audio format policy](../../../docs/spec/engine/audio-media.md#audio-format-policy), [runner CSP](../../../docs/spec/engine/runners.md#csp-and-the-audio-path), and [G6](../../../docs/guardrails.md#g6--licence-gate) constrain the probe. Keep existing WAV/MIDI and SF3 evidence distinct from the new Opus host matrix.

## Tasks & Acceptance

**Execution:**

- [x] `tools/spikes/runtime-audio/fixtures.mjs` — Generate reproducible authored WAV and Ogg Opus pairs with user-installed FFmpeg/libopus, inspect packet trim/granules independently, and verify impulse, package bytes and asset keys. Missing FFmpeg is explicit.
- [x] `tools/spikes/runtime-audio/host-probe.mjs` — Exercise disposable hosted pages under the shipped policy with real gestures, TPK bytes and audio worklet, at attained 44.1/48 kHz. Run matched WAV through the same cue path without the experimental decoder, and the independent existing MIDI control.
- [x] `tools/spikes/runtime-audio/runtime-audio.test.mjs` and `probe-guards.test.mjs` — Check the packet/trim oracle, unsupported inputs, frame clocks and finite end, rewound core position and wrap, and waveform/negative-lane guard failure.
- [x] `tools/spikes/runtime-audio/run.mjs` and `mobile-host.mjs` — Run and pace one actual host at a time; isolate Android build and writable device data. Capture artifact and runner hashes, host/OS versions, graph/rate/onset, overlap, memory and diagnostic observations.
- [x] `discovery/runtime-audio-playback-evidence.md` — Publish the exact commands, versions, hashes, fixture recipe and full host/rate matrix, including WAV/MIDI baselines, failures and explicitly unproven rows. Separate host and adapter capabilities, license/notice obligations and recipes for WAV, MP3, AAC, ALAC, FLAC, Vorbis and Opus. Hand off to [14.11 / #1752](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1752); make no codec, dependency or production-policy decision.

**Acceptance Criteria:**

- Given the same packaged fixture set, when each actually available shipped player runs at each attained output rate, the matrix shows observed audible graph output, trimmed length and gapless whole-clip repeat; WAV and MIDI remain independently identified controls and unattained rows remain unproven.
- Given matched long tracks, when playback starts, repeats and overlaps, the report distinguishes measured peak/retained memory and onset from calculated PCM and transfer bytes, and states what the evidence can establish without assuming a memory budget.
- Given recorded fixture hashes, host artifact hashes and reproduction commands, when another contributor runs each available host probe independently under shipped policy, the input, package and observed row are reproducible without a production-contract, dependency or policy change.


## Implementation Notes

**Implementation notes:**

- Derive complete single-link playable length from Ogg EOS granule position minus `OpusHead.pre-skip`; both use 48 kHz per [RFC 7845 §§4–5](https://www.rfc-editor.org/rfc/rfc7845.html). Independently parse page headers/lacing, packets, `OpusHead`, and EOS, cross-check summed packet durations against granule progression, and reject or explicitly report chained/multistream input. Cross-check decoded frame count separately; a shared encoder/decoder is not an independent oracle.
- Compare exact duration rationally when resampling to 44.1 kHz. Tick edges are 800 frames at 48 kHz and 735 at 44.1 kHz. Use boundary cases and repeated rendered output to expose a loop seam; lossy Opus smears an impulse, so use correlation/energy for acoustic evidence rather than demanding bit-identical impulse PCM. Measure sample rate and rendered graph frames/output, not `canPlayType`, `isConfigSupported`, or the requested context rate alone. A destination analyser proves graph output, not physical-speaker audibility.
- Browser `AudioDecoder` accepts encoded chunks, not Ogg pages; native media capability and native `decodeAudioData` do not demonstrate integration with `CuePlayer`/`PcmSink`. Keep any host decode shim probe-only and send its decoded PCM through the packaged runner's real Worklet output. Report this evidence separately from native end-to-end audio support.
- Locally installed FFmpeg 9.0.1 exposes `libopus` and `ffprobe` and was built with `--enable-gpl --enable-version3`. The fixture manifest records `ffmpeg -buildconf`; the binary is not bundled or approved.

## Plan Change Log

- Implementation uses a probe-only native decoder and WAV conversion, then the production `PcmSink` and `CuePlayer` in a disposable worklet on the exact host origin/CSP. Production policy and dependency manifests are unchanged.
- On the installed Android SDK the user's original AVD storage rejected the APK, so the proof creates disposable storage. API 33's WebView also lacks `Element.checkVisibility`; the existing Android CDP helper sends a trusted touch to a measured button location instead of using Playwright's unsupported locator visibility path.
- Independent re-review found a 0.2 s negative capture could stop before the fixture's 0.5 s authored impulse, and the shared ADB daemon could recycle transport IDs after restart. Require at least 0.6 s of observed silence from each play marker; scope Android to a per-run USB-, emulator-discovery- and mDNS-disabled daemon on a read-only private Unix socket, expose only guarded per-run loopback relays to Playwright and the owned emulator, and fail closed on daemon or transport loss. Before device access, verify both selected console/ADB listener PIDs are in the launched emulator's process tree; repeat that ownership check before every write.
- [Evidence and reproduction](discovery/runtime-audio-playback-evidence.md) records graphs, raw artifact identities, separate control runs and the remaining policy decisions.

## Review Triage Log

Two independent reviewers covered the timing/package oracle and the host/measurement harness; both revisited their findings after correction. The table records the review outcome, not a change to the approved scope.

| Finding | Verdict / disposition | Evidence |
| --- | --- | --- |
| [#3645](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/3645) Archive lookup bypassed game asset resolution | Medium / patched | Resolve `Media/` with the production index; lowercase key, exact hash and intentional invalid-lookup red. |
| [#3643](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/3643) Cue stub did not prove core clock | Medium / patched | Real audio runtime receives the trim oracle's duration, crosses wrap, and finishes at the exact core tick without a device callback. |
| [#3647](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/3647) Correct duration hid leading pre-skip displacement | Medium / patched | Independent FFmpeg-decoded PCM impulse and rendered impulse must lie within 5 ms. |
| [#3648](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/3648) Malformed headers and code-2 packet framing passed | Medium / patched | CRC-valid invalid-header and framing assertions plus real generated fixture validation. |
| [#3644](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/3644) Valid full final-packet trim rejected | Medium / patched | The EOS lower-bound equality case passes; trimming one frame farther fails. |
| [#3646](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/3646) Prepared voice could end one frame late | Medium / patched | Require `ended` immediately after the actual final sample, including the observed one-frame-short shape. |
| [#3649](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/3649) Native require path used as ESM import | Low / patched | Resolve from existing runner dependency and convert to a file URL. Windows host playback was not run. |
| [#3657](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/3657) Shared ADB daemon could reassign transport IDs after restart | High / patched | Per-run daemon in a non-writable private Unix-socket directory with USB/mDNS disabled and local emulator scanning capped at the chosen console port; require the console's AVD identity, sole serial, stable ID, live child, and lsof-verified process ownership of both console/ADB listening ports before any device access or write. |
| [#3653](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/3653) Android could replace an existing user's APK | High / patched | Forbid external serial and refuse already connected devices; only the owned disposable emulator receives the APK. |
| [#3656](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/3656) Probe overwrote standard mobile output | High / patched | Stage Gradle project, web assets and copied APK below the per-run artifact directory. |
| [#3652](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/3652) Sine correlation alone could pass on the wrong loop | Medium / patched | Require actual impulse separation and measured seam silence; absent-repeat and displaced-repeat cases fail. |
| [#3655](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/3655) Play markers did not prove both voices; 0.2 s silence could hide later impulse leakage | Medium / patched | Mixed PCM must match aligned solo windows; require 0.6 s PCM from each negative play marker and zero peak; both old-window and leaked-waveform perturbations red. |
| [#3650](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/3650) WAV and MIDI controls absent | Medium / patched | Run the full matched WAV timeline through the PCM source and use the existing MIDI fixture and TK-16 SF2 digests. |
| [#3651](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/3651) Missing/unsupported requests or missing rows could pass | Medium / patched | Real failed load and play, exact controller-owned IDs and ordered diagnostics, silence and native malformed rejection; omitted-row red. |
| [#3654](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/3654) Trusted click reported as observed unlock | Medium / patched | Pre-gesture, at-gesture and resumed context states reported separately. |
| [#3660](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/3660) Missing overlap memory samples and unmatched WAV memory | Medium / patched | Require baseline, page-observed worklet-acknowledged overlap, active samples and context-close sample in both legs; disclose message delay, allocator, process-scope and order limits. |
| [#3661](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/3661) Launched Electron runner bytes not pinned | Medium / patched | Reports hash the built main and preload files passed to launch. |
| [#3662](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/3662) Chromium headless mute not disclosed | Low / patched | Graph output only; reports note Playwright's mute. |
| [#3658](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/3658) Retried pending Android bridge operations | Medium / patched | Bounded attach/touch with no duplicate uncancelled request; serial boot polling only for cancellable commands. |
| [#3659](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/3659) Cleanup did not require emulator exit | High / patched | Bounded child shutdown requires exit before deleting the isolated writable images; propagates cleanup failure. |
| [#1215](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1215) CSP assertion accepted a copied string | Medium / probe patched | Independently verify a blocked inline script on every lane; existing broader CSP issue is not closed by the spike. |
| [#3663](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/3663) Core seek oracle could pass without seeking | Medium / patched | Rewind to a non-natural position and require deferred wrap; omit the seek and the positive playhead assertion fails. |
| [#3664](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/3664) Accepted audio continuation on tags page and negative header granule | Medium / patched | Reject CRC-valid mixed/continued audio and any nonzero header-completion granule. |
| [#3665](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/3665) Zero-byte frame rejected, oversized frame accepted | Medium / patched | Accept TOC-only code-1 and impose the 1,275-byte inferred frame ceiling in all branches. |
| [#3666](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/3666) Writable AVD SD image could remain shared | High / patched | Pass a private data directory and SD image path, disable cache and snapshots; clean up only the owned directory after exit. |
| [#3667](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/3667) Native channel loss hidden by adapter conversion | Medium / patched | Assert authored channel count before conversion; do not infer left/right separation from dual-mono stimulus. |
| [#3107](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/3107) Worktree inherited stale compiled exports | Medium / build prerequisite corrected | Missing source exports reproduced in baseline build; forced scoped TypeScript rebuild and regenerated probe bundles, then reran the real host matrix rather than reusing earlier hashes. No shared build-system change. |

## Verification

- After rebuilding the pinned audio artifacts and correcting review findings, the focused spike, core, synth, runner-web and private-ADB helper tests passed; targeted perturbations fail at their intended assertions. The final affected-lane suite after the emulator port-owner guard passed 19/19 tests, with scoped ESLint and syntax checks clean; the ownership test log SHA-256 is listed in the [evidence report](discovery/runtime-audio-playback-evidence.md#negative-lanes-and-falsification).
- Actual corrected matched WAV/Opus host runs: 12 pairs (24 format legs), each at 44.1 and 48 kHz with 2 s and 60 s clips on Chromium, Electron and Capacitor Android. The [corrected replay matrix](discovery/runtime-audio-playback-evidence.md#corrected-review-replay-matrix-final) pins run IDs, JSON/APK hashes, frame measurements and negative-lane silence. iOS, physical speaker output, other platforms and long-term drift remain unproven.
- Package descriptor checks and the existing browser audio / Electron CSP-SF3 controls are recorded separately. No codec or dependencies were selected. Production source, manifests/lockfile, goldens, and policy did not change. The remote required gate remains subject to CI and independent corrected-head review.
