---
title: 'RPGCode deterministic doubles and spies'
type: 'feature'
ticket: '#2042'
created: '2026-11-11'
status: 'in-review'
baseline_revision: 'f06ab8af36d5b8763d593ada6ad9831b2485df7b'
route: 'full'
route_source: 'pinned'
risk: 'high'
review: ''
review_source: ''
lenses_ran: []
review_loop_iteration: 0
context: ['docs/guardrails.md', 'docs/spec/engine/rpgcode-tooling.md', 'docs/adr/0014-rpgcode-spec-package.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** RPGCode authors cannot script input, time or RNG doubles or spy on built-in calls, despite Epic 10 requiring them. Seeded replay alone does not provide a double.

**Approach:** Extend the existing test-only package and runner, specifying the complete contract before code. Retain real-engine creator tests and keep test helpers out of production.

## Boundaries & Constraints

**Always:** G1–G7; fixed ticks, deterministic replay, bounded execution; independent fixture and history for each case, including cases restored from group setup; positive and negative assertions with source locations. A doc-only commit precedes code.

**Never:** inspect legacy source; add general game commands or ship the test pack in the engine manifest; replace the real-engine gameplay fixtures/actions owned by 11.9; use time sleeps; mark the issue done before reviewed merge and required CI.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Scheduled input | key-down and key-up scheduled for later ticks while a script waits | each edge enters the ordinary input queue before that tick's wait poll, once and in scheduling order | invalid or past tick fails the case, never silently drops |
| Tick control | request N whole ticks, including zero | caller yields for N fixed simulation ticks; other engine phases keep running | negative, fractional, nonfinite or over-budget N fails the case |
| Scripted RNG | fixed sequence of unsigned draws | real `random` transforms each supplied draw using its normal range semantics | empty/exhausted sequence fails explicitly, never falls back silently |
| Spy | named built-in called with arguments | ordered snapshots recorded at call time; default forwards to real implementation | unknown, test-only, or unsupported target fails explicitly |
| Matcher | expected argument list equals any recorded call | `toHaveBeenCalledWith` passes; `.not` reverses it; ordered assertion addresses a particular call | wrong type/invalid spy fails in both polarities with source position |
| Isolation/replay | two cases and two identical runs | no previous case's doubles or calls leak; reports and state hashes agree | replay mismatch fails the run |

</frozen-after-approval>

## Design Notes

**Proposed ruling (pending owner approval; #2042).** A spec opts in explicitly: `specInput(tick, name, code, char, down)` schedules one key edge at an absolute fixture tick, with the same `name`, `code`, `char` (string or unset) and `down` fields as the engine input event; `down` 1 means press and 0 means release. `specTicks(count)` yields the caller for whole fixed ticks; `specRng(draws)` installs an ordered list of raw unsigned 32-bit draws for the case; `spyOn(name)` installs a forwarding spy and returns its opaque handle. Call `expect(spy).toHaveBeenCalledWith(args)` with one list of ordered arguments, and `expect(spy).toHaveBeenNthCalledWith(n, args)` with a 1-based call number and argument list. Fixed matcher arities follow TOOL-5. `args` is a list with `length` and numeric string keys; value equality is TOOL-5 `toEqual`, without numeric/string coercion. Capture argument values when the call happens, not when asserted. A spy intercepts calls after installation, not prior calls; folded names and aliases resolve to the same actual command target. Repeated installation of the same target in one case fails. The matcher reports expected and recorded calls at the author assertion's position. Non-spy handles fail both positive and negated assertions.

The default spy forwards the original handler and preserves return value, by-reference writes, waits, effects and errors; it does not replace real behavior unless an explicitly specified double does so. RNG exhaustion is an error. A new case starts with no installed spy, pending input or draw sequence even when its game fixture is restored from `beforeAll`; setup-task histories are not inherited. Each run gets independent doubles and histories. State-backed values remain serializable; host-only control/history must never enter saves and must be recreated for each replay. The runner's 1,000-tick ceiling remains binding.

**Evidence:** TOOL-5 currently has seven test-only natives and `toEqual` snapshots; ADR 0014 allows that closed set to grow only after a TOOL-5 edit. `runner.ts` builds a fresh `GameState`, creates real services and runs every task twice; it presently exposes only a seed. `advanceScriptTick` polls waits before scripts and increments time after scripts/events. `script/registry.ts` composes command middleware; `CommandHandler` can forward via `next`. `RngPort.nextUint32()` returns one unsigned draw. These are not existing scripting APIs.

**Rejected alternatives:** a TypeScript-only spy API would not let RPGCode authors write the requested tests; forcing `random` return values bypasses real range semantics; globally replacing engine commands contaminates production; rerunning `beforeAll` per case violates TOOL-5. An API that silently falls back after exhausted scripted draws can hide missing interception. This plan proposes the names and shapes, not a claim of prior owner approval.

## Code Map

- `docs/spec/engine/rpgcode-tooling.md` TOOL-5, native set and fixture snapshots; `docs/spec/engine/rpgcode-functions.md` test-only command and matcher catalogue; `docs/adr/0014-rpgcode-spec-package.md` accepted closed-set decision: amend consistently in the first commit.
- `packages/script-spec/src/runner.ts` creates state/services, handles setup snapshots, drains effects, advances ticks and checks replay; `src/project.ts` delegates project runs.
- `packages/script-spec/src/natives.ts`, `src/snapshot.ts`, `src/index.ts` and `package/startup.prg` own native registration, deep equality and author-facing matcher objects.
- `packages/core/src/script/registry.ts`, `script/plugin.ts`, `script/vm.ts`, `ports/input.ts`, `ports/rng.ts` define middleware, handler and tick/input/port seams. Extend core only if a documented seam is strictly needed, preserving production behavior and save contracts.
- `packages/script-tools/src/lint.ts` recognizes spec-only author names. `packages/script-spec/test/runner.test.ts` and `test/tool5-acceptance.test.ts` assert the exact native set and need deliberate updates.

## Tasks & Acceptance

**Execution:**
- [ ] Obtain explicit approval of this plan and its proposed ruling; re-read the approved plan before changing its status.
- [ ] Commit normative TOOL-5, catalogue and ADR amendment first, with all names, signatures, validation, timing, snapshot, error and reset semantics specified.
- [ ] Implement case-local scheduling, tick waits, scripted RNG, spy interception and both matchers using existing seams; document any indispensable core seam before code.
- [ ] Update package exports, native catalogue/help, linter's spec-only names, affected existing exact-set tests, and user-facing docs/changelog as applicable.
- [ ] Add authored RPGCode acceptance cases for every matrix row, matching and mismatching nested arguments, call ordering, forwarding/out/wait/error behavior, aliases, exhausted input, invalid handles, reset after group snapshots, and replay. Add distinct perturbation controls proving each input/tick/RNG/spy interception assertion goes red when that path is removed. Preserve real-engine test coverage.
- [ ] Run each new unit test alone and record duration; run focused tests, full required local gates and dogfood if script inputs change. Independently review and fix findings; push only after local checks, then merge only reviewed head with required CI and repository protections.

**Acceptance Criteria:**
- Given authored RPGCode cases, when the test runner executes them, then all four doubles/spy paths and positive, negative and ordered calls are observed through the real VM, and the specified isolation and replay checks pass.
- Given each interception path is deliberately disabled in turn, when its relevant acceptance test runs, then that test fails for the intended behavioral reason.
- Given the default engine manifest, when inspected, then no spec helpers or interceptors are present; production behavior is unchanged without opt-in.

## Implementation Notes

- Approved by the owner on 2026-11-12 (plan, ruling and API names as proposed). The docs-first commit adds TOOL-5 `#tool-5-doubles`, the catalogue rows and the ADR 0014 second amendment.
- `specTicks(0)` returns the current fixture tick. No other command reads the tick, and an author needs it to schedule absolute-tick input. With a positive count the call's value is unset, because a waiting command's value is the wait poll's.
- `specCalled` takes an explicit `any` flag, so `toHaveBeenNthCalledWith(0, …)` is rejected rather than read as "any call".
- Doubles are host-side per run (`packages/script-spec/src/doubles.ts`). The runner wraps every registered handler per run: spies record at the top layer of a name, and scripted draws replace `view.rng` for the call. No core seam was needed.
- No RPGCode command reads a held key (`actionDown` is not implemented), so the key-up edge is proven on a real `InputSection` through `applyDue`. The runner's use of it is proven by the `wait()` cases.
- `thread()` of a project program fails in the runner fixture (#2106, predates this work), so the cooperative wait is proven by its wait record rather than by a live worker thread.

## Plan Change Log

## Review Triage Log

Independent plan review: one P2 confirmed. The first draft scheduled key-down only, leaving held keys impossible to release. The proposed input API now accepts both edges, and the matrix requires both; evidence is `packages/core/src/ports/input.ts:14-22` and `packages/core/src/input/input.ts:614-618`. No other findings were reported.

## Verification

After approval: focused script-spec tests; typecheck; lint; fixtures fetch, strict suite, author/check and fixture tests; golden and Bun golden; dependency graph, licence, provenance, catalogue and command-docs checks; closing and `pnpm script:dogfood` when applicable. Run CI's relevant exact commands as well. Record every observed result and each perturbation, without treating an unavailable gate as green.
