---
type: epic
title: "Games play in the browser; desktop, mobile and packaging wrap the same core"
parent: initiative-rpgtoolkit-reawakened
covers: ["CAP-12"]
assignee: ""
risk: medium
---

# Games play in the browser; desktop, mobile and packaging wrap the same core

## Description

`render-webgl2` replays draw lists, `runner-web` outputs audio through Web Audio and loads assets by fetch and OPFS; `runner-desktop` and `runner-mobile` wrap it, and a game can be packaged into a single file and legacy packages imported.

## Outcome

Anyone can play a legacy game in a browser; the CAP-12 success check, sample games playing in the browser and a packaged file loading, is the signal.

## Done when

1. The sample games play in a browser from the same core build the headless runner uses.
2. The WebGL2 replayer and the CPU rasteriser agree within the golden tolerance on the golden draw lists (G4).
3. A recorded input log replays to identical state hashes under Node and in a headless browser (G3).
4. A packaged single-file game loads in the web and desktop runners.
5. The mobile wrapper runs a sample game on a device or emulator.

## Notes

- Open question (epic 6 evidence gap, filed as issue #877): a headless-browser SoundFont playback test. `packages/synth/test/render.test.ts` proves the MIDI-through-bank path under Node; the browser limb of epic 6's Done-when 2 has no test, and this repository has no browser runner. The assertion belongs to this epic's browser job (its Done-when 3 already requires a browser replay), so it is carried here until this envelope gets a `tickets.toml`. Adding Playwright for one assertion now was rejected; the licence (Apache-2.0) is acceptable, the scope is not.

## Boundaries

`render-webgl2`, `runner-web`, `runner-desktop` and `runner-mobile` as wrappers, and game packaging through the core package writer. Not the desktop editor shell (epic desktop-shell) and not editor hosts.

- Touch point: Capacitor and the chosen desktop shell - consumed; owner: this epic for the runner wrapper, epic desktop-shell for the editor

## References

- spec - _bmad-output/initiative-rpgtoolkit-reawakened/spec-rpgtoolkit-reawakened/spec-rpgtoolkit-reawakened.md, section Capabilities
- spine - _bmad-output/initiative-rpgtoolkit-reawakened/architecture-rpgtoolkit-reawakened/architecture-rpgtoolkit-reawakened.md, AD-1, AD-3, AD-4, AD-5, AD-6, AD-14, AD-27
- constraint - docs/guardrails.md, sections G3 and G4
- reference - docs/spec/engine/main-loop-and-startup.md#e-130 to E-132
- reference - docs/architecture-options.md, section 8

## Notes

- Open question: the desktop runner shell depends on the same Tauri, Electron or Electrobun spike as epic desktop-shell; decide which epic runs the spike.
- Decision: epic set approved by the user, 2026-10-10.
- Waits on board-rendering because: draw lists to replay.
- Waits on audio-synth because: audio cues and synth.
- Waits on battle because: battle.
- Waits on menu-party-save because: menu and save.
- Decision: envelope re-sliced against the architecture spine, 2026-10-10.
- Open question: image storage and transfer for web play. Legacy art is BMP, GIF and JPG with no PNG (`docs/spec/formats/images.md` survey, PR 2.19). Decide the stored image format, whether BMP and GIF transcode to it on import, and whether lossless WebP is added beside PNG. Settle at inception.
- Assumption: PNG is the baseline stored format, indexed where the image has 256 colours or fewer. JPG stays JPG, never transcoded to a lossless format.
- Assumption: WebP is adopted only if lossless WebP beats PNG by enough on the sample games, after gzip or brotli, to justify a second pure-TS decoder in core (G2, G3). Any encoder dependency must meet G6; `sharp` is out because libvips is LGPL.
- Assumption: a per-board asset preload and a decoded-pixel cache live in the runner layer and can be discarded without changing behaviour (G4, guardrails.md section G4).
- Waits on tk2-support because: BMP and GIF decoders (entries 16.11 and 16.12) to transcode from.
- Decision: image-storage work is this epic's, 2026-10-12; it may move to another epic at inception.
- Decision: Jensen, 2026-10-15: `docs/spec/` replaces `docs/format-spec.md` and `docs/engine-features.md` as the normative spec (ADR 0007, entry 1.13); the owner attests it is clean (extraction-log round 4).
- Evidence: docs/spec/examples/files/example_game.tpk and standalone_layout.exe.bin are a committed `.tpk` and `CMP1` EXE, usable for Done-when 4. docs/spec notes the original wrote saves from PAK games into a temporary folder deleted on exit.
- Handoff (epic board-rendering inception, 2026-10-16): epic 4 entry 4.6 commits per-command rasteriser conformance vectors (key, tint, blends, scaling, scratch targets) and entries 4.8 and 4.9 add text vectors to the same directory; entry 4.26 commits the golden draw lists with a ledger of oracle classes (`golden/ledger.json`); the WebGL2 replayer's CPU-agreement check (CAP-6) replays exactly those. Entry 4.7 gives `engine.surfacePixels(id, rev)` for runner texture caches; a runner may flush every cache each frame (AD-27 check). Entry 4.5 adds the pinned Bun lane the cross-engine checks use.
- Owner concern (2026-10-18): first loads mid-game must not stall visibly. AD-5 already keeps stalls from changing results (blocking requests freeze time, music and video stream, hints cannot change state), so this is presentation and caching work. Full proposal: `epic-audio-synth/discovery/audio-exploration.md` §7. Settle at inception:
  - Assumption: two load modes. Below about 64 MB the whole package downloads once behind the title screen with progress and is kept offline; every corpus game fits (largest about 33 MB uncompressed). Larger games stream using prefetch hints.
  - Assumption: core computes a deterministic prefetch plan from data and sends AD-5 hints in tiers (now: current board; next: edge-linked and literal `send` boards, battle background and enemies; always: menu sounds and the active SoundFont). This needs a small core entry at the AD-5 seam. It refines the per-board preload assumption above so runners do not reparse boards.
  - Assumption: `manifest.json` `index` entries gain a content hash and size, giving immutable cache keys, delta updates and a safe service-worker offline mode.
  - Assumption: hints also trigger worker-side decode (images, WAV/ADPCM, MIDI, SoundFonts); storage is memory, then Cache Storage/OPFS, then network; `navigator.storage.persist()` with streaming fallback on quota errors; offer PWA install (Safari eviction rules unverified).
  - Assumption: a blocking stall keeps the last frame, shows a spinner only after about 300 ms, and keeps music playing.
- Handoff (from epic audio-synth exploration, 2026-10-18): runner audio settings include per-bus volume, mute and a SoundFont picker (bundled, CDN, or any user `.sf2`) as player preferences. The runner implements epic 6's rules for autoplay unlock, focus pause and late-SFX drops, and caches SoundFonts per runner, shared across games.
- Open question (from epic audio-synth exploration, 2026-10-18; owner direction that runners in any language share one shape): should the whole runner boundary (draw-list replay, audio, input events, AD-5 requests) get what epic 6 proposes for audio? That is a normative behaviour page, a language-neutral message schema, and conformance vectors a non-TypeScript runner can replay. Settle at this epic's inception; see `epic-audio-synth/discovery/audio-exploration.md` §12.
- Handoff (epic audio-synth entry 6.3, proposed, pending owner review, 2026-10-18): the audio contract this epic implements is in `docs/spec/engine/audio-media.md#epic9-audio-handoff`: autoplay unlock as a delayed late start (`#audio-autoplay`), focus pause by default (`#audio-focus`), the 15-tick late-sound drop measured from ready (`#audio-late-sounds`), audio prefetch tiers and a SHA-256 keyed SoundFont cache shared across games (`#audio-prefetch`, `#audio-soundfont-cache`), the user `.sf2` contract (`#soundfont-user-bank`), and the browser playback test and `wasm-unsafe-eval` note (`#audio-browser-test`; Done-when items 2 and 3 of epic audio-synth are delivered here against that contract). Video: the portable profile (WebM, VP9, Opus; browser support unverified, verify here) and the `playVideo` / `video.ended { reqId }` contract (`#video-policy`, `#video-request`). The core prefetch planner and hint wire shape remain this epic's inception to create.
