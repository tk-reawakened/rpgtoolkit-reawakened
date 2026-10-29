---
id: 29
type: story
title: "Cover omitted E-79 fighter queries in a custom battle"
parent: epic-battle
tracker_id: "#749"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/749"
covers: [CAP-5, CAP-9]
after: [12, 17]
hitl: false
risk: low
---

# Cover omitted E-79 fighter queries in a custom battle

## Description

The custom-fight API suite covers most E-79 operations but does not assert fighter-name queries or the ruled stance/animation queries. Add focused regression coverage for those omitted calls without duplicating the existing broad operation, outcome, or custom-program tests.

## Acceptance Criteria

Verify: A custom battle program with `stock_battle` absent queries the fighter name and each ruled stance/animation operation using the public E-79 API; the fixture asserts the expected name and animation result for its actors, and exercises the relevant query outcome without reaching into package internals.

## References

- parent — _bmad-output/initiative-rpgtoolkit-reawakened/epic-battle/epic-battle.md
- spec — docs/spec/engine/battle.md, E-79
- tests — packages/core/test/battle-custom-fight.test.ts

## Notes

- Audit evidence: `packages/core/test/battle-custom-fight.test.ts:1054-1105` covers other custom-fight operations but omits the name/stance assertions; 7.18 / #690 already covers the broader public API and outcomes, so this is limited to the missing E-79 queries.
- Risk rationale: low — Unasserted fighter-name and stance queries could regress for custom battles; scope is limited to coverage of these omitted calls.
