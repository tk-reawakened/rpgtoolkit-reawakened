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
| A. Docs-first (G7) | **Landed** as `docs(tool-8)`: P1 and P2 written into TOOL-8 with the whitelist table and the error codes, the server note, TOOL-1's dependency sentence and the spine's AD-1 note. |
| B. Engine `debugView()` — **landed** | Add `debugView()` to the `Engine` interface (`packages/core/src/ports/engine.ts`) and implement it in `packages/core/src/engine/engine.ts`. The view is a deep copy: mutating returned objects does not affect state, and `hashState` is unchanged by the call. Update existing `Engine` implementors (`packages/runner-harness/src/script-host.ts`, `packages/runner-harness/src/double/test-engine.ts`) with stubs/implementation. |
| C. Evaluate capability (ruling P1) — **landed** | Add `engine.evaluate(expression, threadId, frameDepth?)` to parse and run an RPGCode expression in a copied frame/globals context, returning `{ value, error }`, without mutating engine state. |
| D. `packages/dap` — **landed** | `createDebugSession(engine, program, breakpoints)`, DAP request handlers, and a one-instruction stepping loop that computes step over/in/out from frame depth. |
| E. Web registration — **landed in the early extension, its vscode.dev run is the open gap** | In `packages/runner-web` (or `packages/editor-ui` when it exists), register the DAP session factory as a `DebugAdapterInlineImplementation` against the VS Code API. |
| F. Tests — **landed** | Hash-unchanged `debugView`; breakpoint stops at a line; step-over does not land in a deeper frame; step-in increases frame depth; step-out decreases frame depth; evaluate returns expected value; watch re-evaluates after a step. |

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

