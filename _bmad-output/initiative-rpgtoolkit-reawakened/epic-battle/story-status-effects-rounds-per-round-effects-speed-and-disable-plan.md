---
title: "Status effects: rounds, per-round effects, speed and disable"
type: 'feature'
ticket: 6
created: '2026-10-19'
status: in-progress
baseline_revision: '4255ec6f520af495d3aa2db8ed2553cb685ea3ab'
risk: "high"
context:
  - "spec - docs/spec/engine/battle.md as ruled by 7.1 (BAT-6)"
  - "spec - docs/spec/engine/plugins-and-battle.md#e-75"
  - "spec - docs/spec/formats/battle-data.md (.ste)"
  - "spec - docs/spec/engine/actors.md as ruled by 20.1 (status counter, advanceStatus)"
---

## Intent

Implement E-75 status effects in the stock package on top of the core's status data. The core stores the effect, its remaining rounds and the source; the package decides when a round passes, applies the per-round effects and interprets speed, slow and disable.

A status ticks once per turn of the fighter carrying it: in the pass where the fighter is found fully charged, just before its turn, and for each status in turn the package applies its HP amount, then its SMP amount, then runs its program, then reduces its round count, then expires it at 0 (BAT-6). Re-applying a status restarts its rounds. A fighter's statuses tick in order of their file names compared in upper case.

## Boundaries

No damage formulas (7.5) and no AI (7.7). The core owns the status data, lifetime countdown and expiry; this entry owns the 3.1 "each round while charged" semantics, the per-round program and the charge-rate contributions. It does not add status types to the core.

## Key Decisions

1. **Storage.** A status is identified by its `.ste` file name and carries `{ id, name, rounds, source, data }`. Applying an existing id replaces the entry and restarts `rounds`; it does not stack two copies. Two different statuses may both contribute speed.

2. **Round boundary.** The tick is the fighter becoming charged, once per turn (BAT-6, R11-Q5). A disabled fighter never becomes charged, so it takes no status round and a disable never ends by itself; it ends only by `removestatus` or the battle's end. With several disables it stays frozen until all are gone. The legacy cancellation of a player's self-disable at turn end is not reproduced.

3. **Per-round effects.** For each status in file-name order: apply the HP delta (through the actor heal/damage path, so it stops at 0 and at the maximum), then the SMP delta, then run the program with the fighter as both `source` and `target`, then age that status by one round and expire it at 0. If `advanceStatus(1)` cannot age one status at a time, apply all effects then age all (the BAT-6 departure 4). A program error is reported with the status id and does not abort the battle; the remaining statuses still apply. A `.ste` with fewer than 1 round loads with a diagnostic and lasts until removed.

4. **Charge contribution.** Speed adds 2 to the rate per active speed status and slow subtracts 2; the effects sum across different status files with **no floor and no ceiling** (BAT-4). A rate of 0 or less means the fighter never becomes charged. Disable is a reference count and freezes charging (a charge at or above the threshold is set to one below it).

5. **Removal and death.** `removestatus` removes the entry and drops its contributions immediately. A lethal per-round HP effect fires `fallen` once with `cause: "status"` through the actor path; the package does not emit `defeated` (7.8 does). Status state saves with the actor and replays identically.

## Acceptance

- [x] Apply, re-apply, remove and expire behave as ruled; re-apply restarts the rounds and does not duplicate the entry. Tests: `battle-loop.test.ts` — “reapplying a case-insensitive status restarts one counter; HP and SMP effects run before each turn and expire”; `actor-rules.test.ts` — “actor status owner restarts counters, removes identities, and emits ordinary transitions”.
- [x] A per-round HP, SMP and program effect runs exactly once per round, at the fighter's charged boundary. Tests: `battle-loop.test.ts` — “reapplying a case-insensitive status restarts one counter; HP and SMP effects run before each turn and expire”; “status programs run in upper-case filename order with status context”.
- [x] Speed and slow stack per active effect; disable freezes only while at least one disable is active and unfreezes on the last removal. Tests: `battle-loop.test.ts` — “speed, slow, multiple status files, and zero-round counters produce the unbounded exact rate”; “disable reference-counts active status files, clamps ready charge, and resumes after the last owner removal”.
- [x] A lethal status fires `fallen` once with cause `status`. Test: `battle-loop.test.ts` — “lethal status HP fires one fallen event with cause status without cancelling the turn”.
- [ ] For an enemy, the package then emits `defeated` once (7.8). This clause belongs to 7.8; the merged test establishes `fallen` but no `defeated` behavior.
- [x] Status state is saved with the actor and a save/restore replays identically. Tests: `battle-loop.test.ts` — “a budget-preempted status pass restores and resumes as plain deterministic state”; “status cache restores identically both before and after a mid-battle status change is refreshed”.
- [ ] Statuses are absent from the `battle` section. The cited tests demonstrate actor status state but do not assert that the battle section lacks status data.
- [x] A program error in a per-round effect is reported and does not abort the battle. Test: `battle-loop.test.ts` — “a per-round program error is reported while the status turn and battle continue”.

## Verification

Unit tests for apply/re-apply/expire, a round-boundary test including a disabled fighter, a stacking test, a program-error test, a lethal-status test, and a save/replay test. Full suite, typecheck and lint.
