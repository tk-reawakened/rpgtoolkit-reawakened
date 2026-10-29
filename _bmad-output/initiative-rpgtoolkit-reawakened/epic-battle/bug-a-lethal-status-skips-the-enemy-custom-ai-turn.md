---
id: 22
type: bug
title: "A lethal status skips the enemy custom AI turn"
parent: epic-battle
tracker_id: "#742"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/742"
covers: [CAP-9]
after: [6, 7]
refined: false
hitl: false
risk: medium
severity: P2
---

# A lethal status skips the enemy custom AI turn

## Description

If a status takes an enemy to 0 HP immediately before its charged turn, the stock loop skips its custom AI program. BAT-6 requires the AI program to run even then, while attacks, moves, and items from a fallen actor have no effect.

## Reproduction

1. In a deterministic stock-battle fixture, create a living enemy whose custom AI increments an observable call counter.
2. Give it a status that lowers its HP to 0 at its charged boundary.
3. Advance the battle through that boundary and inspect the counter; repeat with an otherwise equivalent living control.
4. Actual: the lethal case calls custom AI zero times, while the living control calls it once. Expected: both custom AI programs run once; the fallen actor's attacks, moves, and items have no effect.

## Cause Hypothesis

The enemy-turn script returns when `hp < 1` before reaching the custom-AI call. This appears to bypass the BAT-6 exception for status-lethal turns.

## Acceptance Criteria

1. **The custom AI turn still runs after a lethal status**
   **Given** an enemy with custom AI whose status lowers it to 0 HP at its charged boundary
   **When** the stock battle loop processes that turn
   **Then** the AI program runs once and its attacks, moves, and items have no effect
2. **Tests cover the condition found and fixed**
   **Given** the stock-battle test suite
   **When** the lethal-status and living-control cases run
   **Then** tests assert one AI call in both cases and no effect from an action by the fallen actor
3. **Or: no change is needed, with proof**
   **Given** the reproduction
   **When** it is run on the current code
   **Then** the custom AI already runs once in both cases, or the report was mistaken, with the evidence recorded in Notes — this supersedes 1 and 2

## References

- parent — _bmad-output/initiative-rpgtoolkit-reawakened/epic-battle/epic-battle.md
- spec — docs/spec/engine/battle.md, BAT-6 and BAT-7

## Notes

- Audit evidence: `stock/stock_battle/startup.prg:449-480` returns at `hp < 1` before custom AI; the isolated probe observed zero custom-AI calls for the lethal case and one for a living control.
- Risk rationale: medium — Changing the turn guard can alter custom-AI side effects and deterministic draws after a lethal status.
