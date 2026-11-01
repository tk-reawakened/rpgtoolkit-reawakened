---
title: "RPGCode spec framework: the describe/it/expect pack, its runner and *.spec.prg discovery"
ticket: 8
status: blocked
blocked_reason: awaiting the owner ruling on F-A (native helpers vs new language built-ins) only; F-B was disproven by probe and needs no ruling
---

## Intent

Entry 10.8 builds `packages/script-spec`: an RPGCode package plus the single native `specResult` channel, the matcher surface, and a runner that discovers `*.spec.prg`, gives every case a fresh fixture, and is deterministic.

## Delivered on `feat/946-spec-framework`

- **Slice 1 — `CommandView.pos`.** A getter fed by `ScriptServices.setCommandPos` at the `call` instruction, beside `thread`; two tests prove a command sees its call site. Rejected: stamping a position onto the effect channel (`recordEffect` stamps seq/tick/thread only, and the effect log is saveable data) and threading a position through arguments (no RPGCode expression produces one).
- **Slice 2 — the package.** `manifest.json` (name `script-spec`, namespace `scriptspec`, requests, startup `startup.prg`), the `startup.prg` library (describe/it/test, four hooks, expect with seven matchers and `.not`, skip/only), and `SPEC_PLUGIN`, registering **only** `specresult` (the registry keys by folded name, so a camel-case registration is unreachable). Tests: manifest parses, the catalogue loads the package by name, `specResult` records kind/name/expected/actual and the call's position, an unknown kind records no outcome.
- **Slice 3a — hook order.** beforeAll at registration; each case wrapped by beforeEach outermost-first, afterEach innermost-first; afterAll once when its describe returns; nested levels proved by the recorded order.
- `specClose` compares the absolute difference (the earlier symmetric check passed both directions); a callable must be called with its declared arity (ERR-2), so the default tolerance is passed as `0`.

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

The empty expected/actual seen by the first runner attempt was a **harness mismatch**, not an engine or library bug: the runner tests ran against a library revision that did not yet carry the per-case (`specCaseName`, `specCaseIndex`, `specOnlyCase`) changes the runner relied on. No spec amendment is needed for F-B.

### F-B (original claim, retained for the record) — `expect(actual).toBe(expected)` under FUN-8

**Claim.** The chained-matcher shape TOOL-5 rules is not implementable as written.

**Evidence.** FUN-8 (`docs/spec/engine/rpgcode-language.md:100`): a lambda captures only a plain variable reference; "Never captured: a parameter (it shadows the outer name)". `expect(actual)`'s parameter is therefore not carried into the matcher lambdas, and the matcher cannot read the value it is asserting on. Observed: the same `specCheck` call works at top level and from a lambda over a *variable*, but a matcher closing over `expect`'s parameter produces results inconsistent with the value.

**Options.**
1. *Reshape the API to two-argument matcher functions* — `toBe(actual, expected)`, `toEqual(actual, expected)`, …, with `.not` expressed as `notToBe(actual, expected)` or as a negation flag on a matcher object returned by a helper. No language change; changes TOOL-5's table and the documented calls.
2. *Relax FUN-8* so a lambda defined inside the declaring function may capture that parameter. A language change with capture-list, save-format and closure-cell consequences.

**Recommendation:** option 1 — a language change for a test API is disproportionate; the two-argument form is also what F-A's native helpers would expose.

### F-C — the runner is built; F-B disproved (see the probe table), F-A still open

**Delivered** (`packages/script-spec/src/runner.ts`):

- **Discovery** by running the file once and grouping outcomes by the record label, which the library writes as `<case>/<matcher>` (no new record kind: TOOL-5 fixes pass/fail/skip/only).
- **Fresh fixture per case**: each case is re-run in its own `GameState` with the library's `specOnlyCase` selector, so a global set by one case is unset in the next (tested).
- **Determinism**: every case is run twice; outcomes and `hashGameState` must be identical, and the report carries each case's state hash (tested; two whole-file runs deep-equal).
- **Strict mode** fails a skip (`skip` respects the selector, so an isolated run never reports another case's skip); **lenient** tolerates it and still lists it.
- **`only`** narrows and warns with the stable text "only() narrowed the run to the marked cases; unmarked cases were not run" (asserted verbatim).
- **Exact failure message**: `<matcher>: expected X, actual Y`, asserted as `toBe: expected 1, actual 2` and as the report's failure line.
- **Manifest absence**: `ENGINE_DEFAULT_MANIFEST` does not contain `script-spec`, and the plugin registers only `specresult`.

**Blocked on F-A**: element-wise `toEqual`, array `toContain` and `toThrow`. The seven runner tests deliberately do not use them; the library states the limits where they are defined.

**Judgement on the entry**: the runner and `specResult` surface match the entry, but two of the seven matchers (`toEqual` element-wise, `toThrow`) and array `toContain` do not. The entry stays **in progress** until the owner rules on F-A; the code lands because it is green and self-contained.


The runner slice (discovery, fresh fixture per case, determinism re-run with identical results and state hashes, strict mode failing a skip, `only` narrowing with a warning, exact failure-message text, engine-default-manifest absence) is untouched: its assertions are written against the matcher surface, so building it now would encode a shape the owner may change.

## Limits recorded in the library

`toEqual` is scalar equality and `toContain` is string-only (both say so where they are defined); `toThrow` reports a fixed failure; `afterEach`/`afterAll` are implemented for the library's own order but the runner has not exercised them across a fixture. None of these are silently wrong — each is a stated limit with the evidence above.

## Verify, mapped

| Ticket verify | Where |
|---|---|
| determinism re-run, identical results and state hashes | runner (F-C, not built) |
| strict fails a skip; `only` warns | runner (F-C, not built) |
| exact failure message | runner (F-C, not built) |
| absent from the engine's default manifest | not yet tested; `ENGINE_DEFAULT_MANIFEST` lists only engine plugins, so a test asserting `script-spec` is absent is a one-liner for the runner slice |
| `specResult` with kind, name, expected/actual and SourcePos | `packages/script-spec/test/spec-result.test.ts` (green) |
