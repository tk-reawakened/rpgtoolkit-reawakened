# ADR 0036 — Performance budgets: count work in CI, measure time outside it

* **Status:** Proposed (2026-11-15). Pending owner acceptance.
* **Date:** 2026-11-15
* **Context documents:** [guardrails.md](../guardrails.md) G3 and G5, [AGENTS.md](../../AGENTS.md) "Tests stay fast", [runners.md#state-hash-cadence](../spec/engine/runners.md#state-hash-cadence), [tools/perf/README.md](../../tools/perf/README.md), issues #2766, #1890, #2767, #1871.

## Summary

In plain terms:

1. **CI checks how much work the engine does, not how long it takes.** A performance budget is a test that counts something deterministic, such as bytes hashed, bytes serialized or state size. It fails when the count goes over a stated number. It gives the same answer on every machine, so it can gate a merge.
2. **Frame rate and frame time are measured outside CI.** `tools/perf/profile-player.mjs` measures them on real hardware. Those numbers are advisory and are recorded in `tools/perf/README.md`. They never gate a merge.
3. **The live loop must not do work that grows with the size of the game state on every frame.** Hashing, serializing, cloning or posting the whole state is done on request or at a throttled rate.

## Context

The `demo` sample ran at 8.5 fps in the editor's Run panel. The cause was invisible to every existing check:

- `engine.advance` hashed the whole state on every call, and the live player called it once per animation frame (#1890).
- `vm.defOwners` repeats a bundled program's full source once per function it defines, about 14.6 MB (#2767).
- An em dash in `stock_menu`'s source made 66 of those copies miss the hash's transition cache, so about 5 MB was UTF-8 encoded and hashed on every frame (#2766).

Goldens, unit tests and browser specs all passed throughout, because none of them measures cost. The regression would have been caught by a count of bytes hashed per tick. It would not reliably have been caught by a wall-clock threshold: timing in CI depends on the runner, its load and (for the player) its GPU, and the owner rule "Tests stay fast" forbids timing-dependent assertions.

## Decision

### 1. Work budgets gate CI

A **budget test** asserts that a deterministic work count stays at or below a stated limit. It follows the rules for every unit test: it finishes in under one second and asserts no wall-clock time.

- **Name and place.** `packages/<package>/test/perf-budget-<topic>.test.ts`, so a reader can find every budget with one search.
- **What it counts.** Something that is the same on every machine and engine: bytes scanned by the FNV loops (`fnv1a64ScannedBytes()` in `core/canon/fnv1a.ts`), canonical bytes produced, state or save size, draw commands, or operations counted by a test double. A counter added to production code for a budget is observation only. It never feeds the simulation, so it changes no hash, pixel or sound (G3).
- **What it states.** The limit is a named constant with a comment saying what it bounds, in plain terms, and why that number.
- **Proof it bites.** When a budget is added for a known regression, the PR records that the test fails against the code before the fix, as #2766's budget does.
- **Changing a budget.** Raising a limit is like changing a golden (G5). It is deliberate, and the PR explains why the extra work is necessary. Lowering a limit after an improvement is encouraged.

The first budget is `packages/core/test/perf-budget-state-hash.test.ts`. Re-hashing a demo-shaped state that the cache has already seen scans at most 64 KiB, with each owner program stored once in `vm.programs` (#2767). The non-ASCII source alone exceeds the budget without #2766’s transition cache.

Budgets to add next, each with its own issue:

- The canonical size of the demo's state after boot is now covered by `perf-budget-state-size.test.ts` (#2767), which landed before this proposal.
- Bytes serialized per steady-state live frame, once the live loop's remaining per-frame canonicalization is counted.

### 2. Timing is measured, recorded and advisory

- `tools/perf/profile-player.mjs` is the reference measurement for the live player: frame rate, frame-time percentiles, long tasks, ticks per second and a CPU profile.
- A PR that changes a hot path (the live loop, `advance`, hashing, canonicalization, draw-list replay) includes before-and-after numbers from that script and updates the table in `tools/perf/README.md`, stating the machine.
- **Target**, on the reference machine recorded in the README: the demo holds the display's frame rate while walking, with no long tasks (over 50 ms) after load. A miss is a `bug` issue, not a failed check.
- An advisory scheduled CI lane that runs the profile and keeps its history may be added later. It reports and never gates.

### 3. Rules for the live loop

- Per-frame work in a live player is proportional to what changed, not to the size of the state.
- The state hash, snapshots and status messages to a host (such as the editor) are computed when something reads them, or at most every 250 ms, and at once when what they show changes ([runners.md#state-hash-cadence](../spec/engine/runners.md#state-hash-cadence)).
- A new piece of work inside `advance` or the live frame states its cost in the PR: what it touches per tick and how that grows.

## Rejected alternatives

- **Wall-clock thresholds in CI** (for example "a tick under 2 ms"). They are flaky across runners and load, the browser lane's GPU varies, and they break the "Tests stay fast" rule against timing-dependent assertions.
- **A gating benchmark suite with a tolerance band.** Noise forces a wide band, and a wide band misses gradual regressions. A tight band fails at random. Work counts have neither problem.
- **No budgets, profiling on demand.** That is how this regression shipped unnoticed: every functional check passed.

## Consequences

- One observation-only counter is added to `core/canon/fnv1a.ts`. Other counters are added only with a budget that uses them.
- Performance regressions of the kind behind #2766 fail a fast unit test with a message naming the count and the limit.
- Frame-rate numbers stay honest about hardware, because they are recorded with the machine and never compared across machines in CI.
