---
id: 24
type: bug
title: "Battle identifiers are reused after loss cleanup"
parent: epic-battle
tracker_id: "#744"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/744"
covers: [CAP-9, CAP-11]
after: [2, 8]
refined: true
hitl: false
risk: medium
severity: P2
---

# Battle identifiers are reused after loss cleanup

## Description

A battle started later in the same run can reuse an identifier from a battle that ended by loss. BAT-2 requires battle identifiers not to be reused during a run.

## Boundaries

Require uniqueness within one run, not monotonically increasing identifiers.

## Reproduction

1. In a deterministic engine fixture, register a game-over program that starts another battle before returning.
2. Start a battle and record its identifier.
3. End it through the loss path.
4. Inspect the identifier of the battle started by the game-over program.
5. Actual: it reuses the first identifier (`1` in the isolated probe). Expected: it has not been used earlier in the same run.

## Cause Hypothesis

The next identifier is derived from the current battle section, or defaults to zero when no section exists. Loss cleanup clears that section, so the next start loses the prior identifier.

## Acceptance Criteria

1. **Identifiers remain unique within one run**
   **Given** a battle with identifier N that ends through loss cleanup
   **When** another battle starts in the same run
   **Then** the new identifier differs from every identifier already used in that run
2. **Run-scoped lifetime is settled in this ticket**
   **Given** BAT-2 does not say whether an explicit reset or a save/restore with no active battle ends a run's identifier history
   **When** the work settles that question
   **Then** the choice is recorded as a dated decision in Notes, and a regression test shows the counter behaves the same way after an explicit reset and after a save/restore with no active battle, whichever way the decision goes
3. **Tests cover the condition found and fixed**
   **Given** the deterministic battle-state test suite
   **When** a battle is started, lost, and a game-over program starts another battle before returning
   **Then** a regression test fails on the reused identifier and passes when the second identifier is unused in the same run
4. **Or: no change is needed, with proof**
   **Given** the reproduction
   **When** it is run on the current code
   **Then** the second identifier is already unique within the run, or the report was mistaken, with the evidence recorded in Notes — this supersedes 1 to 3

## References

- parent — _bmad-output/initiative-rpgtoolkit-reawakened/epic-battle/epic-battle.md
- spec — docs/spec/engine/battle.md, BAT-2 and BAT-8

## Notes

- Audit evidence: `packages/core/src/battle/port.ts:123-124` derives the next identifier from the current battle or zero, while `endLoss` clears the battle section at `:176-181`; the isolated probe observed identifier `1` reused after loss.
- Open question: Does BAT-2's "in a run" counter persist across an explicit reset or a save/restore with no battle active? The spec does not say whether those boundaries end a run or preserve its battle-number history. Answering it is part of this ticket's work when it starts, recorded as a dated decision; do not resolve it by guessing now.
- Risk rationale: medium — Reused identifiers can alias earlier battles within a run; requiring monotonic increase would exceed BAT-2's uniqueness contract.
