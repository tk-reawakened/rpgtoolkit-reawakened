---
title: 'Rule wrong-kind actor references in restored battles'
type: 'chore'
ticket: 25
created: '2026-10-29'
status: blocked
baseline_revision: '82d30c5e'
risk: 'medium'
review: 'quick'
blocked_reason: 'awaiting the owner ruling on the proposal recorded here'
context:
  - 'docs/spec/engine/battle.md'
  - 'docs/spec/formats/save-game.md'
---

## Intent

**Problem:** BAT-2 assigns party 0 to the enemies and party 1 to the player's party (`docs/spec/engine/battle.md:46`), and already makes a dangling or repeated fighter reference a located, recoverable load diagnostic (`:48`), but a restored `battle` section accepts any extant actor in either slot. Whether a role mismatch is valid, repairable or a load error is an owner decision, so nothing changes until it is made (ticket 25, issue #745).

**Approach:** Record the observed cases, the alternatives and one recommended rule in this plan; the owner reviews and decides, the rule is then written at BAT-2, and any implementation is scoped separately.

## Proposed ruling (pending owner review)

**Question:** When a restored `battle` section holds an actor whose kind does not match its party — a `party` actor in party 0, an `enemy` actor in party 1 — is that valid as saved, repaired, or a load error?

**Recommended wording** (an addition to BAT-2's diagnostic sentence): "An `actorId` whose actor is missing, whose kind does not match its party (party 0 is `enemy`, party 1 is `party`), or which repeats within its party is a located, recoverable load diagnostic; the entry is kept and marked unusable so a later script can repair it, and the loop skips it as not living. Restore never refuses the save for a fighter reference and never rewrites the entry."

**Status:** proposed only. No owner ruling, approval or date is claimed here; ticket 25 stays `blocked` and issue #745 stays open until the owner decides.

## Evidence

- `docs/spec/engine/battle.md:46` states party 0 is the enemies and party 1 the player's party; `:48` already rules a dangling or repeated reference as a located load diagnostic whose entry is kept, marked unusable and skipped as not living.
- A new start enforces kind: `packages/core/src/battle/port.ts:114-116` finds the actor by `candidate.kind === kind` and fails `battle.bad-fighter`, and the start path re-checks the party (`packages/core/src/script/packs/battle.ts:668`).
- Restore does not: `packages/core/src/battle/model.ts:60,63` check duplicates and existence only, and `packages/core/src/save/snapshot.ts:855-864` forwards recoverable issues as `restore.battle-fighter`.
- `isBattleFighterUsable` (`packages/core/src/battle/model.ts:24-32`) likewise checks existence and duplicates, so the loop, `battle.fighter`, `battle.charge` and `battle.chargePercent` all accept the wrong-kind entry.

## Rejected alternative

**Silent acceptance (today's behavior).** It lets a party actor fight as an enemy while it stays in party 1: party index selects the charge threshold and the win/loss check, so the battle silently fights the wrong side and the corruption is invisible. **Whole-load refusal** was also rejected: one repairable reference would refuse an otherwise valid save, and no documented rule or evidence supports refusing it.

## Consequences

- If the owner accepts the wording: one new recoverable `restore.battle-fighter` case, raised once per wrong-kind entry and located at `battle.parties[party][index].actorId`; the entry is retained, so party indices and any script repair are preserved; no save is refused for a fighter reference.
- Implementation (a separate ticket, not this one): `isBattleFighterUsable` and `validateBattleSection` gain the kind check over the actor section. No runtime change is made by this plan.
- Tests: add a restore case asserting exactly one diagnostic and an unusable fighter; the existing dangling/duplicate counts stay as they are (`packages/core/test/battle-state.test.ts:68-85`).
- Docs: the rule text lands at BAT-2 only after the owner approves it; `docs/spec/` is untouched by this plan.

## Verified defect facts

- **Only an altered save can produce it.** Every start path validates kind (`port.ts:114-116`, `battle.ts:668`), actor ids are never reused within a run (`packages/core/src/actors/model.ts:294-300`), and only the start and charge writes touch `BattleState.parties` (`port.ts:136,222-226`), so no normal battle start or play path can. A hand-edited or hand-built snapshot can.
- **Reproduced on `82d30c5e`** with a scratch probe (built, run, deleted; not committed): a snapshot with the enemy-kind actor in party 1 and the party-kind actor in party 0 gave `validateBattleSection` issues `[]`, `restoreGameState` diagnostics `[]`, `battle.fighter(0,0)` → `{"ok":true,"value":{"actorId":2,"charge":0,"party":0}}` (actor 2 is the party actor) and `chargePercent(0,0)` → `{"ok":true,"value":0}`, while `battle.start` over the same swap returned `{"ok":false,"error":{"code":"battle.bad-fighter","message":"no unique enemy actor exists at this position (party=0, index=0)"}}`.
