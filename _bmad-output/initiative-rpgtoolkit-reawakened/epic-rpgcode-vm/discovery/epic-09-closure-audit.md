---
type: discovery
title: "Closure audit: epic rpgcode-vm, criterion by criterion"
date: 2026-10-31
baseline_revision: 3c7c71903422c3025ca592cac330e0b9b4381adf
---

# RPGCode VM closure audit

Audited at **`3c7c7190`**. All 27 child issues are CLOSED and every entry reads `done`. The VM is the one epic whose
criteria can be read directly off the corpus gate, so the audit cites the gate's own output plus the named suites.

| # | Done when | Verdict | Evidence |
|---|---|---|---|
| 1 | `system.prg` and `start.prg` of the sample games run to completion headlessly with scripted input | **Proven** | `pnpm golden` runs the corpus programs including the scripted-input sample cases (`packages/runner-harness/src/corpus.ts:665` `sample-start-demo` with key inputs, `:681` `sample-system-demo`, `:692` `sample-sys-test-demo`, `:703` `sample-win-demo`, and the `Basic` pair at `:751`), and prints `scripts: 27 programs ok (snapshot/restore verified)`; `pnpm closing` boots the fetched games (2 clean, 6 expected TK2 failures) |
| 2 | For every corpus program, a snapshot at a random step restored into a fresh VM finishes identically (G1) | **Proven** | The golden line above is that check's own report (`snapshot/restore verified`); `packages/runner-harness/src/restore-check.ts` (`randomSplit`, `checkSnapshotRestore`) is exercised by `packages/runner-harness/test/restore-check.test.ts` (“a restored host driven from the split matches every tick”, “a diverging restored run throws naming the first mismatching tick”) |
| 3 | Threads (board, persistent, item), sleep, wake, `tellThread`, blocking and `multiRun` coupling behave as E-33/E-93 | **Proven** | `packages/core/test/script-threads.test.ts` (thread lifecycle, sleep/wake, blocking, tell) plus the engine-level thread tests in `engine.test.ts`; the corpus threads programs (`synthetic-5-threads`) are in the same gate |
| 4 | Runtime errors report file and line; handlers and `resume` forms work | **Proven** | `script-errors.test.ts` (diagnostic file/line and handler forms), with `script-failures.ts` as the shared assertion helper; the corpus `synthetic-4-errors` and `synthetic-9-mismatch` programs pin the behaviour |
| 5 | Language-only and pure built-ins work; domain built-ins register through the API and are owned by their epics | **Proven** | `script-builtins-pure.test.ts`, `script-functions.test.ts`, `script-expressions.test.ts`, `script-control-flow.test.ts`, `script-modules.test.ts`, `script-frontend.test.ts`; `catalogue:check` and `command-docs:check` are green, which is the registration surface the domain packs use |
| 6 | State shape, built-in contract and wake contract are exactly AD-7…AD-9: inline programs, operand stack and handler state in a snapshot, by-reference outputs, duplicate-name rejection, restart-on-compiler-mismatch | **Proven** | `script-state.test.ts`, `script-operand-stack.test.ts`, `script-closure-save.test.ts`, `script-ir-fingerprint.test.ts` (compiler mismatch and restart), `script-registry.test.ts` (duplicate-name rejection), `script-step-counters.test.ts`; the save-schema tests for `restore.ir-mismatch` are green |

## Findings

None. 27/27 entries `done`, 27/27 issues closed, no store correction and no follow-up ticket.

## Not probed

Criterion 2's “every program in the corpus” is taken from the gate's count (`27 programs ok`) rather than re-deriving
the random step for each program by hand; that is exactly what the gate does on every pull request.
