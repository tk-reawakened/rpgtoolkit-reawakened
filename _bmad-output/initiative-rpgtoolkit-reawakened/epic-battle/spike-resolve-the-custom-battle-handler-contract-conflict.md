---
id: 27
type: spike
title: "Resolve the custom battle-handler contract conflict"
parent: epic-battle
tracker_id: "#747"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/747"
covers: [CAP-5, CAP-9]
after: [1, 12, 16]
hitl: true
risk: medium
---

# Resolve the custom battle-handler contract conflict

## Description

E-79's owner-approved independent RPGCode battle path is settled: a custom program can run its own loop over the core battle operations without `stock_battle`. The narrower documentation conflict is that BAT-9 §3 says a program's `Fight` or `FightEnemy` call without `stock_battle` is catchable `battle.package-missing`, while BAT-9 §4 directs an own-loop program to setup-only entry points and BAT-14 repeats the package-missing rule. Clarify the no-handler versus registered replacement-handler cases without reopening E-79 or changing runtime behavior.

## Approach

1. Compare the exact BAT-9 §3 and §4 wording with BAT-14 and the owner-approved E-79 rule.
2. Preserve the settled capability: a registered custom battle handler may implement its own loop over core operations without `stock_battle`; do not propose removing or narrowing that path.
3. Distinguish the no-stock/no-replacement-handler case that reports `battle.package-missing` from the registered replacement-loop path exercised by the existing tests; propose a precise text clarification.
4. Have the owner review the wording, record the text clarification in the battle spec and epic Notes, and make no runtime change.

## Acceptance Criteria

1. **The conflicting requirements are identified from authoritative text**
   Verify: BAT-9 §3 and §4 and BAT-14 are quoted or precisely cited; the contradiction is stated as the no-handler error versus the own-loop setup path, not as uncertainty about E-79's capability.
2. **The existing owner ruling is preserved**
   Verify: the E-79 independent own-loop path remains supported without `stock_battle`; neither the ticket nor the wording proposal reopens that capability.
3. **The owner accepts a precise documentation clarification**
   Verify: the text distinguishes an absent battle handler from a registered custom handler, and the dated wording decision is recorded in `docs/spec/engine/battle.md` and this epic's Notes.
4. **No implementation is bundled with the clarification**
   Verify: no runtime or test behavior changes in this ticket; any new behavior question outside the existing E-79 ruling is brought back to the owner.

## References

- parent — _bmad-output/initiative-rpgtoolkit-reawakened/epic-battle/epic-battle.md
- spec — docs/spec/engine/plugins-and-battle.md, E-79 owner ruling
- spec — docs/spec/engine/battle.md, BAT-9 §§3–4 and BAT-14
- prior plan — _bmad-output/initiative-rpgtoolkit-reawakened/epic-battle/story-a-custom-fight-program-drives-every-battle-operation-plan.md
- tests — packages/core/test/battle-custom-fight.test.ts

## Notes

- Open question: How should the no-registered-handler `battle.package-missing` error be worded so it does not contradict the already-approved registered replacement-loop path?
- Audit evidence: `docs/spec/engine/battle.md:201-202,318`; E-79 owner ruling in `docs/spec/engine/plugins-and-battle.md:182`; completed 7.12 plan `story-a-custom-fight-program-drives-every-battle-operation-plan.md:17,29,33`; `packages/core/test/battle-custom-fight.test.ts:556-577` distinguishes absent-handler error from registered replacement, and `:579-604` covers outcomes 0–4. Code/test evidence does not reopen the E-79 decision.
- Risk rationale: medium — Ambiguous BAT-9/BAT-14 wording can mislead custom-battle authors; the accepted E-79 capability must not be narrowed.
