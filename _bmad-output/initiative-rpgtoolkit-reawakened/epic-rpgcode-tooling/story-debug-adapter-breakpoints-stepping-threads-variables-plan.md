---
title: "Debug adapter: breakpoints, step over/in/out, threads, call stack, variables and watches"
ticket: 10
status: draft
---

## Intent

Entry 10.10 builds `packages/dap`, a Debug Adapter Protocol (DAP) implementation over the engine's existing AD-1 breakpoint contract and the TOOL-8 `debugView()` projection. The package:

- drives `createEngine` on a committed fixture (a SceneInit board plus a program),
- sets source breakpoints via `engine.setBreakpoints()`,
- resumes with `advance(..., resume: "step")` to implement step over/in/out in the adapter,
- answers DAP requests for threads, stackTrace, scopes, variables and evaluate,
- and registers as a VS Code `DebugAdapterInlineImplementation` in the web build.

The engine gains `debugView()` as its only required new seam (TOOL-8). All stepping logic stays in the adapter; the engine gains no stepping mode beyond the existing `continue`/`step` resume contract ([THR-3](docs/spec/engine/rpgcode-errors-and-threads.md#thr-3)).

## Slices

| Slice | What it changes |
|---|---|
| A. Docs-first (G7) | TOOL-8 is already ruled; this plan records the adapter-side interpretation of step over/in/out and the proposed rulings below. No new spec page is needed unless a ruling changes the contract. |
| B. Engine `debugView()` | Add `debugView()` to the `Engine` interface (`packages/core/src/ports/engine.ts`) and implement it in `packages/core/src/engine/engine.ts`. The view is a deep copy: mutating returned objects does not affect state, and `hashState` is unchanged by the call. Update existing `Engine` implementors (`packages/runner-harness/src/script-host.ts`, `packages/runner-harness/src/double/test-engine.ts`) with stubs/implementation. |
| C. Evaluate capability (proposed ruling P1) | Add `engine.evaluate(expression, threadId, frameDepth?)` to parse and run an RPGCode expression in a copied frame/globals context, returning `{ value, error }`, without mutating engine state. |
| D. `packages/dap` | `createDebugSession(engine, program, breakpoints)`, DAP request handlers, and a one-instruction stepping loop that computes step over/in/out from frame depth. |
| E. Web registration | In `packages/runner-web` (or `packages/editor-ui` when it exists), register the DAP session factory as a `DebugAdapterInlineImplementation` against the VS Code API. |
| F. Tests | Hash-unchanged `debugView`; breakpoint stops at a line; step-over does not land in a deeper frame; step-in increases frame depth; step-out decreases frame depth; evaluate returns expected value; watch re-evaluates after a step. |

## Guardrail: sequencing

No `packages/core` edit — including any change to the `debugView()` shape, the addition of `evaluate()`, or any other new VM seam — may land until **P1 and P2 are ratified as doc-first amendments to TOOL-8**. A later session must not start implementation at P1. P3 is already ruled by THR-3 and the existing AD-1 `resume: "step"` contract, so the adapter-side stepping design can proceed independently once the plan is approved.

## Proposed rulings

- **P1 — Evaluate/watch needs an engine-side expression runner.**
  - **Question.** TOOL-8 gives `debugView()` but no expression evaluation. The 10.10 description includes `evaluate` and `watches`.
  - **Recommended ruling.** Add `engine.evaluate(expression, threadId, frameDepth?)` that parses the expression against the current program's globals and the requested frame's locals, runs it in a copied context, and returns `{ value, error }`. The engine state hash is unchanged.
  - **Evidence.** DAP `evaluate` and `watches` require reading expression values; re-implementing RPGCode expression semantics in the adapter duplicates core and invites drift.
  - **Rejected alternative.** Evaluate in the adapter by maintaining a shadow interpreter or by temporarily mutating engine state, both of which violate G1/G3 and TOOL-8's read-only contract.

- **P2 — `debugView()` should expose locals per frame.**
  - **Question.** TOOL-8 says `locals` is only the innermost frame. DAP `scopes`/`variables` requests expect locals for any selected frame.
  - **Recommended ruling.** Extend `debugView()` so each frame carries its own `locals`; keep a top-level `locals` alias pointing to the innermost frame for backward compatibility.
  - **Evidence.** The frames array already contains the program, instruction pointer, source line and function; adding `locals` to each frame is a natural extension and lets the DAP adapter answer `variables` for any frame without re-querying.
  - **Rejected alternative.** Restrict DAP scopes to innermost Locals + Globals only, which breaks standard stack-trace variable inspection.

- **P3 — Stepping is adapter-side single-instruction with frame-depth checks.**
  - **Question.** The contract says step over/in/out are computed by the adapter from frame depth between one-instruction resumes.
  - **Recommended ruling.** The adapter issues `advance(..., resume: "step")` repeatedly, compares frame depth before and after, and decides when to pause. No new VM stepping mode is added.
  - **Evidence.** THR-3 defines a step as one VM instruction; `ResumeMode` already supports `"step"`.
  - **Rejected alternative.** Add engine-side step-over/in/out modes, which would couple the VM to DAP semantics and complicate the save/restore contract.

## Decisions already ruled

- **Read-only, copied-out view.** TOOL-8 / AD-1: `debugView()` returns plain data, copied out, never aliased, leaving `stateHash` unchanged.
- **One-instruction resume.** AD-1 / THR-3: `advance(..., resume: "step")` executes one VM instruction and pauses. The adapter uses this to implement all stepping.
- **Source breakpoints.** AD-1: `engine.setBreakpoints([{ file, line }])`; a hit returns `TickReport.paused`.

## Verify, mapped

| Requirement | Acceptance evidence |
|---|---|
| `debugView()` does not mutate the VM | Two `hashState` calls before and after `debugView()` are equal; mutating the returned object and advancing again does not change behavior. |
| `debugView()` leaves state hash unchanged | `engine.advance(1, []).stateHash` is identical whether `debugView()` was called mid-tick or not. |
| Step-over does not land in a deeper frame | After a step-over from a call site, the top frame's program/line is the caller's next line; frame depth is unchanged. Assertion on `frames.length`. |
| Step-in increases frame depth | After stepping into a call, `frames.length` is one greater than before. |
| Step-out decreases frame depth | After stepping out, `frames.length` is one less than before and the line is in the caller. |
| Breakpoint stops at the given line | Set a breakpoint at line `L`; `engine.advance(...)` returns `paused.line === L`. |
| Evaluate returns the expected value | `engine.evaluate("x + 1", threadId, 0)` returns the correct result when `x` is in scope. |
| Watch re-evaluates after a step | A watch expression is re-evaluated after each `resume: "step"` and reported with the updated value. |
| Web registration | The web build exposes a `DebugAdapterInlineImplementation` factory that can start a session and return DAP messages. |

## Out of scope

- Changing the VM's stepping or breakpoint implementation beyond adding `debugView()` and `evaluate()`.
- A transport (stdio/TCP) debug server; this entry ships an inline implementation for the web build and a programmatic API for tests.
- Variable editing/setValue; watches are read-only.
- Conditional breakpoints or logpoints.
- Source maps or `#include` line translation; breakpoints use the unit's own line from `SourcePos`.

## Files touched

- `packages/core/src/ports/engine.ts` — add `DebugView`, `EvalResult`, `debugView()`, `evaluate()` to `Engine`.
- `packages/core/src/engine/engine.ts` — implement `debugView()` and `evaluate()`; ensure copies are deep.
- `packages/runner-harness/src/script-host.ts` — add `debugView()`/`evaluate()` to the `Engine` wrapper.
- `packages/runner-harness/src/double/test-engine.ts` — add stub methods.
- `packages/dap/src/session.ts`, `packages/dap/src/handlers.ts`, `packages/dap/src/index.ts` — new DAP package.
- `packages/dap/package.json`, `packages/dap/tsconfig.json` — new package wiring.
- `packages/runner-web/src/index.ts` (or future `packages/editor-ui`) — register `DebugAdapterInlineImplementation`.
- `tools/deps/edges.json` and `tools/check-core-deps` if rules require it.
- `.github/workflows/ci.yml` only if a DAP-specific shard is required (defer to 10.11 release entry).

## Landing

Not yet started. Estimated size: **medium**.
