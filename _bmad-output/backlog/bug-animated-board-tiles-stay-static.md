---
id: 5
type: bug
title: "Animated board tiles stay static after the board loads"
parent: none
covers: []
after: []
tracker_id: "#3244"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/3244"
assignee: ""
refined: false
hitl: false
risk: medium
severity: P1
---

# Animated board tiles stay static after the board loads

## Description

A board can display the right first frame of an animated tile but never advance it while the board stays loaded. The original board format expects the tiles to cycle at their configured speed, including when several connected water pieces are visible together.

## Reproduction

1. Use the repository's authored `water.tan` and `village.tst` example. Create a 2×1 board with two cells referencing `water.tan`.
2. Load the board once at tick 0 and compose that same loaded board at ticks 0, 11, 12, 24 and 36. The animation runs at 5 frames per second on a 60 Hz simulation.
3. Expected tile numbers in each cell: `2, 2, 3, 4, 2`. Observed on `a3cf8c2c4b428243a35fd8193a9c74952559d0ab`: `2, 2, 2, 2, 2`. Loading again for each tick produces the expected numbers but is not a playback workaround.

## Cause Hypothesis

Board loading appears to select one animation frame and retain only the selected tile. Later composition receives no animation sequence to advance.

## Acceptance Criteria

1. **Playback on a loaded board.** Given the authored two-cell board, when deterministic ticks cross frame and loop boundaries without reloading, then both cells draw the expected tiles in sync at each stated tick. Also prove playback through an actual runner, not only a preconstructed animation model.
2. **Empty frames and save/reload.** Given an authored animation with a blank middle frame, when it plays through that frame, then the cell is blank for its allotted interval and the next frame still plays. Given a save and reload during playback, then the frame and following transitions match uninterrupted playback at the same simulation ticks.
3. **Regression or proof no change is needed.** Tests exercise the loaded-board boundary and fail on the defect before the fix. If current main already satisfies the reproduction and related cases, record the exact revision and passing evidence instead of changing code.

## Boundaries

Follow existing board timing and compatibility rules. Do not change native authoring formats, implement terrain lowering, or modify unrelated asset preview diagnostics.

## References

- issue and reproduction — https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/3244#issuecomment-7024082029
- source — `docs/spec/formats/board.md#animated-tiles`, loaded-board behavior
- source — `docs/spec/formats/tiles.md#animated-tile-tan`, animation speed and empty frames
- sample data — `docs/spec/examples/listings/water.tan.txt`, authored five-frame-per-second example

## Notes

- Medium risk: board loading, rendering and saved state must agree, but the fix is scoped to runtime playback of an existing format.
