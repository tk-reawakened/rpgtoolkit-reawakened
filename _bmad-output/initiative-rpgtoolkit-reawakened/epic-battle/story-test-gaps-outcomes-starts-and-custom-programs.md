---
id: 18
type: story
title: "Test gaps for outcomes, battle starts, and custom fight programs"
parent: epic-battle
tracker_id: "#690"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/690"
after: [8, 9, 12]
hitl: false
risk: high
---

# Test gaps for outcomes, battle starts, and custom fight programs

## Description

Close the remaining deterministic test gaps in Epic 7.8, 7.9, and 7.12. Verify the gold effect is consumed by an inventory effect double and level-up preserves current SMP; exercise complete Fight/FightEnemy setup, the random-handoff `canRun` result, fallen HP, empty-party failure, and no-enemy/no-battle behavior; prove a catchable `program.missing` continues after an explicit marker; and run the same main-file-registered all-API custom fight program through the real path with the stock package absent and present-but-replaced.

## Acceptance Criteria

1. **Outcome effects:** A seeded victory routes gold through a consuming inventory double and asserts the resulting balance; fallen and living members preserve current SMP through default level-up growth.
2. **Battle setup:** Deterministic Fight/FightEnemy tests assert ordered parties, background, `canRun`, and starting HP including fallen members; random handoff derives `canRun` from all drawn enemies without another RNG draw; empty party is a located error.
3. **No enemies:** The empty-pool path shows the exact ruled message and leaves battle inactive.
4. **Missing custom program:** Catchable `program.missing` continues to an explicit marker and starts no battle.
5. **Main-file custom-fight API:** One authored program registered from the main file drives the full documented API, drawing and input through the real custom-fight path in paired seeded runs with stock_battle absent and present-but-overridden. Compare outcomes and state/draw hashes; do not read stock internals. Absent-package `stockBattle` access reports `include.missing`.
6. **Run chance:** Pin the approved deterministic `random(5) <= 2` success/failure boundary; do not require perfect statistical uniformity or change the RNG.

## References

- parent — `_bmad-output/initiative-rpgtoolkit-reawakened/epic-battle/epic-battle.md`
- issues — #511 (outcomes), #512 (battle starts), #515 (custom fight program)
- spec — `docs/spec/engine/battle.md` (BAT-3, BAT-8, BAT-9, BAT-12)
- spec — `docs/spec/engine/plugins-and-battle.md#e-78`
- spec — `docs/spec/engine/progression-and-levels.md`
- spec — `docs/spec/engine/rpgcode-functions.md` (battle API)

## Prerequisites

- Depends on: 8, 9, 12

## Guardrails

- G7 Clean-Room: use Reawakened specifications and current code only; never consult legacy GPL source.
- Preserve the approved seeded RNG contract and do not add statistical-randomness acceptance criteria.

## Notes

- Owner ruling, 2026-10-26: absent-package access to `stockBattle` reports `include.missing`.
- Owner ruling, 2026-10-26: `random(5) <= 2` and its negligible modulo bias are accepted; no RNG change.
