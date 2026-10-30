---
title: "Validate saved equipment consistency against compatible assets"
type: 'feature'
ticket: 23
status: in-progress
created: '2026-10-30'
risk: "high"
context:
  - "normative - docs/spec/formats/save-game.md#game-ledger-and-savable-continuation"
  - "normative - docs/spec/engine/plugins-and-battle.md#e-81"
  - "normative - docs/spec/engine/plugins-and-battle.md#e-82"
  - "load ownership - story-load-validation-restore-order-and-thread-continuation-plan.md"
---

## Intent

Add the asset-aware equipment check a recovery candidate must pass before it is accepted (#797). The saved inventory equipment tuples are authoritative; an actor's equipment references and bonuses are a derived projection that must match the current item and character definitions exactly, or the candidate is refused.

## Contract and boundaries

The accepted ledger ruling in `docs/spec/formats/save-game.md#game-ledger-and-savable-continuation` says inventory equipment assignments are authoritative and actor equipment bonuses and references are derived and must be validated or rebuilt consistently. E-81 defines the stack and available-quantity rule; E-82 defines the deterministic tuple reference, the catalog, the eligibility rule and the derived bonuses.

- Validation is pure and read-only: no I/O, no mutation, no `applyEquipment` and no behaviour hook. A projection customised by an `equipmentChanged` or stats hook therefore fails closed instead of being reset.
- A missing or malformed item or character definition refuses the candidate. No default is substituted for a changed asset and no saved stat is rewritten.
- A nonempty saved actor equipment projection with no matching inventory tuple is refused as unsafe. There is no migration that invents a tuple and no reset that discards saved progress.
- Eligibility for a saved tuple is slot and asset based only (`validEquipmentSlot`). The `usedBy` name list is checked by the live `equip` operation against `actor.name`, but a name is script-writable progress: an actor renamed after a valid equip must still restore, so the consistency check must not consult it.
- Normal save bytes, the actor-section restore path, the ledger hash and the game-save roster are unchanged. This is not the #593 untrusted-blob pipeline and not recovery eligibility (#782/#783/#779); it is the check those callers can run on their validated readback.

## Implementation map

- `packages/core/src/menu/equipment.ts` holds the pure derivation the live `equip` path already used (`slotLocation`, `equippedReference`, `equipmentCatalog`, `validEquipmentSlot`, `validEquipment`); `packages/core/src/menu/inventory.ts` imports it, so the check and the operation share one rule set, while the check uses the actor-independent `validEquipmentSlot`.
- `packages/core/src/actors/rules.ts` exports the existing pure bonus derivation as `deriveEquipmentBonuses`; `applyEquipment` still uses it internally.
- `packages/core/src/save/equipment-check.ts` exports `checkEquipmentConsistency(inventory, actors, assets)` with an `EquipmentAssetLookup` of read-only `item(source)` / `character(source)` functions, returning a located `StateIssue` on refusal. `packages/core/src/save/index.ts` re-exports the API.
- `packages/core/test/save-equipment-check.test.ts` covers a consistent candidate, each refusal class with its path, duplicate item filenames in distinct slots, no side effects on frozen inputs, a changed asset, the legacy nonempty-projection refusal and a live equip followed by an actor-owner rename.

## Acceptance

Compatible assets with a consistent projection validate without side effects. Changed, missing or inconsistent assets are refused with a located diagnostic. Legacy nonempty actor equipment without inventory tuples is refused by the documented rule. Normal save/load behaviour and canonical bytes are unchanged.

## Verification

`node --test packages/core/test/save-equipment-check.test.ts` plus the existing menu-state, save-migration and engine suites, `typecheck`, `lint`, `graph`, `golden` and the provenance scan. The focused test must stay under the one-second owner rule.

## Unresolved

Wiring the check into a recovery promotion path belongs to #782/#783/#779; this slice exposes the pure API and does not call it from restore or from any host.
