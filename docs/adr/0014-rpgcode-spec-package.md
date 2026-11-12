# ADR 0014 — The RPGCode spec API is a test-only package, not engine built-ins

> **Status:** Accepted (owner, 2026-10-31). **Amended 2026-11-11** (owner, #948, ruling F-A): the one native command becomes a closed, test-only set of seven; see [the amendment](#amendment-2026-11-11--a-closed-test-only-set-of-native-commands). **Amended 2026-11-12** (owner, #2042): the set grows to twelve with the test doubles and spies; see [the second amendment](#amendment-2026-11-12--test-doubles-and-spies). Numbering note: **0013 belongs to the desktop shell ADR**, which epic 9 lands with the same commit series; this ADR deliberately takes 0014 so the two can land independently.
> **Supersedes:** nothing. **Amends:** nothing. Related: [ADR 0004](0004-script-ast-step-ir-and-plugins.md) (the plugin manifest and command registration), [ADR 0007](0007-docs-spec-is-the-normative-specification.md) (docs first).

## Context

RPGCode authors write game logic in `.prg` files; the engine has no way to test it. Epic 10 adds a Jasmine-style framework — `describe`, `it`, `expect` with chainable matchers, hooks, `skip`/`only` — and the question is where its commands live.

Three facts constrain the answer. **G1** requires the VM to remain a plain-data step machine, so anything that runs a script body must do so as an ordinary call, not by re-entering the interpreter from inside a native handler. The command contract (`CommandHandler`, `packages/core/src/script/plugin.ts:167-171`) receives a read-only `CommandView` that cannot invoke a callable, so a native `it(name, body)` could not run its lambda without a new VM capability. And **G7** with [ADR 0004](0004-script-ast-step-ir-and-plugins.md) requires a command to be specified in `docs/spec` before it exists, and every registered command to carry documentation the command-docs gate validates.

Meanwhile the language already has first-class callables: a plain-name call resolves through the environment table, whose first entry is the running scope's own variable when it holds a callable (FUN-8, `docs/spec/engine/rpgcode-language.md`). So a *script* function can call a lambda; a native handler cannot.

## Decision

The spec API is an RPGCode package, `script-spec`, consisting of a library program plus **one** native command, `specResult`, which records a result (kind, case name, expected, actual) together with the source position the VM already knows for the call. Everything authors write — `describe`, `it`/`test`, the four hooks, `expect` with `toBe`, `toEqual`, `toBeTruthy`, `toBeNull`, `toContain`, `toBeCloseTo`, `toThrow` and `.not`, `skip` and `only` — is defined in the package's library program, so `it` calls its body as an ordinary callable call and `expect` returns a dictionary of callables.

The package is loadable only by the test runner. It must not appear in the engine's default manifest, and a test asserts that it does not, so a shipped game's catalogue never carries test commands. The contract is specified in `docs/spec/engine/rpgcode-tooling.md#tool-5`; the command rows are in `docs/spec/engine/rpgcode-functions.md`.

## Consequences

* `it(name, body)` needs no new VM capability: the call is a plain-name call of a variable holding a callable, which FUN-8 already rules and entry 18.4/18.5 already implement.
* One command needs a spec row and a catalogue entry, not roughly twenty.
* Failure messages get an exact source line cheaply, because the native call is the point at which the VM knows the position.
* The test runner owns result reporting and fixture isolation; a game never learns the API exists.
* A future author-facing assertion library can be a different package with a different manifest entry, without touching the engine.

## Rejected

**About twenty native built-ins.** Each would need a `docs/spec` row and a catalogue entry; `it` could not run its lambda without a new VM capability (a nested re-entry the step machine does not have); and every shipped game's catalogue would carry test commands, which the corpus and command-docs gates would then have to special-case.

**A runner-side protocol with no RPGCode API.** Authors would write their specs in TypeScript, which defeats the point: the programs under test are RPGCode, and their authors write RPGCode.

## Amendment (2026-11-11) — a closed, test-only set of native commands

**Context.** Building the library (entry 10.8) showed that four matchers cannot be written in RPGCode. `toEqual` and `toContain` need a value's type and an element array's indices; the language has neither, element arrays are separate variables (SEM-5), and a lambda captures a copy and drops the reference `expect` received. `toThrow` must see an error raised in a called function, and ERR-1 never delivers one to the caller. `toBeCloseTo` must compare stored doubles that a named read truncates (SEM-3).

**Decision.** `script-spec` ships `specResult` plus six matcher helpers — `specCapture`, `specEqual`, `specContain`, `specClose`, `specThrowBegin` and `specThrowEnd` — specified in [TOOL-5](../spec/engine/rpgcode-tooling.md#tool-5-natives) and [rpgcode-functions.md](../spec/engine/rpgcode-functions.md#tooling-the-rpgcode-spec-package-not-part-of-the-282-legacy-catalogue). The rest of the decision above stands: authors still write against the library program, `it` still calls its body as an ordinary call, and the package is still absent from the default manifest. The set is **closed**: a native command joins it only by editing TOOL-5 first. `toBeCloseTo` takes a required tolerance and `toThrow()` takes none, because a matcher has one fixed arity and methods are call-only (F-F, 2026-11-01).

**Consequences.** Seven catalogue rows instead of one, all test-only. No helper re-enters the interpreter: `specThrowBegin` and `specThrowEnd` bracket an ordinary call the library makes, so the G1 reasoning above holds.

**Rejected.** General `typeOf`/`arrayCount` built-ins (test primitives in every game's catalogue, and still no way to list a sparse element array); letting a nested error reach the caller's handler (changes verified 3.1 control flow, R2-Q10); a class-method tear-off for an optional tolerance (ruled out by F-F).

## Amendment (2026-11-12) — test doubles and spies

**Context.** Epic 10's Done-when 8 asks for test doubles for input, ticks, RNG and built-ins, with spies and `toHaveBeenCalledWith` (#2042). None of them can be a library function: a scheduled key has to enter the input section before a tick's wait poll, a scripted draw has to replace the RNG port a command reads, and a spy has to wrap a command's handler. All three are on the runner's side of the VM.

**Decision.** `script-spec` adds five natives, specified in [TOOL-5](../spec/engine/rpgcode-tooling.md#tool-5-doubles): `specInput`, `specTicks`, `specRng` and `spyOn`, which a case calls directly, and `specCalled`, the helper behind the new `toHaveBeenCalledWith` and `toHaveBeenNthCalledWith` matchers. Their state is host-side for one run, never saved or hashed, and starts empty for every case even when a group snapshot is restored. A spy forwards to the real command; no command is replaced. The set stays closed and the package stays out of the default manifest.

**Consequences.** Twelve test-only catalogue rows. The runner wraps the handlers of the commands it registers so a spy or scripted draws can take effect; that wrapping is per run and only in the test runner, so a game's commands are unchanged. `specTicks` waits through the existing cooperative sleep, so G1 holds.

**Rejected.** A TypeScript-only spy API (RPGCode authors could not write the tests); forcing `random`'s return value (skips its range rules); replacing commands globally; falling back to the seeded generator once scripted draws run out.
