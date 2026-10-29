---
title: "Test gaps for outcomes, battle starts, and custom fight programs"
type: 'feature'
ticket: 18
created: '2026-10-26'
status: done
risk: "high"
context:
  - "spec - docs/spec/engine/battle.md (BAT-3, BAT-8, BAT-9, BAT-12)"
  - "spec - docs/spec/engine/progression-and-levels.md"
  - "spec - docs/spec/engine/rpgcode-functions.md (battle API)"
---

## Intent

Close the remaining named test gaps in Epic 7.8, 7.9, and 7.12 while preserving the settled seeded-random and package-absence contracts.

## Boundaries

Tests only. Do not alter runtime behavior or the seeded RNG, require statistically perfect 2-in-5 sampling, or couple the custom program to stock internals. The current contract/docs reconciliation in 7.16 must land before tests rely on those rulings.

## Key Decisions

- The accepted run check is `random(5) <= 2` with negligible modulo bias (about 1 in 10^10); its boundary is already tested and no RNG change is needed.
- Absent-package access to `stockBattle` reports `include.missing`; existing tests prove it and this ticket does not repeat it.

## Acceptance

- [ ] A seeded victory proves living and fallen party members preserve current SMP through default level-up growth.
- [ ] `Fight` and `FightEnemy` tests assert ordered parties, background, `canRun` from all enemies, and starting HP including fallen members; random handoff derives `canRun` without an extra RNG draw.
- [ ] Catchable `program.missing` reaches an explicit marker and starts no battle.
- [ ] One main-file-registered all-API program drives the real custom-fight path in paired seeded runs with `stock_battle` absent and present-but-replaced; compare outcome/state/draw hashes and prove it reads no stock internals.
- [ ] Do not duplicate the already-covered gold, `include.missing`, run boundary, empty-party, or no-enemy cases.

## Verification

Run focused level-up, `Fight`/`FightEnemy` setup, handoff, missing-program continuation, and main-file custom-fight tests. Ensure paired API runs use the same seed/inputs. Do not rerun or duplicate the existing gold reward, package-absence diagnostic, run-boundary, empty-party, or empty-pool cases. Run repository checks in the main verification pass.

## Plan Change Log

- 2026-10-26: created as an Epic 7 follow-up to audit gaps in 7.8, 7.9, and 7.12.
- 2026-10-27: narrowed the ticket to outstanding tests and added the doc-first dependency on 7.16.
- 2026-10-28: marked done after PR #700 (`07f17469`) merged and closed #690 COMPLETED; tests plus one authored fixture, no runtime change — default level-up growth, Fight setup from every drawn enemy and the custom-fight paths in `battle-custom-fight.test.ts`, `battle-custom-program.test.ts`, `battle-outcomes-core.test.ts` and `battle-outcomes-stock.test.ts`.
