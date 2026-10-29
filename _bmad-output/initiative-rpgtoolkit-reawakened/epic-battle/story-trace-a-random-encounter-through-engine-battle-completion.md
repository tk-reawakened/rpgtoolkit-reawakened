---
id: 28
type: story
title: "Trace a random encounter through engine battle completion"
parent: epic-battle
tracker_id: "#748"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/748"
covers: [CAP-4, CAP-9]
after: [5.11, 9]
hitl: false
risk: low
---

# Trace a random encounter through engine battle completion

## Description

The existing random-encounter tests cover movement, phase, and handoff separately, while engine tests inject a handoff. Add one deterministic full-engine check of an ordinary, noncustom movement-triggered encounter through stock battle completion without changing encounter rules or repeating direct-start cases.

## Acceptance Criteria

Verify: A seeded noncustom movement-triggered encounter uses the real engine handoff, starts `stock_battle`, reaches a checked outcome, and replays with matching gameplay state and RNG draws at the same simulation point; the test does not inject a prebuilt handoff or repeat direct Fight/no-enemy cases already covered by 7.9 and 7.18.

## References

- parent — _bmad-output/initiative-rpgtoolkit-reawakened/epic-battle/epic-battle.md
- spec — docs/spec/engine/battle.md, BAT-9
- spec — docs/spec/engine/plugins-and-battle.md, E-70

## Notes

- Audit evidence: `packages/core/test/random-encounter.test.ts:88-185` covers movement, phase, and handoff separately; `packages/core/test/engine.test.ts:337-400` injects a handoff rather than driving a real random encounter.
- Exclusion: direct Fight setup and no-enemy behavior are already covered by Epic 7.9 / #512 and 7.18 / #690.
- Risk rationale: low — Missing full-engine random-encounter coverage could hide integration regressions, but this ticket adds test coverage only.
