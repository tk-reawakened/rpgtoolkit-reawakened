---
id: 23
type: bug
title: "playergetpath and itemgetpath do not report the queue the original commands expose"
parent: none
covers: []
after: []
assignee: ""
tracker_id: "#3315"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/3315"
refined: true
hitl: false
risk: medium
severity: P2
---

# playergetpath and itemgetpath do not report the queue the original commands expose

## Description

A script that asks how many destinations a character or item still has cannot do it: the one-argument form is rejected, and the four-argument form answers whether one index exists instead of how many entries are queued. Asking for an index that does not exist zeroes the two output variables instead of leaving them alone, and while a step is in progress index 0 is not the point being walked toward. The commands must follow [R-69](../../docs/spec/engine/rpgcode-functions.md#r-69): exactly one or exactly four arguments, both returning the queue count including the step in progress; four arguments also writing that entry's whole-pixel point, with a missing index writing nothing and raising nothing.

## Reproduction

1. Start a board with the player at (48, 63) and queue one 32-pixel step east, then run one movement phase. The step is in progress toward (80, 63) and the queued-move list is empty.
2. Call `playergetpath(0)` and read the result.
   Actual: catchable `arity.mismatch` — `"playergetpath" takes 4 argument(s), got 1`. Expected: `1`, the entry being walked toward.
3. Call `playergetpath(0, 0, &x, &y)` with `x` and `y` set to 7 and 8.
   Actual: returns `0` and writes `0` to both variables. Expected: returns `1` and writes `80` and `63`.
4. Call `playergetpath(0, 3, &x, &y)` on the same state.
   Actual: returns `0` and writes `0` to both variables. Expected: returns `1` and leaves both variables at `7` and `8`.
5. Repeat steps 2 to 4 with `itemgetpath` and a board item. A handle that names no item writes nothing; the kept 3.1 message text is `player not found`.

## Cause Hypothesis

The built-in declares four required parameters, so one argument fails the shared arity check before it runs. Its handler walks only the queued-move list, treats index 0 as that list's first entry rather than the active step's target, returns 1 or 0 for "index exists", and writes zeroes when the index is missing. It does not count a copied waypoint's remaining cycle, and it resolves an unknown player handle to the selected player instead of reporting it.

## Acceptance Criteria

1. **Both arities are accepted and return the count**
   **Given** an actor with an active step, queued entries, or neither
   **When** `playergetpath` or `itemgetpath` is called with exactly one argument or exactly four
   **Then** both forms return the number of entries including the step in progress, and an idle actor returns 0
2. **Index 0 is the active step's target**
   **Given** a step is in progress toward a point and the queued-move list is empty
   **When** the four-argument form is called with index 0
   **Then** it writes that step's target, and with no active step index 0 is the first queued entry's computed target
3. **Each point is rounded half up**
   **Given** a destination with a fractional pixel coordinate
   **When** the four-argument form writes it
   **Then** each value is `floor(value + 0.5)` whole pixels, never a truncation
4. **A missing index writes nothing and raises nothing**
   **Given** both output variables hold known values
   **When** the index is negative or at or past the count
   **Then** both variables keep their values, no error is raised, and the call still returns the count
5. **Every other argument count is the standard catchable wrong-count error**
   **Given** a call with two or three arguments, or none beyond the handle
   **When** it runs
   **Then** it raises catchable `arity.mismatch` naming one or four, writes nothing, and produces the unset value
6. **Reading has no side effects**
   **Given** a queue with an active step and queued entries
   **When** either form is read twice
   **Then** it does not wait, start, stop or rewrite movement, change facing, or consume an entry, and both reads return the same values
7. **Waypoints follow R-69**
   **Given** a linked waypoint vector, or a copied waypoint vector of several points and cycles
   **When** the count is read
   **Then** a linked waypoint contributes nothing (0 when it is the only movement), and a copied waypoint is counted in full once for its current cycle
8. **A direction entry reports its computed destination**
   **Given** a queued direction entry, including after an earlier blocked step
   **When** its point is read
   **Then** it is computed from the actor's current position or the previous entry's computed point at call time, while a point entry reports its stored absolute target
9. **A handle that names no actor is reported, not invented**
   **Given** a handle that resolves to no live player or item
   **When** either command is called
   **Then** it changes nothing, writes nothing, and reports the failure with the kept 3.1 message text `player not found`
10. **Tests and documentation coverage hold**
    **Given** the affected core suites and the command-documentation gate
    **When** they run
    **Then** failing-first tests cover each criterion above, the movement plugin is checked by `tools/command-docs/check.mjs` like the other documented plugins, and its command summaries match the specification rows

## References

- issue — https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/3315
- ruling — `docs/spec/engine/rpgcode-functions.md`, R-69 and the `playergetpath`/`itemgetpath` rows
- decision — `docs/adr/0041-blocked-step-repeat-distance-program-driven-steps-and-getpath.md`, decision 3
- evidence — `docs/provenance/facts-round-18.md`, Q2

## Notes

- Decision (2026-11-21, owner Jensen): R-69 fixes the contract before the code follows it, including exactly one or four arguments, the count including the active step, half-up whole pixels, and untouched variables for a missing index.
- Decision (2026-11-21): the missing-handle message keeps 3.1's text `player not found` for both commands; it uses the existing catchable `builtin.bad-arg` class and adds no new error class.
- The `playergetpath`/`itemgetpath` specification rows and R-69 were published in PR #3327; this ticket implements them.
