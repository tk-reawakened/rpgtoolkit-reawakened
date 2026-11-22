---
title: "Make mobile dependency resolution recover from a Maven 429 and close the gate hole"
type: bugfix
ticket: '26'
created: '2026-11-22'
status: 'ready-for-dev'
baseline_revision: 'd8a348c58298f6dc27a5097f939d54bd45b595d9'
route: 'oneshot'
route_source: 'auto'
risk: 'low'
review: 'none'
review_source: 'auto'
lenses_ran: []
review_loop_iteration: 0
context:
  - '{project-root}/docs/guardrails.md'
  - '{project-root}/AGENTS.md'
  - '{project-root}/.github/workflows/ci.yml'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Gradle resolves mobile dependencies once, so a transient HTTP 429 from Maven Central or `dl.google.com` fails `./gradlew assembleDebug` before any project code runs; the proof artefact is then empty and the gate still passes. Two hosted-runner occurrences are recorded, neither caused by the PR under test.

**Approach:** Follow the issue's "prove a fix": exercise dependency resolution under a simulated 429 and demonstrate bounded recovery without hiding persistent failures, then verify the mobile proof runs and is uploaded and that a missing proof cannot pass the gate.

## Boundaries & Constraints

**Always:** Keep a persistent rate limit a failure with its cause; keep the mobile proof artefact required when the lane reports success; pace retries with backoff; preserve the advisory status decision for the paused mobile lane.

**Never:** Hide a persistent failure behind a fallback, a cached artefact or a passing gate; change PR code to paper over infrastructure; disable the mobile lane.

</frozen-after-approval>

## Verification

**Test strategy:**
- Exercise dependency resolution against a repository stub that returns HTTP 429 for a bounded count, and assert the build completes; then make it return 429 indefinitely and assert the build fails with the rate-limit cause.
- Assert that a run with no `artifacts/mobile-proof/` content cannot pass the gate, and that a successful proof uploads.
- Perturbation: remove the retry and confirm the simulated-429 test fails; restore the old gate wiring and confirm the missing-proof test fails.

**Commands:**
- The mobile lane steps from `.github/workflows/ci.yml` (`./gradlew assembleDebug`, `pnpm mobile:proof`).
- `pnpm mobile:proof:test`.
- `pnpm bmad:tickets:test`.

## Implementation Notes

## Perturbation Check

| Guard reverted | Test that failed |
|---|---|
| | |
