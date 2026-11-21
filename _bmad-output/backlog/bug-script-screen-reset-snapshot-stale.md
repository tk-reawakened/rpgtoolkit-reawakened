---
id: 20
type: bug
title: "Snapshot persists stale script-screen pixels after a batched reset"
parent: none
covers: []
after: []
tracker_id: "#3282"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/3282"
refined: true
hitl: false
risk: medium
severity: P2
---

# Snapshot persists stale script-screen pixels after a batched reset

## Description

Resetting an existing script-screen layer inside a batch does not change its pixels in a whole-state snapshot taken before the batch ends. The snapshot must include the layer's current reset state, not the pixels from before the reset.

## Reproduction

On Node v26.13 at merged revision `d907521ec9aabd54c4a16e096c05b9071a2af1ce`, create a 1×1 presented surface and a 1×1 script-screen layer seeded to `[90, 80, 70, 255]` before opening a batch. Begin a batch, call `resetScriptScreen`, and call `snapshot(game)` before ending the batch. The live script-screen pixel reads as zero RGB, but the snapshot contains `[90, 80, 70, 255]`. Expected snapshot pixel: `[0, 0, 0, 0]`.

## Cause Hypothesis

Whole-state snapshot materialization flushes the presented surface but does not materialize the pending script-screen edit.

## Verify

`node --test --test-name-pattern="issue #3282" packages/core/test/surface-batch.test.ts`

## Acceptance Criteria

1. **A snapshot observes the current script-screen reset state**
   **Given** 1×1 presented and script-screen surfaces, with the script-screen pixel seeded to `[90, 80, 70, 255]` before a batch
   **When** `resetScriptScreen` runs and a whole-state snapshot is taken before that batch ends
   **Then** the live pixel and serialized script-screen pixel are both `[0, 0, 0, 0]`
2. **Tests cover the condition found and fixed**
   **Given** the focused save and surface regression tests
   **When** the Verify command runs
   **Then** a test name containing `issue #3282` runs and passes, and its reported RGBA bytes show the serialized script-screen pixels match the reset state
3. **Or: no change is needed, with proof**
   **Given** the same-size reset reproduction
   **When** it is run against the implementation
   **Then** the serialized pixels already match the reset surface, or the report was mistaken, with evidence recorded in Notes; this supersedes criteria 1 and 2

## References

- parent — none
- specification — `docs/spec/engine/runners.md`, “Surface reads, presentation and game state”
- lifecycle — `docs/spec/engine/main-loop-and-startup.md`, “RPGCode screen surface and message-window lifecycle”
- regression evidence — https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/3282
- merged change — https://github.com/tk-reawakened/rpgtoolkit-reawakened/pull/3264

## Notes

- Evidence: the snapshot retained `[90, 80, 70, 255]` after the surface had been reset.
- Risk reason: a save can persist old pixels after the runtime surface was reset.
