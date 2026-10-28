# ADR 0012 — Headless sessions: screenshots, video, start state and mocks

* **Status:** Proposed (owner direction, 2026-10-28); the protocol and manifest reference lands first (Epic 24, entry 24.1)
* **Date:** 2026-10-28
* **Epic:** 24 (`epic-headless-sessions`), #727
* **Amends:** [guardrails.md](../guardrails.md) G6, by clarification only (Decision 6)

## Summary

The headless harness (`runner-headless`, built on `runner-harness`) grows from a one-shot dump and golden tool into a **session** that can:

1. take **screenshots** that are exactly the reference pixels;
2. record **short videos with sound**;
3. **start from a chosen state**, including typed fixtures such as "put the player here, holding this item";
4. **mock** everything outside the engine: assets, saves, plugins, video, quit and URLs.

All of this lives in the harness. **The core does not change.** The harness drives the existing `Engine` API from the outside, as the golden tests already do.

> **Video export needs FFmpeg, installed by the user.**
> MP4 export runs an FFmpeg the user installed. We never bundle, link or ship it. Without it, the harness still records the exact frames and sound, and says plainly that MP4 export is unavailable.

## Context

Authors, reviewers, CI and AI agents need to *see* what a game does: a screenshot for a bug report, a short clip of a cutscene, a frame at a given tick from a known state. They also need to run a game with parts of the outside world replaced, for example a plugin that always rolls a 6, or a save slot that already holds a file.

The architecture already provides what this needs:

* `advance(ticks, inputs)` runs whole fixed ticks; inputs go through the canonical input log ([AD-1](../../_bmad-output/initiative-rpgtoolkit-reawakened/architecture-rpgtoolkit-reawakened/architecture-rpgtoolkit-reawakened.md)).
* `drawList()`, `surfacePixels()` and `core/raster` give the exact reference pixels ([ADR 0002](0002-core-pixels-and-deterministic-maths.md), AD-3, AD-4, AD-27).
* Everything outside the engine reaches it as a **request and reply** (`asset`, `loadBlob`, `saveBlob`, `listBlobs`, `playVideo`, `extension.call`, `quit`, `openUrl`; AD-5, with every reply entering as an input, AD-14).
* `synth` renders PCM by pull (`render(left, right, frames)`), so sound can be rendered offline in step with ticks.

## Decisions

### 1. A session is described by one manifest

A **session manifest** is a plain JSON file: the game, the seed, the start state, the fixtures, the mocks, the inputs and the captures. Running the same manifest on the same build gives the same frames, sound samples, state hashes and draw-list hashes. A video is therefore something rendered from a replay, not a separate recording.

The harness writes out the **resolved manifest** at the end of a session, including inputs that arrived live, so any session can be replayed exactly.

### 2. Start state

| Mode | Meaning |
|---|---|
| `boot` | Normal start-up from the main file (`BootInit`). |
| `scene` | One board plus an optional program, with no start-up (`SceneInit`). |
| `save` | The harness serves a save file through its mocked `loadBlob` responder, and the game's own load path restores it. |
| `prefix` | Any of the above, then a recorded input log fast-forwarded before capture starts. |

**Typed fixtures** (`placePlayer`, `giveItem`, `setVariable` and others, listed in the reference) are a harness façade. The harness **compiles them into an RPGCode setup program** made only of built-ins documented in [docs/spec](../spec/engine/rpgcode-functions.md) (for example `putplayer`, `send`, `giveitem` and plain assignment). It runs that program as the scene `program`, or in boot mode through an asset-overlay wrapper around the game's start-up program. This keeps every fixture inside what the engine can reach by itself. Fixtures never edit snapshot JSON, because hand-edited state can be a state the engine could never reach, and it breaks when the state shape changes.

If a needed state is still out of reach, the fallback is to expose the snapshot and restore code that already exists in `core/save` through the `Engine` API. That would be a general engine capability, decided in its own ticket, not a harness feature.

### 3. Mocks are swapped responders

Mocking means the harness answers engine requests with stand-ins: an asset overlay folder, placeholder or failing assets, in-memory or read-only saves, fixed or scripted `extension.call` results, `playVideo` that ends at once or after N ticks, and `quit` / `openUrl` that are recorded and ignored. Time is the virtual tick clock, run as fast as possible or at real-time pace; randomness is the manifest seed. The mock settings are part of the manifest, and the harness logs every request it answered and how.

### 4. Captures

* **Screenshot:** one frame from `core/raster` at logical resolution, written as PNG by a small encoder in the harness (deflate via `fflate`, already allowlisted). Options: integer nearest-neighbour `scale`, `region` crop, and whether the cursor is drawn. A sidecar JSON records `tick`, `stateHash`, `drawListHash` and the manifest hash.
* **Masters (always available):** frames captured on a **tick schedule** (`every: n` ticks), never on wall-clock time, as a numbered PNG folder, plus a **WAV** of `synth` rendered offline in step with the same ticks. Audio sample positions are derived from ticks by an exact integer rule, so sound and picture stay in sync. Masters are lossless and deterministic: replaying the manifest reproduces them byte for byte.
* **MP4 (when FFmpeg is installed):** derived from the masters, H.264 video and AAC audio. Lossy, so it is never compared in tests; tests compare the masters.

