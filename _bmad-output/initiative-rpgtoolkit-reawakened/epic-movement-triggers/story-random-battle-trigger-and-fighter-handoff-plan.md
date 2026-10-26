---
title: 'Random battle trigger and fighter handoff'
type: 'feature'
ticket: 11
created: '2026-10-18'
status: done
baseline_revision: '4e00c268219124233e37e27d7215225b48c87ca5'
route: 'full'
route_source: 'pinned'
risk: 'medium'
review: ''
review_source: ''
lenses_ran: []
review_loop_iteration: 0
context:
  - docs/guardrails.md
  - docs/spec/engine/movement-and-collision.md
  - docs/spec/engine/plugins-and-battle.md#random-encounters
  - _bmad-output/initiative-rpgtoolkit-reawakened/epic-battle/epic-battle.md
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Movement can complete player steps but has no deterministic random-encounter boundary or data-only handoff for the later battle epic.

**Approach:** Evaluate encounters in the battle phase after trigger activation, using the shared saved RNG and persisted tile progress, then post a plain-data battle effect containing stable fighter references and board/actor context.

## Boundaries & Constraints

**Always:** Roll only when fighting is enabled globally and the board allows battles; sample at most once per changed tile; use the shared RNG in documented order; keep references stable and all state/request data JSON-safe and snapshotable.

**Never:** Implement battle charge, damage, statuses, outcomes, custom battle UI, host I/O, or imports from movement into the battle package.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Type 0 | One player tile change, positive `chances` | One draw in `[0,chances)`; zero selects an encounter | Non-positive chances produce no draw |
| Type 1 | Tile changes and positive `chances` | No probability draw; encounter every `chances` tiles | Non-positive chances produce no encounter |
| Eligibility | Fighting disabled, board disallows, or no tile change | No RNG draw or handoff | Preserve RNG and progress |
| Selection | Trigger fires same tick, matching enemy pool exists | Trigger effects precede battle effect; count draw `1+[0,4)`, then one pool draw per enemy in stored order | Empty skill pool posts deterministic no-enemy diagnostic effect, no handoff |
| Custom fight | Encounter selected and custom program configured | Post custom-program request; do not post built-in fighter handoff | No battle mechanics run |
| Restore | Snapshot while handoff is pending or progress is mid-board | Restore preserves progress, pending effect, RNG and later draw sequence | Invalid state is rejected by existing snapshot validation |

</frozen-after-approval>

## Code Map

- `packages/core/src/sprites/model.ts` -- persisted movement-owned encounter progress and schema migration fallback; reuse actor stable ids/indexes and tile coordinate helpers.
- `packages/core/src/sprites/movement.ts` -- fixed movement completion and phase conventions; do not make encounter sampling part of each 4-pixel advance.
- `packages/core/src/world/coords.ts` -- deterministic `pixelToTile` conversion for 2D and isometric boards.
- `packages/core/src/engine/engine.ts` -- AD-26 phase order; pass a phase effect poster and run the movement-owned evaluator before battle consumers.
- `packages/core/src/engine/effects.ts` -- bounded, sequenced plain-data effect dispatch and pending queue.
- `packages/core/src/formats/main-file/model.ts` and `packages/core/src/world/model.ts` -- main encounter table/settings and board battle settings.
- `packages/core/src/save/snapshot.ts` and `packages/core/src/save/state.ts` -- section schema and round-trip validation.
- `packages/core/test/fixtures/movement/random-encounter.json` and `demo-npc-battle-trigger.json` -- all in-scope authored cases; acceptance must drive each through real core phases, deferring only pathfinding-owned cases.

## Tasks & Acceptance

