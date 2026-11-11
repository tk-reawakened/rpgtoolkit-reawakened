---
title: 'Run affected package tests locally'
type: 'feature'
ticket: 6
tracker_id: '#1888'
created: '2026-11-11'
status: 'built'
baseline_revision: '191f0fd09bf1915ad64d68cfca6537cc57b29cbc'
route: 'full'
route_source: 'auto'
risk: 'medium'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
context: ['docs/guardrails.md', 'AGENTS.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Local contributors run the entire unit suite even for a change confined to a leaf package.

**Approach:** Add `pnpm test:affected [--base <ref>]` to build and run the changed packages' tests and all downstream packages, using the existing no-skips runner. Default base is `origin/main`; CI's full suite stays unchanged.

## Boundaries & Constraints

**Always:** Preserve G1–G7, existing test assertions and the no-skips guard. A changed `core` package, root configuration, lockfile, tooling, fixtures, or unknown/unmappable path selects the entire suite. Include committed, staged, unstaged, renamed and untracked changes; use NUL-delimited Git output. When change enumeration or dependency validation is uncertain, fail closed by selecting all tests and explaining why. A valid empty change set or affected package with no tests is reported explicitly and must not accidentally invoke the no-skips runner with no patterns.

**Never:** Alter CI's existing full test selection or coverage thresholds, modify goldens, or execute unsafe shell interpolation of a base ref.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected behavior |
| --- | --- | --- |
| Leaf | A test-bearing leaf package changed | Run that package's tests only. |
| Downstream | A package with dependents changed | Run its and all transitive dependents' tests. |
| Core | A file under core changes | Run all package tests, including packages independent of core. |
| Shared | Lockfile, root config, tool, fixture, or unmapped path changes | Run all tests and state why. |
| Working tree | Committed, staged, unstaged, untracked, deleted or renamed files | Include every affected path, including both sides of renames. |
| Uncertain | Invalid base, Git failure, malformed/incomplete dependency data | Run all tests with a visible reason; never silently select a subset. |
| Empty | No changes or no affected test files | Say so and exit successfully without starting the no-skips default suite. |

</frozen-after-approval>

## Code Map

- `tools/deps/edges.json` is an allowed-edge superset, with `[dependency, dependent]` pairs. Conservative forward transitive closure is appropriate. `core` has independent packages and needs an explicit all-tests rule. `tools/deps/graph.mjs` is a side-effecting CLI, not an importable selector.
- `tools/no-skips/run.mjs` exports `run(root, patterns)`; `--group` resolves only one group. It defaults to all tests if passed no CLI patterns. Enumerate actual test files under `packages/<name>/test/*.test.ts`; some packages have no tests. Build first because tests consume built outputs.
- `tools/ci/classify-changes.mjs` and its tests show NUL-safe path handling and fail-closed classification. Git `diff --no-renames --name-only -z <merge-base> --` includes staged and unstaged tracked edits; supplement with `git ls-files --others --exclude-standard -z` for untracked paths.
- `package.json` defines local scripts; `CONTRIBUTING.md` describes their use. `tools/no-skips/test/no-skips.test.mjs` is explicitly selected by CI, so wire selection tests into an existing CI-executed self-test command without changing CI's package-test policy.

## Tasks & Acceptance

**Execution:**
- [x] `tools/no-skips/affected.mjs` — implement a testable selector and CLI, validating graph coverage against workspace packages and declared workspace dependencies; do not assume the graph has every needed edge. Build then invoke `run` with explicit files, preserving failures and no-skips behavior.
- [x] `tools/no-skips/test/` — exercise all matrix cases, including transitive edges, invalid graph and actual Git tracking behavior using small temporary repositories; ensure tests individually stay under one second.
- [x] `package.json` — register `test:affected` and ensure the selector self-tests run in the existing tool self-test workflow.
- [x] `CONTRIBUTING.md` — explain base, local changes, fail-closed behavior, no-changes behavior, and that CI still runs all tests.

**Acceptance Criteria:**
- Given a changed leaf, when the command runs, then its actual test files run through the no-skips guard and unrelated package tests do not.
- Given core or a root/unknown change, when the command runs, then the complete package test suite is selected.
- Given an invalid Git base or unusable graph, when the command runs, then it clearly selects the full suite instead of a partial result.
- Given the existing CI commands, when run, then their package test selection and coverage policy remain unchanged.

## Implementation Notes

The selector validates workspace dependency reachability, collects all working-tree states, and adds test-only runner edges for the CSP test. Existing no-skips checks execute the selector tests.

## Plan Change Log

## Review Triage Log

- Medium, patched: runner-web CSP tests read desktop source and scan all runner app pages; runner changes now select runner-web and downstream packages. Tracked by #1905.
- False: extra graph packages do not make the graph incomplete; four planned packages are intentionally listed without directories, and only existing package tests are selected.

## Verification

- `pnpm test:strict`: 3,748 passed, no skips, after fetching the sample fixtures.
- `pnpm no-skips:test`: 19 passed; all new tests were under one second when run without the full suite competing for CPU. `pnpm lint`, `pnpm golden`, and `pnpm bmad:tickets:test` passed.
- An isolated CLI fixture exercised leaf and shared-file selection. Removing transitive traversal made the selection test fail; removing the runner test edges made the desktop CSP regression fail. Restoring each change made the tests pass.

- Run each new test individually and inspect its duration; run the existing no-skips self-tests and selector tests.
- Exercise the actual CLI against a controlled leaf change and a root change using a safe temporary checkout or fixture, without changing unrelated files.
- Run `pnpm golden` and appropriate lint/build checks. Perturb the selector so a downstream package is omitted and show a test fails, then restore and rerun.