APNG is not the primary video format because it has no sound.

### 5. Protocol

JSON-RPC 2.0 over **stdio** first; WebSocket later, over the same methods. Groups: session (`open`, `close`, `manifest`), time (`run`, `pause`, `step`, `setPace`), input (`send`), capture (`screenshot`, `startVideo`, `stopVideo`), state (`hashes`), mocks (`set`, `log`), and events (`diagnostic`, `request`, `paused`, throttled `frame`). The full reference, with help text that explains each method simply first and then exactly (units, ticks, order, whether it waits), lands in `docs/` before any code.

### 6. FFmpeg is an optional external tool, not a dependency (G6 clarification)

**Video export needs FFmpeg, installed by the user.**

* The harness looks for an `ffmpeg` executable on `PATH`, or at a path given in configuration, and starts it as a **separate process**. It sends raw RGBA frames and PCM through pipes and passes command-line arguments. It never links FFmpeg libraries and never loads `ffmpeg.wasm`.
* FFmpeg is **never** a package dependency, never vendored, never downloaded by our tooling, and never included in anything we ship (npm packages, installers, images, extensions).
* Without FFmpeg, MP4 export fails with one clear diagnostic that says to install FFmpeg. Screenshots and masters still work.

*Reason:* G6 bans copyleft dependencies. FFmpeg is LGPL, or GPL when built with encoders such as x264, as most ready-made builds are. Running a separately installed program at arm's length, over pipes and arguments, does not combine it with our code, and we do not distribute it, so neither G6's purpose nor the licence is engaged. Distributing an H.264/AAC encoder would also carry patent questions; a copy the user installs is not ours to distribute.

G6 is clarified as follows: *an optional external program that the user installs, that we start as a separate process and never bundle, link, vendor or download is not a dependency. Each such tool is named in an ADR.* FFmpeg is the first, named here.

## Guard-rail check

* **G1, G3:** time is the injected tick clock, inputs go through the canonical log, and captures are scheduled in ticks. Nothing in the core reads wall-clock time.
* **G2:** files, processes, pipes, PNG, WAV and the protocol live in the harness. `core` is unchanged.
* **G4:** frames come from `core/raster`; no renderer is involved.
* **G5:** a screenshot of a golden run equals the golden bitmap, and capturing never changes `stateHash`. Goldens do not move.
* **G6:** no new copyleft dependency; FFmpeg is handled by Decision 6.
* **G7:** fixtures compile to built-ins documented in `docs/spec`; the reference is written before the code.

## Consequences

**Positive**

* Screenshots and clips are exactly the reference output, so a failing test can hand over the frame and the manifest that reproduces it.
* Agents, CI, the VS Code extension and humans share one way to drive and observe a game.
* No core change and no new copyleft dependency.

**Negative / risks, with mitigations**

* *CPU rasterising is slow at high logical resolutions.* Sessions are for previews, tests and short clips, not real-time play; captures are tick-scheduled and may run slower than real time.
* *MP4 depends on the user's FFmpeg build and version.* The harness checks `ffmpeg -version` and the encoders it needs, then reports exactly what is missing; masters do not depend on it.
* *Fixtures limited to documented built-ins may not reach every state.* The snapshot fallback in Decision 2 is kept as a separate, later decision.

## Alternatives considered

* **Bundle FFmpeg or `ffmpeg.wasm`.** Rejected: ships copyleft code, with source-offer duties for each build and possible codec patent exposure.
* **Mediabunny.** Rejected: MPL-2.0, banned by G6.
* **Revideo / Motion Canvas.** Rejected as the recording engine: it authors its own scenes in headless Chrome and installs an FFmpeg binary itself. It could be considered later as a separate dev-only trailer tool, which would need its own ADR entry.
* **Built-in permissive encoders (VP9/AV1 with Opus, as WebAssembly).** Deferred: heavy to build and maintain, and its MP4 support is weaker in common players. May return for browser and desktop hosts through WebCodecs.
* **APNG as the video format.** Rejected as primary: no sound.
* **Typed fixtures that edit state JSON.** Rejected: can create unreachable states and couples tools to the state shape.

## References

* [ADR 0002](0002-core-pixels-and-deterministic-maths.md): pixels in the core, `core/raster`, dev-only tools named in an ADR.
* Architecture spine: AD-1 (engine API), AD-3 (draw list), AD-4 (reference rasteriser), AD-5 (requests), AD-14 (inputs and the log), AD-16 (audio cues), AD-27 (surfaces), AD-33 (logical viewport).
* [guardrails.md](../guardrails.md): G1–G7.
* `_bmad-output/initiative-rpgtoolkit-reawakened/epic-headless-sessions/`: the epic and its entries.
