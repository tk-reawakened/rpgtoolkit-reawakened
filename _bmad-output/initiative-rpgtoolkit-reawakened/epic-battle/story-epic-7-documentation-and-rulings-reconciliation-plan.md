---
title: "Epic 7 documentation and rulings reconciliation"
type: 'feature'
ticket: 16
created: '2026-10-26'
status: in-progress
risk: "medium"
context:
  - "spec - docs/spec/engine/battle.md (BAT-3, BAT-7–15)"
  - "spec - docs/spec/engine/plugins-and-battle.md (E-73, R-57)"
  - "spec - docs/spec/engine/movement-and-collision.md#e-78"
  - "spec - docs/spec/engine/progression-and-levels.md (R-16)"
  - "spec - docs/spec/engine/rpgcode-functions.md (battle built-ins)"
  - "spec - docs/spec/engine/audio-media.md (saved playback section)"
---

## Intent

Make the battle rules, catalogs, and existing ticket plans agree with the approved rulings, without runtime changes. Repair incomplete evidence and stale/conflicting text while preserving useful historical context.

## Boundaries

Edit only the relevant specs and Epic 7 planning text. Do not change code or RNG behavior, do not bring menu cues forward from 7.11, and do not delete the schema-v1 migration.

## Key Decisions

- BAT-3 includes `battle.background` and actor-object handles; fighter-handle errors share `battle.bad-fighter`, distinct from `battle.bad-outcome`.
- BAT-7 follows ERR-2: report the custom-AI error, continue the program, and end the turn when the program returns.
- BAT-8 accepts `random(5) <= 2` and its negligible modulo bias (about 1 in 10^10); no RNG change.
- BAT-9 keeps `skill = -1` in the legacy callback only.
- BAT-10 restores music to the active board and keeps saved playback in the separate audio section, not BattleState.

## Acceptance

- [ ] BAT-3, BAT-7, BAT-8, BAT-9, and BAT-10 exactly reflect the approved rulings above.
- [ ] BAT-11–15 have required evidence, OWNER markers, and rejected alternatives; BAT-12/13 event and save wording agrees with EMIT-13 and save ownership.
- [ ] E-73 links to battle rules; E-78 reconciles its historical formula wording with settled R-16; R-57 no longer appears unresolved.
- [ ] The battle functions catalog includes `fp`, `givefp`, and `dp`; stale 7.8/7.10 plan language is corrected.
- [ ] No runtime or RNG behavior changes.

## Verification

Review each named BAT row, E-73/E-78, R-57, the battle functions table, and the affected plan wording against the owner rulings and cited evidence. Run link/anchor and relevant documentation checks in the main verification pass.

## Plan Change Log

- 2026-10-26: created from the Epic 7 acceptance audit and owner-approved rulings.
