---
id: 21
type: bug
title: "TK2 CheckButton does not write the clicked slot to its output argument"
parent: none
covers: []
after: ["spike-setbutton-image-semantics"]
assignee: ""
tracker_id: "#1951"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1951"
refined: true
hitl: false
risk: medium
severity: P2
---

# TK2 CheckButton does not write the clicked slot to its output argument

## Description

The Final Destiny title script uses the TK2 three-argument `CheckButton` form. Reawakened currently rejects that call, leaves the slot output unset, and may select New Game instead of the button the player clicked. The three-argument form must report the hit slot while preserving the existing two-argument result.

## Reproduction

1. Run the unchanged Final Destiny fixture to its title screen.
2. Click a title button other than New Game.
3. Actual: an `arity.mismatch` diagnostic is reported and the output remains unset, so startup can fall through to New Game.
4. Expected: the call returns whether the click hit a slot and writes that slot number through the output argument.

## Cause Hypothesis

The implemented `checkbutton` form accepts only coordinates and does not declare or write a by-reference slot output, so the TK2 call fails argument validation before the script can branch on the clicked slot.

## Acceptance Criteria

1. **The clicked slot is returned to the title script**
   **Given** the unchanged Final Destiny fixture at its title screen
   **When** the player clicks an enabled button and the script calls the TK2 three-argument form
   **Then** it receives 1 and the clicked numeric slot, so it does not fall through to New Game when another slot was clicked
2. **Hit and miss outputs are deterministic**
   **Given** a button slot and a pointer coordinate
   **When** `checkbutton(x, y, &slot)` runs
   **Then** a hit returns 1 and writes the slot; a miss returns 0 and writes 0, while the two-argument call retains its existing 1/0 behavior
3. **Tests cover the defect and the compatibility case**
   **Given** the focused tests
   **When** they run
   **Then** a regression test fails on the rejected three-argument call and passes with correct hit and miss outputs
4. **Or: no change is needed, with proof**
   **Given** the reproduction
   **When** it is run on the current code
   **Then** the output already identifies the clicked slot, or the report was mistaken, with evidence recorded in Notes; this supersedes criteria 1–3

## References

- issue — https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1951
- spec — `docs/spec/engine/rpgcode-functions.md#reawakened-checkbutton-slot-output`
- related title-screen issue — https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/2153

## Notes

- Decision: The optional output writes the numeric hit slot and writes 0 on a miss, matching the existing 1/0 return behavior (2026-11-21; recorded in the spec).
- Risk: medium — an incorrect result can select a different title action; the unchanged fixture's headless title-click test is the external check.
