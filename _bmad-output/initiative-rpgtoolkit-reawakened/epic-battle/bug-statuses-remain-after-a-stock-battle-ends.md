---
id: 21
type: bug
title: "Statuses remain after a stock battle ends"
parent: epic-battle
tracker_id: "#741"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/741"
covers: [CAP-9]
after: [6, 8, 12]
refined: false
hitl: false
risk: medium
severity: P2
---

# Statuses remain after a stock battle ends

## Description

A battle participant's status remains on its actor after the battle outcome handler finishes. BAT-6 says all statuses end with the battle. BAT-8 includes both automatic and package-handled outcomes; cleanup must wait until the final outcome is selected, preserving same-pass status ticks after a successful run.

## Reproduction

1. In the deterministic battle fixture, add a participant status `late.ste` with counter `0` before starting.
2. Terminate through every BAT-8 outcome code: 0 automatic run, 1 handled run, 2 automatic win, 3 handled win, and 4 loss.
3. Inspect the participant's actor status after each final outcome.
4. Actual: `late.ste` remains on the actor. The review explicitly observed this for handled outcome codes 1 and 3 as well as the other terminal paths. Expected: it is absent after battle termination.
5. In the code-0 run case, also check that later charged-player status ticks still occur before final outcome selection and that a resulting party loss outranks escape.

## Cause Hypothesis

The exercised battle outcome paths finish or clear the battle state without removing participant statuses. Status counters live on actors, so clearing only the battle section would not remove them; BAT-8 outcome codes 1 and 3 also need explicit coverage.

## Acceptance Criteria

1. **Participant statuses end with the battle**
   **Given** a participant with a lasting or indefinite status
   **When** a battle terminates through BAT-8 outcome codes 0, 1, 2, 3, or 4
   **Then** all participant statuses are cleared only after final outcome selection; a code-0 successful run still lets later charged players tick statuses in that pass, and if those ticks leave every player at 0 HP, loss is selected rather than escape
2. **Tests cover the condition found and fixed**
   **Given** the battle test suite
   **When** deterministic cases exercise all five outcomes, with handled codes 1 and 3 as well as automatic codes 0, 2, and 4
   **Then** regression tests prove statuses end after the final outcome and a nonparticipant's statuses are unchanged, while the run-to-loss precedence remains intact
3. **Or: no change is needed, with proof**
   **Given** the reproduction
   **When** it is run on the current code
   **Then** the status is already absent after every outcome, or the report was mistaken, with the evidence recorded in Notes — this supersedes 1 and 2

## References

- parent — _bmad-output/initiative-rpgtoolkit-reawakened/epic-battle/epic-battle.md
- spec — docs/spec/engine/battle.md, BAT-6 and BAT-8

## Notes

- Audit evidence: `stock/stock_battle/startup.prg:849-904` exits without clearing actor statuses; the review explicitly observed retained status for BAT-8 handled outcomes 1 and 3 as well as automatic terminal paths. BAT-8 says later charged players still tick after a successful run; `startup.prg:864-885,896-899` carries those ticks through loss-before-run outcome selection.
- Risk rationale: medium — Clearing statuses before BAT-8's same-pass ticks and final loss-before-run decision could change whether a successful run ends as escape or loss.
