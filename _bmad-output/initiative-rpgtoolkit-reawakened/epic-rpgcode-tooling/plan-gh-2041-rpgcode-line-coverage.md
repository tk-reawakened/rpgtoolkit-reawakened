---
title: 'RPGCode line coverage'
type: 'bugfix'
ticket: ''
created: '2026-11-11'
status: 'draft'
baseline_revision: 'f06ab8af36d5b8763d593ada6ad9831b2485df7b'
route: 'full'
route_source: 'pinned'
risk: 'high'
review: ''
review_source: ''
lenses_ran: []
review_loop_iteration: 0
context:
  - 'docs/guardrails.md'
  - 'docs/spec/engine/rpgcode-tooling.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The RPGCode test runner does not report which RPGCode lines ran. The repository's existing TypeScript LCOV report measures a different language and cannot satisfy Epic 10.

**Approach:** Specify observable line identities, counts and output first; then collect real VM execution coverage and emit deterministic RPGCode-only LCOV. Exercise the result through the public test runner using authored multi-file projects.

## Boundaries & Constraints

**Always:** Follow G1–G7; write the normative TOOL-5 amendment in its own commit before implementation. Instrument observation outside saved game state; preserve replay determinism. A successful result must include uncovered executable lines, not only hits. Each evidence test must be perturbation-proven and individually fast.

**Never:** Consult legacy source, use TypeScript/V8 coverage as a substitute, count every VM instruction as a line execution, count the determinism replay twice, or treat reporter issue #2043 as a dependency for coverage.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Conditional and repetition | Two cases, opposite branches, one loop with known iterations | Per-line hits match hand-worked entries, including zero-hit alternate lines and repeated loop/body hits | No error expected |
| Included program | Multiple specs include the same program using path case variants | One correctly identified project file with sums across logical runs; no synthetic runner/library lines | Follow the existing asset resolver; never merge distinct files merely because their basenames match |
| Unrun code | Loaded file contains an uncalled function, comments and blank lines | Executable lines of the uncalled function appear as zero; comments and blank lines are absent | Invalid source or missing input is not reported as fully covered |
| Replay, hooks, selection | Fresh cases, once-only group hooks, skips and focused runs; runner repeats for determinism | Count one logical run, actual hook executions once, no unselected bodies; do not add discovery/replay work | Keep existing case failure and strict-skip behavior |
| LCOV | Per-file coverage contains hit and zero-hit lines | Stable `SF`, `DA`, `LF`, `LH`, `end_of_record`; counts match the public data exactly | Empty coverage is honestly empty; no TypeScript coverage mixed in |

</frozen-after-approval>

## Code Map

- `docs/spec/engine/rpgcode-tooling.md#tool-5` — test API and runner contract; add the missing coverage rules there before code. Issue #2042 also plans a TOOL-5 amendment; coordinate and preserve whichever lands first.
- `packages/core/src/script/lower.ts`, `link.ts`, `program.ts` — statement ranges, relocated instruction positions and compiled include units. Existing ranges serve error resumption; check nested statements and control-flow headers before using them for coverage. Probe metadata must not change instruction numbering, save state, or hashes.
- `packages/core/src/script/vm.ts:3921-3934`, `observers.ts` — VM selects an actual program and instruction then invokes the optional session observer. The callback currently receives the op and thread, not an instruction index/program; avoid guessing execution from adjacent source positions.
- `packages/script-spec/src/runner.ts:66-89,182-283,378-488` — spec source is served under a synthetic key with an appended harness; setup checkpoints and each selected case run twice; discovery is separate. Combine observation with the setup checkpoint observer rather than replacing it.
- `packages/script-spec/src/project.ts:37-73,76-130` — filesystem loader maps resolved `Prg/` assets and package startup; project reports aggregate file runs. Preserve real original paths when the loader aliases a package-root startup.
- `packages/script-spec/src/index.ts`, `test/project.test.ts`, `test/runner.test.ts` — public exports and real project examples. Reporter #2043 independently changes adjacent runner/project interfaces; keep coverage additive and rebase carefully.
- `packages/script-cli/src/commands/test.ts:23-48`, `packages/script-cli/baselines/*test.json`, `docs/spec/engine/rpgcode-tooling.md#tool-9` — CLI serializes each file report directly, so new file-report fields can change the public JSON envelope and dogfood baselines even without a CLI flag. Preserve the current envelope unless explicitly specified; validate its schema and dogfood output.
- `CONTRIBUTING.md:38-66` — user-facing test-runner instructions; describe the separate RPGCode coverage output once implemented.

