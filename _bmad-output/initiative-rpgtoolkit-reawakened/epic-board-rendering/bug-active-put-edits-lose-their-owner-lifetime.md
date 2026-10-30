---
id: 36
type: bug
title: "[4.36] Active Put edits lose their owner lifetime"
parent: epic-board-rendering
covers: ["CAP-2"]
after: [12]
assignee: ""
tracker_id: "#790"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/790"
tracker_status: in-progress
refined: true
hitl: false
risk: medium
severity: P2
---

# [4.36] Active Put edits lose their owner lifetime

## Description

After one script calls `Put`, another script can finish and trigger cleanup; the still-running script's tile can lose its expiry history. Later, that tile remains on the board when its own script ends. Edits should expire only with the program that made them, while later live edits and board-scoped `LayerPut` edits remain in effect.

## Reproduction

1. Open a board where cell `(1, 1)` contains `tiles/base.tst` and cell `(2, 1)` is empty. Start two concurrent program threads, A and B.
2. A calls `Put(1, 1, "tiles/active.tst")` and remains active.
3. B calls `Put(2, 1, "tiles/finished.tst")` and finishes.
4. Let the end-of-thread-phase cleanup expire B's `Put` edits.
5. Finish A and let cleanup run again.

Actual: A's tile remains after A finishes. Expected: B's cell returns to empty at step 4; A's tile remains until A finishes, then returns to `tiles/base.tst`.

The same reducer must also preserve the order of overlapping edits: the latest still-live edit remains visible, and an expiring owner must not restore a tile from an owner that has already finished.

## Cause Hypothesis

The cleanup appears to restore edits owned by finished threads, then remove every program-scoped edit record rather than only the finished owners' records. A later edit on the same cell can also retain a prior tile from an owner that has already finished, leaving a stale restoration chain.

## Acceptance Criteria

1. **Only the finished owner's `Put` edits expire**
   **Given** two active program threads have changed different cells with `Put`
   **When** one thread finishes and tile edits expire
   **Then** its cell returns to the latest remaining edit or the original board tile, while the other thread's tile remains visible and its expiry record remains until that thread finishes.
2. **Overlapping edits follow the lifetimes that remain active**
   **Given** two program threads have changed the same cell in order
   **When** either the older or newer thread finishes first
   **Then** the latest still-live edit remains visible, the other completion order reveals the older live edit, and the original board tile returns after both finish; a board-scoped `LayerPut` remains visible after overlapping program edits expire.
3. **Regression tests cover the reported and related cases**
   **Given** the core test suite
   **When** it runs
   **Then** tests cover different-cell active owners, both same-cell completion orders, and the interaction with `LayerPut`.
4. **Or: no change is needed, with proof**
   **Given** the reproduction
   **When** it runs on the current code
   **Then** the expected behavior already holds, or the report was mistaken, with the evidence recorded in Notes; this supersedes criteria 1 to 3.

## References

- parent — `_bmad-output/initiative-rpgtoolkit-reawakened/epic-board-rendering/epic-board-rendering.md`, Done when 3
- source — `docs/spec/engine/rpgcode-functions.md#e-14` and `docs/spec/engine/rpgcode-functions.md#reawakened-tile-edit-lifetimes`
- tracker — https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/790

## Notes

- Risk rationale: medium — the visible board can be wrong until it is left, but the issue does not lose saved game data.
