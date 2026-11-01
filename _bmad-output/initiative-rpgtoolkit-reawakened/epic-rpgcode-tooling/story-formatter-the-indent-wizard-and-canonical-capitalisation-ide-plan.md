---
title: "Formatter: the indent wizard and canonical capitalisation, idempotent and behaviour-preserving"
ticket: 7
status: done
---

## Landing

Merged as **`f71426ccf861983e557e216fced4697fefd10ed9`** — "feat(10.7): the RPGCode formatter with a corpus proof and a formatting baseline (#947)" (PR [#992](https://github.com/tk-reawakened/rpgtoolkit-reawakened/pull/992), squash). Issue #947 closed as completed.

Two slices: the formatter (`formatSource`, `formatChanged`, canonical names from `FIRST_PARTY_PLUGINS`) and the dogfooding baseline with the non-vacuous corpus proof.

Proofs: idempotence over all 431 corpus programs and the fixtures; identical lowered instructions (positions ignored) for every changed file that compiles; two named rewrites (`fixtures/legacy/ChimeranEmpire/Prg/Blacksmith.prg`, `.../Project.prg`) prove the comparison runs against real rewrites; no final newline, CRLF and Win-1252 cases pinned.

Baseline: `golden/format-baseline.json` records 30 of 55 dogfooding files that `fmt --check` would change, each with its reason (indentation to brace depth, or canonical lower-case of a registered command) rather than being rewritten into it. Applying that rewrite is a separate reviewable change.

Gates: typecheck, lint, test:strict 2575/2575, graph, licence, provenance, catalogue:check, command-docs:check, fixtures:author:check, golden, closing 8/8 and golden:bun all pass.
