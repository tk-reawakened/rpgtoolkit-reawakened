---
id: 8
type: bug
title: "Tile movement checks each advance instead of the destination"
parent: none
covers: []
after: ["spike-blocked-tile-step-queue-intent", "spike-linked-edge-refusal-transaction"]
assignee: ""
tracker_id: "#1281"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1281"
refined: false
hitl: false
risk: medium
severity: P2
---

# Tile movement checks each advance instead of the destination

## Description

A tile-mode move can stop partway through a tile when a wall blocks the final destination. The move should evaluate the tile destination before advancing and leave the player at the starting position when that destination is blocked. The movement rule must remain consistent with the separately linked queue and board-edge decisions.

## Reproduction

1. On a 2D board, place the player at `(48, 63)` and a blocking wall across `x=76..84`.
2. Enable tile movement, queue east (`E`), and advance the engine ten ticks.
3. Actual: the player is partway through the tile at `x=60`.
4. Expected: the blocked destination is rejected at step start and the player remains at `(48, 63)`.

## Cause Hypothesis

The board-vector collision check appears to run against intermediate animation advances instead of the intended tile destination.

## Acceptance Criteria

1. **A blocked tile destination leaves the player at the starting position**
   **Given** the reproduction board and tile movement mode
   **When** the player queues east and the destination is blocked
   **Then** the step ends without partial movement and the player remains at `(48, 63)`, because the whole destination is prechecked before the first advance ([R-63](../../docs/spec/engine/movement-and-collision.md#r-63)).
2. **Tests prove the boundary behavior and preserve the settled step rules**
   **Given** the movement test suite
   **When** it covers a clear destination, a blocked destination, and an obstacle that becomes solid during an active step
   **Then** clear movement completes, a blocked destination never advances, and a newly solid obstacle stops at the last safe position without a `step-complete` event. A blocked player direction-style step is nevertheless consumed and counted as one tile for end-of-step processing, while a blocked non-player step retries the same entry with its queue waiting ([R-64](../../docs/spec/engine/movement-and-collision.md#r-64)).
3. **Queued directions are recomputed, not replayed from stale targets**
   **Given** the blocked reproduction followed by a queued north step
   **When** the queue runs
   **Then** the north step starts from `(48, 63)` and does not travel diagonally through the wall; absolute point and waypoint targets keep their points, and a save/restore preserves each entry's kind ([R-65](../../docs/spec/engine/movement-and-collision.md#r-65)).
4. **A linked-edge refusal commits nothing and keeps the queue**
   **Given** a linked edge whose arrival is out of bounds, on too high a layer, solid, unloadable, or cancelled by `beforeEnter`
   **When** the player steps into it
   **Then** the player stays on the source board at the last safe position, its queue is unchanged, and no `step-complete`, party step, trigger, battle check or destination-board effect occurs ([R-66](../../docs/spec/engine/movement-and-collision.md#r-66)).
5. **A counted blocked step advances and re-fires repeat distance**
   **Given** a repeat board program whose area contains the tile in front of a wall and whose `distanceRepeat` is 32 px
   **When** the player presses into the wall and the step is counted
   **Then** the step adds one step's worth (32 px) to that program's repeat distance and fires it once per press, while a press whose attempted destination is outside the program's area resets the counter as a normal step leaving the area does ([R-67](../../docs/spec/engine/movement-and-collision.md#r-67)).
6. **End-of-step processing has one suppression predicate**
   **Given** the same completed and blocked player steps driven free-roaming, by an ordinary program's blocking movement, and by a thread or multitask program
   **When** each step ends
   **Then** the ordinary program's synchronous turn runs none of the party step counter, step-triggered programs and items, repeat distances or random-battle test, while thread- and multitask-driven movement runs all of it as free-roaming, and pathfinding runs it once per completed step rather than once per frame ([R-68](../../docs/spec/engine/movement-and-collision.md#r-68)).

## References

- issue — https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1281
- spec — docs/spec/engine/movement-and-collision.md, E-135, E-42, R-63, R-64, R-65, R-66, R-67 and R-68; docs/spec/engine/rpgcode-functions.md#r-69; docs/adr/0040-tile-step-precheck-queues-and-linked-edge-preflight.md; docs/adr/0041-blocked-step-repeat-distance-program-driven-steps-and-getpath.md
- related issues — https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1300 and https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1290

## Notes

- Settled 2026-11-21 by approved owner rulings R-63 to R-66 (owner: Jensen; ADR 0040): the destination is prechecked and a later solid stops at the last safe position; a blocked player direction step is consumed and counted while a non-player retries; queued directions are recomputed from the last safe position while points stay absolute; and a linked-edge arrival is preflighted before movement commits, with the queue kept on refusal. The prerequisites #1300 and #1290 are answered by R-65 and R-66; implementation follows criteria 1 to 6 and amends nothing further in the spec.
- Evidence behind the rulings: docs/provenance/facts-round-17.md (R17-Q1 to R17-Q4), with its certain/probable labels.
- Added 2026-11-21 by approved owner rulings R-67 and R-68 (owner: Jensen; ADR 0041): a counted blocked step adds one step's worth (32 px in tile mode) to every repeat program whose area the attempted destination overlaps and resets the rest as a normal step leaving the area does, so pressing into a wall can re-fire a repeat program once per press (criterion 5); and one live-blocking-thread predicate suppresses all end-of-step processing for completed and blocked steps, while thread- and multitask-driven movement counts as free-roaming and pathfinding counts per completed step (criterion 6). Both criteria are implemented in https://github.com/tk-reawakened/rpgtoolkit-reawakened/pull/3329.
- Closed by PR #3329 for criteria 5 and 6 (verified against current `main` before the change): the movement phase's counted blocked step now advances repeat distance by one step's worth, so the generated case `blocked-counted-step-does-not-leak-into-repeat-distance` and the `P-19` entry in the movement fixture registry were re-recorded and replaced (`blocked-counted-step-feeds-repeat-distance`, `repeat-distance-32-fires-on-every-blocked-press`, `blocked-press-outside-the-area-rearms-the-repeat`); and end-of-step processing for completed and blocked steps is now gated by a live blocking thread rather than by the full script-ownership test (which includes any thread's global wait), with thread-driven movement counting as free-roaming. Both change only behaviour, not state shapes.
- R-69 is the separate path-query contract for `playergetpath`/`itemgetpath`, tracked by https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/3315 and now by `_bmad-output/backlog/bug-getpath-commands-do-not-report-the-live-queue.md` (ticket 23); this ticket does not implement R-69.

- Risk: medium — a wall can stop a tile move at an intermediate position, impairing movement while leaving a workaround.