**Execution:**
- [x] `packages/core/src/sprites/model.ts` -- add JSON-safe encounter progress with migration defaults -- preserve tile count and board identity through saves.
- [x] `packages/core/src/sprites/encounters.ts` -- implement eligibility, tile transition, deterministic draw order, pool selection, stable handoff types, and battle/custom request posting -- keep battle internals out of movement.
- [x] `packages/core/src/engine/engine.ts` and `packages/core/src/engine/effects.ts` -- expose phase effect posting and invoke encounter evaluation after triggers -- let a future battle owner consume queued effects.
- [x] `packages/core/src/index.ts` and `packages/core/src/sprites/index.ts` -- export the boundary API without deep-import requirements.
- [x] `packages/core/test/random-encounter.test.ts` -- run every random-encounter and demo-NPC fixture case through real core movement, trigger and battle phases; assert per-tick actor facts, activation-before-handoff, draw order, stable references and snapshot/restore.
- [x] `_bmad-output/initiative-rpgtoolkit-reawakened/epic-movement-triggers/story-random-battle-trigger-and-fighter-handoff-plan.md` -- append implementation and verification evidence; retain proposed ruling below.

**Acceptance Criteria:**
- Given a changed player tile on an eligible board, when the battle phase runs after triggers, then exactly one deterministic encounter decision is made and any handoff names stable actor/enemy references plus board context.
- Given pixel movement within one tile, when multiple movement advances occur, then no extra encounter draw occurs.
- Given a restored snapshot, when the same subsequent ticks run, then state hash, RNG state, pending request and handoff are identical.

## Implementation Notes

Proposed ruling (pending owner review): enemy count is `1 + draw(4)` and each enemy is selected by one draw from the board-skill-filtered main-file table in stored order. Evidence: `docs/spec/engine/plugins-and-battle.md#random-encounters`, fixture P-10 and `tools/fixtures/movement/sim.mjs:858-892`. Rejected alternative: choose from the full table or use one draw for all enemies, because it violates the documented skill-level pool and fixture draw-order evidence.

## Plan Change Log
- 2026-10-18: built on baseline `4e00c268219124233e37e27d7215225b48c87ca5`; encounter progress remains optional in the existing sprites schema so unrelated state hashes and goldens stay unchanged.
- 2026-10-26 (owner amendment, Jensen; applied by the director): the frozen block above is unchanged and its "Custom fight" row stands. The owner ruled that a random encounter draws from a list of available enemies while a custom encounter is spelled out. That is settled without a format change: `battle.customFight` keeps carrying only `trigger`, `board`, `actor` and `program`, with no fighters and no draw by the evaluator, and the enemy list lives in the custom program's own `FightEnemy(...)` call. The engine (entry 7.9) now runs `program` in place of the draw, with the request as `context`. BAT-9, E-70 and the random-encounters rule are amended to match, in the docs-only change that records this entry. Considered and rejected: a per-encounter enemy-list field in the main file or on the board (a format change with no legacy source) and handing the evaluator's pool to the program (what may be drawn is not what fights now).

## Implementation Evidence

- `encounters.ts` evaluates only eligible board tile changes after triggers, consumes the shared seeded RNG in the ruled order, and posts `battle.randomEncounter`, `battle.customFight`, or `battle.noEnemies` plain-data requests.
- `engine.ts` wires the battle phase poster to the bounded pending-effect queue; random progress and pending requests round-trip through snapshot/restore.
- `random-encounter.test.ts` drives every case from `random-encounter.json` plus `demo-npc-battle-trigger.json` through movement, triggers, and battle phases. Scripted NPC `fightEnemy` remains deferred to Epic 7; the test asserts the random evaluator does not steal it.
- No golden, corpus, closing hash, or PNG changed; all comparison gates remained on committed baselines.

## Review Triage Log

## Design Notes

The request is posted to the `battle` section as a normal sequenced effect with a plain-data payload. Until Epic 7 registers its applier, the engine's bounded pending queue retains it; this makes the seam consumable without importing movement code and makes snapshot/restore observable. Encounter progress lives with sprites because it is movement-owned, while battle state remains reserved for fighter charge/status.

## Verification

**Commands:**
- `pnpm typecheck` -- expected: all project references pass.
- `pnpm lint` -- expected: guardrails pass.
- `pnpm fixtures:fetch && pnpm test:strict` -- expected: strict core and fixture tests pass.
- `pnpm fixtures:author:check && pnpm fixtures:test` -- expected: authored fixtures and oracle pass.
- `pnpm golden && pnpm golden:bun` -- expected: headless goldens pass without unexplained hash changes.
- `pnpm graph && pnpm licence && pnpm provenance && pnpm catalogue:check && pnpm command-docs:check` -- expected: all repository gates pass.
