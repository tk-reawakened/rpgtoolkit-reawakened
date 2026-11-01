---
title: "Behaviour registration and override precedence"
type: 'feature'
ticket: 7
created: '2026-10-19'
status: 'built'
baseline_revision: 'ce05dd4d34d9c0f0fa998cb7d8614ab89d17a47a'
route: 'full'
route_source: 'pinned'
review: 'approve'
review_source: 'fresh independent exact-head fix reviewer'
lenses_ran: ['implementation', 'migration', 'boundary-validation', 'regression-baselines', 'fresh-implementation', 'fresh-boundary', 'fresh-tests', 'remote-head-implementation', 'remote-head-boundary', 'remote-head-tests', 'latest-hydration-lifecycle', 'latest-contract-regression', 'latest-hydration-tests', 'exact-persistence-head']
review_loop_iteration: 6
risk: "high"
context:
  - "spec - docs/spec/engine/actors.md"
  - "code - packages/core/src/script/ (registerPlugin from 19.8)"
  - "code - packages/core/src/actors/"
---

## Intent

A behaviour is a separate package-start-up registration, not a `registerPlugin`
key: each resolved package supplies a package-scoped `behaviourStartup` callback,
and the host passes it a `registerBehaviour(name, hooks)` service during
`runPackageStartup`. The callback is invoked in manifest order and rebuilt by
the 19.16 loader at every boot/reset/restore. The resulting session registry is
injected into the actor owner service, so actor operations resolve behaviour
hooks before applying core rules.

## Boundaries

Registration, resolution, and the actor-owner operation seam only; core rule
implementations, saving, and generic object hydration are entry 8 or later.

## Contract reconciliation

The pre-build plan and ticket verification text used `stock_rpg.hero`, but the
normative package grammar is lower-case hyphenated (`stock-rpg.hero`). The
ticket also named a `damage-taken` behaviour override, while the closed core
hook list contains only `levelUp`, `revive`, `statusChanged`, `equipmentChanged`,
and `statsChanged`; `beforeDamage` and damage resolution belong to the battle
RPGCode thread. This plan and `tickets.toml` now use the normative name and
five-hook list. No core damage hook or extra registry hook will be implemented.

## Key Decisions

1. Behaviour names use the package grammar `namespace.name` (for example
   `stock-rpg.hero`); an actor stores only the name.
2. The hook list is closed and defined by core: the five hooks are `levelUp`,
   `revive`, `statusChanged`, `equipmentChanged`, and `statsChanged`. Unknown
   hook names, malformed names, wrong package namespaces and duplicates
   diagnose and register nothing; packages may still emit custom events.
3. Resolution is behaviour hook first, core default second; no behaviour or an
   unknown name uses the default and emits one located diagnostic for the
   unknown name.
4. `behaviourStartup` is the only package registration surface for behaviours.
   Its registrar is scoped to the owning package namespace, so a package cannot
   register another package's behaviour name. The startup callback is invoked
   with every `runPackageStartup` call; omitting the resolved plugin list is a
   type error rather than a silent no-op.

## Acceptance

