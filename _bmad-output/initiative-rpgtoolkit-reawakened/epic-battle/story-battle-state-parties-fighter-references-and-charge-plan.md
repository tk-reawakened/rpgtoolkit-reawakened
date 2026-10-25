---
title: "Battle state: parties, fighter references and charge"
type: 'feature'
ticket: 2
created: '2026-10-19'
status: done
baseline_revision: '4255ec6f520af495d3aa2db8ed2553cb685ea3ab'
risk: "high"
context:
  - "spec - docs/spec/engine/battle.md as ruled by 7.1 (BAT-2, BAT-13)"
  - "spec - docs/spec/engine/actors.md as ruled by 20.1 (actor ids, the actor store)"
  - "spec - docs/spec/engine/main-loop-and-startup.md#reawakened-reset-sections"
  - "code - packages/core/src/save/sections.ts, packages/core/src/save/state.ts"
---

## Intent

Replace the empty `BattleSection` placeholder with the concrete plain-data battle record that 7.1 rules, so a battle can be started, saved mid-fight and restored without copying actor stats. The section holds one active battle (`id`, `boardKey`, `background`, `canRun`, `outcome`) and two ordered parties of `{ party, actorId, charge }`. Status effects, HP, SMP, FP and DP remain on the actor.

The section is in the save state, is included in the canonical hash, and is cleared by `reset()` like the other placeholder sections.

## Boundaries

This entry writes state only. It does not register built-ins (7.3), run the loop (7.4), start a battle (7.9) or draw anything (7.11). It does not create actors (20.5) or the actor store (20.3); it references their ids.

## Key Decisions

1. **Shape is exactly BAT-2.** A serialisable `BattleState | null`; party entries are ordered arrays, and the order is the turn-order tie-break (enemies before players, then party index). No map keyed by id, because two fighters may share a name and the order is meaningful. The `save/sections.ts` header stops listing `battle` as an empty placeholder, and the `BattleSection` comment names fighter references and charge only, not status.

2. **Versioning and validation.** The `battle` entry in `SCHEMA_VERSIONS` moves from 1 (the empty placeholder) to 2 under the save schema-bump rule, with a fixture save from version 1 and a restore test over it. Validation is a pure function returning located issues (`battle.parties[0][2].actorId` style), not a throw during load; the loader reports issues and continues, in line with the actor section's diagnostics.

3. **Dangling and duplicate references.** A dangling `actorId` or a duplicate `{party, actorId}` pair is a load diagnostic. The battle keeps the reference (so the player can see it and a later script can repair it) but marks the fighter unusable. No silent drop, because removing an entry would renumber the party and change who acts at which index; the loop skips an unusable fighter and counts it as not living.

4. **Hash and reset.** The canonical hash covers the order and the charge values, and is stable across object key insertion order by serialising entries as arrays. `reset()` sets the section to null; a save taken outside a battle contains null, not an empty object.

5. **No copied stats.** Snapshot/restore round-trips the section alone; the actors are saved by the actor section. This is the invariant the epic exists to protect, and a test asserts the section contains no `hp`, `smp`, `status` or `stats` key.

## Acceptance

1. `BattleSection` is the ruled shape, exported from the save barrel, with a pure validator and located issue paths.
2. A save taken mid-battle and restored reproduces party order, charge, background, `canRun` and outcome exactly; the state hash is identical.
3. A dangling or duplicate actor id loads with one located diagnostic per problem and no crash; a valid battle loads with none.
4. The section holds no stat or status copy; reset clears it; an out-of-battle save has `battle: null`.
5. The `battle` section version is bumped under the schema-bump rule, a v1 fixture restores, and the save golden is re-recorded once, deliberately, with the diff showing only the battle section (G5).
6. The `save/sections.ts` header no longer lists `battle` as an empty placeholder and the `BattleSection` comment says fighter references and charge, not status.

## Verification

Unit tests for the validator (dangling, duplicate, bad outcome, bad party), snapshot/restore and hash stability; a v1 fixture restore test; a reset test; the save-golden test with a deliberate re-record. The full suite, typecheck and lint pass. No fixtures are committed outside `packages/core/test/fixtures/`.
