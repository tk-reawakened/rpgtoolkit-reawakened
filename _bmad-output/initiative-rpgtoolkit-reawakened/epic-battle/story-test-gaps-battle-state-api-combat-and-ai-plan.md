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
  - "pull request - #696 (test-gap work in progress)"
  - "spec - docs/spec/engine/progression-and-levels.md"
  - "spec - docs/spec/formats/save-game.md"
---

## Intent

Add real, named deterministic tests for remaining Epic 7.2–7.7 acceptance gaps, leaving already-proven behavior alone and avoiding unrelated source or golden changes.

## Boundaries

Tests only. Do not modify runtime rules, the RNG algorithm, or save goldens; ticket 7.20 owns the battle-section save golden. Do not add source-text guards: the existing API-error/ERR-2 tests and G3 TypeScript lint already cover those behaviors/restrictions.

## Acceptance

- [ ] Validator input is unchanged; valid restore has no diagnostics; out-of-battle save has `battle: null`; BattleState contains no actor HP/SMP/status copies.
- [ ] A named test checks every registered battle-facing built-in against the catalogue and docs.
- [ ] Cover SMP attack underflow, AOE actions without critical draws, non-empty inventory immutability, special availability/status order, and exactly-once `fallen` for lethal Fight/Special/Item.
- [ ] Cover status HP/SMP/program/aging order, actor-owned status state, and both signed effect bounds.
- [ ] Cover level-0/2 healing AI, post-target draw order, and AI configuration ownership.
- [ ] Do not duplicate the existing atomic `battle.bad-fighter`/`battle.bad-outcome` or ERR-2 continuation tests; no static source-text guard or golden changes.

## Verification

Run focused battle state/snapshot, API/catalogue, actions, loop/status, and AI tests. Do not add static source-text assertions; existing tests cover API errors and ERR-2 continuation, and G3 lint covers restricted TypeScript APIs. Run repository checks in the main verification pass.

## Plan Change Log

- 2026-10-26: created to cover the audit's remaining test gaps for Epic 7.2–7.7.
- 2026-10-27: removed duplicate API-error/ERR-2 tests and the static source-text guard from the planned work.
