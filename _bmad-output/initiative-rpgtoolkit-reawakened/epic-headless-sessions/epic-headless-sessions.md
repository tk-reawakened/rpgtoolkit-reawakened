---
type: epic
id: 24
tracker_id: "#727"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/727"
title: "Headless sessions: screenshots, short videos, start state and mocks"
parent: initiative-rpgtoolkit-reawakened
covers: ["CAP-12", "CAP-13"]
assignee: ""
risk: medium
inputDocuments: ["docs/adr/0012-headless-sessions-capture-and-mocks.md", "docs/adr/0002-core-pixels-and-deterministic-maths.md", "docs/guardrails.md", "docs/spec/engine/rpgcode-functions.md", "_bmad-output/initiative-rpgtoolkit-reawakened/architecture-rpgtoolkit-reawakened/architecture-rpgtoolkit-reawakened.md"]
---

# Headless sessions: screenshots, short videos, start state and mocks

## Outcome

Anyone (an author, a reviewer, CI or an AI agent) can start a game headlessly from a chosen state, with the outside world mocked, and get exact screenshots and short videos with sound out of it. Every session is described by one manifest, so it can be replayed byte for byte. The design is [ADR 0012](../../../docs/adr/0012-headless-sessions-capture-and-mocks.md).

> **Video export needs FFmpeg, installed by the user.** MP4 export starts an FFmpeg the user installed. We never bundle, link or ship it. Without it, the lossless PNG frames and WAV masters still work.

## Boundaries and ownership

* All work is in the headless harness: `runner-headless`, building on `runner-harness`. **No core change.** The harness drives the existing `Engine` API from outside.
* Fixtures compile to RPGCode built-ins documented in `docs/spec`; they never edit state JSON.
* Exposing snapshot and restore on `Engine` is **out of scope**. If a fixture cannot reach a needed state, that becomes its own ticket and decision (ADR 0012, Decision 2).
* WebSocket transport, WebCodecs export in browser and desktop hosts, and trailer tooling are later work.
* The resolution and scaling model for live runners (logical resolution, render scale and output) is a separate topic, not this epic.

## Ordered backlog

| Entry | Title | Kind |
|---|---|---|
| 24.1 | Write the session protocol, manifest and capture reference | specification |
| 24.2 | Session manifest and mockable responders | implementation |
| 24.3 | Start states and typed fixtures | implementation |
| 24.4 | Screenshots: PNG writer, capture and hash sidecar | implementation |
| 24.5 | Masters: tick-scheduled frames and offline WAV | implementation |
| 24.6 | MP4 export through a user-installed FFmpeg | implementation |
| 24.7 | JSON-RPC session protocol over stdio | implementation |
| 24.8 | Verify replayability, isolation and guard-rails | acceptance |

## Cross-cutting acceptance (every entry)

* `core` is unchanged; golden, closing and dump output do not move (G5).
* No new copyleft dependency; FFmpeg is never a dependency, vendored, downloaded or shipped (G6, ADR 0012 Decision 6).
* Captures are scheduled in ticks, never wall-clock time; replaying the resolved manifest reproduces masters and hashes exactly.
* User-facing help text explains each option simply first, then exactly (units, ticks, order, whether it waits).

## Scheduling

All entries start in **Backlog (no Sprint)**. 24.1 is first and gates the rest (G7: docs before code). 24.6 also waits for ADR 0012 to be accepted, because it relies on the G6 clarification.

## Done when

1. The reference in `docs/` describes the manifest, the fixtures, the mocks, the captures and the protocol, with help text.
2. A manifest can start from `boot`, `scene`, `save` or `prefix`, apply typed fixtures and mock every request kind.
3. Screenshots, PNG-frame and WAV masters, and (with FFmpeg installed) MP4 with sound are produced from a session.
4. The stdio protocol drives a session live, and the resolved manifest replays it exactly.
5. Entry 24.8 records the evidence, with goldens unchanged.

## References

* `docs/adr/0012-headless-sessions-capture-and-mocks.md`
* `docs/adr/0002-core-pixels-and-deterministic-maths.md`
* Architecture spine: AD-1, AD-3, AD-4, AD-5, AD-14, AD-16, AD-27
* `docs/guardrails.md`: G1–G7

## Notes

* Decision: 2026-10-28, owner: the harness, not the core, owns capture, mocks and the protocol; MP4 with sound is required; typed fixtures are wanted; stdio first, WebSocket later; video export needs a user-installed FFmpeg.
* When ADR 0012 is accepted, `docs/guardrails.md` G6 gains the external-tool clarification (ADR 0012 Decision 6) in the same change.
