---
title: "Rulings: menu ownership, save compatibility and dialogue completion"
type: 'feature'
ticket: 1
created: '2026-10-22'
risk: "high"
context:
  - "spine - AD-7, AD-10, AD-11, AD-17, AD-23"
  - "spec - docs/spec/formats/save-game.md (R-13, E-122)"
  - "spec - docs/spec/engine/plugins-and-battle.md (E-80 to E-87, E-95, E-123)"
  - "spec - docs/spec/engine/rpgcode-modules-and-objects.md (EMIT-8, EMIT-13)"
status: done
---

## Intent

Before runtime implementation, make the Epic 8 ownership, menu interface, save/load and dialogue contracts normative. The owner approved the CAP-5/CAP-9 dialogue work and queued `dialogue.completed` payload `{ actorId, targetId: actor id or null, text }`; this story records that decision rather than reopening it.

## Boundaries

Docs and architecture spine only. No code, tests, ticket reshaping, or implementation of the wrapper.

## Accepted rulings (owner-approved, 2026-10-22)

1. Core owns authoritative party, inventory, equipment, gold and menu state. Each state section owns its validated actions; actor-owned stats remain in the actor section.
2. The `stock_menu` package owns replaceable menu navigation and presentation. Both TypeScript and RPGCode menu implementations receive equivalent semantic query/action capabilities through one shared contract, with language-appropriate calling syntax. The core validates and applies requested actions. Menu presentation contributes to the core draw list; menu code does not mutate section state or draw directly to a host window.
3. Epic 8 implements the Reawakened canonical save format only. Legacy `.sav` import is deferred.
4. Restore saved threads from serialized state only when compatibility matches. A compiler-version mismatch refuses the whole save with `restore.compiler-mismatch` and leaves the current game unchanged (owner ruling 2026-10-27, which supersedes this item's earlier "restart on compiler mismatch"). A source mismatch of a file-backed program restarts only that thread from source rather than resuming incompatible compiled instruction state. Existing callable/owner validation still applies: if a changed program leaves an unresolved saved callable reference, reject the save with the existing located restore error rather than silently discarding callable state.
5. `dialogue.completed` is a queued game-level event with plain-data detail `{ actorId, targetId, text }`, where `targetId` is an actor id or `null`. Normal interaction-wrapper completion emits it once; cancellation or failure emits none. The stock RPG package consumes it and emits actor-scoped `talked`.
6. Epic 8 owns `itemAdded`, `itemRemoved` and `goldChanged`. Party and inventory are the only additional built-in emitters: roster events are on `party`; inventory and gold events are on `inventory`. Events represent successful committed mutations only, are delivered exactly once after commit, and are absent for refused or no-op operations. `itemAdded` and `itemRemoved` details distinguish the inventory-entry identity from the item asset-definition identity; exact field names and semantics remain for the 8.4 plan. `goldChanged` detail is exactly `{ previous, current, delta }`.
7. The `stock_menu` replacement contract is an object-valued, read-only context plus named action capabilities, validated/applied by core. TypeScript and RPGCode expose equivalent semantics through language-appropriate calling syntax. The exact public method/action names, arguments, results and operation semantics remain for the 8.3, 8.4 and 8.7 plans; this ruling does not choose them.

*Rejected:* direct package mutation of party/inventory/equipment/gold/menu state, menus drawing directly to a host window, or making the host UI own game rules. These split authority and bypass deterministic core state/draw-list behavior.

## Deferred to implementation-ticket contracts

The exact menu query/action member names, public method names, argument/result records, action semantics and RPGCode calling syntax are not fixed here. The 8.3, 8.4 and 8.7 implementation plans MUST specify the contract details relevant to their consumers and validation/error behavior before implementation begins. The shared contract remains object-valued read-only context plus named actions validated by core; TypeScript and RPGCode must retain semantic parity. Do not infer exact item event field names or menu API names/arguments/results from this ruling.

## Evidence

| Ruling | Evidence |
| --- | --- |
| Core owns rules/state; replaceable menu owns navigation/presentation | `docs/spec/engine/plugins-and-battle.md` E-80 and `docs/guardrails.md` G2, G4 |
| Thread continuation must respect compiler/source compatibility | `docs/spec/formats/save-game.md` R-13 and field 46; `docs/spec/engine/rpgcode-language.md` restore compatibility checks |
| Dialogue completion is plain queued event data; actor bridge belongs to stock package | `docs/spec/engine/rpgcode-modules-and-objects.md` EMIT-13 and Epic 8 dialogue plans |
| Legacy import is explicitly deferred | `docs/spec/formats/save-game.md` R-13 / E-122 |

## Acceptance

The docs-only PR records accepted/deferred decisions and rejected alternatives, includes this evidence table and `OWNER` marker, and updates the affected spec and spine sections before dependent runtime work is ready.

## Follow-up ruling (owner approval, 2026-10-23)

The owner additionally approved party and inventory as the only additional built-in emitters; party roster events on `party`; `itemAdded`, `itemRemoved` and `goldChanged` on `inventory`; successful committed mutation records emitted exactly once after commit and none for refused/no-op operations; item identity distinguishing inventory-entry from asset-definition identity; and `goldChanged` detail `{ previous, current, delta }`. The owner also approved a read-only object-valued replacement-menu context with named core-validated action capabilities and TypeScript/RPGCode semantic parity. The owner approved preserving `callplayerswap(...)` as its existing unimplemented/no-op; party swaps remain party-owner/menu actions, with no new RPGCode function or signature. Exact item details and menu member shapes remain required in their consumer plans before relevant implementation. E-85 now establishes actor-owned party stats.

<!-- OWNER: 2026-10-23 follow-up approvals include preserving the `callplayerswap(...)` no-op; exact item-event fields and public menu API shapes remain deferred to entries 3, 4 and 7. -->

## Verification

Review the rendered spec and spine, confirm the exact payload and event ownership across each reference, and run ticket-tree validation after the written dependency model is updated.
