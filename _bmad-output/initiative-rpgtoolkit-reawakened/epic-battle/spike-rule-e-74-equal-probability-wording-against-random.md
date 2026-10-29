---
id: 26
type: spike
title: "Rule E-74 equal-probability wording against random()"
parent: epic-battle
tracker_id: "#746"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/746"
covers: [CAP-9]
after: [1, 16]
hitl: true
risk: medium
---

# Rule E-74 equal-probability wording against random()

## Description

E-74 describes random variance and critical-draw values as equally likely, while `random(max)` currently maps a 32-bit draw to `1 + draw % max`. The owner must decide whether E-74 requires exact equal likelihood or should describe this mapping. The already-accepted BAT-8 `random(5) <= 2` behavior is a separate rule and does not decide E-74.

## Approach

1. Derive the exact `random(20)` bucket counts from the full 32-bit draw domain and show the mapping in source terms; do not use an unverified approximation.
2. Compare those counts with E-74's equal-likelihood wording and the accepted one-based BAT-8 run contract.
3. Present the alternatives to the owner: retain current mapping and clarify E-74, or require exactly equal outcomes and separately scope any runtime change.
4. Record the owner's choice and consequences in the E-74 spec and epic Notes. Do not change runtime behavior in this ticket; create a separate implementation issue if the ruling requires it.

## Acceptance Criteria

1. **The actual mapping and exact counts are established**
   Verify: a checked derivation records the one-based modulo mapping and all `random(20)` bucket counts from `2^32` draws, with source citations and no approximate probability claim.
2. **The alternatives are compared without choosing for the owner**
   Verify: the comparison states the compatibility and implementation consequences of retaining modulo mapping versus requiring exact equal likelihood.
3. **The owner makes and records the normative decision**
   Verify: the dated choice, rationale, and rejected alternative are recorded in `docs/spec/engine/plugins-and-battle.md` at E-74 and this epic's Notes.
4. **No runtime change is bundled with the ruling**
   Verify: this ticket changes no random implementation; any behavior change is separately scoped after the owner decision.

## References

- parent — _bmad-output/initiative-rpgtoolkit-reawakened/epic-battle/epic-battle.md
- spec — docs/spec/engine/plugins-and-battle.md, E-74
- spec — docs/spec/engine/rpgcode-functions.md, `random(max)`
- spec — docs/spec/engine/battle.md, BAT-8

## Notes

- Open question: Does E-74's “equally likely” require exactly equal probability for each `random(20)` result, or should the spec describe the current modulo mapping?
- Audit evidence: `packages/core/src/script/builtins/pure.ts:97-105` returns `1 + nextUint32() % range`; `stock/stock_battle/startup.prg:309` uses `random(5) <= 2`, and `:513` uses `random(20)` for the physical-attack draw. Do not generalize BAT-8's accepted run threshold to E-74.
- Risk rationale: medium — Changing E-74 wording or RNG behavior affects battle distributions and replay compatibility; this spike requires owner approval before runtime work.
