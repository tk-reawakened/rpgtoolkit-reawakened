---
title: "Test gaps for outcomes, battle starts, and custom fight programs"
type: 'feature'
ticket: 18
created: '2026-10-26'
status: draft
risk: "high"
context:
  - "spec - docs/spec/engine/battle.md (BAT-3, BAT-8, BAT-9, BAT-12)"
  - "spec - docs/spec/engine/progression-and-levels.md"
  - "spec - docs/spec/engine/rpgcode-functions.md (battle API)"
---

## Intent

Close the remaining named test gaps in Epic 7.8, 7.9, and 7.12 while preserving the settled seeded-random and package-absence contracts.

## Boundaries

Tests only. Do not alter the seeded RNG, require statistically perfect 2-in-5 sampling, change runtime behavior, or couple the custom program to stock internals.

## Key Decisions

- The accepted run check is `random(5) <= 2` with negligible modulo bias (about 1 in 10^10); test the deterministic boundary, not statistical uniformity.
- Absent-package access to `stockBattle` is the catchable `include.missing` diagnostic.

## Acceptance

- [ ] Consume the victory gold action through an inventory effect double and assert the resulting balance; assert current SMP is preserved by default level-up growth.
- [ ] Test Fight/FightEnemy setup fields, ordered parties/background/`canRun`, and fallen HP; test handoff `canRun` without an extra random draw and empty-party error.
- [ ] An empty encounter pool shows the exact message and leaves no active battle.
- [ ] Catchable `program.missing` continues to an explicit marker and starts no battle.
- [ ] A main-file-registered all-API program runs through the real custom-fight path with stock_battle absent and present-but-replaced; compare seeded outcome/state/draw hashes and verify no internals access (`include.missing` when absent).
- [ ] Pin the accepted `random(5) <= 2` success/failure boundary with deterministic inputs; do not change the RNG.

## Verification

Run focused outcome, start/handoff, missing-program, and main-file custom-fight tests. Ensure the paired API-fixture runs use the same seed and inputs. Run repository checks in the main verification pass.

## Plan Change Log

- 2026-10-26: created as an Epic 7 follow-up to audit gaps in 7.8, 7.9, and 7.12.
