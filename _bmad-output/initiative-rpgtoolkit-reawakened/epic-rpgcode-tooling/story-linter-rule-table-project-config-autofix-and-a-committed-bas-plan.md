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
