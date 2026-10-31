---
title: "Save operation and canonical game serialization"
type: 'feature'
ticket: 9
tracker_id: "#591"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/591"
parent: epic-menu-party-save
created: '2026-10-22'
status: built
risk: "high"
context:
  - "spec - docs/spec/formats/save-game.md"
  - "spec - docs/spec/engine/plugins-and-battle.md#e-123"
  - "spine - AD-7, AD-10, AD-11, AD-17, AD-23"
---

## Intent

Write a versioned canonical snapshot of the complete game and route save I/O only through the injected `saveBlob` port keyed by `GameId`.

## Boundaries

Serialization, schema versioning and board-level permission check. `loadBlob` validation/restore is entry 10; the host filesystem is never accessed from core.

## Acceptance

A mid-script save includes globals, object/closure state, actor/party/inventory/equipment/menu and UI sections, board live-item records, all thread state, movement configuration, RNG and clock; a board that forbids saving refuses without modifying state.

## Verification

Serialize equivalent states twice and compare canonical bytes/hash; round-trip each required section, exercise the blocked-save boundary, and prove G1/G2/G3 compliance with no host calls or nondeterministic data.

## Implementation map

Reuse existing `saveBlob` request and canonical save section registry. Each section owner supplies its serializer; do not centralize domain mutation or copy shared state.

## Delivered

The save path itself landed earlier in Epic 8 (`8.15`–`8.25`): `Save(name)` is the blocking `save` builtin (`packages/core/src/script/builtins/files.ts:108-116`) that emits `{ kind: "saveBlob", gameSave: true, blob: { area: "saves", path: "<GameId>/saved/<name>.sav" } }`, the engine answers it with `snapshotGameSave` once no other host request is in flight (`engine/engine.ts:1305-1340`, "a game save never captures a thread parked on an unanswered host request"), and `restoreGameSave` validates and restores it (`save/game-save.ts:177-192`). This ticket is therefore the proof of that contract, not a second implementation: it adds `packages/core/test/save-operation.test.ts`, which drives the real engine rather than the pure helpers.

- **Every section round-trips.** A booted game with an authored board gets an actor (stats, a status counter, a behaviour name), roster and selection, two inventory stacks, an equipped slot, gold, a menu screen and a battle fighter, then a board thread calls `Save("slot")`. The captured bytes are a JSON object carrying `actors`, `audio`, `battle`, `camera`, `events`, `fx`, `input`, `inventory`, `menu`, `party`, `rng`, `sprites`, `time`, `triggers`, `ui`, `vm` and `world`; restoring them reproduces each populated value, keeps the running thread and its wait, and re-canonicalising the restored state reproduces the saved bytes exactly. Two independent restores agree on `hashGameState`.
- **A board that forbids saving refuses.** With `disableSaving: 1` the command returns without emitting any `saveBlob`, the script finishes normally instead of parking, and the actor, party, inventory, menu and battle sections are unchanged (only the clock and RNG move on their own).
- **The canonical form is deterministic.** Canonicalising a restored save is a fixed point, and the bytes the engine writes for a live state equal the canonical form of the state those bytes restore to.

No runtime defect was reproduced and no production code changed; the request path, the board gate and the serializer already behaved as ruled.

## Plan Change Log

- 2026-10-30 (built): audit confirmed E-123's gate, the `saveBlob`/`GameId` routing and the canonical serializer are in place; added the three real-engine tests above. No production change.
