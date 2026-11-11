---
tracker_id: "#1883"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1883"
type: epic
title: "Fast feedback: sub-second tests, faster CI, and guard-rails that warn when broken"
parent: initiative-rpgtoolkit-reawakened
covers: ["CAP-13"]
after: []
assignee: ""
risk: medium
---

# Fast feedback: sub-second tests, faster CI, and guard-rails that warn when broken

## Description

CI takes about 16 minutes and the unit suite about 6 minutes on four cores. Most of that time is in a few places: 11 minutes installing a browser, 150 tests over 1 second (86% of test time), and coverage roughly doubling the cost of the tests it measures. Alongside the speed-up, the epic makes the guard-rails and owner rules provable: every check is shown to fire on a deliberate violation, and every rule break is logged with its reason and the ticket that removes it. The epic is also the home for CI enhancements and CI bug fixes in general.

## Outcome

A contributor gets a CI verdict in well under ten minutes, and a local verdict on the packages they touched in seconds. The coverage thresholds hold on every pull request. Nobody has to remember the rules: a broken rule fails or warns where the author will see it, and an accepted exception is visible, explained and on its way out.

## Requirements

Each line maps to CAP-13 (guard-rails and headless CI) and cites its source.

- E1: Ordinary unit tests finish in under 1 second, and CI checks it (AGENTS.md, Owner rule 2026-10-28; #1892).
- E2: The coverage gate, 91% lines and 81% branches across the repository, holds on every pull request; coverage is not moved to a nightly run (owner, 2026-11-11; #1887).
- E3: Every guard-rail check is proven by a probe that breaks the rule on purpose, and `docs/guardrails.md` maps each rule clause to its check (owner, 2026-11-11; #1893).
- E4: A rule that cannot be decided mechanically warns on the pull request (owner, 2026-11-11; #1894).
- E5: Every rule break is logged with its reason and either an enhancement ticket or a permanent reason, and the entry is removed when the enhancement is resolved (AGENTS.md, Owner rule 2026-11-11; docs/guardrails.md#exceptions; #1896).
- E6: CI wall clock and runner minutes fall without dropping any required check (#1884, #1885, #1886).

## Done when

1. Every test over 1 second has a logged exception with its reason and enhancement ticket, and the log is empty apart from recorded permanent exceptions.
2. The coverage gate enforces 91% lines and 81% branches on every pull request, with coverage reproducible between identical runs (#1330).
3. Every row of the guard-rail matrix in `docs/guardrails.md` names its check and a probe test that proves the check fires.
4. The `browser` job installs nothing at run time, and the slowest unit shard is within about 25% of the mean shard time.
5. No CI bug in this epic is open.

## Boundaries

This epic changes CI, the test tooling, the tests and the engine paths the tests show to be slow. It does not lower any coverage threshold, skip or quarantine a test, or relax a guard-rail. Engine changes that alter observable behaviour go through the spec first (G7) and keep the goldens unchanged unless a golden change is explained (G5). Player-facing runtime performance that CI does not exercise (for example #1874) stays with its own epic.

## References

- parent - _bmad-output/initiative-rpgtoolkit-reawakened/initiative-rpgtoolkit-reawakened.md
- constraint - docs/guardrails.md, G1-G7 and Exceptions
- constraint - AGENTS.md, owner rules of 2026-10-28, 2026-11-07 and 2026-11-11
- adr - docs/adr/0016-ci-classified-steps.md
- adr - docs/adr/0015-web-build-and-test-toolchain.md
- source - .github/workflows/ci.yml
- source - tools/no-skips/run.mjs

## Notes

- Decision: Jensen, 2026-11-11: the review of CI and the tests is accepted in full; every recommendation becomes an issue in this epic, and CI enhancements and CI bug fixes move here as well (#1059 and #1859 moved from epic 9).
- Decision: Jensen, 2026-11-11: coverage must keep holding the line on every pull request; the cost is reduced without dropping it (#1887).
- Decision: Jensen, 2026-11-11: rule breaks are logged with why; a fix that needs breaking changes gets an enhancement ticket; the entry goes when that ticket is resolved (AGENTS.md; docs/guardrails.md#exceptions).
- Decision: Jensen, 2026-11-11: a test harness that starts from a saved state is wanted, so tests skip the replay to the state they test (#1889).
- Evidence, 2026-11-11 (Node 22, 4-core container): suite 6 min 23 s, 150 tests over 1 s; with `--max-semi-space-size=128`, 5 min 00 s; V8 coverage about 2x, and V8 binary mode gives no saving; the guard-rail probes found two gaps (G2 `editor-ui` Node imports caught only by `tsc`; G4.4 unresolved render-engine imports not caught). The figures are in #1883.
- Assumption: the epic covers CAP-13, as epic 1 did for the first guard-rails and CI. Confirm.
