---
id: 17
type: story
title: "Test gaps for battle state, API, combat, and AI"
parent: epic-battle
tracker_id: "#689"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/689"
after: [2, 3, 4, 5, 6, 7]
hitl: false
risk: high
---

# Test gaps for battle state, API, combat, and AI

## Description

Add named deterministic tests for the remaining acceptance gaps in Epic 7.2–7.7: pure battle validation and valid/out-of-battle snapshots; stable, atomic API errors and battle built-in documentation/catalogue parity; charge/action/status edge cases; and missing enemy-AI branches and draw ordering. Include the narrowly scoped static guard requested by the audit against wall-clock or unseeded randomness in the battle core/package inputs. Keep the save golden in 7.20, preserve the approved shared `battle.bad-fighter` versus `battle.bad-outcome` contract, and make no RNG or gameplay-rule changes.

## Acceptance Criteria

1. **State validation and snapshots:** The validator demonstrably leaves input unchanged; a valid restore yields no diagnostics; an out-of-battle save has `battle: null`; and the battle section contains no copied HP/SMP/status.
2. **API and catalog:** Fighter-handle failures share `battle.bad-fighter`, invalid outcomes use `battle.bad-outcome`, and both paths are atomic. A named registration-to-catalogue/docs parity test covers every registered battle-facing built-in.
3. **Charge/action:** Deterministic tests cover SMP-pool attack underflow, active-critical-limit `attackall`/`drainall` without critical draws, non-empty inventory immutability, unaffordable-special availability, special status application order, and exactly-once `fallen` for lethal Fight, Special, and Item actions.
4. **Status:** Tests assert HP/SMP/program/aging order, status state belongs to the actor rather than BattleState, and signed per-round effects clamp at both bounds.
5. **AI:** Tests cover healing at levels 0 and 2, post-target combat draw order, and AI configuration isolation to the acting enemy. A custom-AI error is reported, ERR-2 lets the program continue, and the turn ends when the program returns.
6. **Deterministic boundary guard:** One narrowly scoped static guard rejects wall-clock and unseeded-random APIs in the battle core/package inputs; all other tests exercise named real state/output behavior, not source-text pins.
7. **Scope:** No RNG algorithm, gameplay-rule, or golden-file changes; the battle-section save golden is owned by 7.20.

## References

- parent — `_bmad-output/initiative-rpgtoolkit-reawakened/epic-battle/epic-battle.md`
- issues — #505–#510 (Epic 7.2–7.7)
- spec — `docs/spec/engine/battle.md` (BAT-2–BAT-7)
- spec — `docs/spec/engine/rpgcode-functions.md` (battle built-ins)
- spec — `docs/spec/engine/progression-and-levels.md`
- spec — `docs/spec/engine/rpgcode-modules-and-objects.md#emit-13`
- spec — `docs/spec/formats/save-game.md`

## Prerequisites

- Depends on: 2, 3, 4, 5, 6, 7

## Guardrails

- G7 Clean-Room: use Reawakened specifications and current code only; never consult legacy GPL source.
- No runtime behavior, RNG algorithm, or unrelated golden changes.

## Notes

- The battle-section save golden is tracked separately by Epic 7.20.
- The only allowed source-text guard here is the explicitly requested wall-clock/unseeded-random check; permanent behavior tests must assert real deterministic state/output.
