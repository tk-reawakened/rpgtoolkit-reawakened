---
title: "Item use, equip and remove programs"
type: 'feature'
ticket: 5
created: '2026-10-22'
risk: "high"
context:
  - "spec - docs/spec/engine/plugins-and-battle.md#e-73"
  - "spec - docs/spec/engine/plugins-and-battle.md#e-81"
  - "spec - docs/spec/engine/plugins-and-battle.md#e-82"
  - "spec - docs/spec/formats/item.md"
status: draft
blocked_at: "2026-10-31"
blocked_reason: "Awaiting the owner ruling on the menu item-use capability list: E-80/E-81 rule the menu screens and the inventory owner actions but no item-use action, and docs/spec/engine/actors.md:299 places the item battle program (prgFightUse) in Epic 7, so the Epic 8 item-use surface needs a ruling before implementation."
---

## Intent

Make item use and equipment programs act through the single inventory owner operation, whether triggered from the board, menu or battle.

## Boundaries

Apply documented HP/SMP effects, use/equip/remove programs, quantity changes, bonuses, caps, and event order. Do not implement screen navigation or duplicate battle inventory state.

## Acceptance

Script and Epic 7 battle fixtures demonstrate valid use, invalid targets, successful and refused equip/remove, exact program/effect order, and one-time quantity consumption using the same API.

## Verification

Run deterministic tests at each side-effect boundary; assert final state and queued event sequences and replay from a saved point. Include item uses that do not consume when the documented operation fails.

## Implementation map

Compose entry 4 operations with the existing script scheduler; have battle's item action call the shared use operation instead of mutating inventory directly.
