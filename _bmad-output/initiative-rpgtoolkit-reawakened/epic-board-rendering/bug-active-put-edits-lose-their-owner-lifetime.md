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

After one script calls `Put`, another script can finish and trigger cleanup; the still-running script's tile can lose its expiry history. Later, that tile remains on the board when its own script ends. Killing a program thread can leave its `Put` visible too, because its owner is removed from the thread table. Edits should expire only with the program thread that made them, while later live edits and board-scoped `LayerPut` edits remain in effect.

## Reproduction

1. Open a board where cell `(1, 1)` contains `tiles/base.tst` and cell `(2, 1)` is empty. Start two concurrent program threads, A and B.
2. A calls `Put(1, 1, "tiles/active.tst")` and remains active.
3. B calls `Put(2, 1, "tiles/finished.tst")` and finishes.
4. Let the end-of-thread-phase cleanup expire B's `Put` edits.
5. Finish A and let cleanup run again.

Actual: A's tile remains after A finishes. Expected: B's cell returns to empty at step 4; A's tile remains until A finishes, then returns to `tiles/base.tst`.

A second reproduction writes `LayerPut` on one cell, then `Put` from A and B on that cell; B is killed and A finishes. The board-scoped tile should remain visible, but the killed B tile can remain instead.

## Cause Hypothesis

Cleanup appears to recognize a thread owner as finished only when its id remains in `vm.threads` with finished status. Killing a thread unregisters it, so its old `Put` records can be mistaken for active owners. The reducer can also retain a prior tile from an owner that has already ended.

## Acceptance Criteria

1. **Only a finished or killed owner's `Put` edits expire**
   **Given** two program threads have changed different cells with `Put`
   **When** one thread finishes or is killed and tile edits expire
   **Then** its cell returns to the latest remaining edit or the original board tile, while the other active thread's tile and expiry record remain.
2. **Overlapping edits follow the lifetimes that remain active**
   **Given** two program threads have changed the same cell in order
   **When** either thread finishes first, or the later thread is killed
   **Then** the latest edit whose owner remains active is visible; after both owners finish or are killed, the original tile returns unless a board-scoped `LayerPut` remains.
3. **Regression tests cover the reported and related cases**
   **Given** the core test suite
   **When** it runs
   **Then** tests cover different-cell active owners, both same-cell completion orders, and a killed overlapping owner under a board-scoped `LayerPut`.
4. **Or: no change is needed, with proof**
   **Given** the reproduction
   **When** it runs on the current code
   **Then** the expected behavior already holds, or the report was mistaken, with the evidence recorded in Notes; this supersedes criteria 1 to 3.

## References

- parent — `_bmad-output/initiative-rpgtoolkit-reawakened/epic-board-rendering/epic-board-rendering.md`, Done when 3
- source — `docs/spec/engine/rpgcode-functions.md#e-14`, `docs/spec/engine/rpgcode-functions.md#reawakened-tile-edit-lifetimes`, and `docs/spec/engine/rpgcode-language.md#e-93`
- tracker — https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/790

## Notes

- Risk rationale: medium — the visible board can be wrong until it is left, but the issue does not lose saved game data.
