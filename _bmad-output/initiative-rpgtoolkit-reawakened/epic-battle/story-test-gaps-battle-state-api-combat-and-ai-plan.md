---
title: "Test gaps for battle state, API, combat, and AI"
type: 'feature'
ticket: 17
created: '2026-10-26'
status: in-progress
risk: "high"
context:
  - "spec - docs/spec/engine/battle.md (BAT-2–BAT-7)"
  - "spec - docs/spec/engine/rpgcode-functions.md (battle built-ins)"
  - "spec - docs/spec/engine/progression-and-levels.md"
  - "spec - docs/spec/formats/save-game.md"
---

## Intent

Add real, named deterministic tests for remaining Epic 7.2–7.7 acceptance gaps, leaving already-proven behavior alone and avoiding unrelated source or golden changes.

## Boundaries

This is tests-only, except for the single expressly requested static guard for wall-clock/unseeded-random APIs. Do not modify runtime rules, the RNG algorithm, or save goldens; ticket 7.20 owns the battle-section save golden.

## Acceptance

- [ ] Validator input is unchanged; valid restore has no diagnostics; out-of-battle save has `battle: null`; BattleState contains no actor HP/SMP/status copies.
- [ ] Fighter errors share `battle.bad-fighter`; invalid outcomes use `battle.bad-outcome`; malformed API calls are atomic; registered battle built-ins match the catalogue and docs.
- [ ] Cover SMP attack underflow, AOE actions without critical draws, non-empty inventory immutability, special availability and status ordering, and exactly-once `fallen` for lethal Fight/Special/Item.
- [ ] Cover status HP/SMP/program/aging order, actor-owned status state, both signed effect bounds, level-0/2 healing AI, draw order after target selection, and AI configuration ownership.
- [ ] Custom-AI errors are reported and the program continues under ERR-2; the turn ends when the program returns.
- [ ] The narrowly scoped static guard rejects wall-clock/unseeded-random APIs in battle core/package inputs; all other tests assert actual deterministic behavior.

## Verification

Run focused battle state, API/catalogue, actions, loop/status, and AI tests. The static guard is limited to the relevant battle inputs and forbidden APIs; no other source-text assertions are added. Run repository checks in the main verification pass.

## Plan Change Log

- 2026-10-26: created to cover the audit's remaining test gaps for Epic 7.2–7.7.
