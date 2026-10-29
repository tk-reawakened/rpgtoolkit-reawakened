---
title: "Cover omitted E-79 fighter queries in a custom battle"
ticket: 29
status: done
---

## Completion Record

Built and merged as PR #760 (`abfff222`, "test: cover the omitted E-79 fighter name and stance queries in a custom fight"); issue #749 closed 2026-10-29T15:31:42Z.

- Spec (doc-first, G7): `1dcd9218` names BAT-3 operations 121 and 122 — the actor object's read-only `name` member and `fighteranimationfile(fighter, stance)` with the stored stance slots, the `attack` alias, name matching rules, and an empty string for a missing slot.
- Test: `98ec08f4` adds the focused custom-fight coverage and the authored program fixture `battle-main-file-custom-fight-queries.prg`.
- Verification: PR #760 CI passed all jobs, `unit (core-battle)` in 3m42s.

This plan was created by `tickets.py mark` because the build registered no plan of its own; it records only the merged facts above.