## Tasks & Acceptance

**Execution:**
- [ ] Resolve the choices below at the human checkpoint; commit the resulting `docs/spec/engine/rpgcode-tooling.md#tool-5` rule separately before code (G7).
- [ ] Add compile-time source-to-probe metadata and an opt-in session-only real-VM observation seam. Define executable source positions without changing saved state, emitted instructions or normal VM behavior.
- [ ] Add RPGCode coverage to `packages/script-spec` file/project results, including includes and dynamically loaded project programs; preserve file identity and isolate discovery and replay.
- [ ] Export a deterministic LCOV serializer and surface it through the public test API; document invocation in `CONTRIBUTING.md`. Integrate with existing CLI only if the approved output contract calls for it.
- [ ] Add fast authored tests for the matrix, one deliberate instrumentation-removal negative control, and paired repeatability/hash checks. Prove each evidence test fails under its corresponding production perturbation, then restore and pass it.
- [ ] Run focused tests and their durations, `pnpm script:dogfood`, local typecheck/lint and applicable full fixture/golden/project gates. Request independent review on the exact pushed revision; merge only after review and required CI pass.

**Acceptance Criteria:**
- Given a project with known branch, loop, include and uncalled lines, when its cases run, then the result reports independently hand-counted physical source lines and serializes exactly the same counts in LCOV.
- Given two logical cases loading the same included file, when results are combined, then hits are summed once per logical execution; toggling observation off makes the coverage assertion fail for missing hits.
- Given the same source, seed and selection, when repeated, then coverage and existing state hashes are deterministic, and the uninstrumented run retains the same game state.

## Design Notes

The VM lowers one source statement to multiple instructions; line transitions alone overcount calls/returns and conflate nested executions. Existing statement ranges can overlap, and `for` lowers initialization, condition and step separately (`lower.ts:400-421`), so a complete probe design must explicitly handle branch and loop-header counts rather than assume `ops[range.start]` covers every case. `program.ts:286-313` resolves includes by asset key; a spec's source is instead installed under `Prg/__spec.prg` and must be mapped back to the caller's actual spec path. `runTwice` verifies outcomes by executing twice, so the second run must be compared, not summed. Node's [LCOV reporter](https://github.com/nodejs/node/blob/main/lib/internal/test_runner/reporter/lcov.js) documents `DA` as line number and execution count, `LF` as instrumented lines and `LH` as nonzero lines; it supplies no RPGCode execution oracle.

## Open Questions

1. **Executable-line denominator and scope.** Recommend reporting every executable source line in each compiled project program encountered in selected logical runs, including uncalled functions and reached includes, excluding bundled test infrastructure and synthetic appended lines. Alternative: enumerate every project program even if never loaded; that widens the denominator and requires a separate project-wide compilation/error policy. Should never-loaded project files be included?
2. **Line hit definition.** Recommend per-source-line execution counts derived from source-level probes: sum a probe's entries across logical runs, then use the greatest probe count for a physical line when several executable constructs share it; define probes for control-flow conditions/loop headers as well as ordinary statements. This avoids counting bytecode instructions or double-counting two statements on one line. Alternative: sum all statement hits on a line, which inflates such lines; or report only hit/miss, losing repeated counts. LCOV defines `DA` as a line count but does not independently execute RPGCode: the proposed interpretation must be explicitly adopted rather than claimed to be a universal cross-language oracle.
3. **User-facing output.** Recommend an explicit `script-spec` API returning project coverage plus a deterministic `toLcov` serializer, with no implicit files or stdout changes. Alternative: also add a CLI `--coverage`/`--lcov` flag and specify destination, interaction with JSON/reporters, and failure semantics. Issue #2043 owns reporter formatting; a CLI flag needs coordination with that work.

## Verification

**Commands:**
- Focused new `node --test` coverage tests, separately and after each targeted perturbation, then restored; record test-level durations and failure reasons.
- `pnpm typecheck`, `pnpm lint`, `pnpm script:dogfood`, project strict tests and all locally runnable fixture, golden, graph, licence, provenance and catalogue/command-docs gates required by repository policy.
- After pushing, independently review the exact PR head and wait for required GitHub `gate`; never bypass protection.
- Planning environment: default Node is 26.13.0, not the repository-pinned 24.21.0; find/use the pinned runtime before implementation gates. `lcov` was not found on PATH; choose an available independent tracefile validator or report validation unavailable.

## Implementation Notes

## Plan Change Log

## Review Triage Log
