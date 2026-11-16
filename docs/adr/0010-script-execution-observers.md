# ADR 0010 — Observe script execution without changing it

* **Status:** Accepted (owner direction, 2026-10-23)
* **Issue:** #614
* **Amends:** ADR 0004, service interfaces only

## Context

The closing suite boots real fetched games through `createEngine`. Its command
census must describe instructions executed by those games, not discovery scripts
run by `corpus`. Engine ticks call `runThreadsPhase` directly; observing only
`advanceScriptTick` would silently miss them.

## Decision

`ScriptServices` gains optional synchronous observers. `postStep(op, thread)` runs
once for each instruction attempted inside `stepThread`, before its execution,
including instructions that raise a script error. Continuation work consumes
budget but is not a StepOp and does not emit a step. The services constructor,
script host and engine accept the same optional observer configuration, outside
all saved state.

`postCall(call, thread)` runs at the VM call site after successful resolution and
before argument validation or dispatch. Its immutable payload contains the folded
name as written at that call site, argument count, and resolution kind:
`callable`, `builtin`, `script`, or `extension`. Extension records carry the
winning plugin id. A namespace keeps its qualified spelling. Redirects have
already been applied by compilation. Callable handles retain a distinct call
resolution followed by any command resolution they actually perform; continuations
are marked separately from source calls. Module directives and `bindingOf` bypass
the table and are not invented as AD-8 resolutions.

Resolution is not handler execution. An optional `postHandler` accounting callback
records actual native handler entries, including each layer reached through
`next`. Instrumentation is assembled in the services layer, never in `registry.ts`.
Handler records contain the contributing plugin, canonical command name and
whether the handler function is one of the exported generated catalogue stubs.
Function identity, not a name intersection, distinguishes a stub from a real
implementation of the same command. These counts are reported separately.

### Observation invariants

* Absent observers are no-ops with zero observation allocation on execution paths.
* Observers cannot mutate game state through their arguments: payloads are detached
  and recursively frozen; no state, handler, frame or service reference is exposed.
  Callbacks are trusted host code and must not mutate state through captured ports.
* Observer exceptions are isolated from script execution. No observer may change
  a state hash, draw list, PNG, diagnostic, instruction budget or wait outcome.
  **If tracing moves a hash, the trace is the bug, not the golden.**
* G1–G4 remain binding. No asynchronous script execution, dependencies, schema or
  compiler-version change is introduced.

The runner-harness owns collection. Closing tracing uses a separate one-tick
replay of the unchanged plan so boundary hashes are complete `TickReport` hashes,
after the tick settles and asset replies are handled. It compares every existing
checkpoint and frame against the unobserved reference before reporting results.
Program spans identify thread, root program and executed source file. First/last
execution and thread completion are distinguished; a still-waiting thread has no
invented finish. Loaded `.gam`/`.prg` assets form the boot sequence, including
loaded-but-unexecuted includes. A file load alone is never counted as execution.

The CLI is `closing [<root>] --trace <path>`. Trace output is separate from
baselines and cannot be combined with `--record` or written over repository inputs.
`corpus` semantics and hashes stay unchanged. The catalogue join reports called
commands by owner epic, missing owners, uncalled catalogue names, and actual
generated-stub handler entries. Counts describe only the closing plan's observed
window; stopped games and parse failures remain visible coverage limits.

## Consequences and alternatives

Tracing costs allocations and a replay only when requested. Small authored tests
pin counts, resolution layers, middleware accounting, payload isolation and
determinism. Existing golden and closing checks gate behaviour. An instruction
listing or a call-op-name histogram would be cheaper, but neither proves that a
command resolved or that a stub handler executed. Instrumenting the registry
would mix lookup with execution and is rejected.

References: [boot](../spec/engine/main-loop-and-startup.md#reawakened-boot-sequence),
[threads](../spec/engine/rpgcode-errors-and-threads.md#threads),
[callables](../spec/engine/rpgcode-language.md#keywords-and-structure),
[modules](../spec/engine/rpgcode-modules-and-objects.md#modules).

## Amendment (2026-11-15) — effect observer

**Context.** The creator-test `effect.<name>` projection ([TOOL-5](../spec/engine/rpgcode-tooling.md#tool-5-creator-api), entry 11.9) must count effects cumulatively. The VM's effect log is a ring of 256 records and section owners drain it, so a count read from the surviving log can lose records or fall back to zero.

**Decision.** `ScriptObservers` gains an optional `postEffect(effect, thread)`. It runs synchronously once for each effect record **at the moment the record is produced**, whether a command's result produced it in the VM or the engine posted it for a phase or the boot and board-entry sequences, after the record is appended to the log and before any owner can drain it or the ring can evict it. The payload is detached and recursively frozen like every other observer payload. Every invariant above holds: absent, it is a no-op with no allocation; an exception in it is isolated; it changes no state, hash, diagnostic or wait. The observer is part of the services and engine configuration, not of state, so replacing the state (a restore) does not detach it. A native command that appends a record itself (the runner's own `specResult`) is not an effect production site of the VM and is not observed.

**Consequences.** The runner keeps the counts host-side; they are reset when a fixture is ready and saved and restored with a group snapshot by the runner, and never enter state or any hash.

**Rejected.** Reading the effect log after each tick (it evicts and owners drain it, so a count can be lost or reset); registering an effect applier per section (an applier replaces the section owner, so it would change the engine).
