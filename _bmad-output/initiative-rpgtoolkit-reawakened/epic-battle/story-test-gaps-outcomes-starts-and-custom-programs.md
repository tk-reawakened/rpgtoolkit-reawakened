---
id: 18
type: story
title: "Test gaps for outcomes, battle starts, and custom fight programs"
parent: epic-battle
tracker_id: "#690"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/690"
after: [8, 9, 12, 16]
hitl: false
risk: high
---

# Test gaps for outcomes, battle starts, and custom fight programs

## Description

Close only the remaining deterministic test gaps in Epic 7.8, 7.9, and 7.12: preserve current SMP through default level-up growth; prove full `Fight` and `FightEnemy` setup and random-handoff `canRun` without an extra draw; prove catchable `program.missing` continuation to a marker; and run the same main-file-registered all-API custom fight through the real path with `stock_battle` absent and present-but-replaced. Existing tests already cover gold through the real reward path, `include.missing`, the run boundary, empty-party failure, and no-enemy/no-battle; do not duplicate those cases.

## Acceptance Criteria

1. **Level-up:** A seeded victory proves living and fallen party members preserve current SMP through default level-up growth.
2. **Battle setup:** `Fight` and `FightEnemy` tests assert ordered parties, background, `canRun` from all enemies, and starting HP including fallen members; random handoff derives `canRun` without another RNG draw.
3. **Missing custom program:** Catchable `program.missing` reaches an explicit marker and starts no battle.
4. **Main-file custom-fight API:** One main-file-registered all-API program drives the real custom-fight path in paired seeded runs with `stock_battle` absent and present-but-replaced; compare outcome/state/draw hashes and prove it reads no stock internals.
5. **Existing coverage:** Do not repeat gold-through-engine, `include.missing`, run-boundary, empty-party, or no-enemy/no-battle cases already proved by current tests.

## References

- parent — `_bmad-output/initiative-rpgtoolkit-reawakened/epic-battle/epic-battle.md`
- issues — #511 (outcomes), #512 (battle starts), #515 (custom fight program)
- issue — #688 (approved documentation dependency)
- spec — `docs/spec/engine/battle.md` (BAT-3, BAT-8, BAT-9, BAT-12)
- spec — `docs/spec/engine/movement-and-collision.md#e-78`
- spec — `docs/spec/engine/progression-and-levels.md`
- spec — `docs/spec/engine/rpgcode-functions.md` (battle API)

## Prerequisites

- Depends on: 8, 9, 12, 16

## Guardrails

- G7 Clean-Room: use Reawakened specifications and current code only; never consult legacy GPL source.
- Preserve the approved seeded RNG contract and do not add statistical-randomness acceptance criteria.

## Notes

- Owner ruling, 2026-10-26: absent-package access to `stockBattle` reports `include.missing`.
- Owner ruling, 2026-10-26: `random(5) <= 2` and its negligible modulo bias are accepted; no RNG change.
