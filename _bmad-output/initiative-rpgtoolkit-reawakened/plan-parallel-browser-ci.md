---
title: 'Parallel browser and editor CI proofs'
type: 'refactor'
ticket: ''
created: '2026-11-18'
status: 'built'
baseline_revision: '65611327311a59aa5cb9da0c52231319b51134cc'
route: 'full'
route_source: 'auto'
risk: 'high'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The browser CI job runs unrelated editor, player and cross-host proofs sequentially, obscuring failures and extending feedback time.

**Approach:** Run independent editor web, VS Code editor, browser player and cross-host proofs in parallel, preserving every existing proof and its required gate. Aim for shorter elapsed time; four minutes is a target to measure, not a guaranteed result.

## Boundaries & Constraints

**Always:** Keep all existing browser specifications and both VS Code acceptance scenarios, the installed PWA proof, the cross-host closing suite and the existing VS Code web debugger proof. Preserve fail-closed classification and make every new job required by the aggregate gate. Respect browser/host resource pacing.

**Never:** Skip tests, weaken assertions or substitute stubs. Do not introduce change-path skipping or claim a timing improvement without a CI run.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Full change | classifier requests full checks | independent lanes run their complete assigned proofs | any failing or skipped required lane fails gate |
| Inert change | classifier permits deferral | each required lane reports success after logging the reason | classifier failure or missing verdict runs proofs and fails closed |
| New browser spec | a new test appears | it belongs to exactly one browser selection | no test is silently omitted or duplicated |

</frozen-after-approval>

## Code Map

- `.github/workflows/ci.yml` — `browser` currently sequentially builds, runs two VS Code editor proofs, runs Playwright, runs installed PWA proof and closing suite; `gate` requires job results. Keep existing `vscode-web` debugger job separate.
- `playwright.config.ts` and `tools/browser/tests/` — all browser specs currently run with a shared server that builds desktop, browser and mobile. Editor specs have `editor-` names; complementary selection must retain every other spec, including integration specs.
- `tools/editor-vscode-test/run.mjs` — default and creator proofs are selected separately and may run in independent CI jobs with isolated workspaces.
- `tools/closing/suite.mjs` — real Node, Chromium and Electron cross-host comparisons; retain complete suite.
- `tools/ci/` — existing CI configuration tests and conventions; add a focused selection/gate check if needed to make omissions observable.

## Tasks & Acceptance

**Execution:**
- [ ] `.github/workflows/ci.yml` — partition the browser job into independent required lanes, retaining all setup, fixture and host prerequisites; isolate each VS Code proof workspace; preserve artifact diagnostics.
- [ ] `playwright.config.ts`, `package.json`, and focused CI verification — define complementary editor and player selections with an exhaustive check, retain a command that runs all tests locally, and prevent accidental selection gaps.
- [ ] Contributor-facing CI guidance — explain the lanes and local commands using the existing documentation location.
- [ ] Validate lane selection and gate fail-closed behavior; run targeted relevant checks and report what cannot be measured locally.

**Acceptance Criteria:**
- Given a full CI run, when jobs start, then editor web, VS Code acceptance scenarios, player and closing suite can run independently and every former proof runs once in its assigned lane.
- Given a failing, cancelled or skipped required lane, when the aggregate gate evaluates, then the gate fails.
- Given the existing Playwright test inventory, when lane selection is compared with the full inventory, then each test is selected once and none are missing.
- Given a local developer, when they run the documented lane or complete-suite command, then the corresponding real browser tests are selected.

## Implementation Notes

- The five lanes share one GitHub Actions matrix definition. Each cell has its own runner, and the existing aggregate gate requires the matrix result.
- Playwright listed 136 tests: 47 editor and 89 player, with no missing or duplicated tests across these two selections. The editor PWA limitation and player WebGL agreement smoke tests passed.
- The classifier suite passed all 21 tests, the Playwright image pin matched, and invoking the gate script accepted success while rejecting failure, skip, and cancellation.

## Plan Change Log

## Review Triage Log

- Matrix gate — no gate bypass demonstrated. The gate requires the matrix aggregate result; its shell step rejected failure, skipped and cancelled results. Hosted aggregation was not exercised locally.
- Selection coverage — real Playwright discovery verified the combined lane inventories exactly matched the full inventory. No permanent verifier was added; the selectors share one pattern for matching and exclusion.

## Verification

**Commands:**
- Run a targeted test checking full versus lane test discovery and CI job/gate relationships.
- Run focused affected Playwright scenarios where local dependencies permit; report host or fixture constraints explicitly.
- Validate workflow syntax and exercise classifier checks without changing the classifier contract.
- Obtain CI timings only from a real remote workflow run; do not infer achievement of the four-minute target.
