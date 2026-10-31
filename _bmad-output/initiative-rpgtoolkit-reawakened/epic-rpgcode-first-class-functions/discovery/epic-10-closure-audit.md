---
type: discovery
title: "Closure audit: epic rpgcode-first-class-functions, criterion by criterion"
date: 2026-10-31
baseline_revision: 3c7c71903422c3025ca592cac330e0b9b4381adf
---

# First-class functions closure audit

Audited at **`3c7c7190`**. All 7 child issues are CLOSED and every entry reads `done`.

| # | Done when | Verdict | Evidence |
|---|---|---|---|
| 1 | A script function or built-in can be referenced with `&name` and stored in a local, global or object variable | **Proven** | `packages/core/test/script-callable-syntax.test.ts` (callable literals, `&name`, storage positions) and `script-callable-runtime.test.ts` |
| 2 | Stored handles can be invoked dynamically with standard call syntax (`f(args)`, `obj->fn(args)`) | **Proven** | `script-callable-runtime.test.ts` plus `program-call-vm.test.ts` (dynamic call through the VM), and the corpus `synthetic-11-middleware` / `synthetic-13-package-layers` programs in the golden |
| 3 | Anonymous methods / function expressions can be instantiated, passed as callbacks and assigned | **Proven** | `script-callable-syntax.test.ts` and `script-class-objects.test.ts`; the corpus uses callback literals in `synthetic-12-cancelable-emit` |
| 4 | An author can reassign a global symbol to wrap or override a built-in, saving the original handle and chaining to it | **Proven** | `script-environment-table.test.ts` (the running scope's callable binding), `script-plugin-fixtures.test.ts` (the authored libraries call `bindingOf("mwin")` and chain) and `script-register-plugin.test.ts` (layers with `next`) |
| 5 | Function handles in `GameState.vm` serialize to plain JSON (G1) and restore bit-identically (G3) | **Proven** | `script-closure-save.test.ts`, the save-schema suites, and the corpus gate's `snapshot/restore verified` line over programs that hold callables |
| 6 | Legacy 3.1 games run identically, zero regressions in the headless golden suite | **Proven** | `pnpm golden` (`scripts: 27 programs ok`, every scene exact, audio rows stable) and `pnpm closing` (8/8 games match their baselines) on this SHA |
| 7 | Compiler/parser diagnostics for arity mismatches, non-callable invocations and circular inclusion | **Proven** | `script-callable-runtime.test.ts` and `script-errors.test.ts` (non-callable, arity), `script-modules.test.ts` (circular include), with `synthetic-9-mismatch` in the corpus gate |

## Findings

None. 7/7 entries `done`, 7/7 issues closed, no store correction and no follow-up ticket.

## Not probed

Criterion 6's “identically” is read from the golden and closing suites' own comparison, not from a manual diff of
3.1 outputs, which no second reference exists for (G7 forbids one).
