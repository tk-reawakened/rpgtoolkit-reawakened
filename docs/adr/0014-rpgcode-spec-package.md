# ADR 0014 — The RPGCode spec API is a test-only package, not engine built-ins

> **Status:** Accepted (owner, 2026-10-31). Numbering note: **0013 belongs to the desktop shell ADR**, which epic 9 lands with the same commit series; this ADR deliberately takes 0014 so the two can land independently.
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
