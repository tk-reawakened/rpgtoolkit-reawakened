---
title: "Epic 7 documentation and rulings reconciliation"
type: 'feature'
ticket: 16
created: '2026-10-26'
status: in-progress
risk: "medium"
context:
  - "spec - docs/spec/engine/battle.md (BAT-3, BAT-8–9, BAT-11–15)"
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
- BAT-8 accepts `random(5) <= 2` and its negligible modulo bias (about 1 in 10^10); no RNG change.
- BAT-9 keeps `skill = -1` in the legacy callback only.

## Acceptance

- [x] BAT-3, BAT-8, and BAT-9 exactly reflect the approved rulings above. Evidence: `battle.md` BAT-3 (`battle.background`, actor-object handles, `battle.bad-fighter` vs `battle.bad-outcome`), BAT-8 (`random(5) <= 2`, deviation 3/(5·2^32) ≈ 1.4e-10 accepted, no RNG change), BAT-9 and `plugins-and-battle.md` E-79 (`skill = -1` legacy callback only).
- [x] BAT-11–15 have required evidence, OWNER markers, and rejected alternatives; BAT-12/13 event/save wording agrees with EMIT-13 and save ownership. Evidence: BAT-11–15 each carry an OWNER marker, `*Evidence:*` and `*Rejected:*` in `battle.md`; BAT-12/13 wording cites EMIT-13 and the independent audio save.
- [x] E-73 links to battle rules; E-78 reconciles its historical formula wording with settled R-16; R-57 no longer appears unresolved. Evidence: E-73 links BAT-5 and E-78 states the R-16 ruling in `movement-and-collision.md`; R-57 is “Historical conflict … settled by entry 7.1” in `plugins-and-battle.md`.
- [x] The battle functions catalog includes `fp`, `givefp`, and `dp`; stale 7.8/7.10 plan language is corrected. Evidence: `rpgcode-functions.md` lists `fp`, `givefp`, `dp` under “Reawakened actor-stat aliases”; the 7.8 plan records the `random(5) <= 2` run chance and the 7.9 plan records `skill = -1` as legacy-only.
- [x] No runtime or RNG behavior changes. Evidence: PR #695's changed files are all under `docs/` and `_bmad-output/`; no `src/`, stock-package or RNG change.

## Verification

Review the remaining BAT-3, BAT-8, BAT-9, and BAT-11–15 rows, E-73/E-78, R-57, the battle functions table, and affected plan wording against the owner rulings and cited evidence. Run link/anchor and relevant documentation checks in the main verification pass.

## Plan Change Log

- 2026-10-26: created from the Epic 7 acceptance audit and owner-approved rulings.
- 2026-10-27: removed BAT-7 and BAT-10 as duplicate documentation work; those rulings are already present in the current docs.
- 2026-10-27: reconciled against merged PR #695; every acceptance item verified against the current docs.
