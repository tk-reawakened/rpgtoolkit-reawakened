---
id: 17
type: story
title: "Test gaps for battle state, API, combat, and AI"
parent: epic-battle
tracker_id: "#689"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/689"
after: [2, 3, 4, 5, 6, 7]
hitl: false
risk: high
---

# Test gaps for battle state, API, combat, and AI

## Description

Add named deterministic behavior tests for the remaining Epic 7.2–7.7 gaps in state validation/snapshots, battle built-in catalogue/docs parity, charge/actions/status, and enemy AI. Existing tests already cover atomic `battle.bad-fighter`/`battle.bad-outcome` errors and ERR-2 custom-AI continuation; G3 ESLint covers forbidden time/random APIs in core TypeScript. Do not add duplicate tests or source-text scans; leave the battle save golden to 7.20 and make no RNG or gameplay-rule changes.

## Acceptance Criteria

1. **State and snapshots:** The validator leaves input unchanged; valid restore yields no diagnostics; out-of-battle save has `battle: null`; BattleState contains no copied actor HP/SMP/status.
2. **Catalogue parity:** A named command-docs check (`pnpm command-docs:check`: `doc.required`, `native.summary-mismatch`, `native.row-missing`) rather than a named core test (amended 2026-10-27 under delegated decision, not a direct owner ruling: permanent tests must not assert source text or duplicate existing tooling) checks every registered battle-facing built-in against the catalogue and docs. Original wording: "A named behavior test checks every registered battle-facing built-in against the catalogue and docs."
3. **Charge/actions:** Cover SMP attack underflow, AOE actions without critical draws, non-empty inventory immutability, special availability and status ordering, and exactly-once `fallen` for lethal Fight/Special/Item.
4. **Status:** Cover HP/SMP/program/aging order, actor-owned status state, and signed per-round effects clamped at both bounds.
5. **AI:** Cover healing at levels 0 and 2, post-target combat draw order, and AI configuration isolation to the acting enemy.
6. **Scope:** Existing API-error and ERR-2 behavior is already tested; do not duplicate those cases or add a static source-text guard. No RNG, gameplay-rule, or golden-file changes; 7.20 owns the battle save golden.

## References

- parent — `_bmad-output/initiative-rpgtoolkit-reawakened/epic-battle/epic-battle.md`
- issues — #505–#510 (Epic 7.2–7.7)
- pull request — #696 (test-gap work in progress)
- spec — `docs/spec/engine/battle.md` (BAT-2–BAT-7)
- spec — `docs/spec/engine/rpgcode-functions.md` (battle built-ins)
- spec — `docs/spec/engine/progression-and-levels.md`
- spec — `docs/spec/engine/rpgcode-modules-and-objects.md#emit-13`
- spec — `docs/spec/formats/save-game.md`

## Prerequisites

- Depends on: 2, 3, 4, 5, 6, 7

## Guardrails

- G7 Clean-Room: use Reawakened specifications and current code only; never consult legacy GPL source.
- No runtime behavior, RNG algorithm, or unrelated golden changes.

## Notes

- The battle-section save golden is tracked separately by Epic 7.20.
- Existing battle API tests prove atomic `battle.bad-fighter` and `battle.bad-outcome`; existing AI tests prove ERR-2 continuation. G3 ESLint covers forbidden time/random APIs in core TypeScript. Do not duplicate those tests or add a source-text guard.
