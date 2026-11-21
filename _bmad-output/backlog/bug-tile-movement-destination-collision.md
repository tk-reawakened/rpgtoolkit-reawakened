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

## References

- issue — https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1281
- spec — docs/spec/engine/movement-and-collision.md, E-135, R-63, R-64, R-65 and R-66; docs/adr/0040-tile-step-precheck-queues-and-linked-edge-preflight.md
- related issues — https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1300 and https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1290

## Notes

- Settled 2026-11-21 by approved owner rulings R-63 to R-66 (owner: Jensen; ADR 0040): the destination is prechecked and a later solid stops at the last safe position; a blocked player direction step is consumed and counted while a non-player retries; queued directions are recomputed from the last safe position while points stay absolute; and a linked-edge arrival is preflighted before movement commits, with the queue kept on refusal. The prerequisites #1300 and #1290 are answered by R-65 and R-66; implementation follows criteria 1 to 4 and amends nothing further in the spec.
- Evidence behind the rulings: docs/provenance/facts-round-17.md (R17-Q1 to R17-Q4), with its certain/probable labels.

- Risk: medium — a wall can stop a tile move at an intermediate position, impairing movement while leaving a workaround.
