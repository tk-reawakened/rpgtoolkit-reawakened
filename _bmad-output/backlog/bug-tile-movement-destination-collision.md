---
id: 7
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
   **Then** the step ends without partial movement and the player remains at `(48, 63)`.
2. **Tests prove the boundary behavior and preserve the settled step-stop rule**
   **Given** the movement test suite
   **When** it covers a clear destination, a blocked destination, and an obstacle that becomes solid during an active step
   **Then** clear movement completes, a blocked destination never advances, and a newly solid obstacle stops at the last safe position without a successful-move event.
3. **Or: no change is needed, with proof**
   **Given** the reproduction
   **When** it is run on the current implementation
   **Then** the player already stays at the starting position, or the report is mistaken, with the evidence recorded in Notes; this supersedes criteria 1 and 2.

## References

- issue — https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1281
- spec — docs/spec/engine/movement-and-collision.md, E-135 and Reawakened solid-step-stop
- related issues — https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1300 and https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1290

## Notes

- Open question: the queue behavior after a blocked step and the side effects of a refused linked-edge arrival must be settled by the prerequisite tickets before implementation; this ticket does not choose either rule.

- Risk: medium — a wall can stop a tile move at an intermediate position, impairing movement while leaving a workaround.
