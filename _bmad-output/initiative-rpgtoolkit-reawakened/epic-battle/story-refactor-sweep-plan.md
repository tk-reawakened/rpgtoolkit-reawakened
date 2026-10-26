---
title: "Refactor sweep"
type: 'feature'
ticket: 13
created: '2026-10-19'
status: built
baseline_revision: '4255ec6f520af495d3aa2db8ed2553cb685ea3ab'
risk: "low"
context:
  - "spec - docs/spec/engine/battle.md as ruled by 7.1"
  - "epic - _bmad-output/initiative-rpgtoolkit-reawakened/epic-battle/epic-battle.md (Done when)"
  - "code - packages/core/src/save/sections.ts, packages/core/src/sprites/encounters.ts"
  - "code - packages/core/src/script/catalogue-responders.ts, packages/core/src/script/packs"
---

## Intent

Close the epic by making its seams single-owner and its evidence explicit. One registration path for the battle built-ins and the `battle` command; the battle section exported through the save barrel; the 5.11 handoff with one consumer; the 20.1 phase list; the package manifest and `.gam` mapping; the catalogue and command docs; the spec links and anchors. Remove the placeholder and any dead battle-phase code, then check every Done-when item with a named test or fixture.

## Boundaries

No new behaviour. If the sweep finds a missing rule, it is fixed in `battle.md` first (G7), then in code. It does not touch Epic 8's menus, items, gold or saves.

## Key Decisions

1. **Single registration.** The battle built-ins are registered once, from the battle pack, and no second path re-registers them. A catalogue test proves the documented rows and the registrations agree.

2. **One handoff consumer.** The 5.11 handoff has one reader (7.9). Any duplicate read or a second copy of the draw/encounter logic is deleted, and the handoff stays plain data.

3. **Phase list.** The phase list matches the 20.1 ruling; no `battle` core phase remains, and the phase test names the ruled list. Any dead branch that assumed a core phase is deleted.

4. **Save barrel.** `BattleSection` is exported from the save barrel, the placeholder comment is gone, and the section appears once in the section list and once in the reset list.

5. **Package manifest and `.gam`.** The `stock_battle` package is named in the manifest and mapped in `.gam` the same way as the other stock packages; its absence is the ruled "ends immediately" path, not a crash.

6. **Evidence.** Each Done-when item names the test or fixture that proves it in the PR; the epic's Done-when list is checked off with those names. `pnpm provenance` and `pnpm licence` are green.

## Acceptance

- [ ] No duplicate battle registration, handoff reader or dead battle-phase path remains. No named core test asserts all three.
- [ ] The phase, catalogue, command-docs, provenance and licence gates are green. These are repository gates, not a named `packages/core/test` test.
- [ ] Every docs link and anchor in `battle.md` and its amendments resolves. No named core test checks these links.
- [ ] Each Done-when item is checked with a test or fixture named in the PR. This is blocked by Epic 7.11, which remains intentionally unbuilt.
- [ ] The placeholder and its comment are gone; the section is exported and reset exactly once. No named core test asserts all of these.
- [ ] The full suite, typecheck and lint pass. No named core test proves these repository-wide gates.

## Verification

The gates above, a link/anchor checker, a grep for the removed placeholder and dead phase code, and the full suite. The PR body carries the Done-when checklist with the evidence names.
