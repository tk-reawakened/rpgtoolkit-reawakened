---
id: 9
type: spike
title: "Clarify queued movement intent after a blocked tile step"
parent: none
covers: []
after: []
assignee: ""
tracker_id: "#1300"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1300"
refined: false
hitl: true
risk: high
---

# Clarify queued movement intent after a blocked tile step

## Description

The current destination-collision and direct-step-stop rules settle how the active step ends, but do not settle what happens to later queued absolute targets after it is blocked. Ticket #1281 waits on this answer because stale targets could move through a wall after the player remains at a safe position. The owner must choose and record the queue rule before the implementation starts.

## Approach

1. Compare replaying queued directional intent from the last safe position, preserving and revalidating absolute targets, and discarding later queued moves.
2. Use a deterministic movement fixture to demonstrate each candidate after a blocked step, including whether any later command can cross the obstacle.
3. Recommend replaying relative intent from the safe position, or discarding targets that cannot be safely revalidated; do not silently preserve a target that permits crossing the obstacle.
4. Have the owner choose the behavior and record it in `docs/spec/engine/movement-and-collision.md` before ticket #1281 starts.

## Acceptance Criteria

1. **The queue choices are compared against the deciding cases**
   Verify: the comparison records ordering, remaining queue contents, safe-position behavior, and whether a later command can cross the blocking wall.
2. **A deterministic fixture demonstrates the chosen rule**
   Verify: the fixture and test prove the queued sequence after a blocked step and fail if a later target crosses the wall.
3. **The selected rule and its consequences are recorded where the waiting ticket can find them**
   Verify: the movement spec names the queue rule and the #1281 ticket references it.
4. **The owner has accepted the rule**
   Verify: the dated owner decision is recorded in the movement spec.

## References

- issue — https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1300
- waiting ticket — bug-tile-movement-destination-collision.md (#1281)
- spec — docs/spec/engine/movement-and-collision.md, E-135 and R-51

## Notes

- Resolved 2026-11-21 by an approved owner ruling (owner: Jensen; [R-65](../../docs/spec/engine/movement-and-collision.md#r-65), [ADR 0040](../../docs/adr/0040-tile-step-precheck-queues-and-linked-edge-preflight.md)): queued directions are relative intent recomputed from the actor's last safe position; absolute point and waypoint targets and later script-appended commands are kept; and a kept absolute point never grants passage through solid geometry. The dated ruling satisfies criterion 4 and the queue rule criterion 3.
- The assumption below is now the rule: queued movement must never cross a solid obstacle because a later command retained a stale target.
- Evidence: [Round 17 facts](../../docs/provenance/facts-round-17.md), R17-Q1 (`:24-27`, `:46`).

- Risk: high — stale queued targets could cross a wall after a blocked step; outside this ticket's criteria, verify the selected rule in Epic 5's entry 12 replay and snapshot sweep.