1. Override and default paths; namespacing.
2. Package startup invokes each package's scoped `registerBehaviour(name,
   hooks)` service before actor operations; `ActorService` resolves the actor's
   hooks and supplies them to the core operation rules.
3. The owner service routes direct stat writes through hook-aware operations;
   all five hook paths, reset/restore rebuilds, missing-service diagnostics,
   plain hook dictionaries, and actor save data are covered by consumer tests.

## Verification

Unit tests with two test packages and consumer-visible actor operation usage.
The core behaviour test registers `stock-rpg.hero` through a package-scoped
startup callback, calls `services.actors.awardExperience`, and verifies the
hook override changes the committed actor result. Additional tests exercise
each hook through the owner service, direct stat writes, namespace ownership,
fresh startup services, restore/missing-service diagnostics, and reject
non-plain hook dictionaries.

## Review Triage Log

- `high` / `patch`: the initial registry was not connected to package
  definitions or actor host resolution; package behaviour overrides could not
  reach actor operations. Added session registration from resolved plugin
  behaviour startup callbacks, passed registry resolution into the actor owner
  service, and routed actor operations and virtual/host writes through that
  service while preserving the five-hook boundary.
- `fixed`: the earlier review question about wiring hooks into rule operations
  was valid against the acceptance claim that an actor uses its overrides.
  `ActorService` now owns the operation calls (`updateStats`, `advanceStatus`,
  `applyEquipment`, `awardExperience`) and injects the resolved hooks; the
  consumer test exercises `awardExperience`.
- `live` / `fixed`: the independent review found that static
  `PluginDefinition.behaviours` did not implement the normative startup call.
  Replaced it with the package-scoped `behaviourStartup(registerBehaviour)`
  service and made `runPackageStartup` require the resolved plugin list.
- `live` / `fixed`: package namespace validation used the global namespace
  union, direct stat writes bypassed `statsChanged`/`revive`, non-plain objects
  were accepted as hook dictionaries, and coverage omitted the remaining hook
  paths and reset/restore diagnostics. Scoped registration, owner-routed
  writes, plain-object validation, and consumer tests close those gaps.
- `live` / `fixed`: the host lifecycle could skip behaviour-only package
  registration and restore package startup on a scratch state without attaching
  hooks to restored actors. `createScriptHost` now always invokes
  `runPackageStartup` with resolved plugins; restore rebuilds package layers on
  scratch and reruns package registration against the actual restored services.
  Host consumers cover fresh behaviour-only startup and restored actor hook
  writes.

## Fix review (2026-10-20)

The latest uncommitted worktree was reviewed at `HEAD f34a86c3`, with
`origin/main` at `96f580a9` and that commit as the merge base. The intervening
main change is `feat(media): ship the cleaned-up logo master and its provenance
notice` (`#557`): it adds `media/NOTICE.txt` and replaces media icon binaries
only. It does not touch the Epic 20.7 source, API, tests, or docs, so this
review did not need to wait for another implementation rebase. `pnpm
typecheck` passed for all workspace and test projects after the latest fixes.

### Actionable findings

- `medium` / `fixed`: `registerPackageBehaviours` now consumes the
  registry's explicit owner-scoped registration capability; it no longer
  casts an exported `BehaviourRegistry` to a private symbol. Consumers cannot
  pass a structurally valid registry that fails at callback dispatch.

- `medium` / `fixed`: removed the exported unscoped `registerBehaviour`
  escape hatch. The session registry now exposes only an explicit
  owner-scoped registration capability used by the package-startup dispatcher;
  the public helper no longer casts a registry to a private symbol.

The previously reported startup-lifecycle and compile findings are fixed in
this worktree: `createScriptHost` always invokes startup with resolved
plugins; restore passes resolved plugins to both scratch and actual service
rebuilds; the runner tests now prove a restored actor's `HP!` write applies
the behaviour's `dp: 42` hook; package-callback duplicate registration is
covered; and the missing `createBehaviourRegistry` test import is restored.

### Verification dispositions

- **Fixed:** `registerPackageBehaviours` now uses an explicit owner-scoped
  `registerForNamespace` capability instead of casting to a private symbol.
  A structurally valid custom registry therefore remains usable, while the
  package callback still cannot register another package's namespace.

- **Fixed:** the unscoped exported `registerBehaviour` escape hatch was removed.
  Package behaviour registration is available only through
  `PluginDefinition.behaviourStartup`, distinct from `registerPlugin`.

- **Fixed:** actor-behaviour tests assert callback execution in manifest order,
  duplicate rejection and diagnostic, plain-hook validation, and the accepted
  synthetic missing-behaviour location (`<package startup>`, line `0`).

- **Fixed:** runner restore tests include a package-startup program that
  consumes an actor hook on the scratch rebuild and assert the same hook is
  attached to the actual restored service.

- **Fixed:** createEngine tests exercise an actor alias write through a
  `behaviourStartup` package and verify registration is rebuilt after
  lifecycle reset.

- Existing `packages/core/test/actors.test.ts` already verifies actor records
  round-trip through `snapshot`/`restoreGameState` and contain no callable, so
  the save-shape acceptance criterion remains dispositioned as covered rather
  than reopened here.

### Disposition

The latest review findings are addressed in the working tree. Full repository
gates and a fresh independent review are still required; this is not yet an
approval, and no commit or push has been made.

### Latest review findings (disposition)

