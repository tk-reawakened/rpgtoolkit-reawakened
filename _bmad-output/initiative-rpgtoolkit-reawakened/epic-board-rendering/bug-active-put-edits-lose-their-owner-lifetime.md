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

After one script calls `Put`, another can finish and trigger cleanup, causing the still-running script's tile to lose its expiry history. Killed threads expose a second owner-lifetime failure: removal happens before end-of-phase cleanup, and a new thread can reuse the killed thread's numeric id. Edit lifetime belongs to the thread instance, not a reused id; later live edits and board-scoped `LayerPut` edits must remain in effect.

## Reproduction

1. Open a board where cell `(1, 1)` contains `tiles/base.tst` and cell `(2, 1)` is empty. Start two concurrent program threads, A and B.
2. A calls `Put(1, 1, "tiles/active.tst")` and remains active.
3. B calls `Put(2, 1, "tiles/finished.tst")` and finishes.
4. Let the end-of-thread-phase cleanup expire B's `Put` edits.
5. Finish A and let cleanup run again.

Actual: A's tile remains after A finishes. Expected: B's cell returns to empty at step 4; A's tile remains until A finishes, then returns to `tiles/base.tst`.

A second reproduction writes board-scoped `LayerPut`, then overlapping `Put` edits from A (older, id 1) and B (newer, highest id 2) on one cell. A kills B and starts C before the thread phase ends, so C reuses id 2; A then finishes. B's edit must have expired at the kill command boundary; after phase cleanup the board tile should be visible, not B's tile mistaken for C's.

## Confirmed Cause

End-of-phase cleanup previously retained only board-scoped edits, so a cleanup triggered by one thread finishing discarded edits from other still-running program threads. Numeric thread ids are reused after removal; end-of-phase lookup alone could therefore also make a killed thread's stale edit appear to belong to its replacement. Active-owner retention plus synchronous cleanup at thread-removal boundaries addresses both failures without changing id allocation.

## Acceptance Criteria

1. **Only a finished or killed owner's `Put` edits expire**
   **Given** two program threads have changed different cells with `Put`
   **When** one thread finishes or is killed and tile edits expire
   **Then** its cell returns to the latest remaining edit or the original board tile, while the other active thread's tile and expiry record remain.
2. **Overlapping edits follow the lifetimes that remain active**
   **Given** two program threads have changed the same cell in order
   **When** either thread finishes first, or the later highest-id thread is killed and a replacement starts before end-of-phase cleanup
   **Then** the latest edit whose owner remains active is visible; the killed edit expires before its id can be reused, and after the older owner finishes the original board tile or remaining board-scoped `LayerPut` is visible.
3. **Regression tests cover the reported and related cases**
   **Given** the core test suite
   **When** it runs
   **Then** tests cover different-cell active owners, both same-cell completion orders, and a killed highest-id owner followed by same-phase id reuse under a board-scoped `LayerPut`.
4. **Or: no change is needed, with proof**
   **Given** the reproduction
   **When** it runs on the current code
   **Then** the expected behavior already holds, or the report was mistaken, with the evidence recorded in Notes; this supersedes criteria 1 to 3.

## References

- parent — Epic 4 GitHub parent issue https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/794; local envelope `_bmad-output/initiative-rpgtoolkit-reawakened/epic-board-rendering/epic-board-rendering.md`, Done when 3
- source — `docs/spec/engine/rpgcode-functions.md#e-14`, `docs/spec/engine/rpgcode-functions.md#reawakened-tile-edit-lifetimes`, and `docs/spec/engine/rpgcode-language.md#e-93`
- tracker — https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/790

## Notes

- Risk rationale: medium — the visible board can be wrong until it is left, but the issue does not lose saved game data.
- Confirmed in `expireProgramTileEdits`: program-scoped records must survive while their owner is active, and an early owner removal must expire its history before a numeric id can be reused.