Landed on `feat/950-debug-adapter` (#950) as four commits: the TOOL-8 amendment, the
core seams, the `dap` package, and this record. What each slice became, and what the
implementation learned that the plan did not say:

1. **Docs (A).** P1 and P2 are [TOOL-8](docs/spec/engine/rpgcode-tooling.md#tool-8)
   subsections with their OWNER comments; the whitelist is a table of 25 folded
   command names, the budget is 1000 instructions, and the eight `evaluate.*` codes
   are tabled beside the rule that any other failure keeps the engine's own code.
   TOOL-1 now names `dap`'s two edges (`core` for the port, `runner-harness` for the
   scene) and records that the package adds no third-party dependency: the framing
   is 30 lines this repository owns, so no library ruling is needed.
2. **`debugView()` (B).** Each frame carries `program` (`key` and the decoded `text`,
   so a client can show an inline snippet it has no file for), `ip`, `line`,
   `function` and its own `locals`; the view also carries the innermost frame's
   `locals` and the globals. Two things the plan did not foresee: a frame's line is
   the instruction about to run in the innermost frame and the call it is inside in
   every outer frame, and the engine had to remember which thread the last `advance`
   paused in (observation only, never state) to know which frame the top-level
   `locals` belongs to.
3. **`evaluate()` (C).** The text is parsed inside a wrapper call, so the expression
   grammar — not the statement grammar, where a lone name is a zero-argument call —
   decides what it is; the parsed expression is then lowered into the paused frame's
   copied locals and run by the real `stepThread` under a command table that answers
   only the whitelist. Findings: `pos.file` for an inline program is `<inline>`, so a
   breakpoint's `file` is that string and not the client's path; a lowered program
   ends with `pop` and `return`, which would carry the copied thread on into the
   paused frame's own program, so the instruction list is cut at the result store;
   and a bare name resolves in the *current* frame and then the globals (SEM-4), never
   in a caller, so the copied frame takes the selected frame's locals.
4. **`packages/dap` (D).** `protocol.ts` (typed subset plus framing), `session.ts`
   (every request, stepping per THR-3), `channel.ts` (`serveDebugSession` over a
   stream pair) and a stdio binary outside the export. A launch may return a promise,
   because an editor reads the program and the board through its own file API.
   `continue` ignores a re-stop at the very location it resumed from: the engine's
   breakpoint cursor legitimately re-hits a line while that statement's own call runs.
5. **Web registration (E).** `extensions/rpgcode/src/debug.ts` is a
   `vscode.DebugAdapter` inline implementation registered by both hosts (desktop and
   the `vscode.dev` worker bundle), with `contributes.debuggers` and a launch schema.
   `extensions/rpgcode/build.mjs` now fails the build if the manifest stops
   contributing the debugger or either bundle stops registering the factory, so the
   CI extension job proves the registration reaches the artefacts a web load would
   run. **The vscode.dev run itself is the open gap**: CI builds and packages the
   extension but never opens it in a VS Code web session.
6. **Tests (F).** `packages/core/test/script-debug.test.ts` (view shape, per-frame
   locals, copies, the whitelist, every refusal code, the budget, the uninterrupted
   hash) and `packages/dap/test/session.test.ts` over a stream pair plus
   `packages/dap/test/stdio.test.ts` against the real binary, using the committed
   fixture `packages/dap/test/fixtures/probe` (empty authored board plus a two-thread
   program whose `compute()` calls `twice()`).

### The `vscode.dev` attempt (recorded so it is not repeated blindly)

The registration is in both bundles, and `extensions/rpgcode/build.mjs` fails the build if it
stops being. Running a *real* VS Code web session was attempted with `@vscode/test-web` 0.0.81
(MIT, dev-only) against VS Code Stable web (commit `69047191`), with the fixture folder mounted
and an extension-host test module that drives `vscode.debug.startDebugging`, a
`vscode.debug.addBreakpoints` breakpoint and `session.customRequest` for `threads`,
`stackTrace`, `scopes`, `variables`, `evaluate`, `next`, `stepOut` and `continue`.

What worked, in order: the VS Code web build downloaded and served; the extension loaded from
the development mount (`Loading development extension at /static/devextensions`); the test
module loaded and ran inside the web extension host (`[rpgcode web] test module loaded`, the
workspace mounted at `vscode-test-web://mount/`, and `/Prg/probe.prg:21` resolved as the
breakpoint line). Three defects were fixed on the way: the test module must live **inside** the
served extension folder or the runner reports *"no extension host found that can launch the test
runner"*; it must be **CommonJS** (the web worker host refuses ES modules: *"ESM modules are not
supported in the web worker extension host"*, even though the page reports `Using ESM loader:
true`); and a lane that runs beside another needs its own `port`.

Where it blocks: `startDebugging` fails with *"Couldn't find a debug adapter descriptor for
debug type 'rpgcode' (extension might have failed to activate)"*, and `extensions/rpgcode`'s
`activate` is never entered — no `Activating extension` record appears and the trace added to
`activate` never prints — even though `vscode.extensions.getExtension(...).activate()` resolves
and `isActive` is true, and even when activation is left to the client's `onDebugResolve`. The
extension is registered with the manifest the test reads (`browser=./dist/extension.browser.js`,
`contributes.debuggers[0].type = "rpgcode"`), so the failure is in how this host activates a
development extension, not in the contribution. The lane was removed rather than committed red;
a future attempt should first prove that *any* development extension's `activate` runs in this
host (one built-in extension with a `console.log`), then bring the debugger scenario back.

### The web host fix (#2008) and what is left

The blocker was ours, not the host's: the `browser` entry was bundled as an IIFE, and the web
extension host reads `exports.activate` from a module — so the host never entered `activate`
while still reporting the extension active. A controlled experiment settled it: a two-file probe
extension (`tools/vscode-web/fixtures/minimal-extension`) that only logs in `activate` and
registers a debug adapter factory reproduces the exact failure with `PROBE_FORMAT=iife` (no
`activate`, *"Couldn't find a debug adapter descriptor"*) and passes with `PROBE_FORMAT=cjs`
(`activate` runs, factory registers, session starts, adapter receives `initialize`/`launch`/
`disconnect`). `extensions/rpgcode/build.mjs` now builds the browser bundle as CommonJS, and
the RPGCode debugger then starts a real session in VS Code for the Web.

Remaining before this lane can gate CI: the scenario's own sequencing. `session.customRequest`
sent immediately after `onDidStartDebugSession` is cancelled by VS Code (`Canceled: Canceled`)
because the client is still in its configuration phase; the test must wait for the client's
paused state (`onDidChangeActiveStackItem`) before its first `continue`, and only then assert
the two threads (the program has not run `spare = thread(...)` before that stop). `run.mjs`
and its tests are committed and `pnpm vscode-web:probe` is green; `pnpm vscode-web:test` is not
wired into CI until it is green.

### Remaining gap (why the PR says `Refs #950`)

* The `vscode.dev` session is not run in CI. Everything else in the acceptance list is
  exercised: a stdio session, a breakpoint stop with its thread/frame/line, step over
  a call without entering it, step in, step out, two threads with frames, a local and
  a global (including a local of a frame below the innermost), a watch, the refusals
  and the budget, and a run to the uninterrupted state hash.
* Two defects found in this entry's own work, both fixed before the PR: the test
  helper waited for an event the session never sent (a fixture comment matched the
  line search, so the breakpoint landed on a comment and `continue` ran to the end),
  which hung the suite; the helper now asserts the name of the next event instead of
  waiting for a named one, and the fixture's line search skips comments.

Estimated size: **medium**, as planned.
