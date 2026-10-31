---
type: discovery
title: "Closure audit: epic 20 (actors), criterion by criterion"
date: 2026-10-31
baseline_revision: 26740257db3b692b5b210b05b489f60057d35e72
---

# Epic 20 closure audit

Audited at **`26740257`**. All 15 children are now CLOSED: the refactor sweep (20.14 / #479) merged as #827 (`c282ad39`)
after this audit was written, so nothing is in flight.

| # | Done when | Verdict | Evidence |
|---|---|---|---|
| 1 | The actor model inventory is written in docs/spec and approved | **Proven** | `docs/spec/engine/actors.md`, section `#act-inventory`, holds the inventory (there is no separate inventory file under `epic-actors/discovery/`); the ruling record is `docs/spec` with owner markers |
| 2 | Party, enemies and NPCs are plain-data actors in one section; board sprites a separate section that may reference an actor | **Proven** | `packages/core/src/actors/`; `packages/core/test/actors.test.ts`, `actor-rules.test.ts`; `packages/core/src/sprites` holds the separate sprite section |
| 3 | Fallen, `advanceStatus(n)`, equipment bonuses and level-up defaults are core data + hooks with defaults | **Proven** | `actor-rules.test.ts` and `actor-behaviour.test.ts` (fallen at HP≤0, status countdown, level-up equation); the battle suites consume the same rules |
| 4 | A package registers named behaviours that override the hooks; the actor carries only the name | **Proven** | `actor-behaviour.test.ts` — “behaviour registration is namespaced, closed, and behaviour-first” and “behaviour names survive save as plain data and re-resolve after restore”; the OOP-12 hydration seam is `packages/core/src/script/host.ts` |
| 5 | Saves hold actor data and behaviour names only; load re-attaches by name; a missing behaviour gives the core default + diagnostic, never a refused load | **Proven for behaviour names** | `actor-behaviour.test.ts:338-339` asserts the missing-behaviour diagnostic's `file` is `"<package startup>"`; the save shape is plain data. The *listener* half of the same idea is the separate owner question 21.12 / #843 |
| 6 | Actors, boards and the game emit the ruled events; stock actor code re-emits `stock-rpg.fallen` | **Proven** | `packages/core/test/events-*.test.ts` plus the stock packages under `stock/` (stock_battle, stock_menu, stock_rpg present); `script-plugin-engine.test.ts` drives them |
| 7 | `stock-battle` and `stock-menu` exist as packages; templates list them; legacy DLLs map in memory | **Proven** | `stock/stock_battle`, `stock/stock_menu`, `stock/stock_rpg` on `main`; `battle-cues-engine.test.ts` loads `stock_battle` by name from the catalogue; the `.gam` mapping is covered by `format-main-file.test.ts` |
| 8 | Two authored battle scripts run over the same model with a save mid-fight, pinned in goldens; legacy goldens unchanged | **Proven** | `packages/core/test/battle-scripts.test.ts` with `golden/actors/battle-scripts.json` (the `zelda` 12-hearts and `ff` 9999-HP scripts, asserted tick by tick with a save at every tick) and the save-mid-fight case in `battle-cues-engine.test.ts` (“a full-engine save during battle resumes its parked thread”); `pnpm golden` and `pnpm closing` unchanged |

## Findings

None against the criteria. The only open child is 20.14 / #479 (the epic's refactor sweep, tracking item on the board),
which owns no Done-when criterion of its own; its closure is bookkeeping for the epic.

## Not probed

No store correction: 14/14 non-sweep entries read `done` and their issues are closed.

> **Corrections (2026-10-31, second cross-check).** Four rows were re-derived against `main`; the verdicts stand, the
> citations did not.
> - Header: "14 of 15 children are CLOSED; the open one is the epic's own refactor sweep (20.14 / #479)" — the sweep
>   merged as #827 (`c282ad39`), so all 15 are closed.
> - Row 1: "the inventory the epic references under `epic-actors/discovery/`" — no inventory file lives there; the
>   inventory is `docs/spec/engine/actors.md#act-inventory`.
> - Row 4 quoted a test named "behaviours hydrated by name from installed packages", which does not exist; the real
>   cases are "behaviour registration is namespaced, closed, and behaviour-first" and "behaviour names survive save as
>   plain data and re-resolve after restore".
> - Row 8 cited `battle-custom-fight.test.ts` / `battle-custom-program.test.ts` for the 12-hearts and 9999-HP scripts;
>   those scripts are `packages/core/test/battle-scripts.test.ts` with `golden/actors/battle-scripts.json`.
