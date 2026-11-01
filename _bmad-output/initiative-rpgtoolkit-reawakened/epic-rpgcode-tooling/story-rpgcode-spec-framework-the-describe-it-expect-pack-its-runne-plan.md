---
title: "RPGCode spec framework: the describe/it/expect pack, its runner and *.spec.prg discovery"
ticket: 8
status: blocked
blocked_reason: awaiting the owner ruling on F-A and completion of the independently identified TOOL-5 runner and matcher gaps
---

## Intent

Entry 10.8 builds `packages/script-spec`: an RPGCode package plus the single native `specResult` channel, the matcher surface, and a runner that discovers `*.spec.prg`, gives every case a fresh fixture, and is deterministic.

## Partial implementation merged in PR #1000

The story is [#948](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/948). The implementation branch was named `feat/946-spec-framework` in error: #946 is the Epic 9 parent issue, not this story. The historical branch name and commit messages do not change the tracker identity.

- **Slice 1 — `CommandView.pos`.** A getter fed by `ScriptServices.setCommandPos` at the `call` instruction, beside `thread`; two tests prove a command sees its call site. Rejected: stamping a position onto the effect channel (`recordEffect` stamps seq/tick/thread only, and the effect log is saveable data) and threading a position through arguments (no RPGCode expression produces one).
- **Slice 2 — the package.** `manifest.json` (name `script-spec`, namespace `scriptspec`, requests, startup `startup.prg`), the `startup.prg` library (describe/it/test, four hooks, expect with seven matchers and `.not`, skip/only), and `SPEC_PLUGIN`, registering **only** `specresult` (the registry keys by folded name, so a camel-case registration is unreachable). Tests: manifest parses, the catalogue loads the package by name, `specResult` records kind/name/expected/actual and the call's position, an unknown kind records no outcome.
- **Slice 3a — hook order.** beforeAll at registration; each case wrapped by beforeEach outermost-first, afterEach innermost-first; afterAll once when its describe returns; nested levels proved by the recorded order.
- `specClose` compares the absolute difference (the earlier symmetric check passed both directions); a callable must be called with its declared arity (ERR-2), so the default tolerance is passed as `0`. **Superseded by slice 4**, which supplies real one- and two-argument overloads; F-D still limits it to integer precision.

## Findings for the owner

### F-A — the matcher surface needs facts the language does not expose

**Claim.** Element-wise `toEqual`, array `toContain` and `toThrow` cannot be implemented by a library program under TOOL-5 as ruled.

**Evidence.**
- The catalogue has no type test and no array length: a search of every built-in module (`packages/core/src/script/builtins/*.ts`, `packs/*.ts`) finds `len` (string length only) and no `typeof`/`typeOf`/`arrayCount`; arrays are sparse (`docs/spec/engine/rpgcode-language.md:165`), so a script cannot even iterate one safely to a bound.
- `toThrow` cannot see the error: **ERR-1** — "Errors in nested calls are not caught by the caller's handler. An error raised inside a called script function is seen only by that function's own handler; with none there it is reported and the callee continues, and it never reaches the caller's handler." A library `toThrow(body)` therefore cannot observe `body`'s failure.
- TOOL-5 rules "the package is not a set of engine built-ins" and "one native command, `specResult`".

**Options.**
1. *A small closed set of native commands in the test-only package* (e.g. `specEqual(actual, expected)`, `specArrayLength(value)`, and a `specThrow` that runs a callable and reports whether it raised). Smallest code change; needs TOOL-5 reworded from one command to "a closed, test-only set of native commands".
2. *Add two language built-ins* (`typeOf`, `arrayCount`). Contradicts TOOL-5 explicitly and grows the 3.1-facing catalogue for a test-only need.
3. *Land EMIT-9 first* and make `toThrow` event-based; still leaves `toEqual`/`toContain` blocked on option 1 or 2.

**Recommendation:** option 1, with the commands named in TOOL-5 and their rows in `rpgcode-functions.md`; it keeps the product catalogue unchanged and the surface test-only.

### F-B — DISPROVEN by a four-part probe (see below): the matcher chain works

**Status:** not a language limitation. The matcher API can stay chained; FUN-8 does not stop a lambda created inside `f(x)` from reading `x`.

Probe results (all with `SPEC_PLUGIN` and the real VM):

| # | Program | Recorded |
|---|---|---|
| A | `m = { f: (x) => specResult("pass","ctl",x,"") }; m.f(5)` | `5` |
| B | `f = (x) => { return { g: (y) => specResult("pass","g",y,"") } }; f(1).g(2)` | `2` |
| C | `f = (x) => { return { g: () => specResult("pass","cap",x,"") } }; f(7).g()` | `7` — the capture works |
| D | `f = (x) => { return { g: (y) => specResult("pass","both",y,x) } }; f(7).g(9)` | `9`, `7` |
| E | the same through a top-level function (`h(y, x)`) | `9`, `7` |
| F | `expect(3-1).toBe(1)` with the package library | `fail, toBe, expected 1, actual 2` — correct |

The first runner experiment produced empty expected/actual values. The direct probes above show the basic capture and forwarding paths work; they do not independently prove the cause of every result in that earlier experiment. No FUN-8 amendment is established by those observations.

### F-B (disproven original claim, retained for the record) — `expect(actual).toBe(expected)` under FUN-8

**Claim.** The chained-matcher shape TOOL-5 rules is not implementable as written.

**Evidence.** FUN-8 (`docs/spec/engine/rpgcode-language.md:100`): a lambda captures only a plain variable reference; "Never captured: a parameter (it shadows the outer name)". `expect(actual)`'s parameter is therefore not carried into the matcher lambdas, and the matcher cannot read the value it is asserting on. Observed: the same `specCheck` call works at top level and from a lambda over a *variable*, but a matcher closing over `expect`'s parameter produces results inconsistent with the value.

**Options.**
1. *Reshape the API to two-argument matcher functions* — `toBe(actual, expected)`, `toEqual(actual, expected)`, …, with `.not` expressed as `notToBe(actual, expected)` or as a negation flag on a matcher object returned by a helper. No language change; changes TOOL-5's table and the documented calls.
2. *Relax FUN-8* so a lambda defined inside the declaring function may capture that parameter. A language change with capture-list, save-format and closure-cell consequences.

**Historical recommendation, superseded:** option 1 was recommended before the probe disproved the premise; it is not a current recommendation.

### F-C — the runner is built; F-B disproved (see the probe table), F-A still open

**Delivered** (`packages/script-spec/src/runner.ts`):

- **Case discovery implementation**: runs the supplied source and groups recorded outcome labels (`<case>/<matcher>`). It does not itself discover project `*.spec.prg` files, and a case without an outcome cannot be identified from those records.
- **Fresh fixture per case**: each case is re-run in its own `GameState` with the library's `specOnlyCase` selector, so a global set by one case is unset in the next (tested).
- **Determinism**: every case is run twice; outcomes and `hashGameState` must be identical, and the report carries each case's state hash (tested; two whole-file runs deep-equal).
- **Strict mode** fails a skip (`skip` respects the selector, so an isolated run never reports another case's skip); **lenient** tolerates it and still lists it.
- **`only` warning**: the current test asserts the warning text. It does not assert narrowing, and the library's `only` implementation records the marker and calls `it` without suppressing unmarked cases.
- **Exact failure message**: `<matcher>: expected X, actual Y`, asserted as `toBe: expected 1, actual 2` and as the report's failure line.
- **Manifest absence**: `ENGINE_DEFAULT_MANIFEST` does not contain `script-spec`, and the plugin registers only `specresult`.

**Blocked on F-A**: element-wise `toEqual`, array `toContain` and `toThrow`. The seven runner tests deliberately do not use them; the library states the limits where they are defined.

**Judgement on the entry**: PR #1000 landed a partial implementation, not a completed TOOL-5 runner. In addition to F-A, `only` selection, project file discovery and the other independently verified acceptance gaps must be resolved and exercised through the real consumer before this story can be closed. Keep the tracker blocked; do not change TOOL-5 without an owner ruling.

### F-D — fractional closeness is not evaluable in RPGCode arithmetic (owner-gated)

**Claim.** `toBeCloseTo` cannot compare fractional values from a package-defined matcher, because the language truncates a variable's number when it is used as an operand.

**Evidence.** `docs/spec/engine/rpgcode-language.md:209` (compatibility note 3) — "Reading a variable truncates its number to an integer. `x = 1.5; y = x + 0` gives `y = 1`. Literals and intermediate results keep their fractions." The core implements it: a binary or unary operand whose `Arg` carries a `ref` is coerced with `| 0`. Probes against the built core: `q = 0.0000002 - 0.0000001` is `1e-7` (literals), while `v = 0.00000005; r = v - 0` is `0` (variable operand). Inside a callable, `actual`, `expected` and `tolerance` are always variables, so `expect(0.002).toBeCloseTo(0, 0.001)` compares `0` with `0` and passes.

**Options.** 1. A test-only native comparison beside `specResult` (F-A option 1) that reads its arguments by reference, the way `isNaN`/`isFinite` do. 2. Change the language's numeric precision, which is a 3.1 compatibility decision.

**Status:** not implemented. The library documents the integer-precision limit where `toBeCloseTo` is defined, and a test pins the truncation so any future precision change is visible. No silent claim of fractional closeness.

### F-F — one-callable-with-two-arities needs a class-method tear-off read (owner-gated, not in this PR)

TOOL-5 declares `toBeCloseTo(double expected, [double tolerance])`, but FUN-1/ERR-2 give a callable exactly its declared arity and the language has no default argument, so one callable cannot accept both one and two arguments. A working design was built and then withdrawn from this PR: a class with two `close` overloads, read as a bound method (`get_member_bound` → `@class-method:<class>:<name>`), stored in the dictionary ADR 0014 requires. It works (an inherited zero-argument overload, an overridden one-argument overload and `.not` all dispatch correctly), but it changes engine semantics and the saved callable format: a class-method name would read as a callable where OOP-10 (`docs/spec/engine/rpgcode-modules-and-objects.md:332`) says a class instance exposes "only declared members", OOP-11's auto-binding rule (`:349`) covers "a member that holds a callable", legacy methods are reached by calls (`:358`), and a new `def` prefix would enter saves. G7/ADR 0007 make that doc-first, and a tooling PR must not carry it.

**Open sub-findings the withdrawn design exposed** (evidence for a future branch): access for a private method was decided at the read, so a legally obtained tear-off kept working when called; the granting class had to be recorded in the `def` so `bindThis` and a restore could not rebind it onto an unrelated class; and the receiver's program rather than the running program first answered the lookup, unlike a direct call (OOP-10). Those are all decisions for the OOP-11 ruling.

### F-E — a fresh fixture per case conflicts with once-per-group hooks

`docs/spec/engine/rpgcode-functions.md:664-665` says `beforeAll`/`afterAll` run once around the enclosing `describe`. The runner isolates every case by re-running the file, so a group's `beforeAll`/`afterAll` run once per rerun, including reruns of cases outside that group. Repeated registrations of the same hook kind now all run, in order. How a once-per-group setup is meant to survive a fresh fixture per case (captured value, or a snapshot taken after the group setup) is an owner decision.

## Slice 4 — project consumer, focused selection and hook multiplicity

- `packages/script-spec/src/project.ts`: `discoverProjectSpecs` walks a project recursively and returns deterministic project-relative paths for files ending exactly `.spec.prg`; `runSpecProject` reads each with the core Windows-1252 decoder and loads includes through a `ProgramLoader` built from the project's `Prg/` tree, so the asset resolver's case rules apply (`#include "HELPER.prg"` finds `Prg/helper.prg`).
- Focused runs narrow the whole project: every file is scanned in a collect-only pass that executes no case body, and when any file marks a case no unmarked file is run or reported. The warning text is unchanged.
- Discovery no longer depends on recorded outcomes: the collect pass records each registered case with its kind, so duplicate names and cases with no assertions are discovered, and a failure during collection fails discovery instead of yielding an empty successful run.
- Repeated `beforeEach`/`afterEach`/`afterAll` registrations all run, in registration order.
- `toBeTruthy` applies the RPGCode truth test (R-39); the previous numeric non-zero test called `""` and `"0"` false.
- Every outcome carries the spec file's own line (`(line N)` on each report entry); a runtime error inside a case becomes a failing outcome with its code, message and line; a run that never finishes is `spec.timeout`; a strict run lists its skips as failures.
- Each case starts on a fresh 1×1 board, one selected party actor and an empty variable set (tested with `HP!` and `ambientRed`).
- `toBeCloseTo` stays the two-argument callable PR #1000 shipped (a callable takes exactly its declared arity, FUN-1/ERR-2), now honest about its precision: whole numbers only (F-D), with the caller passing the limit. One- and two-argument overloads are not in this branch; they need F-F first.

**Still open:** F-A (array `toEqual`/`toContain`, `toThrow`), F-D, F-E, strict `toBe` type identity (numbers and strings currently compare by RPGCode `==`, which converts mixed numbers and strings), and `skip`/`only` on a `describe` group — both are declared `(name, body)` and are treated as cases, because no runtime distinction between a group body and a case body exists without executing the body during discovery.

## Limits recorded in the library

`toEqual` is scalar equality and `toContain` is string-only (both say so where they are defined); `toThrow` always records a failure and its negated form is absent. `toBeCloseTo` now accepts its omitted or explicit tolerance, but compares at the language's integer precision (F-D). The library's comments identify these limitations, but they are not implementations of the approved behaviors.

## Verify, mapped

| Ticket verify | Where |
|---|---|
| determinism re-run, identical results and state hashes | `packages/script-spec/test/runner.test.ts` exercises repeated supplied-source runs; complete consumer-flow coverage remains outstanding |
| strict fails a skip; `only` warns | `packages/script-spec/test/runner.test.ts` and `test/project.test.ts` (a marked case in one file excludes an unmarked file; the marked file reports only its marked case) |
| exact failure message | `packages/script-spec/test/runner.test.ts` asserts the message and its line; `test/project.test.ts` asserts the project-relative file prefix |
| absent from the engine's default manifest | asserted by `packages/script-spec/test/runner.test.ts` |
| `specResult` with kind, name, expected/actual and SourcePos | `packages/script-spec/test/spec-result.test.ts` (green) |
| discovering project `*.spec.prg` and running a real consumer | `packages/script-spec/test/project.test.ts` (recursive discovery, `Prg/` include, Windows-1252 source) |
