---
type: epic
title: "Platform baseline: monorepo, guard-rails and headless CI"
parent: initiative-rpgtoolkit-reawakened
covers: ["CAP-12", "CAP-13"]
assignee: ""
risk: medium
---

# Platform baseline: monorepo, guard-rails and headless CI

## Description

The monorepo, per-package TypeScript config, lint rules, dependency-graph checks and required CI jobs for G1-G7 exist before any feature code, together with the platform-neutral `runner-harness` skeleton, its thin Node shell `runner-headless`, the single dependency edge list (`tools/deps/edges.json`) that generates the dependency rules, and the fetch of the legacy sample games as fixtures. ADR 0002 and the doc amendments it needs land first. Every later epic lands on this base.

## Outcome

Contributors and agents cannot merge code that breaks a guard-rail; the CAP-13 success check, CI blocking on any failing or skipped job, is the signal.

## Done when

1. A fresh clone installs, builds and runs typecheck, lint and unit tests with one command each at repository scope (`pnpm build`, `typecheck`, `lint`, `test`); `synth` additionally exposes them per package. Per-package scripts for the other four packages were tried and rejected because they depend on each other's built output, so `pnpm -r build` fails (entry 1.2'"'"'s review).
2. A deliberate violation of each rule G1, G2, G3, G4, G6 and G7 (generator in the VM scope, DOM global in core, `Math.random`, a `Math` function outside the AD-13 allowlist or a `**` operator in core, the bare `fflate` specifier, an engine import outside a runner render folder, a GPL dependency, a legacy marker) fails its CI job, and a dependency edge not in the edge list fails the graph check.
3. The golden job runs on every PR through `runner-harness`: it asserts the RFC 8785 and FNV-1a vectors of AD-11 and replays an input log against a test-double engine. It fetches the legacy `demo` and `Basic` games at CI time and commits none of them.
4. The PR template carries the guard-rail checklist and cites-the-docs checkbox, `THIRD_PARTY_NOTICES` exists, and the required checks are set in branch protection.
5. ADR 0002 is accepted and its doc amendments are committed before any code.

## Boundaries

The repo scaffold, CI, and the `runner-harness` skeleton (null audio, scripted-input driver) with `runner-headless` as its thin Node shell. The CPU rasteriser itself is `core/raster`, built in epic board-rendering. Not any engine feature, format reader, or real renderer. The harness replays real draw lists only once epic board-rendering lands. Only the packages this epic needs (`core`, `synth`, `runner-harness`, `runner-headless`) are created here; the edge list names all planned packages. Spec non-goals apply.

- Touch point: GitHub Actions and the legacy sample game source - consumed at CI time; owner: this epic

## References

- spec - _bmad-output/initiative-rpgtoolkit-reawakened/spec-rpgtoolkit-reawakened/spec-rpgtoolkit-reawakened.md, section Capabilities
- spine - _bmad-output/initiative-rpgtoolkit-reawakened/architecture-rpgtoolkit-reawakened/architecture-rpgtoolkit-reawakened.md, AD-1, AD-11, AD-13, AD-14, AD-21, AD-22, AD-24
- constraint - docs/guardrails.md, sections G1-G7 and Rollout
- reference - docs/architecture-options.md, section 9 First milestones

## Notes

- Decision: tools are those of the architecture spine Stack: pnpm, `node:test`, ESLint with typescript-eslint, dependency-cruiser, GitHub Actions. The user replaced Vitest with `node:test` on 2026-10-10 because Vitest brings `lightningcss` (MPL-2.0) into the dev tree.
- Open question: where the sample games are fetched from, and a pinned revision for them.
- Decision: epic set approved by the user, 2026-10-10.
- Assumption: an agent drafts ADR 0002 and the doc amendments from the spine's Deferred list and a person accepts them (entry 1). Confirm.
- Assumption: the G1 snapshot/restore test lands in epic rpgcode-vm and the headless-browser G3 replay in epic web-runner-packaging; this epic's golden job is where they plug in. Confirm.
- Decision: envelope re-sliced against the architecture spine, 2026-10-10.
- Decision: entry 1 (ADR 0002 and doc amendments) comes before the tracer because G7 and Done when 5 require the doc commit before any code; entry 2 is the tracer bullet (2026-10-10).
- Decision: sequencing: entry 3 (least certain, high risk) follows the tracer; entries 3 to 7 run in parallel after 2, each adding its own workflow file; 8 after 3; 9 joins 4, 7 and 8; 10 sets the required checks once every job exists; 11 is the sweep (2026-10-10).
- Decision: the epic opens with no refactor, and closes with a refactor sweep that waits on every other entry (2026-10-10).
- Decision: entry 12 (explicit absent values in the ports contract) follows entry 9 and runs before the sweep (2026-10-10). It makes optional contract fields required `T | null`, collapses the `missing`/`bytes` reply unions, and moves event-shape checking into one core validator that `parseRun` calls.
- Note for the builder of entry 9: build against the contract as it is today. Keep every event-shape check in `parseRun` in one function, with no field rules spread through the driver, so entry 12 can swap that function for the core validator. Do not edit the ports contract types for this; entry 12 owns that change.
- Decision: Jensen, 2026-10-15: `docs/spec/` replaces `docs/format-spec.md` and `docs/engine-features.md` as the normative spec (ADR 0007, entry 1.13); the owner attests it is clean (extraction-log round 4).
- Decision: 2026-10-15: entries 13 (ADR 0007) and 14 (engine-features migration onto docs/spec/engine with the E-xx IDs) are added to this epic, which owns the guard-rails and contributor docs; the citation sweep that deletes the old files is entry 3.28, the last migrating epic in build order. Source: discovery/docs-spec-reconciliation.md.