- **Fixed:** reset preserves the manifest-resolved plugin set when `createEngine`
  starts without explicit `init.plugins`; the engine test performs an actor
  operation after reset and observes the package hook.
- **Fixed:** restored-services missing-behaviour coverage performs an actor
  operation, asserts the core default result, and asserts exactly one located
  diagnostic.
- **Fixed:** duplicate, cross-namespace, malformed-name, and unknown-hook
  diagnostics assert their synthetic file and line locations. Hook validation
  now uses own property keys/descriptors and rejects symbols, non-enumerable
  properties, and accessors.
- **Fixed:** startup registrars close when their callback returns; retained
  callbacks reject late registration without mutating the registry.
- **Fixed:** documented lower-case hyphenated package IDs and namespaces are
  accepted by the manifest parser and covered end to end.
- **Fixed:** generic `ActorService.patchActor` was removed, `StatsPort` requires
  an owner hook resolver, and `createDefaultVirtuals` requires an explicit
  owner service. Raw model patching remains a lower-level model operation;
  actor-owner consumers route through `ActorService` operations.

## Fresh fix re-review (2026-10-20)

The stable worktree was rebaselined at `HEAD f34a86c3`, with
`origin/main` and the merge base both `96f580a9`. The intervening main
commit (`feat(media): ship the cleaned-up logo master and its provenance
notice`, #557) changes only media provenance and icon binaries; it does not
overlap this ticket. No implementation rebase is required for this review.
The worktree is unstaged-only with 23 modified files and no untracked files
(`+792/-120`).

### Prior findings

All previously actionable findings are fixed in the latest snapshot:

- Package startup now uses `PluginDefinition.behaviourStartup` with a
  resolved-plugin list, distinct from `registerPlugin`; registration is
  owner-scoped, ordered, duplicate-safe, and closed after the callback pass.
- Hook dictionaries are validated through own keys and descriptors, rejecting
  symbols, non-enumerable properties, accessors, non-callables, unknown hooks,
  and non-plain objects. Diagnostics assert the synthetic startup location.
- Direct owner writes use the resolver-aware `ActorService`; the public
  `StatsPort` now requires a hook resolver, `ActorService.patchActor` was
  removed, and `createDefaultVirtuals` requires an explicit owner service.
  Raw model patching remains the lower-level state/model API by design.
- Engine boot retains manifest-resolved plugins for reset, and fresh/restore
  runner paths rebuild behavior registries on both scratch and actual
  services. Consumer tests cover actor operations after reset, restored
  missing-behavior fallback/diagnostics, and the package callback lifetime.
- The manifest parser now accepts the documented lower-case hyphenated
  package IDs and namespaces, with parser and end-to-end coverage.

### Remaining findings and verification gaps

No actionable implementation finding remains in this snapshot. The
intervening main change is irrelevant to the ticket, and the current source
matches the documented behavior-registration, actor-owner, and lifecycle
contracts. Focused core/runner tests are reported passing by the paused
implementer. Remaining non-blocking verification gaps are:

- The restore test proves the final restored actor uses the hook, but its
  callback count does not independently label the scratch and actual service
  registrations.
- The missing-behaviour test proves the default progression transition and
  one located diagnostic, but does not compare that result with a separately
  configured core-default hook.
- Existing actor snapshot coverage establishes plain save data, but does not
  add a behavior-specific save/restore assertion that the saved name
  re-resolves after registry rebuild.
- The full repository gate was not rerun by this review pass; focused test
  success is reported by the paused implementer.

### Disposition

**APPROVE** the Epic 20.7 implementation review at this stable snapshot.
This is a review disposition only; no GitHub approval, commit, or push was
performed by this reviewer.

## Remote-head fix re-review (2026-10-21)

The pushed PR was independently reviewed at exact `HEAD
9efb3c094683ab94bfdcba96b3a7162580993631`. The worktree was clean before
this plan-only update. `origin/main` was `96f580a9300199b01b738250b13194216a7dc808`,
and the merge base was the same commit, so the pushed head is already based on
the latest available main and no rebase wait is required. The hosted CI run
for this exact head (`#39535570614`) completed successfully: all nine jobs
passed, including unit, typecheck, lint, build/golden, graph, provenance,
licence, and gate checks.

### Actionable finding

- **Medium — fixed:** `runPackageStartup` now resolves every hydrated actor
  immediately after package behaviour registration. This covers boot and actual
  restore services, emits one deduplicated located `behaviour.missing`
  diagnostic for absent saved names, and preserves the same resolver for later
  operations. A restored unused actor is covered by a consumer test.

### Verification gaps

- **Closed:** callback order is asserted in manifest order.
- **Closed:** hook validation has independent accessor and non-callable tests,
  including located diagnostics.
- **Closed:** save/restore coverage asserts re-resolution and diagnostics for an
  unused restored actor.

### Disposition

**FIXED** in the working tree. Full gates, push, and a fresh independent
review of the new remote head remain required. No merge is authorized yet.

## Save-shape review follow-up (2026-10-21)

- **Fixed:** the previous persistence test compared two identical object
  literals and proved nothing. It now snapshots a consumer-created actor,
  asserts the saved behaviour name remains plain data with no serialized hook
  members, restores the state, rebuilds package startup, and verifies the
  saved name resolves to a callable hook used by an actor operation.

## Final remote-head fix re-review (2026-10-21)

The exact pushed PR head is `c71870e50e038f42bf07160bfad060f20e5821d5`.
The worktree was clean before this plan-only update. `origin/main` is
`96f580a9300199b01b738250b13194216a7dc808`, and the merge base is the same
commit; the PR is already based on the latest available main and needs no
rebase.

The prior lazy missing-behaviour finding is fixed. `runPackageStartup` first
registers package behaviours, then resolves every actor already hydrated in
the supplied state (`packages/core/src/script/package-startup.ts:40-48`).
`missingReported` deduplicates diagnostics by behaviour name, while later
actor operations reuse the same registry and do not duplicate the diagnostic.
The actual restored-state path in
`packages/runner-harness/src/script-host.ts:374-388` runs this sequence after
loading the snapshot; the scratch restore path is separate and runs before
the actual restored services. Engine boot/reset rebuilds services through
`makeServices` with the active plugin list. The restored-unused-actor
regression test passed in the focused run (`7/7` tests), including the
unused actor diagnostic, and the independent lifecycle and contract lenses
found no remaining correctness bug.

### Hosted checks

GitHub Actions run `#39536278271` for commit `c71870e50e03` completed
successfully. All nine hosted jobs passed: unit, typecheck, lint, golden,
golden-bun, graph, provenance, licence, and gate.

### Remaining verification gaps

The previously noted persistence-test gap is closed by the save-shape
consumer assertion in the follow-up section above. No acceptance finding
remains in this review thread.
No GitHub review was submitted because the PR author is the same identity;
this review did not self-approve.

### Disposition

**APPROVE** the exact pushed PR head for implementation correctness. This is
a plan/review disposition only; no implementation edit, GitHub approval,
commit, or push was performed.

## Exact persistence-head fix re-review (2026-10-21)

The exact pushed head reviewed was
`3e58a9c3ae7ae49fa9603ea1c3ca53922b36aec7`. The worktree was clean before
this plan-only update. `origin/main` is
`96f580a9300199b01b738250b13194216a7dc808`, and the merge base is identical;
no rebase is required.

The persistence-test fix is valid. The test now creates an actor with
`stock-rpg.hero`, snapshots it, parses the saved JSON, asserts the behaviour
name is present and hook members are absent, restores the state, rebuilds
package startup, verifies the name remains, verifies the hook resolves to a
callable, and proves the hook affects a subsequent actor operation
(`packages/core/test/actor-behaviour.test.ts:52-88`). The focused behavior
suite passed 7/7, including the restored-unused-actor diagnostic and the
new persistence test.

### Hosted checks

GitHub Actions run `#39537085685` for commit `3e58a9c3ae7a` completed
successfully. All nine jobs passed: unit, typecheck, lint, golden,
golden-bun, graph, provenance, licence, and gate.

### Findings and disposition

No actionable implementation or persistence-contract finding remains. Prior
hydration-time diagnostics, startup/restore ordering, hook validation, actor
owner routing, manifest grammar, and registry lifecycle findings remain
fixed. **APPROVE** the exact pushed head for implementation correctness.
This is a plan/review disposition only; no implementation edit, commit, push,
or GitHub review was performed. The PR author is the same identity, so no
self-review was submitted.
