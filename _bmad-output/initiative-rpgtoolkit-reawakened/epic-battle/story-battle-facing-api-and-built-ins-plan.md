---
title: "The battle-facing API and the battle built-ins"
type: 'feature'
ticket: 3
created: '2026-10-19'
status: done
baseline_revision: '4255ec6f520af495d3aa2db8ed2553cb685ea3ab'
risk: "high"
context:
  - "spec - docs/spec/engine/battle.md as ruled by 7.1 (BAT-3)"
  - "spec - docs/spec/engine/plugins-and-battle.md#e-79 (callbacks 114-132)"
  - "spec - docs/spec/engine/rpgcode-functions.md (battle, stats and menus rows)"
  - "spec - docs/spec/engine/actors.md as ruled by 20.1 (stat aliases, methods)"
  - "code - packages/core/src/script/catalogue-responders.ts, packages/core/src/script/packs"
---

## Intent

Give an RPGCode battle package everything it needs to run a battle, and nothing that belongs to the package. The global `battle` object exposes the section: party size, fighter lookup, charge read/add/set/release, charge percent, `canRun`, the read-only background and outcome. The battle built-ins become aliases onto the actor's stats and methods, so a script reads and writes the same actor the rest of the engine sees.

Fighter handles resolve from `source`, `target`, a party-member name, a canonical actor-object handle or an enemy reference. The resolver is total for valid handles and returns a catchable, stable error for anything else.

## Boundaries

No loop, no damage, no AI, no UI. The package decides when to call these operations; this entry only makes them callable and correct. It does not re-implement actor stats; it delegates to 20.4/20.6. No Reawakened core operation is named `fightTick`; the legacy callback remains documented in E-79 and maps to no core operation.

## Key Decisions

1. **Objects, then aliases.** `battle` is a plain object capability in the same style as the other RPGCode objects. The stat built-ins (`hp`, `givehp`, `gethp`, `maxhp`, `getmaxhp`, `smp`, `givesmp`, `getsmp`, `maxsmp`, `getmaxsmp`, `fp`, `givefp`, `getfp`, `dp`, `getdp`) resolve their handle and call the actor method; they are not a second store. `givehp` and `givesmp` clamp and go through the actor's damage/heal path so `fallen` fires once.

2. **Charge is the section's, not the actor's.** `battle.charge` reads and writes the entry in the `battle` section; `releaseCharge` sets it to 0 and is the only reset used by the loop. `chargePercent` is `floor(charge * 100 / threshold)`, with threshold 75 for party 1 and 123 for party 0, and is clamped to 0..100 when read.

3. **Handles.** `battle.fighter(party, index)` returns the actor object; `battle.partySize(party)` returns the entry count. A script-side handle is one of: the current `source`/`target`, a party-member name resolved through the actor store's ordered party, the canonical actor-object handle returned by `battle.fighter`, or an enemy reference `{ party: 0, index }`. An unknown handle, a bad party or an index out of range raises `battle.bad-fighter` with the party and index in the message.

4. **Outcome.** `battle.finish(code)` validates integer codes 0-4 and writes `outcome`; a non-integer or out-of-range code raises the distinct catchable `battle.bad-outcome` error, not `battle.bad-fighter`. It does not apply rewards (7.8 does that). A second `finish` in the same battle is `battle.already-finished`, so a package cannot double-award.

5. **Registration.** The built-ins are registered once in the battle pack, and the catalogue rows carry the same names; `applystatus`/`removestatus` route to the actor's status methods. A catalogue test compares the registered names with the documented rows, so a rename cannot drift.

## Acceptance

1. Every operation of the ruled E-79 surface is reachable from a script and resolves to the same actor object the actor store holds.
2. A legacy handle (`source`, `target`, a party name, an actor-object handle, or an enemy reference) resolves inside and outside battle; a stat alias still works outside a battle.
3. Fighter-handle failures share the stable, catchable `battle.bad-fighter` error; an invalid outcome raises the distinct `battle.bad-outcome`; both leave the state unchanged.
4. Stats are never copied; a write through an alias is visible through the actor store and through a second alias.
5. The built-in catalogue and command-docs rows match the registrations; `pnpm provenance` and `pnpm licence` pass.
6. No Reawakened core operation named `fightTick` exists; E-79 retains the legacy callback reference and the map identifies that the package loop replaces it.

## Verification

Script-level unit tests for the operations and their error codes; a catalogue-to-registration test; an actor-identity test (same object reference, same stat after a write); verify the core registers no `fightTick` operation while E-79 retains its legacy callback documentation. Full suite, typecheck and lint.

## Plan Change Log

- 2026-10-26 (owner ruling, Jensen; applied by the director): BAT-3 documents the read-only background and canonical actor-object handles, groups fighter-resolution failures under `battle.bad-fighter`, and distinguishes invalid outcomes with `battle.bad-outcome`. `fightTick` is scoped to no Reawakened core operation while preserving the legacy callback documentation in E-79.
