---
title: 'Independent movement oracle and authored fixtures'
type: 'feature'
ticket: 2
created: '2026-10-18'
status: done
baseline_revision: 'd53cdd804d5f93525c2aa4e444bc848e75f550a5'
risk: 'medium'
context:
  - 'docs/spec/engine/movement-and-collision.md'
  - '_bmad-output/initiative-rpgtoolkit-reawakened/epic-movement-triggers/discovery/movement-readiness.md'
  - '_bmad-output/initiative-rpgtoolkit-reawakened/epic-movement-triggers/discovery/inception-proposal.md'
---

## Intent
Produce the data source and observable oracle for every later movement and trigger implementation.

## Boundaries
Authored, anonymised or generated fixtures and a core-independent checker only. No legacy GPL source, no imports from `packages/core`, and no implementation behavior hidden in the fixture generator.

## Key Decisions
Use fixed-tick recorded inputs and named outcome facts, not legacy screenshot parity. Produce `movement-tile-pixel`, `collision-solid-stairs-under`, `collision-sprite-blocking`, `edges-board-link-program`, `board-entry-thread-lifecycle`, `triggers-precedence`, `actor-hydration-item-multitask`, `pathfinding-axial-diagonal-vector`, `input-replay-button-slots`, `movement-waits`, `animation-fallback-stance`, `random-encounter`, `demo-npc-pathfinding` and `demo-npc-battle-trigger`; include the reachable demo NPC/pathfinding scenario as a corpus case.

## Acceptance
Fixtures cover every named scene above. Each producer output has a stable name and expected per-tick outcome facts (positions, layers, fired triggers and events); core state/draw hashes are asserted by later consumer entries.

## Verification
Generator/check mode reproduces all committed fixtures; static import scan proves no `packages/core` dependency; later ticket references resolve to the concrete names above.

## Scope

The producer is limited to authored JSON movement scenes, a core-independent reference tick machine, deterministic generation/checking, and fixture-tool tests. It does not implement runtime movement, alter state/draw hash contracts, or copy corpus files. The fifteen scene names are the stable downstream contract:
`movement-tile-pixel`, `collision-solid-stairs-under`, `collision-sprite-blocking`,
`edges-board-link-program`, `board-entry-thread-lifecycle`, `triggers-precedence`,
`tile-step-precheck-events`, `actor-hydration-item-multitask`, `pathfinding-axial-diagonal-vector`,
`input-replay-button-slots`, `movement-waits`, `animation-fallback-stance`,
`random-encounter`, `demo-npc-pathfinding`, and `demo-npc-battle-trigger`.

## Evidence and rejected alternatives

The scene contracts use the fixed 60 Hz phases and observable rules in
`docs/spec/engine/movement-and-collision.md` E-20..E-48, R-50..R-54 and its
ratifications, plus the bounded gamepad contract in
`docs/spec/engine/display-input-audio.md#reawakened-gamepad-contract`. The
readiness audit F-19..F-22 confirms that the fetched corpus has no suitable
movement oracle, while `Prg/man_wander.prg` and `Prg/man.prg` provide the
reachable demo program/battle evidence. The producer therefore pins only those
program digests and reads them at test time.

Rejected: importing `packages/core` to generate expected facts, because that
would let a consumer pass by sharing implementation behavior. Rejected:
committing extracted demo boards/programs or claiming screenshot parity, because
G5/G7 require fetched corpus inputs and authored, docs-derived fixtures. Rejected:
state or draw hashes in this producer, because those are downstream consumer
contracts.

## Code Map

- `tools/fixtures/movement/geometry.mjs` — fixed-point geometry, collision and
  R-54 glancing calculations; pure helper reused by the simulator and tests.
- `tools/fixtures/movement/sim.mjs` — explicit fixed-tick reference world for
  actors, queues, collisions, edges, triggers, threads, encounters and path
  outcomes. It has no core or host imports.
- `tools/fixtures/movement/pathfind.mjs` — axial, diagonal and vector search,
  deterministic ties, nearest-free goals, expansion cap and cache behavior.
- `tools/fixtures/movement/input.mjs` — keyboard/gamepad/pointer replay and
  button-slot facts for E-112.
- `tools/fixtures/movement/common.mjs`, `scenes-a.mjs`, `scenes-b.mjs`,
  `scenes-c.mjs` — authored boards/actors and the fifteen named scene cases.
- `tools/fixtures/movement/index.mjs` — stable scene manifest, proposed-ruling
  registry, corpus digest checks and static workspace-import scan.
- `tools/fixtures/author/generate.mjs` — writes/checks movement fixtures beside
  existing authored format fixtures without sharing core writers.
- `packages/core/test/fixtures/movement/*.json` — committed generated data:
  one outcome row per fixed tick, with actor positions/layers, triggers and
  events; no state or draw hashes.
