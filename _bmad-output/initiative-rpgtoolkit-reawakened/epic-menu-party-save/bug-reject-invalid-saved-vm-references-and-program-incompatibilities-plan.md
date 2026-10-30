---
title: "Reject invalid saved VM references and program incompatibilities"
ticket: 22
type: bug
status: built
risk: high
---

## Scope

Harden normal save and snapshot validation for VM references, saved object programs, compiler mismatch precedence, and surface payload shape while preserving released/reused object values and suspended method receivers. This is a focused slice of #593, not completion of its asset-aware equipment validation.

## Contract and evidence

`docs/spec/formats/save-game.md` requires compiler mismatch refusal before payload use and preservation of supported script continuation. `packages/core/test/save-compiler-refusal.test.ts`, `save-migration.test.ts`, and `script-class-objects.test.ts` cover the changed boundaries. The remaining #593/#778 equipment reconciliation dependency is documented in the 8.10 plan.
