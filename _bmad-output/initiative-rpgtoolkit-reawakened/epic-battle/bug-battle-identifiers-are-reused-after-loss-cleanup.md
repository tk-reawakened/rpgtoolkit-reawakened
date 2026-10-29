---
id: 24
type: bug
title: "Battle identifiers are reused after loss cleanup"
parent: epic-battle
tracker_id: "#744"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/744"
covers: [CAP-9, CAP-11]
after: [2, 8]
refined: false
hitl: false
risk: medium
severity: P2
---

# Battle identifiers are reused after loss cleanup

## Description

A battle started later in the same run can reuse an identifier from a battle that ended by loss. BAT-2 requires battle identifiers not to be reused during a run.

## Reproduction

1. In the deterministic engine fixture, start a battle and record its identifier (the observed first identifier is `1`).
2. End it through the loss path that clears the battle section and lets the game-over program return.
3. Start another battle in the same run and inspect its identifier.
4. Actual: the second battle receives identifier `1` again. Expected: it receives an identifier that has not been used earlier in the run.

## Cause Hypothesis

The next identifier is derived from the current battle section, or defaults to zero when no section exists. Loss cleanup clears that section, so the next start loses the prior identifier.

## Acceptance Criteria

1. **Identifiers remain unique within one run**
   **Given** a battle with identifier N that ends through loss cleanup
   **When** another battle starts in the same run
   **Then** the new identifier differs from every identifier already used in that run
2. **Tests cover the condition found and fixed**
   **Given** the deterministic battle-state test suite
   **When** a battle is started, lost, and started again
   **Then** a regression test fails on the repeated identifier and passes on the corrected sequence
3. **Or: no change is needed, with proof**
   **Given** the reproduction
   **When** it is run on the current code
   **Then** the second identifier is already unique within the run, or the report was mistaken, with the evidence recorded in Notes — this supersedes 1 and 2

## References

- parent — _bmad-output/initiative-rpgtoolkit-reawakened/epic-battle/epic-battle.md
- spec — docs/spec/engine/battle.md, BAT-2 and BAT-8

## Notes

- Audit evidence: `packages/core/src/battle/port.ts:123-124` derives the next identifier from the current battle or zero, while `endLoss` clears the battle section at `:176-181`; the isolated probe observed identifier `1` reused after loss.
- Risk rationale: medium — Reused identifiers can alias earlier battles within a run; requiring monotonic increase would exceed BAT-2's uniqueness contract.