- `tools/fixtures/test/movement.test.mjs` — generator/check, import, corpus,
  manifest and hand-worked acceptance assertions; `package.json` registers it
  in `fixtures:test`.

## Implementation notes and proposed rulings

Every proposed choice below remains **Proposed ruling (pending owner review)**, except P-19, which is settled; the scene records the observable consequence and the rejected alternative:

- P-1/P-3/P-4: cadence begins on command, 4 px advances use 1/256 fixed-point
  vectors, and blocked/reached steps end independently. Evidence: E-22/E-23
  and R-50. Rejected frame-rate-dependent or whole-queue cancellation.
- P-2/P-17: tile reference points, deterministic A* costs/ties, nearest-free
  goal selection, vector inflation and the 1000-expansion cap are fixed as
  documented. Evidence: E-34. Rejected unordered-neighbor or floating-point
  tie behavior.
- P-5: the first stored hit edge determines the slide turn and facing is the
  step octant. Evidence: E-26/R-54. Rejected arbitrary vector iteration or
  post-hoc facing.
- P-6/P-7/P-8: activation is evaluated at completion/key press, item
  precedence and queue clearing follow E-40..E-45, and silent program movement
  suppresses nested triggers. Rejected firing every tick or marking losing
  candidates as fired.
- P-9: hidden loading-condition items own no thread until shown and stop on
  hide/remove. Evidence: E-45. Rejected starting hidden multitasks.
- P-10: encounter draws happen after activation and at most once per tile,
  with deterministic skill-pool sampling. Evidence: random-battle rule after
  E-44 and plugins-and-battle.md. Rejected per-frame rolls.
- P-11: successful edge/send transitions clear or replace the queue and use
  one-based tile/layer coordinates; refusal preserves source state. Evidence:
  E-19/E-28/R-53. Rejected immediate same-tick swaps and unaligned arrival.
- P-12/P-13/P-18: disabled diagonals use latest press, button hit tests are
  half-open, and merged gamepad/key edges do not duplicate actions. Evidence:
  E-24 and E-112 contract. Rejected duplicate queue entries and inclusive
  right/bottom hit bounds.
- P-14/P-15/P-16: animation delay rounding, waits-phase wake-up, path diversion
  and 120-tick retests are explicit. Evidence: E-21, R-51 and AD-26. Rejected
  wall-clock waits, immediate wake-up, or unbounded diversion search.
- **P-19 (settled).** A counted blocked player direction-style tile step adds one
  step's worth (32 px in tile mode) to the repeat distance of each step-activated
  repeat program whose area the attempted destination overlaps, and resets the
  others exactly as a normal step leaving the area does; pressing into a wall can
  therefore re-fire a repeat program once per press. Settled 2026-11-21 by
  [R-67](../../../docs/spec/engine/movement-and-collision.md#r-67) (owner: Jensen;
  [ADR 0041](../../../docs/adr/0041-blocked-step-repeat-distance-program-driven-steps-and-getpath.md)),
  which resolves the ambiguity in favour of the traced legacy finished-move
  processing (`docs/provenance/facts-round-18.md`, Q1a/Q1b). Rejected: the previous
  zero contribution, which contradicted that processing and made a repeat program
  in front of a wall impossible to author deliberately. Since #1281 implemented R-67
  the oracle records the settled answer: the superseded
  `blocked-counted-step-does-not-leak-into-repeat-distance` case was replaced by
  `blocked-counted-step-feeds-repeat-distance`,
  `repeat-distance-32-fires-on-every-blocked-press` and
  `blocked-press-outside-the-area-rearms-the-repeat`, and `P-19` was removed from
  the fixture registry (`tools/fixtures/movement/index.mjs` and `manifest.json`).

## Acceptance mapping

1. `movementFixtureFiles()` and `fixtures:author --check` reproduce all fifteen
   committed scene files and `manifest.json` byte-for-byte.
2. `checkMovementImports()` statically rejects core/workspace imports in every
   movement module and the author generator.
3. Every recorded-input case has one ordered expected fact row per tick with
   positions/layers and named trigger/event facts; no state or draw hashes are
   present.
4. `checkMovementCorpus()` validates the fetched demo program digests and
   required operation strings without committing corpus files.
5. The fixture test suite asserts all named scenes and the specified movement,
   collision, pathfinding, trigger, input, wait, animation, encounter and demo
   outcomes.

## Status

Built on branch `feat/5.2`; implementation and fixture gates are complete. The
ticket remains `built` pending owner review and merge; it is not marked done.

## Plan Change Log

- 2026-10-18: resumed the partial implementation, completed the plan's code map
  and acceptance mapping, and recorded all pending proposed-ruling choices.
