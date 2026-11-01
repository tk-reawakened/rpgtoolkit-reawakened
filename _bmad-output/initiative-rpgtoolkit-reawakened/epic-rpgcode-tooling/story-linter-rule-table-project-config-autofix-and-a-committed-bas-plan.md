---
title: "Linter: rule table, project config, autofix and a committed baseline"
ticket: 6
status: done
---

## Landing

Merged as **`5225e0c15cd49a9c4dcd0c96136b44e639bcef33`** — "feat(10.6): the rule-based linter, one config and a stock baseline (#945)" (PR [#985](https://github.com/tk-reawakened/rpgtoolkit-reawakened/pull/985), squash). Issue #945 closed as completed.

Three slices on one branch: the rule table + config + four index rules; the four dialect rules with safe autofix; the dogfooding baseline. Gates at the final head: `typecheck`, `lint`, `graph`, `licence`, `provenance`, `catalogue:check`, `command-docs:check`, `fixtures:author:check`, `golden`, `golden:bun` and `closing` (8/8) pass; `test:strict` 2535/2535, 0 skipped.

First baseline content: seven `lint/unknown-command` findings over the three `stock/` programs (`bridgetalked`; `next`, `get`, `clearbuffer`), committed as `golden/lint-baseline.json` and rebuilt by a test.

Two false positives were fixed before the baseline: a plain-name call whose name is read anywhere is a callable variable (FUN-8), and `unresolved-include` only runs with an asset index (`resolveIncludes`).

## Baseline correction (2026-10-31): all seven findings were false positives

The first baseline committed seven `lint/unknown-command` findings against our own `stock/` packages. Challenging each by hand:

| Name | Verdict | Evidence |
|---|---|---|
| `get` | **registered command** | `MOVEMENT_PLUGIN`, row `get` in `docs/spec/engine/rpgcode-functions.md:34` |
| `clearbuffer` | **registered command** | `MOVEMENT_PLUGIN`, row at `rpgcode-functions.md:46` |
| `bridgetalked` | **registered command** | `STOCK_RPG_PLUGIN` (`packages/core/src/script/stock-rpg.ts:35`) |
| `next` (×4: stock_menu and three in stock_battle) | **lambda parameter called as a callable** | `internalmenu: (menu, next) => next(menu)`; the IR has the call but no `load`, so the index needs parameter names |

The linter's plugin list was the docs gate's eleven plugin ids, not the engine's full registration set, so three registered packs (movement, UI/graphics and stock-RPG) were invisible; and the index had no parameter fact, so a called parameter looked unknown.

Fixes:

- `core`: new `FIRST_PARTY_PLUGINS` (the engine table plus UI, graphics, movement, battle and stock-RPG), used by the linter, the baseline and the language server's default catalogue.
- `script-tools` index: additive `parameters` per program (every function, method and lambda parameter, folded), which is a **minor** change under TOOL-6's stability promise; the schema and the index tests are updated.
- `lint/unknown-command` does not fire on a parameter name.

The re-recorded baseline is **empty**: `stock/` lints clean, and the test proves the rules are still armed by reporting `nope()` in a probe program. A clean baseline is a real assertion; the previous seven entries were suppressions of a broken catalogue.
