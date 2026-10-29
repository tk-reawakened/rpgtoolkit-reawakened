---
id: 25
type: spike
title: "Rule wrong-kind actor references in restored battles"
parent: epic-battle
tracker_id: "#745"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/745"
covers: [CAP-9, CAP-11]
after: [2]
hitl: true
risk: medium
---

# Rule wrong-kind actor references in restored battles

## Description

BAT-2 assigns party 0 to enemies and party 1 to players, but a restored battle currently accepts any extant actor in either slot. The code does not establish the intended contract. The owner must decide the role-mismatch behavior before any runtime or documentation change; future restore work that depends on this rule waits for that decision.

## Approach

1. Compare BAT-2 and save-game semantics with the validation performed on a new battle start and the current restore validation.
2. Present the observed mismatch cases and alternatives without treating current code as normative: retain the restored reference as saved, reject it with a load diagnostic, or another owner-selected rule.
3. Record the owner's choice, rationale, rejected alternatives, and consequences for restore compatibility in the battle spec and this epic's Notes. Do not change runtime behavior in this ticket.
4. If implementation or migration is needed, create a separate follow-up after the ruling.

## Acceptance Criteria

1. **The contract options are compared against the source evidence**
   Verify: `docs/spec/engine/battle.md` and save-game behavior are compared with new-start validation and restore code; the options and compatibility consequences are recorded in this ticket.
2. **The owner selects the rule**
   Verify: the owner-approved choice, rationale, and rejected alternatives are dated in this epic's Notes.
3. **The contract is recorded where future work can find it**
   Verify: the chosen rule is added to the appropriate section of `docs/spec/engine/battle.md`, with a reference from the epic Notes.
4. **No behavior is inferred from the current implementation**
   Verify: this ticket makes no runtime change; any required implementation is separately scoped after owner approval.

## References

- parent — _bmad-output/initiative-rpgtoolkit-reawakened/epic-battle/epic-battle.md
- spec — docs/spec/engine/battle.md, BAT-2
- spec — docs/spec/formats/save-game.md

## Notes

- Open question: Should a restored fighter whose actor kind conflicts with its party be retained, rejected with a diagnostic, or handled by another owner-selected rule?
- Audit evidence: `packages/core/src/battle/model.ts:23-31,58-64` validates actor existence; `packages/core/src/battle/port.ts:103-122` checks actor kind only on new starts.
- Risk rationale: medium — A wrong restored-actor rule could reject valid saves or assign a fighter to the wrong side; owner approval gates behavior changes.
