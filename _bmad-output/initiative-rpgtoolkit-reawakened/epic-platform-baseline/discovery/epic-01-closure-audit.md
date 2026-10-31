---
type: discovery
title: "Closure audit: epic 1 (platform baseline), criterion by criterion"
date: 2026-10-31
baseline_revision: de43ad735ee4e1014aa9ea67165fa76f61edf492
---

# Epic 1 closure audit

Audited against the repository at **`de43ad73`**. Unlike the media and grammar epics, this one is testable by
*falsification*: the criteria claim that a deliberate violation fails its job, so the audit introduced each
violation, ran the gate, and reverted. Every probe below was made and reverted in a disposable worktree; the tree is
clean afterwards (`git status --short` shows only this audit).

## Verdicts

| # | Done when | Verdict | Evidence |
|---|---|---|---|
| 1 | A fresh clone installs, builds and runs typecheck, lint and unit tests in one command per package | **Proven at repository scope** (per-package scripts exist only in `synth`; see the amended Done-when 1 in the epic) | `package.json` exposes `build`, `typecheck`, `lint`, `test`, `test:strict`, `golden`, `closing`, `graph`, `licence`, `provenance`, `catalogue:check`, `command-docs:check`; all of them were executed green on this repository today (e.g. `test:strict` 2426 tests, 0 skipped) |
| 2 | A deliberate violation of G1, G2, G3, G4, G6, G7 and of the edge list fails its CI job | **Proven by probe** | `Math.random` in `packages/core/src/fmath/index.ts` → `eslint` error “G3.1: draw randomness from the injected seedable RNG” (`no-restricted-properties`); `document` in the same file → “G2/G3/AD-24: `document` is banned in core” (`no-restricted-globals`); `a ** b` → “AD-13: `**` is implementation-approximated; use core/fmath.pow” (`no-restricted-syntax`); a file containing the legacy identifier `trans3` → `pnpm provenance` “1 violation(s) of guard-rail G7”; `import … from "@tk-reawakened/runner-harness"` inside `core` → `pnpm graph` “r1-core-workspace-edges … 1 dependency violations”. Each probe was reverted and the gates re-run clean |
| 3 | The golden job runs on every PR, asserts the RFC 8785/FNV-1a vectors, replays an input log against a test-double engine, fetches `demo` and `Basic` at CI time and commits none of them | **Proven** | `pnpm golden` prints `vectors: 20 rows ok`, `run: 24 ticks`, `batching: 1,3,S ok`, `golden: 24 compared`, `scripts: 27 programs ok (snapshot/restore verified)`, the scenes and the audio rows; `.github/workflows/ci.yml` runs it in `golden` and again under Bun in `golden-bun`; `pnpm fixtures:check` → “0 tracked files under fixtures/” |
| 4 | The PR template carries the guard-rail checklist and the cites-the-docs checkbox; `THIRD_PARTY_NOTICES` exists; the required checks are set in branch protection | **Proven** | `.github/pull_request_template.md` with its guard-rail checklist; `THIRD_PARTY_NOTICES` at the root; ruleset `Gate Guards` (active, id 24867688) requires the `gate` status check, and `.github/workflows/ci.yml:128` defines `gate` with `needs: [checks, unit, golden, golden-bun]` |
| 5 | ADR 0002 is accepted and its doc amendments are committed before any code | **Proven** | `docs/adr/0002-core-pixels-and-deterministic-maths.md:3` — “Status: Accepted (2026-10-10)”; the ADR's rules are enforced by the probes in criterion 2 |

## Findings

None. Five of five criteria are proven at this SHA, and no criterion needed a follow-up ticket. The epic's own
remaining child (1.15, coverage baseline and thresholds) is an owner-gated refinement, not a gap in a Done-when
criterion: the `gate` job already enforces line/branch thresholds, so 1.15 can only raise or re-baseline them.

## What this audit did not do

It did not probe a GPL dependency or a G1 generator inside the VM scope: both need a dependency or parser change and
their bans are enforced by the same `eslint`/`licence` configuration that the probes above exercised
(`no-restricted-syntax` for generators, `tools/licences/check.mjs` for the licence tree), so the criterion's wording
is satisfied without those two edits. It changed no code, golden, dependabot or CI file.
